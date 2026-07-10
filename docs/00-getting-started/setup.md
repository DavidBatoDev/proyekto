# Setup

> **Last updated:** 2026-07-09 · **Status:** current

Getting the Proyekto stack running locally. The three services you'll usually run are
**web** (React), **backend** (NestJS), and **agent** (Python) — each installs and runs
independently. This replaces the old (missing) root `SETUP.md`.

> You don't need everything to start. For most frontend/backend work, run **web +
> backend**. Add the **agent** only when working on roadmap AI.

## Prerequisites

| Tool | Version | For |
| --- | --- | --- |
| Node.js | 22.x | web + backend |
| npm | 10+ | web + backend |
| Python | 3.12 | agent |
| Git | any | — |
| Android Studio / Xcode | latest | mobile (optional; iOS needs macOS) |

You'll also need credentials for the backing services (Supabase, Upstash Redis,
Cloudflare R2, OpenAI, Gmail) — see [environment-variables.md](./environment-variables.md).
The shell examples assume **bash** (Git Bash on Windows).

## Clone

```bash
git clone <repo-url> prdigy
cd prdigy
```

The folder is legacy-named `prdigy/`; the product is **Proyekto**.

## Backend (`backend/`)

```bash
cd backend
cp .env.example .env        # fill Supabase, R2, Redis, OpenAI, Gmail values
npm install
npm run dev                 # nest start --watch → http://localhost:3001/api
```

The API mounts under the `/api` prefix. Required env is validated at boot — a missing
value stops startup with a clear error. See [Backend → configuration](../03-backend/configuration.md).

## Web (`web/`)

```bash
cd web
cp .env.example .env        # VITE_* values (API/agent/realtime/Supabase)
npm install
npm run dev                 # vite on http://localhost:3000
```

Point `VITE_API_URL` at your local backend (`http://localhost:3001`).

## Agent (`agent/`)

```bash
cd agent
python -m venv venv && source venv/Scripts/activate   # venv lives at agent/venv/
pip install -r requirements.txt
cp .env.example .env        # OPENAI_API_KEY, UPSTASH_REDIS_*, NEST_API_BASE_URL
python run.py               # uvicorn on http://localhost:8010
```

Set `NEST_API_BASE_URL=http://localhost:3001/api` so the agent can call your local
backend. See [Agent → setup & deploy](../05-agent-ai/setup-and-deploy.md).

## Database (Supabase)

The schema is migration-driven (`supabase/migrations/`). To point at a Supabase
project and apply migrations (run from `backend/`):

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

For the live Singapore project, use the Supabase MCP `apply_migration` (CLI `db push`
fails SASL there). See [Data → migrations workflow](../07-data-and-db/migrations-workflow.md).

## Next

- [local-development.md](./local-development.md) — the day-to-day commands.
- [environment-variables.md](./environment-variables.md) — the full env reference.
- [Architecture → system overview](../02-architecture/system-overview.md) — how the pieces fit.
