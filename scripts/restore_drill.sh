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

echo "-- Dropping and recreating the public/app schemas on the target --"
psql "$TARGET_DB_URL" -c "drop schema if exists app cascade; drop schema if exists public cascade; create schema public;"

echo "-- Restoring (pg_restore, single transaction) --"
pg_restore --no-owner --no-privileges --single-transaction -d "$TARGET_DB_URL" "$DUMP_FILE"

END=$(date +%s)
ELAPSED=$((END - START))

echo
echo "== Restore completed in ${ELAPSED}s =="
echo
echo "-- Sanity checks --"
psql "$TARGET_DB_URL" -c "select count(*) as employee_count from employees;"
psql "$TARGET_DB_URL" -c "select count(*) as company_count from companies;"
psql "$TARGET_DB_URL" -c "select tablename from pg_tables where schemaname = 'app' limit 5;"
psql "$TARGET_DB_URL" -c "select count(*) as rls_enabled_tables from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and c.relrowsecurity;"

echo
echo "Record the elapsed time above as this drill's RTO data point."
echo "If any sanity check looks wrong (0 employees, no app schema, RLS not enabled on the expected tables), the restore is NOT trustworthy as-is -- investigate before relying on it."
