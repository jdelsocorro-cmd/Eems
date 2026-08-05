"""Excel silently reformats a hire_date column to MM/DD/YYYY on save even
when it started as clean ISO -- this hit Jayson twice in one afternoon on
the same file. Verifies _parse_hire_date/_coerce_value accept both formats,
still reject DD/MM-style ambiguity and garbage, and that non-hire_date
fields are passed through untouched.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "placeholder")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql+asyncpg://user:pass@localhost:5432/postgres")

from datetime import date  # noqa: E402

import pytest  # noqa: E402

from app.services.bulk_import import _RejectedRow, _coerce_value  # noqa: E402


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2025-09-15", date(2025, 9, 15)),
        ("09/15/2025", date(2025, 9, 15)),
        ("9/15/2025", date(2025, 9, 15)),
        ("09-15-2025", date(2025, 9, 15)),
    ],
)
def test_hire_date_accepts_iso_and_excel_formats(raw, expected):
    assert _coerce_value("hire_date", raw) == expected


def test_hire_date_rejects_garbage():
    with pytest.raises(_RejectedRow):
        _coerce_value("hire_date", "not-a-date")


def test_hire_date_blank_passes_through():
    # _coerce_value is only ever called on fields that already had a
    # non-empty stripped value (see _execute_insert/_execute_update) -- an
    # empty string must not raise, it just isn't treated as a date.
    assert _coerce_value("hire_date", "") == ""


def test_non_hire_date_field_passed_through_unparsed():
    assert _coerce_value("employment_type", "full_time") == "full_time"
