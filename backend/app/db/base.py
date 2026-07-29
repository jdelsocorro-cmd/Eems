from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base. Models mirror the hand-written SQL migrations
    in supabase/migrations/ (source of truth for schema, triggers, and RLS --
    see the plan's decision to use raw SQL migrations, not Alembic
    autogenerate) rather than generating them.
    """
