-- Adds an employment_type classification to employees themselves (Full-Time
-- vs Part-Time Consultant), distinct from positions.employment_type which
-- describes the seat's intended nature, not the specific person's actual
-- classification. Reuses the existing employment_type enum (full_time,
-- part_time, contractor) rather than inventing a parallel type -- same
-- domain concept, just scoped to a different table. hire_date already
-- exists on employees (models/employee.py) and needed no migration.

alter table employees
  add column employment_type employment_type;
