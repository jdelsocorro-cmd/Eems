# Bulk Import Center

A generic, configuration-driven CSV import tool: upload a file, review exactly what will be
inserted/updated/skipped/rejected, then commit. Nothing touches a real table until you explicitly
commit. Every import is tracked as a batch with a full row-by-row audit trail.

**Where to find it:** Admin → Bulk Import (`/admin/bulk-import`). Requires the
`employee.bulk_import` permission — granted by default to Super Admin and HR/People Admin.

## Phase 1 scope: Employees only

Bulk Import currently supports one module: **Employees**. Projects, Goals, and KPIs aren't
available yet — none of them has a stable business identifier (a "code") in the database today,
and a business identifier is required before a module can be registered. See
[Future modules](#future-modules) below.

## How matching works

Every module defines a **matching key** — a business identifier, not a database ID — used to
detect whether a CSV row refers to a record that already exists.

- **Employees' matching key is `work_email`** (always present, always unique in the database).
- `employee_number` is checked too, as a secondary safeguard: if a row's `work_email` matches one
  existing employee but its `employee_number` belongs to a *different* existing employee, the row
  is rejected before anything is written, with an explanation, rather than either silently
  corrupting a record or crashing partway through the batch.

This is genuinely configuration, not something baked into the import logic — a future module adds
its own matching key (e.g. `project_code` for Projects) without changing how imports work.

## CSV format

A ready-to-edit sample file is available from the upload form itself ("Download sample CSV"),
or directly at `frontend/public/samples/employees-import-sample.csv` in the repo.

**Employees** — plain CSV, first row = headers, exact column names below (all except
`work_email`/`first_name`/`last_name` are optional and can be omitted or left blank per row):

| Column | Required | Notes |
|---|---|---|
| `work_email` | for new employees | Matching key. Must look like a real email address. |
| `first_name` | for new employees | |
| `last_name` | for new employees | |
| `employee_number` | no | Checked for cross-record conflicts (see above). |
| `personal_email` | no | |
| `phone` | no | |
| `hire_date` | no | `YYYY-MM-DD` |
| `employment_type` | no | One of `full_time`, `part_time`, `contractor` |
| `org_unit_name` | no | Org unit name, exact match against the current Org Chart. Must be filled in together with `position_code`, or both left blank. |
| `position_code` | no | Position code *within that org unit*, exact match against the current Org Chart. See [Assigning a position](#assigning-a-position-org_unit_name--position_code) below. |

"Required for new employees" means: a row that will **update** an existing match doesn't need
`first_name`/`last_name` filled in — leaving them blank there just means "don't change this
field" (see Field strategy below). A row that doesn't match anyone existing (a genuine new hire)
does need them.

**Not importable:** `status` (active/on_leave/offboarded). Even if a `status` column is present
in the file, it's ignored. Status changes go through the dedicated Offboard flow in Users, which
also closes position assignments and disables login — a bulk import deliberately can't bypass
that.

## Assigning a position (`org_unit_name` + `position_code`)

A row can also assign the employee to a seat in the Org Chart — **both** columns together, or
**both** left blank (leave their position untouched). One filled in without the other is treated
as an error, not a guess.

**The Org Chart is the single source of truth — nothing is ever auto-created.** A row referencing
an org unit or position that doesn't already exist is **rejected outright**: the employee record
itself is *not* created or updated either, even though that part alone would have succeeded. This
is deliberate — a half-applied row (employee written, position silently skipped) would be more
confusing than a clean rejection with a clear reason.

Because position codes are only unique *within* their own org unit (two different org units can
both have a position coded `M1`), the org unit is resolved first by name, then the position by
code within it:

1. **Org unit not found**, or the name matches more than one org unit → rejected, with the exact
   name that didn't resolve.
2. **Position not found** under that org unit → rejected, naming both the org unit and the code.
3. **Position already held by someone else** → rejected (reassigning an employee to the position
   they *already* hold is fine — that's a no-op, not a conflict).

Assigning a position requires `org_structure.manage`, the same permission the existing
single-employee "Reassign Position" control (in Users) requires, in addition to
`employee.bulk_import`. Super Admin already holds both.

**Fix and retry without re-uploading:** if rows were rejected because a position or org unit
didn't exist yet, add it in Org Admin, then click **Revalidate** on the still-`previewed` batch —
every row is re-checked against the current Org Chart in place, no new file upload needed. Commit
also re-checks fresh at the moment you click it, so this is always accurate even if you don't
click Revalidate first.

## Import modes

Choose one when uploading:

| Mode | New rows | Rows that already exist |
|---|---|---|
| **Insert New Only** | Inserted | Left alone |
| **Insert + Update Existing** (default) | Inserted | Updated |
| **Update Existing Only** | Skipped | Updated |
| **Skip Duplicates** | Inserted | Left alone |

> **Note:** "Insert New Only" and "Skip Duplicates" currently behave identically — both insert
> new rows and leave existing matches untouched. They're kept as separate options because the
> original spec named them separately; if you need them to diverge (e.g. "Skip Duplicates" should
> also validate-but-not-insert), that's a small, well-isolated change to make.

## Field strategy (how updates are applied)

| Strategy | Behavior |
|---|---|
| **Update only non-empty values** (default) | A blank cell means "leave this field as-is." Only columns with an actual value in the row are changed. |
| **Overwrite all fields** | Every importable column is set to exactly what's in the row — a blank cell **clears** that field. |

## Preview before commit

After upload, every row is classified and shown in a table before anything is written:

- **Insert** — a new record will be created
- **Update** — an existing record (shown by its matching key) will be updated
- **Skip** — no action, per the chosen import mode
- **Reject** — won't be written, with a reason (missing required field, invalid email, a
  cross-key conflict, or — discovered only at commit time — insufficient permission to write that
  specific record)

Nothing is written to the Employees table until you click **Commit Import**. You can filter the
preview table by action (All/Insert/Update/Skip/Reject) to review any category before committing.

## Who can import which records

Two independent layers, same pattern used everywhere else in this app:

1. **`employee.bulk_import`** gates the feature itself — whether you can open Bulk Import at all.
2. **Row Level Security (RLS)** governs which specific records you can actually write, exactly as
   it does for every other create/update in the app. A leader with narrower access than a Super
   Admin can run an import, but any row outside their accessible scope comes back **Rejected**
   (visible in the preview/summary and the downloaded log) rather than silently failing the whole
   batch or being written anyway.

If a row also assigns a position (`org_unit_name` + `position_code`), a third requirement
applies: `org_structure.manage`, scoped to that position's company — the same permission the
single-employee "Reassign Position" control already requires. Missing it rejects only the
position-assignment part of that row, but per the atomicity rule above, that rejects the *whole*
row, including the employee write that would otherwise have succeeded.

Bulk-imported employees are **never** sent an invite email, regardless of how many rows are in
the file — inviting someone is a separate, existing action (in Users, or via `send_invite` on a
single employee creation).

## After commit: summary, history, and the log

Each committed batch shows final counts (inserted / updated / skipped / rejected) and a
**Download log** button — a CSV of every row, its outcome, and any error, safe to open in Excel
(cells that look like formulas are escaped so they can't execute). Every batch you've run — or
that you have oversight visibility into — is listed under Import History, click through to see
its full detail again at any time.

## Current limitations

- **Employees only.** Projects/Goals/KPIs need their own migration (a `code` column) before they
  can be added.
- **CSV only**, fixed column headers — no Excel upload, no column-mapping UI yet.
- **No rollback action yet.** The data needed for a future rollback (a snapshot of each updated
  record's prior values) is already being captured on every import, but there's no "undo this
  batch" button yet.
- **Synchronous, single-request processing.** Fine at the scale of a few hundred rows; a very
  large file would need background/async processing, which doesn't exist yet.

## Future modules

Projects, Goals, and KPIs will each need:
1. A migration adding a real business-identifier column (e.g. `project_code`, `goal_code`,
   `kpi_code`) with a unique constraint — none of the three has one today.
2. A decision on what that code should be for every *existing* row, before the column can be
   made `not null unique`.
3. One new entry in `IMPORT_MODULE_REGISTRY` (`backend/app/services/bulk_import.py`) — table
   name, matching key, importable fields, required fields, permission. No changes to the import
   engine itself.

Cross-module references (e.g. a Projects import naming an owner by email rather than a database
ID) will also need a small addition: resolving a foreign key via another module's matching key,
not its own.
