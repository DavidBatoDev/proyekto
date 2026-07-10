# Local Development

> **Last updated:** 2026-07-09 · **Status:** current

The day-to-day commands for each package, the ports they run on, and the
Windows/monorepo gotchas that trip people up.

## Ports

| Service | Dev URL |
| --- | --- |
| web | `http://localhost:3000` |
| backend | `http://localhost:3001/api` |
| agent | `http://localhost:8010` |

## Web (`cd web`)

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server on port 3000 |
| `npm run build` | `vite build` **then** `tsc` (typecheck gates the build) |
| `npm test` | Vitest (single run); `vitest` for watch |
| `npm run check` / `lint` / `format` | Biome |
| `npm run cap:sync` / `cap:open:android` / `cap:open:ios` | Capacitor (mobile) |

## Backend (`cd backend`)

| Command | Does |
| --- | --- |
| `npm run dev` | `nest start --watch` |
| `npm run build` | `nest build` |
| `npm test` | Jest (config inline in `package.json`, `rootDir` is `src/`) |
| `npx jest path/to/file.spec.ts` | Run a single spec |
| `npm run test:e2e` | Jest with `backend/test/jest-e2e.json` |
| `npm run check:roadmap-ai-schema` | Validate the shared roadmap-AI schema |

## Agent (`cd agent`)

- `python run.py` — FastAPI via uvicorn (reload in dev).
- Tests run through a Node wrapper from the repo root:
  `node scripts/test_agent_unit.mjs [tests.module_name …]`. If interpreter autodetect
  fails, set `AGENT_PYTHON_BIN=agent/venv/Scripts/python.exe`.

## Benchmarks & validation (repo root)

```bash
node scripts/benchmark_resolve_lookup.mjs --assert-warm-p95-ms=50
node scripts/benchmark_roadmap_ai_commit.mjs
node scripts/validate_agent_canary_matrix.mjs
```

See [Runbooks → benchmarks & canary](../12-runbooks/benchmarks-and-canary.md).

## Gotchas

- **Shell is bash-on-Windows** — use forward slashes and `/dev/null`, not `NUL`.
- **Web build runs `tsc` after `vite build`** — a type error fails the build even if
  Vite succeeds.
- **Backend Jest `rootDir` is `src/`** — pass single-spec paths relative to
  `backend/src/` (or absolute).
- **Don't `npm run lint` in `backend/` to verify** — it ESLint-`--fix`es all of
  `src/`. Use `npx eslint <files>` (no `--fix`) to check specific files.
- **Supabase CLI runs from `backend/`** per SETUP conventions, though
  `supabase/migrations/` lives at the repo root.
- Scripts auto-load `.env` in order: cwd → `scripts/.env` → repo root `.env` →
  `backend/.env` (or `agent/.env` for the agent runner). First value wins.

## See also

- [setup.md](./setup.md) · [environment-variables.md](./environment-variables.md)
- [Backend](../03-backend/README.md) · [Web](../04-web/README.md) · [Agent](../05-agent-ai/README.md)
