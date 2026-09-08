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

## Cloudflare R2: evaluated, declined

R2 was considered 2026-09-08 as a durable, long-retention offsite copy alongside the GitHub Actions artifact. Its current signup flow requires adding a card on file to activate R2 at all, even to stay on the $0 free tier — declined rather than hand that over for a backup workflow that has no real spend need. The backup workflow's R2 upload step (`.github/workflows/backup.yml`) is written and ready (`continue-on-error: true`, so it's a no-op today rather than a failure) if this is revisited later, either with R2 once a cardless path exists, or with an alternative like Backblaze B2.

**In the meantime**, the GitHub Actions artifact is the only copy, and its retention was bumped from 14 to **90 days** (GitHub Free's own max) specifically to compensate for not having a second provider. That's real runway, not a stopgap — but it's still one provider, so if GitHub Actions itself ever had an extended outage or the repo were deleted, there'd be no fallback. Revisit a genuinely cardless offsite option if that risk stops being acceptable.

## Going forward

`.env` files should never point at the production project ref (`lipfajayiwnybykanshq`) except in the actual deployed Render/Vercel environment variables. If you're ever unsure which project a local `.env` points at, check `SUPABASE_URL` against the production ref before running anything destructive against it — this is exactly the mistake that started this whole review.
