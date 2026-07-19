---
name: perf-benchmark
description: Run and interpret the scripts/benchmark_*.mjs suite and the agent canary matrix. Use for latency work, Redis/agent performance questions, and pre-push verification of agent or schema changes.
---

# Skill: Performance Benchmarks + Canary

Run everything from the REPO ROOT. Scripts auto-load .env in order: cwd -> scripts/.env -> repo root .env -> backend/.env (agent/.env for the agent runner); first value wins. They hit real services (Supabase, Upstash, the agent) - results depend on network and warm state.

## The suite

- `node scripts/benchmark_resolve_lookup.mjs` - node-reference resolve path. `--assert-warm-p95-ms=<n>` turns it into a pass/fail gate; `--redis-chaos` simulates degraded Redis (failures under chaos are findings about fallback behavior, not flakes).
- `node scripts/benchmark_roadmap_ai_commit.mjs` - compares include_roadmap=true vs false. The lean-diff (false) path is a DELIBERATE latency optimization; a regression here means that optimization broke.
- `node scripts/benchmark_reasoning_summary.mjs` - summarizer path cost.

## The canary

`node scripts/validate_agent_canary_matrix.mjs` - runs the v2 loop + shared-contract unittests; non-zero exit on failure. REQUIRED before pushing changes to agent/ or schemas/.

## Interpretation rules

- Warm p95 is the SLO number; ignore cold-start outliers unless cold start is the topic.
- Never claim a regression from a single run - compare at least 2 runs per side.
- If Redis chaos runs fail, report which fallback broke (cache miss handling vs hard error), not just "failed".
- Record the numbers you saw in your report - "faster" without numbers is not a finding.
