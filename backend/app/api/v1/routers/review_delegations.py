import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import ReviewDelegation as ReviewDelegationModel
from app.schemas.completion import ReviewDelegation, ReviewDelegationCreate

router = APIRouter(prefix="/review-delegations", tags=["review-delegations"])


@router.get("", response_model=list[ReviewDelegation])
async def list_review_delegations(
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> list[ReviewDelegationModel]:
    """No manual scoping beyond "mine" -- review_delegations_select's own
    RLS (delegator, delegate, or role.manage for admin oversight) already
    narrows this to exactly what the caller should see. Explicit filter
    here anyway (rather than select-everything-RLS-scopes-it) since the
    role.manage admin branch would otherwise return every company's
    delegations to an admin with no way to ask "just mine" -- this always
    returns "given by me OR received by me", the common case for the
    Account Settings UI this backs.
    """
    employee_id = uuid.UUID(current.employee_id)
    result = await db.execute(
        select(ReviewDelegationModel)
        .where(or_(ReviewDelegationModel.delegator_employee_id == employee_id, ReviewDelegationModel.delegate_employee_id == employee_id))
        .order_by(ReviewDelegationModel.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=ReviewDelegation, status_code=status.HTTP_201_CREATED)
async def create_review_delegation(
    payload: ReviewDelegationCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> ReviewDelegationModel:
    """No permission gate -- review_delegations_insert's own RLS (delegator_
    employee_id = self) is the real authorization, same low-friction "you
    can only act on your own record" reasoning recognitions_insert already
    uses. You can only ever lend out your OWN review authority.
    """
    delegation = ReviewDelegationModel(
        delegator_employee_id=uuid.UUID(current.employee_id),
        delegate_employee_id=payload.delegate_employee_id,
        start_date=payload.start_date or date.today(),
        end_date=payload.end_date,
        reason=payload.reason,
        created_by=uuid.UUID(current.employee_id),
    )
    db.add(delegation)
    await db.flush()
    await db.refresh(delegation)
    return delegation


@router.delete("/{delegation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_review_delegation(
    delegation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """RETURNING-then-check, not a bare db.get()+setattr() -- review_
    delegations_select is broader than _revoke (a delegate can see a
    delegation naming them but can't revoke it themselves), so a naive
    fetch-then-update would find the row via the broad select policy and
    then have its UPDATE silently blocked (0 rows) by the narrower revoke
    policy -- the same failure class documented on completion_submissions'
    approve/reject endpoints.
    """
    result = await db.execute(
        text("update review_delegations set revoked_at = now() where id = :id and revoked_at is null returning id"),
        {"id": str(delegation_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delegation not found, already revoked, or you don't have rights to revoke it",
        )
    await db.flush()
