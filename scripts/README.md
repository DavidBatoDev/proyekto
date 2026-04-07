# Scripts

Utility scripts are run directly from this folder using Node `.mjs` files.

## Resolve Lookup Benchmark

Run from repo root:

```bash
node scripts/benchmark_resolve_lookup.mjs
```

### Environment setup

1. Copy:

```bash
cp scripts/.env.example scripts/.env
```

2. Set required values in `scripts/.env`:

- `BENCH_API_BASE`
- `BENCH_ROADMAP_ID`
- `BENCH_AUTH_TOKEN`

### Useful options

- Assert warm p95 threshold:

```bash
node scripts/benchmark_resolve_lookup.mjs --assert-warm-p95-ms=100
```

- Simulate Redis-chaos client mode:

```bash
node scripts/benchmark_resolve_lookup.mjs --redis-chaos
```

- Combine both:

```bash
node scripts/benchmark_resolve_lookup.mjs --redis-chaos --assert-warm-p95-ms=100
```

## Resolve Lookup SQL Benchmark

For DB-only index/query-plan benchmarking (EXPLAIN + warm-loop percentiles), run:

```sql
\i scripts/benchmark_resolve_lookup_patterns.sql
```

File: [scripts/benchmark_resolve_lookup_patterns.sql](scripts/benchmark_resolve_lookup_patterns.sql)

The script benchmarks these runtime lookup shapes:

- Epic title exact/prefix/contains
- Epic description contains
- Feature title exact/prefix/contains
- Feature description contains
- Task title exact/prefix/contains via roadmap_features join

It also emits p50/p95/avg from repeated warm executions to compare before/after index changes.

### Environment file precedence

The benchmark auto-loads env values in this order:

1. current working directory `.env`
2. `scripts/.env`
3. repo root `.env`
4. `backend/.env`

First value found wins (existing env vars are not overwritten).

## Agent Unit Tests (Python)

Run the targeted agent tests from repo root via Node wrapper:

```bash
node scripts/test_agent_unit.mjs
```

Default modules:

- `tests.test_agent_safety`
- `tests.test_edit_resolver`

To run specific modules:

```bash
node scripts/test_agent_unit.mjs tests.test_agent_safety
```

If Python is not auto-detected, set:

```bash
AGENT_PYTHON_BIN=agent\\venv\\Scripts\\python.exe
```

The runner also auto-loads env files in this order:

1. current working directory `.env`
2. `scripts/.env`
3. repo root `.env`
4. `agent/.env`

So you can place `AGENT_PYTHON_BIN=...` in `scripts/.env` and run without extra shell setup.

## Canary Validation Matrix

Run rollout/canary acceptance subsets for both strict and react-compat profiles:

```bash
node scripts/validate_agent_canary_matrix.mjs
```

This runs two profiles with explicit environment overrides and targeted unittest modules:

- `strict-canary`:
  - `AGENT_HYBRID_REACT_ENABLED=true`
  - `AGENT_DRAFT_GRAPH_ENABLED=true`
  - `AGENT_STRICT_PREVIEW_FINGERPRINT=true`
  - `AGENT_REACT_MAX_ATTEMPTS=4`
  - `MAX_EDIT_TOOL_TURNS=3`

- `react-compat`:
  - `AGENT_HYBRID_REACT_ENABLED=true`
  - `AGENT_DRAFT_GRAPH_ENABLED=false`
  - `AGENT_STRICT_PREVIEW_FINGERPRINT=true`
  - `AGENT_REACT_MAX_ATTEMPTS=2`
  - `MAX_EDIT_TOOL_TURNS=4`

Legacy aliases remain supported for one release:

- `AGENT_EDIT_PLANNER_MAX_ATTEMPTS`
- `AGENT_EDIT_PLANNER_REPAIR_RETRIES`

Exit code is non-zero if either profile fails.
