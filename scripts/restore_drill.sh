#!/usr/bin/env bash
# ============================================================================
# restore_drill.sh
#
# Production readiness review (2026-09-05) found the nightly backup
# workflow (.github/workflows/backup.yml) has never had its restore path
# tested -- a backup nobody has restored from is a false-confidence gap,
# not a real safety net. This script rehearses the restore end to end
# against a SEPARATE, disposable Supabase project -- never run this
# against the production project, since a restore is destructive to
# whatever database it targets.
#
# Usage:
#   ./scripts/restore_drill.sh /path/to/eems-backup-TIMESTAMP.dump \
#       "postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres"
#
# Get a backup file either from the Cloudflare R2 bucket the nightly
# workflow uploads to, or from that workflow's own GitHub Actions run
# artifacts (Actions tab -> a "Nightly backup" run -> Artifacts).
#
# The target must be a project you're fine wiping and reloading -- this
# is exactly what a dev/CI Supabase project (see the accompanying
# reliability fix, docs/PROD_DATA_SAFETY.md) is for. Running this drill
# periodically against that same project doubles as validating the
# restore path AND keeps the dev project's data reasonably fresh.
#
# CROSS-PROJECT CAVEAT (found live running the first real drill, 2026-09-05):
# employees.auth_user_id has a foreign key to Supabase's own auth.users
# table. Every Supabase project has its OWN separate, unrelated set of
# Auth accounts -- so restoring a dump taken from production into any
# OTHER project can never satisfy that one FK; the UUIDs it points to
# simply don't exist there. This is not a backup defect -- restoring this
# same dump back into the SAME project it came from (the real disaster-
# recovery scenario) would satisfy it fine, since that project's
# auth.users would still be intact. For a cross-project drill, this
# script restores best-effort (no --single-transaction) specifically so
# that one expected, cross-project-only failure doesn't roll back
# everything else -- check the sanity queries below to confirm the real
# business data actually landed.
# ============================================================================
set -euo pipefail

DUMP_FILE="${1:?Usage: restore_drill.sh <dump-file> <target-db-url>}"
TARGET_DB_URL="${2:?Usage: restore_drill.sh <dump-file> <target-db-url>}"

if [[ "$TARGET_DB_URL" == *"lipfajayiwnybykanshq"* ]]; then
  echo "REFUSING: that URL looks like the production project ref. This script is destructive to its target." >&2
  exit 1
fi

echo "== Restore drill starting =="
echo "Dump file: $DUMP_FILE"
echo "Target:    $(echo "$TARGET_DB_URL" | sed -E 's#://[^:]+:[^@]+@#://***:***@#')"
echo

START=$(date +%s)

echo "-- Dropping the public/app schemas on the target --"
# Drop only -- don't also `create schema public` here. A dump taken with
# `-n public -n app` (see .github/workflows/backup.yml) already contains its
# own `CREATE SCHEMA public` statement as part of restoring that schema from
# scratch; pre-creating it here made pg_restore's own attempt fail with
# "schema public already exists" (found live running the first real restore
# drill against a correctly-scoped dump, 2026-09-05).
psql "$TARGET_DB_URL" -c "drop schema if exists app cascade; drop schema if exists public cascade;"

echo "-- Restoring (pg_restore, best-effort) --"
set +e
pg_restore --no-owner --no-privileges -d "$TARGET_DB_URL" "$DUMP_FILE"
RESTORE_EXIT=$?
set -e
if [ "$RESTORE_EXIT" -ne 0 ]; then
  echo
  echo "pg_restore reported errors (exit $RESTORE_EXIT) -- expected if the only"
  echo "failure is employees_auth_user_id_fkey (see the cross-project caveat"
  echo "above). Check the sanity queries below before deciding if this drill"
  echo "actually passed."
fi

# --no-owner --no-privileges above is correct (avoids "role postgres already
# exists"-style ownership conflicts on a target that doesn't share the
# source's exact role setup) but has a real cost: it strips EVERY grant on
# every restored object, including the ones the app's own connection role
# depends on to see anything at all. Found live 2026-09-08 -- a restore
# drill against eems-dev several days earlier had silently left `eems_app`
# (backend/app/db/session.py's connection role) and `authenticated` with NO
# usage privilege on the public/app schemas. The restore "succeeded" (all 67
# employees were really there per an admin connection) but the app itself
# saw nothing and looked like a total data loss -- indistinguishable from a
# genuinely failed restore to anyone using it afterward. This is exactly the
# failure mode a disaster-recovery drill exists to catch, so it gets
# re-applied unconditionally here rather than left as a "gotcha to remember
# manually": grant usage on schema public, app to eems_app; (008_app_role.sql)
# + grant usage on schema app to authenticated; grant execute on all functions
# in schema app to authenticated; (010_grant_app_schema_to_authenticated.sql)
# + the standard Supabase public-schema grants, which are normally set up
# once by Supabase's own project bootstrap and are just as vulnerable to
# being dropped by this same schema-drop-and-restore cycle.
echo
echo "-- Re-applying app-role grants (stripped by --no-owner --no-privileges) --"
psql "$TARGET_DB_URL" <<'SQL'
grant usage on schema public, app to eems_app;
grant usage on schema public, app to authenticated;
grant execute on all functions in schema app to authenticated;
alter default privileges in schema app grant execute on functions to authenticated;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
SQL

END=$(date +%s)
ELAPSED=$((END - START))

echo
echo "== Restore completed in ${ELAPSED}s =="
echo
echo "-- Sanity checks --"
# Schema-qualified on purpose -- this project's default search_path for the
# postgres role doesn't include bare `public`, so an unqualified `from
# employees` fails with "relation does not exist" even when the table is
# very much there (found live running the first real drill, 2026-09-05 --
# information_schema.tables, which is always schema-qualified, showed the
# tables present the whole time this was failing).
psql "$TARGET_DB_URL" -c "select count(*) as employee_count from public.employees;"
psql "$TARGET_DB_URL" -c "select count(*) as company_count from public.companies;"
psql "$TARGET_DB_URL" -c "select count(*) as app_function_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app';"
psql "$TARGET_DB_URL" -c "select count(*) as rls_enabled_tables from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and c.relrowsecurity;"

# The check that would have caught the 2026-09-08 incident: row counts above
# only prove data exists, via an admin connection that bypasses grants
# entirely. This proves the role the actual app connects as can see it.
psql "$TARGET_DB_URL" -c "select has_schema_privilege('eems_app', 'public', 'USAGE') as eems_app_can_use_public, has_table_privilege('eems_app', 'public.employees', 'SELECT') as eems_app_can_select_employees;"

echo
echo "Record the elapsed time above as this drill's RTO data point."
echo "If any sanity check looks wrong (0 employees, no app schema, RLS not enabled on the expected tables, or eems_app_can_use_public/eems_app_can_select_employees is false), the restore is NOT trustworthy as-is -- investigate before relying on it."
