import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.support import SupportTicket as SupportTicketModel
from app.models.support import SupportTicketNote as SupportTicketNoteModel
from app.schemas.support import (
    SupportTicket,
    SupportTicketCreate,
    SupportTicketNote,
    SupportTicketNoteCreate,
    SupportTicketUpdate,
)
from app.services import slack_notify
from app.services.completion_workflow import get_employee_company_id
from app.services.supabase_admin import generate_screenshot_signed_url

router = APIRouter(prefix="/support-tickets", tags=["support"])


@router.get("", response_model=list[SupportTicket])
async def list_support_tickets(
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[SupportTicketModel]:
    """No manual "mine vs all" branching -- support_tickets_select's own RLS
    (reported_by = self OR support_tickets.review on the company) already
    decides that; a reporter's query and a Super Admin's query hit the same
    endpoint and each just gets what they're entitled to see.
    """
    stmt = select(SupportTicketModel).order_by(SupportTicketModel.created_at.desc())
    if status_filter is not None:
        stmt = stmt.where(SupportTicketModel.status == status_filter)
    if severity is not None:
        stmt = stmt.where(SupportTicketModel.severity == severity)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=SupportTicket, status_code=status.HTTP_201_CREATED)
async def create_support_ticket(
    payload: SupportTicketCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> SupportTicketModel:
    """No permission gate -- anyone can report a problem, same low-friction
    reasoning as tasks_insert/recognitions_insert. screenshot_path (if
    present) points at an object the frontend already uploaded directly to
    the private support-screenshots bucket via the caller's own Supabase
    session -- this endpoint never touches the file itself, only its path.
    """
    employee_id = uuid.UUID(current.employee_id)
    company_id = await get_employee_company_id(db, employee_id)
    if company_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active company assignment found for this account")

    ticket = SupportTicketModel(**payload.model_dump(), company_id=company_id, reported_by=employee_id)
    db.add(ticket)
    await db.flush()
    await db.refresh(ticket)

    settings = get_settings()
    await slack_notify.notify_support_ticket_created(ticket, settings.frontend_url)

    return ticket


@router.patch("/{ticket_id}", response_model=SupportTicket)
async def update_support_ticket(
    ticket_id: uuid.UUID,
    payload: SupportTicketUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("support_tickets", "review")),
) -> SupportTicketModel:
    """RETURNING-then-check -- support_tickets_select is broader than
    support_tickets_review (the reporter can see their own ticket but can't
    change its status/severity/assignment), so a naive db.get()+setattr()
    would silently no-op under RLS for anyone who isn't an actual reviewer
    for this ticket's company, same failure class as everywhere else in this
    codebase that has this asymmetry.
    """
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        ticket = await db.get(SupportTicketModel, ticket_id)
        if ticket is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found")
        return ticket

    set_clauses = ", ".join(f"{col} = :{col}" for col in fields)
    result = await db.execute(
        text(f"update support_tickets set {set_clauses} where id = :id returning id"),
        {**fields, "id": str(ticket_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support ticket not found, or you don't have rights to update it",
        )
    ticket = await db.get(SupportTicketModel, ticket_id)
    await db.refresh(ticket)
    return ticket


@router.get("/{ticket_id}/notes", response_model=list[SupportTicketNote])
async def list_support_ticket_notes(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("support_tickets", "review")),
) -> list[SupportTicketNoteModel]:
    result = await db.execute(
        select(SupportTicketNoteModel)
        .where(SupportTicketNoteModel.ticket_id == ticket_id)
        .order_by(SupportTicketNoteModel.created_at)
    )
    return list(result.scalars().all())


@router.post("/{ticket_id}/notes", response_model=SupportTicketNote, status_code=status.HTTP_201_CREATED)
async def add_support_ticket_note(
    ticket_id: uuid.UUID,
    payload: SupportTicketNoteCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("support_tickets", "review")),
) -> SupportTicketNoteModel:
    note = SupportTicketNoteModel(ticket_id=ticket_id, employee_id=uuid.UUID(current.employee_id), note=payload.note)
    db.add(note)
    await db.flush()
    await db.refresh(note)
    return note


@router.get("/{ticket_id}/screenshot-url", response_model=str | None)
async def get_support_ticket_screenshot_url(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("support_tickets", "review")),
) -> str | None:
    ticket = await db.get(SupportTicketModel, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found")
    if not ticket.screenshot_path:
        return None
    return await generate_screenshot_signed_url(ticket.screenshot_path)
