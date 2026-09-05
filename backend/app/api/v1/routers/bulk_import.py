import csv
import io
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_db, require_permission
from app.models.bulk_import import ImportBatch as ImportBatchModel
from app.models.bulk_import import ImportBatchRow as ImportBatchRowModel
from app.schemas.bulk_import import ImportBatch, ImportBatchRow
from app.services import bulk_import as service

router = APIRouter(prefix="/import-batches", tags=["bulk-import"])

# Coarse feature gate (app.has_permission -- "do you hold this anywhere at
# all"), matching every other require_permission() usage in this codebase.
# The scoped question -- "can you actually write THIS row" -- is answered
# per-row by employees_insert/employees_update RLS during commit, and per-
# batch by import_batches_insert/_select RLS (has_permission_on_company),
# never by this dependency alone. Two independent layers, same as Employee
# 360's employee.view_360 (route gate) vs hierarchy_subtree_employee_ids
# (row visibility).
require_bulk_import = require_permission("employee", "bulk_import")


@router.post("", response_model=ImportBatch, status_code=status.HTTP_201_CREATED)
async def create_import_batch(
    module: str = Form(...),
    company_id: uuid.UUID = Form(...),
    import_mode: str = Form(...),
    field_strategy: str = Form("non_empty_only"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_bulk_import),
) -> ImportBatchModel:
    """Stages a batch: parses the file, validates + classifies every row,
    writes them to import_batch_rows. Nothing touches the target table yet
    -- see POST /{id}/commit for that. import_batches_insert's RLS (has_
    permission_on_company) is what actually decides whether this caller may
    stage a batch for this specific company; the coarse require_bulk_import
    dependency above only confirms they hold the permission somewhere.
    """
    try:
        rows = await service.parse_csv(file)
        batch = await service.stage_batch(
            db,
            module=module,
            initiated_by=uuid.UUID(current.employee_id),
            company_id=company_id,
            import_mode=import_mode,
            field_strategy=field_strategy,
            file_name=file.filename or "upload.csv",
            rows=rows,
        )
    except service.ImportError_ as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return batch


@router.get("", response_model=list[ImportBatch])
async def list_import_batches(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_bulk_import),
) -> list[ImportBatchModel]:
    """No manual filtering -- import_batches_select's own RLS (initiated_by
    = self, or has_permission_on_company for admin oversight) already scopes
    this to exactly what the caller should see, same "the query looks like
    select everything because RLS already scoped it" pattern used throughout
    this codebase.
    """
    result = await db.execute(select(ImportBatchModel).order_by(ImportBatchModel.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{batch_id}", response_model=ImportBatch)
async def get_import_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_bulk_import),
) -> ImportBatchModel:
    batch = await db.get(ImportBatchModel, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
    return batch


@router.get("/{batch_id}/rows", response_model=list[ImportBatchRow])
async def list_import_batch_rows(
    batch_id: uuid.UUID,
    action: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_bulk_import),
) -> list[ImportBatchRowModel]:
    stmt = select(ImportBatchRowModel).where(ImportBatchRowModel.batch_id == batch_id).order_by(ImportBatchRowModel.row_number)
    if action is not None:
        stmt = stmt.where(ImportBatchRowModel.action == action)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/{batch_id}/commit", response_model=ImportBatch)
async def commit_import_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_bulk_import),
) -> ImportBatchModel:
    """A security review found the previous read-then-check-then-process
    shape here had a real double-submit race: a double-click or retried
    request could both read status='previewed' before either write landed,
    processing the same batch twice. Claiming the batch atomically first
    (previewed -> committing, in one UPDATE ... WHERE ... RETURNING) closes
    that -- a losing concurrent request's UPDATE affects 0 rows and gets a
    409, the same compare-and-set idiom already used for approve/reject
    elsewhere in this codebase. The ownership/ RLS-visibility check still
    happens first via db.get() (import_batches_select), same as before.
    """
    batch = await db.get(ImportBatchModel, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
    if batch.initiated_by != uuid.UUID(current.employee_id):
        # Only the person who staged a batch can commit it -- an admin with
        # oversight visibility (has_permission_on_company) can SEE someone
        # else's batch via RLS, but committing someone else's staged import
        # on their behalf isn't a scenario this phase supports.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the employee who staged this batch can commit it")

    claim = await db.execute(
        text("update import_batches set status = 'committing' where id = :id and status = 'previewed' returning id"),
        {"id": str(batch_id)},
    )
    if claim.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Batch is '{batch.status}', not 'previewed' -- it may already be committed",
        )
    await db.refresh(batch)

    return await service.commit_batch(db, batch)


@router.post("/{batch_id}/revalidate", response_model=list[ImportBatchRow])
async def revalidate_import_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_bulk_import),
) -> list[ImportBatchRowModel]:
    """Re-checks every row's already-stored raw_data against current data
    (including the Org Chart, for a module with position columns) without
    re-uploading the file -- for fixing a row that was rejected because a
    referenced org unit/position didn't exist yet, then confirming the fix
    before committing. Same ownership rule as commit: only the employee who
    staged the batch can revalidate it.
    """
    batch = await db.get(ImportBatchModel, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
    if batch.status != "previewed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Batch is '{batch.status}', not 'previewed' -- it may already be committed",
        )
    if batch.initiated_by != uuid.UUID(current.employee_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the employee who staged this batch can revalidate it")

    return await service.revalidate_batch(db, batch)


def _sanitize_csv_cell(value: object) -> str:
    """CSV/Excel formula-injection mitigation: a cell opened in Excel that
    starts with =, +, -, or @ can execute as a formula. Prefixing with a
    leading apostrophe forces Excel (and Sheets) to treat it as literal text.
    """
    text_value = "" if value is None else str(value)
    if text_value[:1] in ("=", "+", "-", "@"):
        return f"'{text_value}"
    return text_value


@router.get("/{batch_id}/log")
async def download_import_log(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_bulk_import),
) -> StreamingResponse:
    batch = await db.get(ImportBatchModel, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")

    result = await db.execute(
        select(ImportBatchRowModel).where(ImportBatchRowModel.batch_id == batch_id).order_by(ImportBatchRowModel.row_number)
    )
    rows = result.scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["row_number", "matching_key_value", "action", "validation_errors", "raw_data"])
    for row in rows:
        writer.writerow(
            [
                row.row_number,
                _sanitize_csv_cell(row.matching_key_value),
                row.action,
                _sanitize_csv_cell("; ".join(row.validation_errors) if row.validation_errors else ""),
                _sanitize_csv_cell(row.raw_data),
            ]
        )
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="import-batch-{batch_id}-log.csv"'},
    )
