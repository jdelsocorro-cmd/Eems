import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

ImportMode = Literal["insert_only", "upsert", "update_only", "skip_duplicates"]
FieldStrategy = Literal["non_empty_only", "overwrite_all"]
ImportBatchStatus = Literal["staged", "previewed", "committed", "failed", "rolled_back"]
ImportRowAction = Literal["insert", "update", "skip", "reject"]


class ImportBatch(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    module: str
    initiated_by: uuid.UUID
    company_id: uuid.UUID
    import_mode: ImportMode
    field_strategy: FieldStrategy
    file_name: str
    status: ImportBatchStatus
    row_count: int
    inserted_count: int
    updated_count: int
    skipped_count: int
    rejected_count: int
    created_at: datetime
    committed_at: datetime | None
    rolled_back_at: datetime | None
    rolled_back_by: uuid.UUID | None


class ImportBatchRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_id: uuid.UUID
    row_number: int
    raw_data: dict[str, Any]
    matching_key_value: str | None
    action: ImportRowAction
    target_record_id: uuid.UUID | None
    old_data: dict[str, Any] | None
    validation_errors: list[str] | None
    committed_at: datetime | None
