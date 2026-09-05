# Separating dev/CI from production

**Why this exists**: on 2026-09-05, a live-verification test script targeted the production Supabase project (the same one local `.env` files and `backend/tests/integration/test_*_live.py` already pointed at) and deleted a real position, requiring a same-day manual repair. The production readiness review that followed identified this as the single highest-leverage fix available: as long as dev/test tooling and production share one database, this can happen again regardless of how careful any individual script is.

This is the one item from that review that needs your action, not code — provisioning a Supabase project is an account/dashboard action, not something to do from a script.

## Steps

1. **Create a second Supabase project** (Supabase dashboard → New Project). Free tier is fine — this is a dev/CI database, not a production one. Name it something unambiguous, e.g. `eems-dev`.
2. **Run every migration against it**: `supabase/migrations/001` through the latest, in order, the same way they were applied to production (see `supabase/apply_migrations.py` if that's the tool already in use, or the Supabase CLI's `supabase db push`).
3. **Copy `backend/.env.example` → `backend/.env`** (if not already done) and fill in the *new dev project's* `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Do the same for `frontend/.env` from `frontend/.env.example`, and `supabase/.env` (the admin/migration credential) from `supabase/.env.example`.
4. **Confirm the switch worked**: run `RUN_LIVE_TESTS=1 pytest backend/tests/integration` — this should now create and clean up test data in the *dev* project, never production.
5. **Run a restore drill** into this same dev project using `scripts/restore_drill.sh` (see below) — this closes the second finding from the same review (backup exists, restore was never tested) using the project you just made for the first one.

## Restore drill

```bash
./scripts/restore_drill.sh /path/to/eems-backup-TIMESTAMP.dump "<dev-project-db-url>"
```

Get a dump file from the nightly backup workflow's Cloudflare R2 bucket, or from that workflow's own GitHub Actions run artifacts. The script refuses to run against anything that looks like the production project ref as a safety check, but the real safety comes from only ever pointing it at the dev project.

Run this once now, then periodically (quarterly is reasonable at this scale) — a backup that restores correctly today doesn't guarantee it will after the next few migrations land.

## Going forward

Once the dev project exists, `.env` files should never again point at the production project ref (`lipfajayiwnybykanshq`) except in the actual deployed Render/Vercel environment variables. If you're ever unsure which project a local `.env` points at, check `SUPABASE_URL` against the production ref before running anything destructive against it — this is exactly the mistake that started this whole review.
