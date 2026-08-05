"""Generic, configuration-driven Bulk Import Center engine.

Adding a new module (Projects, Goals, KPIs, ...) means adding one entry to
IMPORT_MODULE_REGISTRY -- once that module's own migration has added a real
business-identifier column -- not changing any function below. That's the
whole point of the config-driven design: the engine only ever reads a
module's table/matching-key/fields from its ImportModuleConfig, never
hardcodes them.

Two-phase flow: stage_batch() parses + validates + classifies every row
into import_batch_rows (nothing touches the target table yet -- this is
what the preview screen and downloadable log read from), then a separate
commit_batch() call actually writes.
"""

import csv
import io
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import UploadFile
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bulk_import import ImportBatch, ImportBatchRow


@dataclass(frozen=True)
class ImportModuleConfig:
    table: str
    matching_key: str
    # A second unique column worth pre-checking for cross-row conflicts
    # (e.g. employees has both work_email and employee_number independently
    # unique) -- optional, most future modules won't need one.
    alternate_matching_key: str | None
    required_fields: tuple[str, ...]
    # Every field the CSV is allowed to set or update, matching_key and
    # alternate_matching_key included. Deliberately NOT including fields
    # with side-effecting business logic elsewhere (employees.status is
    # excluded here on purpose -- see offboard_employee in employees.py).
    importable_fields: tuple[str, ...]
    permission: tuple[str, str]


IMPORT_MODULE_REGISTRY: dict[str, ImportModuleConfig] = {
    "employees": ImportModuleConfig(
        table="employees",
        matching_key="work_email",
        alternate_matching_key="employee_number",
        required_fields=("work_email", "first_name", "last_name"),
        importable_fields=(
            "work_email",
            "first_name",
            "last_name",
            "employee_number",
            "personal_email",
            "phone",
            "hire_date",
            "employment_type",
        ),
        permission=("employee", "bulk_import"),
    ),
}


class ImportError_(Exception):
    """Raised for whole-file problems (bad module name, empty file, no
    header row) -- distinct from per-row validation errors, which never
    raise: they're recorded on the row and the batch keeps processing.
    """


def get_module_config(module: str) -> ImportModuleConfig:
    config = IMPORT_MODULE_REGISTRY.get(module)
    if config is None:
        raise ImportError_(f"Unknown import module: {module!r}. Available: {sorted(IMPORT_MODULE_REGISTRY)}")
    return config


async def parse_csv(file: UploadFile) -> list[dict[str, str]]:
    raw = await file.read()
    try:
        text_content = raw.decode("utf-8-sig")  # -sig strips a BOM, which Excel adds when saving CSV
    except UnicodeDecodeError as exc:
        raise ImportError_("File is not valid UTF-8 text.") from exc
    reader = csv.DictReader(io.StringIO(text_content))
    if not reader.fieldnames:
        raise ImportError_("File has no header row.")
    rows = list(reader)
    if not rows:
        raise ImportError_("File has a header row but no data rows.")
    return rows


_EMPLOYMENT_TYPES = {"full_time", "part_time", "contractor"}


def _validate_row(row: dict[str, str], config: ImportModuleConfig, *, is_new_record: bool) -> list[str]:
    """required_fields only applies to rows that will become a brand new
    record -- a row UPDATING an existing match is allowed to leave
    first_name/last_name blank (non_empty_only's whole point is "blank
    means leave it alone"), so requiring them there would reject perfectly
    valid updates that just aren't touching those fields.
    """
    errors: list[str] = []
    if is_new_record:
        for field_name in config.required_fields:
            if not (row.get(field_name) or "").strip():
                errors.append(f"Missing required field: {field_name}")
    work_email = (row.get("work_email") or "").strip()
    if work_email and "@" not in work_email:
        errors.append("work_email is not a valid email address")
    employment_type = (row.get("employment_type") or "").strip()
    if employment_type and employment_type not in _EMPLOYMENT_TYPES:
        errors.append(f"employment_type must be one of {sorted(_EMPLOYMENT_TYPES)}")
    return errors


async def stage_batch(
    db: AsyncSession,
    *,
    module: str,
    initiated_by: uuid.UUID,
    company_id: uuid.UUID,
    import_mode: str,
    field_strategy: str,
    file_name: str,
    rows: list[dict[str, str]],
) -> ImportBatch:
    config = get_module_config(module)

    batch = ImportBatch(
        module=module,
        initiated_by=initiated_by,
        company_id=company_id,
        import_mode=import_mode,
        field_strategy=field_strategy,
        file_name=file_name,
        status="staged",
        row_count=len(rows),
    )
    db.add(batch)
    await db.flush()

    # Bulk existence check, one query per key column -- not one query per
    # row. This is also what makes pre-commit conflict detection possible:
    # a CSV row can match an existing record on work_email but collide with
    # a DIFFERENT existing record's employee_number, which a naive
    # single-key dedupe would miss until it hit a unique-constraint
    # violation at commit time.
    def _clean_values(key: str) -> list[str]:
        return [v for v in (((row.get(key) or "").strip()) for row in rows) if v]

    matching_values = _clean_values(config.matching_key)
    existing_by_key: dict[str, uuid.UUID] = {}
    if matching_values:
        result = await db.execute(
            text(f"select id, {config.matching_key} as key from {config.table} where {config.matching_key} = any(:vals)"),
            {"vals": matching_values},
        )
        existing_by_key = {row.key: row.id for row in result.mappings()}

    existing_by_alt: dict[str, uuid.UUID] = {}
    if config.alternate_matching_key:
        alt_values = _clean_values(config.alternate_matching_key)
        if alt_values:
            result = await db.execute(
                text(
                    f"select id, {config.alternate_matching_key} as key from {config.table} "
                    f"where {config.alternate_matching_key} = any(:vals)"
                ),
                {"vals": alt_values},
            )
            existing_by_alt = {row.key: row.id for row in result.mappings()}

    for i, row in enumerate(rows, start=1):
        key_value = (row.get(config.matching_key) or "").strip()
        alt_value = (row.get(config.alternate_matching_key) or "").strip() if config.alternate_matching_key else ""

        existing_id = existing_by_key.get(key_value) if key_value else None
        alt_existing_id = existing_by_alt.get(alt_value) if alt_value else None

        errors = _validate_row(row, config, is_new_record=existing_id is None)

        if alt_existing_id is not None and existing_id is not None and alt_existing_id != existing_id:
            errors.append(
                f"{config.alternate_matching_key} '{alt_value}' belongs to a different existing "
                f"record than {config.matching_key} '{key_value}'"
            )
        elif alt_existing_id is not None and existing_id is None:
            errors.append(f"{config.alternate_matching_key} '{alt_value}' is already used by a different existing record")

        if errors:
            action = "reject"
        elif existing_id is not None:
            # insert_only and skip_duplicates currently produce identical
            # behavior for an existing match (do nothing, report skipped) --
            # both names describe "leave existing records alone", just from
            # two different angles the original brief used. Flagging this
            # explicitly rather than inventing an undocumented distinction;
            # revisit if these two are meant to diverge.
            action = "update" if import_mode in ("upsert", "update_only") else "skip"
        else:
            action = "skip" if import_mode == "update_only" else "insert"

        db.add(
            ImportBatchRow(
                batch_id=batch.id,
                row_number=i,
                raw_data=row,
                matching_key_value=key_value or None,
                action=action,
                target_record_id=existing_id,
                validation_errors=errors or None,
            )
        )

    batch.status = "previewed"
    await db.flush()
    await db.refresh(batch)
    return batch


def _coerce_value(field: str, value: str) -> object:
    """Raw SQL via text() skips SQLAlchemy's normal type coercion, so a
    bind param goes to asyncpg exactly as Python typed it -- and unlike
    psycopg2, asyncpg does NOT implicitly parse a plain str into a
    datetime.date for a `date`-typed column/parameter (raises a DataError
    instead). employment_type (a Postgres enum) is fine as a plain str --
    asyncpg's enum codec handles that automatically. hire_date is the one
    field in Phase 1 that needs explicit parsing.
    """
    if field == "hire_date" and value:
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise _RejectedRow(f"Rejected: hire_date '{value}' is not a valid date (expected YYYY-MM-DD)") from exc
    return value


def _jsonable(value: object) -> object:
    """Raw asyncpg rows carry UUID/date/datetime/Decimal values -- none of
    those are JSON-serializable by the default encoder SQLAlchemy's JSONB
    binding uses, and old_data needs to survive as a plain JSON snapshot.
    """
    if isinstance(value, (uuid.UUID, date, datetime, Decimal)):
        return str(value)
    return value


async def commit_batch(db: AsyncSession, batch: ImportBatch) -> ImportBatch:
    config = get_module_config(batch.module)

    result = await db.execute(
        select(ImportBatchRow).where(ImportBatchRow.batch_id == batch.id).order_by(ImportBatchRow.row_number)
    )
    batch_rows = list(result.scalars().all())

    inserted = updated = skipped = rejected = 0

    for batch_row in batch_rows:
        if batch_row.action == "skip":
            skipped += 1
            continue
        if batch_row.action == "reject":
            rejected += 1
            continue

        raw = batch_row.raw_data

        try:
            # SAVEPOINT per row: Postgres aborts the whole enclosing
            # transaction on any statement error (including an RLS
            # WITH CHECK violation on INSERT, which -- unlike a blocked
            # UPDATE's USING clause -- raises instead of silently matching
            # zero rows). Without begin_nested() here, one row a caller
            # isn't allowed to write would poison every row after it in
            # the same batch.
            async with db.begin_nested():
                if batch_row.action == "insert":
                    target_id = await _execute_insert(db, config, raw, batch.initiated_by)
                    batch_row.old_data = None
                else:
                    target_id, old_row = await _execute_update(db, config, raw, batch_row.target_record_id, batch.field_strategy)
                    if target_id is None:
                        raise _RejectedRow("Rejected: record no longer exists or is not visible to you")
                    batch_row.old_data = {k: _jsonable(v) for k, v in old_row.items()}
        except _RejectedRow as exc:
            batch_row.action = "reject"
            batch_row.validation_errors = [str(exc)]
            rejected += 1
            continue
        except Exception as exc:  # noqa: BLE001 -- deliberately broad: any DB error rejects just this row
            batch_row.action = "reject"
            batch_row.validation_errors = [f"Rejected: insufficient permission or database error ({type(exc).__name__})"]
            rejected += 1
            continue

        # No exception means _execute_insert/_execute_update already
        # returned a real id (both raise _RejectedRow rather than
        # returning None on failure) -- nothing further to check here.
        batch_row.target_record_id = target_id
        batch_row.committed_at = datetime.now(timezone.utc)
        if batch_row.action == "insert":
            inserted += 1
        else:
            updated += 1

    batch.status = "committed"
    batch.inserted_count = inserted
    batch.updated_count = updated
    batch.skipped_count = skipped
    batch.rejected_count = rejected
    batch.committed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(batch)
    return batch


class _RejectedRow(Exception):
    pass


async def _execute_insert(db: AsyncSession, config: ImportModuleConfig, raw: dict, initiated_by: uuid.UUID) -> uuid.UUID | None:
    fields = [f for f in config.importable_fields if (raw.get(f) or "").strip()]
    if not fields:
        raise _RejectedRow("Rejected: no fields to insert")
    columns = ", ".join([*fields, "created_by"])
    placeholders = ", ".join([f":{f}" for f in fields] + [":created_by"])
    params = {f: _coerce_value(f, raw.get(f).strip()) for f in fields}
    params["created_by"] = str(initiated_by)
    result = await db.execute(
        text(f"insert into {config.table} ({columns}) values ({placeholders}) returning id"),
        params,
    )
    row = result.mappings().one_or_none()
    return row["id"] if row else None


async def _execute_update(
    db: AsyncSession, config: ImportModuleConfig, raw: dict, target_id: uuid.UUID | None, field_strategy: str
) -> tuple[uuid.UUID | None, dict]:
    if target_id is None:
        return None, {}

    existing = await db.execute(text(f"select * from {config.table} where id = :id"), {"id": target_id})
    existing_row = existing.mappings().one_or_none()
    if existing_row is None:
        return None, {}

    fields = [f for f in config.importable_fields if f != config.matching_key]
    if field_strategy == "overwrite_all":
        # Every importable field is set, blank cells included -- a blank
        # cell clears the field to NULL.
        set_fields = fields
        params = {f: (_coerce_value(f, (raw.get(f) or "").strip()) or None) for f in set_fields}
    else:
        # non_empty_only: a field is only included in the SET clause at
        # all when the CSV cell had a real value -- simply omitting it
        # (rather than a SQL-side COALESCE/NULLIF) is what keeps this
        # correct for non-text columns like hire_date, where comparing a
        # typed bind parameter against an untyped '' literal would fail to
        # cast.
        set_fields = [f for f in fields if (raw.get(f) or "").strip()]
        params = {f: _coerce_value(f, raw.get(f).strip()) for f in set_fields}

    if not set_fields:
        # Matched, but every importable field was blank -- nothing to
        # change; still a legitimate "update" outcome, not a rejection.
        return existing_row["id"], dict(existing_row)

    set_clause = ", ".join(f"{f} = :{f}" for f in set_fields)
    params["id"] = target_id
    result = await db.execute(text(f"update {config.table} set {set_clause} where id = :id returning id"), params)
    row = result.mappings().one_or_none()
    return (row["id"], dict(existing_row)) if row else (None, {})
