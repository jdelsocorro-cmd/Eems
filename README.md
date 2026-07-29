# EEMS — Enterprise Execution Management System

Phase 1 foundation: organization hierarchy, RBAC, projects/tasks, goals/KPIs
with weighted scoring, on Supabase (Postgres + Auth + Realtime) + FastAPI +
React, running on free-tier hosting. See the architecture plan this was
built from for full context on design decisions.

## Repo layout

```
backend/     FastAPI app (Python 3.12)
frontend/    Vite + React + TypeScript
supabase/    SQL migrations, config, one-time bootstrap seed
.github/     CI + free-tier reliability workflows (keep-alive, backup)
docs/adr/    Architecture decision records
```

## Local setup

**Backend**
```
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env   # fill in Supabase values once a project exists
.venv\Scripts\uvicorn app.main:app --reload
```

**Frontend**
```
cd frontend
npm install
copy .env.example .env   # fill in Supabase values once a project exists
npm run dev
```

**Database** (once a Supabase project exists)
```
supabase link --project-ref <your-project-ref>
supabase db push
```
Then run the one-time bootstrap in `supabase/seed.sql` (grants the first
real employee the Super Admin role — nothing else can grant roles until one
person has it).

## Known npm audit finding (accepted, not a bug)

`npm audit` flags `react-router-dom@7.18.2` for GHSA-qwww-vcr4-c8h2 ("RSC
Mode CSRF Bypass"). This app uses plain client-side `<BrowserRouter>`, not
React Router's RSC/Framework mode, so the vulnerable code path is never
invoked. The alternative — downgrading to 7.11.0 — trades this for four
other high-severity advisories (open redirect XSS, RSCErrorHandler XSS,
constructor injection via SSR hydration, route-matching DoS) that are not
RSC-scoped and are strictly worse for our usage. Re-check this the next time
`react-router-dom` is bumped; the registry may have a version by then that's
clean on both counts.

## Setup steps that need to happen outside this repo

See the architecture plan's "Setup steps" section for the full list
(GitHub, Supabase, Vercel, Render, Cloudflare) — each gets surfaced with
exact instructions at the point in the build where it's actually needed.
