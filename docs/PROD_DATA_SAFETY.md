# Separating dev/CI from production

**Why this exists**: on 2026-09-05, a live-verification test script targeted the production Supabase project (the same one local `.env` files and `backend/tests/integration/test_*_live.py` already pointed at) and deleted a real position, requiring a same-day manual repair. The production readiness review that followed identified this as the single highest-leverage fix available: as long as dev/test tooling and production share one database, this can happen again regardless of how careful any individual script is.

**Status: done.** A dev/CI project (`eems-dev`) exists, has all migrations applied, and `backend/.env`/`frontend/.env`/`supabase/.env` all point at it. 13 of 14 live integration tests pass against it (the one failure is a pre-existing, unrelated stale test assertion — see `test_org_hierarchy_crud_and_reparent_flow`, checks for the word "cycle" in an error message that was reworded at some point). The steps below are recorded for reference / for provisioning a similar project again in the future, not something still pending.

## Steps (for reference)

1. **Create a second Supabase project** (Supabase dashboard → New Project). Free tier is fine — this is a dev/CI database, not a production one.
2. **Run every migration against it**, in order — see `supabase/apply_migrations.py` or a plain loop over `supabase/migrations/*.sql` with `asyncpg`.
3. **Set `backend/.env`, `frontend/.env`, `supabase/.env`** to the new project's URL/keys. `backend/.env`'s `SUPABASE_DB_URL` uses the `eems_app` role (008_app_role.sql), which is created with **no password by design** — set one manually via `ALTER ROLE eems_app WITH PASSWORD '...'` through the SQL editor before this will connect; it's never in a migration file, never committed.
4. **Confirm the switch worked**: run `RUN_LIVE_TESTS=1 pytest backend/tests/integration` — creates and cleans up real data in the *dev* project, never production.

## Restore drill

**Status: done, and it found real bugs along the way** — the nightly backup workflow (`.github/workflows/backup.yml`) had never once succeeded since it was added (all repo secrets were missing entirely), and once that was fixed, two more issues surfaced only by actually running a real drill: the Postgres client version mismatch (Ubuntu's default v16 vs. the project's v17), and an unscoped `pg_dump` that included Supabase's own internal schemas. All fixed; see that file's own comments and `scripts/restore_drill.sh`'s header for the details.

```bash
./scripts/restore_drill.sh /path/to/eems-backup-TIMESTAMP.dump "<dev-project-db-url>"
```

Get a dump file from the workflow's GitHub Actions run artifacts (Actions → "Nightly backup" → a successful run → Artifacts), or from the Cloudflare R2 bucket once that's configured (see below — not yet set up). The script refuses to run against anything that looks like the production project ref as a safety check.

**One inherent cross-project caveat**, not a bug: `employees.auth_user_id` has a foreign key to Supabase's own `auth.users` table, and every Supabase project has its own separate, unrelated set of Auth accounts. A dump taken from production can never satisfy that FK when restored into a *different* project — the UUIDs simply don't exist there. Restoring into the *same* project the dump came from (the real disaster-recovery scenario) doesn't have this problem. The drill script restores best-effort specifically so this one expected failure doesn't block verifying everything else landed correctly.

**Confirmed working** (2026-09-05): 66 employees, 2 companies, 76 positions, 35 `app` functions, 44 RLS-enabled tables restored correctly in ~53s.

Run this periodically (quarterly is reasonable at this scale) — a backup that restores correctly today doesn't guarantee it will after the next few migrations land.

## Still open: Cloudflare R2

The backup workflow uploads to R2 as its durable copy, with the GitHub Actions artifact (14-day retention) as a second, independent copy in case R2 credentials ever break silently. R2 is **not yet configured** — no Cloudflare account/bucket exists for this. The GitHub-artifact copy is real and working today (confirmed by the drill above), but it expires after 14 days. Setting up R2 (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ACCOUNT_ID` as repo secrets) is the next step for a durable, long-retention backup — treat it as its own task, same as the dev project was.

## Going forward

`.env` files should never point at the production project ref (`lipfajayiwnybykanshq`) except in the actual deployed Render/Vercel environment variables. If you're ever unsure which project a local `.env` points at, check `SUPABASE_URL` against the production ref before running anything destructive against it — this is exactly the mistake that started this whole review.
