# Getting Started

> **Last updated:** 2026-07-09 · **Status:** current

Everything you need to clone Proyekto, install each package, and run the stack
locally. The three services you'll usually run are **web**, **backend**, and
**agent** — each installs and runs independently.

> If you only read one page, read [setup.md](./setup.md). New to the product itself?
> Start with [Product & Concepts](../01-product/README.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [setup.md](./setup.md) | Prerequisites, clone, per-package install, first run, database |
| [local-development.md](./local-development.md) | Day-to-day commands, ports, tests, gotchas |
| [environment-variables.md](./environment-variables.md) | Cross-service env map + where values come from |

## The 60-second version

```bash
# backend
cd backend && cp .env.example .env && npm install && npm run dev   # :3001/api
# web (new terminal)
cd web && cp .env.example .env && npm install && npm run dev       # :3000
# agent (optional, for roadmap AI)
cd agent && python -m venv venv && source venv/Scripts/activate \
  && pip install -r requirements.txt && cp .env.example .env && python run.py  # :8010
```

## Where to go next

- [Architecture](../02-architecture/README.md) — how the six units fit together.
- [Backend](../03-backend/README.md) / [Web](../04-web/README.md) / [Agent](../05-agent-ai/README.md) — per-unit deep dives.
- [Data & Database](../07-data-and-db/README.md) — the schema and migrations.
