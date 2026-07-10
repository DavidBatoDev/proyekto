# Runbook: Benchmarks & Canary

> **Last updated:** 2026-07-09 · **Status:** current

Performance benchmarks and the agent canary validation live in
[`scripts/`](../../scripts/) as Node `.mjs` files. They're run from the repo root and
auto-load `.env` (cwd → `scripts/.env` → repo root `.env` → `backend/.env`, first
value wins).

## Benchmarks

| Script | Measures | Notable flags |
| --- | --- | --- |
| [`scripts/benchmark_resolve_lookup.mjs`](../../scripts/benchmark_resolve_lookup.mjs) | Node-resolution lookup latency | `--assert-warm-p95-ms=<n>`, `--redis-chaos` |
| [`scripts/benchmark_roadmap_ai_commit.mjs`](../../scripts/benchmark_roadmap_ai_commit.mjs) | AI-commit latency, `include_roadmap` true vs false (the lean-diff win) | — |

```bash
node scripts/benchmark_resolve_lookup.mjs --assert-warm-p95-ms=50
node scripts/benchmark_roadmap_ai_commit.mjs
```

The commit benchmark quantifies the **lean diff** optimization (see
[Agent → operations schema](../05-agent-ai/operations-schema.md) and
[Architecture → cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit)).

## Agent canary

[`scripts/validate_agent_canary_matrix.mjs`](../../scripts/validate_agent_canary_matrix.mjs)
runs the v2 canary — the v2 loop plus the shared-contract unit tests — and exits
non-zero on failure. Run it before shipping agent or schema changes:

```bash
node scripts/validate_agent_canary_matrix.mjs
```

## Shared-contract check

Whenever an operation shape changes, run the parity checker from `backend/`:

```bash
cd backend && npm run check:roadmap-ai-schema
```

It asserts the schema, backend DTOs, and agent Python model agree — a release
blocker if it fails. See [Agent → operations schema](../05-agent-ai/operations-schema.md).

## Agent unit tests

```bash
node scripts/test_agent_unit.mjs                    # default suite
node scripts/test_agent_unit.mjs tests.test_v2_loop # one module
# if interpreter autodetect fails:
AGENT_PYTHON_BIN=agent/venv/Scripts/python.exe node scripts/test_agent_unit.mjs
```

> If a test module hangs, drop the flaky addition rather than looping on retries.

## Code locations

- **Scripts:** [`scripts/`](../../scripts/)
- **Env loading:** each script auto-loads `.env` (cwd → `scripts/.env` → repo root → `backend/.env`)
