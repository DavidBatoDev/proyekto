#!/usr/bin/env node

/**
 * Benchmark roadmap context search latency to approximate resolve_node_reference
 * DB/cache behavior.
 *
 * Required env:
 * - BENCH_API_BASE (e.g. http://localhost:3000)
 * - BENCH_ROADMAP_ID
 * - BENCH_AUTH_TOKEN (Bearer token value, without "Bearer ")
 *
 * Optional env:
 * - BENCH_NODE_TYPE (legacy single value epic|feature|task, default: epic)
 * - BENCH_NODE_TYPES (comma/pipe delimited values, e.g. epic,feature,task)
 * - BENCH_QUERIES (pipe-delimited labels, default built-in set)
 * - BENCH_QUERY_PROFILE (clean|mixed, default: mixed)
 * - BENCH_HIT_REPEATS (default: 5)
 * - BENCH_PARALLEL (default: 1)
 * - BENCH_TIMEOUT_MS (default: 15000)
 */

import process from 'node:process';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_QUERIES = [
  'Platform Foundation',
  'Roadmap and Project Management Module',
  'Authentication System',
  'Database Schema Setup',
  'Roadmap JSON Editor',
];
const MIXED_QUERIES = [
  ...DEFAULT_QUERIES,
  'Roadmap and PM Modlue', // typo
  'Databse Schema Setp', // typo
  'Authn system',
  'Roadmap JSON, Editor',
];

loadEnvFiles();

const API_BASE = (
  process.env.BENCH_API_BASE ||
  process.env.NEST_API_BASE_URL ||
  `http://localhost:${process.env.PORT || '3000'}`
).trim();
const ROADMAP_ID = (process.env.BENCH_ROADMAP_ID || '').trim();
const AUTH_TOKEN = (
  process.env.BENCH_AUTH_TOKEN ||
  process.env.BENCH_TOKEN ||
  ''
).trim();
const NODE_TYPE = (process.env.BENCH_NODE_TYPE || 'epic').trim();
const NODE_TYPES = parseNodeTypes();
const QUERY_PROFILE = (process.env.BENCH_QUERY_PROFILE || 'mixed').trim().toLowerCase();
const HIT_REPEATS = Number(process.env.BENCH_HIT_REPEATS || '5');
const PARALLEL = Number(process.env.BENCH_PARALLEL || '1');
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || '15000');
const QUERIES = (
  process.env.BENCH_QUERIES
    ? process.env.BENCH_QUERIES.split('|').map((item) => item.trim())
    : QUERY_PROFILE === 'clean'
      ? DEFAULT_QUERIES
      : MIXED_QUERIES
).filter((item) => item.length > 0);

if (!API_BASE || !ROADMAP_ID || !AUTH_TOKEN) {
  const missing = [];
  if (!API_BASE) missing.push('BENCH_API_BASE');
  if (!ROADMAP_ID) missing.push('BENCH_ROADMAP_ID');
  if (!AUTH_TOKEN) missing.push('BENCH_AUTH_TOKEN');
  console.error(
    [
      'Missing required env vars.',
      'Required: BENCH_API_BASE, BENCH_ROADMAP_ID, BENCH_AUTH_TOKEN',
      `Missing now: ${missing.join(', ')}`,
      'The script auto-loads .env from backend/ and repo root.',
      'Example:',
      '  BENCH_API_BASE=http://localhost:3000',
      '  BENCH_ROADMAP_ID=55e431e2-e416-468c-a973-94d97280e97d',
      '  BENCH_AUTH_TOKEN=<jwt>',
    ].join('\n'),
  );
  process.exit(1);
}

if (!Number.isFinite(HIT_REPEATS) || HIT_REPEATS < 1) {
  console.error('BENCH_HIT_REPEATS must be a positive number.');
  process.exit(1);
}

if (!Number.isFinite(PARALLEL) || PARALLEL < 1) {
  console.error('BENCH_PARALLEL must be a positive number.');
  process.exit(1);
}

if (QUERIES.length === 0) {
  console.error('No benchmark queries found. Set BENCH_QUERIES.');
  process.exit(1);
}

const endpoint = `${API_BASE}/roadmaps/${ROADMAP_ID}/ai/context/search`;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(label, durationsMs, statuses) {
  const okCount = statuses.filter((status) => status >= 200 && status < 300).length;
  const failCount = statuses.length - okCount;
  const p50 = percentile(durationsMs, 50);
  const p95 = percentile(durationsMs, 95);
  const avg =
    durationsMs.length > 0
      ? durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length
      : null;
  return {
    label,
    calls: durationsMs.length,
    okCount,
    failCount,
    p50Ms: p50,
    p95Ms: p95,
    avgMs: avg,
  };
}

async function runSeries({ phaseLabel, workItems }) {
  const durationsMs = [];
  const statuses = [];
  const meta = [];

  await runWithConcurrency(workItems, PARALLEL, async (item) => {
    const { query, nodeType } = item;
    const params = new URLSearchParams({
      query,
      node_type: nodeType,
      limit: '10',
    });
    const url = `${endpoint}?${params.toString()}`;

    const started = performance.now();
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
      },
      TIMEOUT_MS,
    );
    const elapsedMs = performance.now() - started;

    durationsMs.push(elapsedMs);
    statuses.push(response.status);
    meta.push(`${nodeType}:${query}`);
  });

  return {
    ...summarize(phaseLabel, durationsMs, statuses),
    nodeTypes: [...new Set(workItems.map((item) => item.nodeType))],
    samples: meta.length,
  };
}

async function main() {
  console.log('--- Resolve Lookup Benchmark ---');
  console.log(`API base: ${API_BASE}`);
  console.log(`Roadmap: ${ROADMAP_ID}`);
  console.log(`Node types: ${NODE_TYPES.join(', ')}`);
  console.log(`Query profile: ${QUERY_PROFILE}`);
  console.log(`Queries: ${QUERIES.length}`);
  console.log(`Hit repeats: ${HIT_REPEATS}`);
  console.log(`Parallel: ${PARALLEL}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);

  const baseWorkItems = buildWorkItems(QUERIES, NODE_TYPES);
  // Phase 1: first pass (best approximation of miss-heavy run)
  const cold = await runSeries({
    phaseLabel: 'cold_first_pass',
    workItems: baseWorkItems,
  });

  // Phase 2: warm/hit-heavy run over same query set repeated.
  const warmWorkItems = [];
  for (let i = 0; i < HIT_REPEATS; i += 1) {
    warmWorkItems.push(...baseWorkItems);
  }
  const warm = await runSeries({
    phaseLabel: 'warm_repeated_pass',
    workItems: warmWorkItems,
  });

  console.log('\nResults');
  for (const row of [cold, warm]) {
    console.log(
      [
        `${row.label}:`,
        `calls=${row.calls}`,
        `ok=${row.okCount}`,
        `fail=${row.failCount}`,
        `types=${row.nodeTypes.join(',')}`,
        `p50=${row.p50Ms?.toFixed(1) ?? 'n/a'}ms`,
        `p95=${row.p95Ms?.toFixed(1) ?? 'n/a'}ms`,
        `avg=${row.avgMs?.toFixed(1) ?? 'n/a'}ms`,
      ].join(' '),
    );
  }

  if (cold.failCount > 0 || warm.failCount > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

function parseNodeTypes() {
  const raw = (process.env.BENCH_NODE_TYPES || NODE_TYPE || 'epic').trim();
  const values = raw
    .split(/[|,]/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  const filtered = values.filter((value) =>
    value === 'epic' || value === 'feature' || value === 'task',
  );
  return filtered.length > 0 ? [...new Set(filtered)] : ['epic'];
}

function buildWorkItems(queries, nodeTypes) {
  const items = [];
  for (const nodeType of nodeTypes) {
    for (const query of queries) {
      items.push({ nodeType, query });
    }
  }
  return items;
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}

function loadEnvFiles() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const cwd = process.cwd();

  const candidates = [
    path.join(cwd, '.env'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'backend', '.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equalIndex = line.indexOf('=');
      if (equalIndex <= 0) continue;
      const key = line.slice(0, equalIndex).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = line.slice(equalIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
