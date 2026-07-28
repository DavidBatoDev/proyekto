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

## Roadmap AI Commit Benchmark

Run from repo root:

```bash
node scripts/benchmark_roadmap_ai_commit.mjs
```

This benchmark executes safe no-op `update_node` commits against an existing node and compares latency between:

- `include_roadmap=true` (full response path)
- `include_roadmap=false` (lean response path)

It reports p50/p95/avg and optional assertions.

### Useful options

- Override iterations and warmup:

```bash
node scripts/benchmark_roadmap_ai_commit.mjs --iterations=12 --warmup=2
```

- Add assertions for lean mode and savings:

```bash
node scripts/benchmark_roadmap_ai_commit.mjs --assert-lean-p95-ms=350 --assert-p95-savings-ms=30
```

- Benchmark only lean mode:

```bash
node scripts/benchmark_roadmap_ai_commit.mjs --include-roadmap-modes=false
```

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

## Stock Photo Seeding

`node scripts/seed_stock_photos.mjs` compresses a folder of source images,
uploads them to the `proyekto-media` R2 bucket, and regenerates
`web/src/data/stockPhotoManifest.ts` — the manifest the roadmap create flow
reads to pick a cover image. This is the only script here with an npm
dependency (`sharp`). Install it from inside `scripts/` — `npm --prefix scripts
install` fails on Windows, where npm still reads `package.json` from the cwd.

```bash
cd scripts && npm install && cd ..
node scripts/seed_stock_photos.mjs --source=./seed-images --dry-run
node scripts/seed_stock_photos.mjs --source=./seed-images
```

### Source layout

One directory per theme, named exactly as in `THEMES` at the top of the script.
`generic/` is required — it is the fallback pool for categories that match no
theme. Each theme needs at least 3 images so the Shuffle button has somewhere
to go.

```
seed-images/
  web-development/  mobile-app/     saas/       ai-ml/
  e-commerce/       marketing/      health-fitness/
  finance/          education/      design/     data-analytics/
  devops-cloud/     security/       operations/ team-collaboration/
  generic/
```

Any format `sharp` reads is fine at any size: each image is re-encoded to
1200x675 JPEG and stepped down the quality ladder until it fits `--max-bytes`
(default 1 MB). `seed-images/` and `.stock-staging/` are gitignored.

### Useful options

- `--dry-run` — report the per-theme plan and exit without writing anything
- `--skip-upload` — compress and write the manifest, but do not touch R2
- `--max-bytes=`, `--width=`, `--height=`, `--quality=` — encoding budget
- `--bucket=`, `--prefix=`, `--base-url=` — R2 target and public origin
- `--source=`, `--out=`, `--staging=` — paths

### Sourcing the images

`node scripts/fetch_stock_photos.mjs` fills `seed-images/` from Pexels — one
search per theme, ~16 of the 200/hour free allowance for a full run. It needs
`PEXELS_API_KEY` (already in `backend/.env`). This is build-time only; the
product never calls Pexels. Photographer credits land in
`docs/08-storage-media/stock-photo-credits.md`.

```bash
node scripts/fetch_stock_photos.mjs --per-theme=16
node scripts/fetch_stock_photos.mjs --themes=finance,security --force  # refresh some
```

Skip it entirely if you would rather curate `seed-images/` by hand — the seed
script does not care where the files came from.

### Upload transport

`--upload=auto` (the default) probes R2's S3 endpoint and uses it when
reachable, since it reuses the `R2_*` keys already in `backend/.env` and needs
no login. It falls back to `wrangler r2 object put --remote` — which requires
`npx --prefix realtime wrangler login` first — because
`docs/08-storage-media/r2-architecture.md` records TLS handshake failures
against `<account>.r2.cloudflarestorage.com` on some networks. Force either
with `--upload=s3` or `--upload=wrangler`.

After seeding, verify an object and only then enable the surface:

```bash
curl -sI https://cdn.proyekto.tech/stock/generic/01.jpg | head -1
# then set VITE_STOCK_PHOTOS_ENABLED=true in the web build
```
