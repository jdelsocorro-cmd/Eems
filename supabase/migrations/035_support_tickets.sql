-- ============================================================================
-- 035_support_tickets.sql
--
-- "Report Problem" -> a real support ticket, not a stray Slack message with
-- no context: title/description/category/severity plus auto-captured page
-- URL, browser info, and an optional screenshot. Visible only to Super
-- Admins per Jayson's explicit answer -- a lightweight status workflow
-- (new/acknowledged/in_progress/resolved/closed) with internal-only
-- resolution notes, room to grow into a full service desk later without a
-- schema change.
--
-- severity reuses the EXISTING priority_level enum (004_projects_tasks.sql)
-- rather than inventing a duplicate low/medium/high/critical type --
-- already shared by projects.priority and tasks.priority, same values mean
-- the same thing here.
--
-- New permission `support_tickets.review`, Super Admin only (same
-- single-role-grant shape as help_articles.manage in 034) -- deliberately
-- NOT extended to Department Head/Manager, unlike completion.review (030),
-- since Jayson was explicit that only Super Admins should see these.
-- ============================================================================

insert into permissions (resource, action, description) values
  ('support_tickets', 'review', 'View, triage, and resolve reported problems in the Support Center');

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000001', id from permissions where (resource, action) = ('support_tickets', 'review');

create type support_category as enum ('bug', 'ux_issue', 'performance', 'data_issue', 'feature_request', 'question', 'other');
create type support_ticket_status as enum ('new', 'acknowledged', 'in_progress', 'resolved', 'closed');

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reported_by uuid not null references employees(id),
  title text not null,
  description text not null,
  category support_category not null default 'other',
  severity priority_level not null default 'medium',
  status support_ticket_status not null default 'new',
  page_url text,
  user_agent text,
  screenshot_path text, -- Supabase Storage object path in the support-screenshots bucket, nullable
  assigned_to uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_support_tickets_updated_at
  before update on support_tickets
  for each row execute function app.set_updated_at();

create index idx_support_tickets_company on support_tickets(company_id);
create index idx_support_tickets_status on support_tickets(status) where status not in ('resolved', 'closed');
create index idx_support_tickets_reported_by on support_tickets(reported_by);

-- Internal only -- not visible to the original reporter, per Jayson's
-- "internal notes" phrasing. This is where a reviewer records what they
-- found/did before bringing it back to a fix conversation, not a public
-- back-and-forth with the reporter.
create table support_ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  employee_id uuid not null references employees(id),
  note text not null,
  created_at timestamptz not null default now()
);

create index idx_support_ticket_notes_ticket on support_ticket_notes(ticket_id);

alter table support_tickets enable row level security;
alter table support_ticket_notes enable row level security;

-- Deliberately broader than support_tickets_review below (a reporter can
-- see their own ticket's current status but can't change it) -- same shape
-- as completion_submissions_select vs. _review (030). The backend's PATCH
-- endpoint must use RETURNING-then-check, not a naive db.get()+setattr(),
-- for exactly the reason documented there: a blocked UPDATE from a
-- non-reviewer would otherwise silently no-op instead of erroring.
create policy support_tickets_select on support_tickets for select
  using (
    reported_by = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'support_tickets', 'review')
  );

create policy support_tickets_insert on support_tickets for insert
  with check (
    reported_by = app.current_employee_id()
    and company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
  );

create policy support_tickets_review on support_tickets for update
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'support_tickets', 'review'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'support_tickets', 'review'));

create policy support_ticket_notes_select on support_ticket_notes for select
  using (exists (
    select 1 from support_tickets st where st.id = ticket_id
      and app.has_permission_on_company(app.current_employee_id(), st.company_id, 'support_tickets', 'review')
  ));

create policy support_ticket_notes_insert on support_ticket_notes for insert
  with check (
    employee_id = app.current_employee_id()
    and exists (
      select 1 from support_tickets st where st.id = ticket_id
        and app.has_permission_on_company(app.current_employee_id(), st.company_id, 'support_tickets', 'review')
    )
  );

create trigger trg_audit_support_tickets
  after insert or update or delete on support_tickets
  for each row execute function app.write_audit_log();

create trigger trg_audit_support_ticket_notes
  after insert or delete on support_ticket_notes
  for each row execute function app.write_audit_log();

-- ============================================================================
-- Supabase Storage: first bucket in this repo. Private (not public) --
-- reads only ever happen through a backend-generated short-lived signed URL
-- (service_role key, bypasses RLS by design), never a direct client read,
-- so no select policy is defined here at all. The frontend uploads directly
-- via supabase.storage.from('support-screenshots').upload(...) using the
-- caller's own session -- no backend round-trip needed for the upload
-- itself, only for later generating a signed URL to view it.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('support-screenshots', 'support-screenshots', false)
on conflict (id) do nothing;

-- Standard Supabase per-user-folder idiom: the object path's first segment
-- must equal the uploader's own auth.uid(), so one employee can never write
-- into another's folder. The frontend uploads to `${auth.uid()}/...`.
create policy support_screenshots_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'support-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
