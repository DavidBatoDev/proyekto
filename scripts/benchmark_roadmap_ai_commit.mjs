#!/usr/bin/env node

/**
 * Benchmark roadmap AI commit latency with and without heavy roadmap payloads.
 *
 * Required env:
 * - BENCH_API_BASE (e.g. http://localhost:3000)
 * - BENCH_ROADMAP_ID
 * - BENCH_AUTH_TOKEN (Bearer token value, without "Bearer ")
 *
 * Optional env:
 * - BENCH_COMMIT_ITERATIONS (default: 8)
 * - BENCH_COMMIT_WARMUP (default: 1)
 * - BENCH_COMMIT_TIMEOUT_MS (default: 20000)
 * - BENCH_COMMIT_NODE_TYPE (epic|feature|task, default: epic)
 * - BENCH_COMMIT_NODE_ID (optional explicit node id)
 * - BENCH_COMMIT_INCLUDE_TIMELINE (true|false, default: false)
 * - BENCH_COMMIT_INCLUDE_ROADMAP_MODES (comma/pipe delimited booleans, default: true,false)
 * - BENCH_ASSERT_LEAN_P95_MS (optional numeric threshold)
 * - BENCH_ASSERT_P95_SAVINGS_MS (optional min p95(full)-p95(lean) savings)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

loadEnvFiles();

const cliOptions = parseCliOptions(process.argv.slice(2));
const API_BASE = (
  process.env.BENCH_API_BASE ||
  process.env.NEST_API_BASE_URL ||
  `http://localhost:${process.env.PORT || "3000"}`
).trim();
const ROADMAP_ID = (process.env.BENCH_ROADMAP_ID || "").trim();
const AUTH_TOKEN = (
  process.env.BENCH_AUTH_TOKEN ||
  process.env.BENCH_TOKEN ||
  ""
).trim();

const ITERATIONS =
  cliOptions.iterations ?? Number(process.env.BENCH_COMMIT_ITERATIONS || "8");
const WARMUP =
  cliOptions.warmup ?? Number(process.env.BENCH_COMMIT_WARMUP || "1");
const TIMEOUT_MS =
  cliOptions.timeoutMs ??
  Number(process.env.BENCH_COMMIT_TIMEOUT_MS || "20000");
const NODE_TYPE = (process.env.BENCH_COMMIT_NODE_TYPE || "epic")
  .trim()
  .toLowerCase();
const NODE_ID = (process.env.BENCH_COMMIT_NODE_ID || "").trim() || null;
const INCLUDE_TIMELINE =
  cliOptions.includeTimeline ??
  parseBooleanEnv(process.env.BENCH_COMMIT_INCLUDE_TIMELINE, false);
const INCLUDE_ROADMAP_MODES =
  cliOptions.includeRoadmapModes ??
  parseBooleanList(
    process.env.BENCH_COMMIT_INCLUDE_ROADMAP_MODES || "true,false",
  );
const ASSERT_LEAN_P95_MS =
  cliOptions.assertLeanP95Ms ??
  (process.env.BENCH_ASSERT_LEAN_P95_MS
    ? Number(process.env.BENCH_ASSERT_LEAN_P95_MS)
    : null);
const ASSERT_P95_SAVINGS_MS =
  cliOptions.assertP95SavingsMs ??
  (process.env.BENCH_ASSERT_P95_SAVINGS_MS
    ? Number(process.env.BENCH_ASSERT_P95_SAVINGS_MS)
    : null);

if (!API_BASE || !ROADMAP_ID || !AUTH_TOKEN) {
  const missing = [];
  if (!API_BASE) missing.push("BENCH_API_BASE");
  if (!ROADMAP_ID) missing.push("BENCH_ROADMAP_ID");
  if (!AUTH_TOKEN) missing.push("BENCH_AUTH_TOKEN");
  console.error(
    [
      "Missing required env vars.",
      "Required: BENCH_API_BASE, BENCH_ROADMAP_ID, BENCH_AUTH_TOKEN",
      `Missing now: ${missing.join(", ")}`,
    ].join("\n"),
  );
  process.exit(1);
}

if (!Number.isFinite(ITERATIONS) || ITERATIONS < 1) {
  console.error("BENCH_COMMIT_ITERATIONS must be a positive number.");
  process.exit(1);
}
if (!Number.isFinite(WARMUP) || WARMUP < 0) {
  console.error("BENCH_COMMIT_WARMUP must be a non-negative number.");
  process.exit(1);
}
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS < 1000) {
  console.error("BENCH_COMMIT_TIMEOUT_MS must be >= 1000.");
  process.exit(1);
}
if (!["epic", "feature", "task"].includes(NODE_TYPE)) {
  console.error("BENCH_COMMIT_NODE_TYPE must be one of: epic, feature, task.");
  process.exit(1);
}
if (INCLUDE_ROADMAP_MODES.length === 0) {
  console.error(
    "BENCH_COMMIT_INCLUDE_ROADMAP_MODES must include at least one mode.",
  );
  process.exit(1);
}
if (
  ASSERT_LEAN_P95_MS !== null &&
  (!Number.isFinite(ASSERT_LEAN_P95_MS) || ASSERT_LEAN_P95_MS <= 0)
) {
  console.error(
    "BENCH_ASSERT_LEAN_P95_MS must be a positive number when provided.",
  );
  process.exit(1);
}
if (
  ASSERT_P95_SAVINGS_MS !== null &&
  (!Number.isFinite(ASSERT_P95_SAVINGS_MS) || ASSERT_P95_SAVINGS_MS < 0)
) {
  console.error("BENCH_ASSERT_P95_SAVINGS_MS must be >= 0 when provided.");
  process.exit(1);
}

const roadmapEndpoint = `${API_BASE}/roadmaps/${ROADMAP_ID}`;
const commitEndpoint = `${API_BASE}/roadmaps/${ROADMAP_ID}/ai/commit`;

async function main() {
  console.log("--- Roadmap AI Commit Benchmark ---");
  console.log(`API base: ${API_BASE}`);
  console.log(`Roadmap: ${ROADMAP_ID}`);
  console.log(`Node type: ${NODE_TYPE}`);
  console.log(`Node id: ${NODE_ID ?? "(auto-select first matching node)"}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Warmup per mode: ${WARMUP}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log(`include_timeline: ${INCLUDE_TIMELINE}`);
  console.log(`include_roadmap modes: ${INCLUDE_ROADMAP_MODES.join(", ")}`);
  if (ASSERT_LEAN_P95_MS !== null) {
    console.log(`Lean p95 assertion: <= ${ASSERT_LEAN_P95_MS}ms`);
  }
  if (ASSERT_P95_SAVINGS_MS !== null) {
    console.log(`p95 savings assertion: >= ${ASSERT_P95_SAVINGS_MS}ms`);
  }

  const roadmap = await fetchRoadmap();
  const operationSeed = resolveOperationSeed(roadmap, {
    nodeType: NODE_TYPE,
    nodeId: NODE_ID,
  });

  console.log(
    `Using node ${operationSeed.nodeType}:${operationSeed.nodeId} (${operationSeed.title || "no-title"})`,
  );

  const summaries = [];
  for (const includeRoadmap of INCLUDE_ROADMAP_MODES) {
    const label = includeRoadmap
      ? "include_roadmap=true"
      : "include_roadmap=false";

    let revisionToken = readRevisionToken(roadmap);
    if (!revisionToken) {
      revisionToken = await fetchRevisionToken();
    }

    for (let i = 0; i < WARMUP; i += 1) {
      const warmupResult = await runCommitOnce({
        revisionToken,
        includeRoadmap,
        includeTimeline: INCLUDE_TIMELINE,
        operation: buildNoopUpdateOperation(operationSeed),
      });
      revisionToken =
        warmupResult.revisionToken ?? (await fetchRevisionToken());
    }

    const durations = [];
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const result = await runCommitOnce({
        revisionToken,
        includeRoadmap,
        includeTimeline: INCLUDE_TIMELINE,
        operation: buildNoopUpdateOperation(operationSeed),
      });
      durations.push(result.elapsedMs);
      if (result.ok) {
        okCount += 1;
      } else {
        failCount += 1;
      }
      revisionToken = result.revisionToken ?? (await fetchRevisionToken());
    }

    summaries.push(
      summarizeDurations({
        label,
        durations,
        okCount,
        failCount,
      }),
    );
  }

  console.log("\nResults");
  for (const summary of summaries) {
    console.log(
      [
        `${summary.label}:`,
        `calls=${summary.calls}`,
        `ok=${summary.okCount}`,
        `fail=${summary.failCount}`,
        `p50=${summary.p50Ms?.toFixed(1) ?? "n/a"}ms`,
        `p95=${summary.p95Ms?.toFixed(1) ?? "n/a"}ms`,
        `avg=${summary.avgMs?.toFixed(1) ?? "n/a"}ms`,
      ].join(" "),
    );
  }

  const full = summaries.find((item) => item.label === "include_roadmap=true");
  const lean = summaries.find((item) => item.label === "include_roadmap=false");
  if (full?.p95Ms != null && lean?.p95Ms != null) {
    const savings = full.p95Ms - lean.p95Ms;
    console.log(`p95 savings (full - lean): ${savings.toFixed(1)}ms`);
  }

  if (summaries.some((summary) => summary.failCount > 0)) {
    process.exitCode = 2;
  }

  if (
    ASSERT_LEAN_P95_MS !== null &&
    lean?.p95Ms != null &&
    lean.p95Ms > ASSERT_LEAN_P95_MS
  ) {
    console.error(
      `Lean p95 assertion failed: observed ${lean.p95Ms.toFixed(1)}ms > ${ASSERT_LEAN_P95_MS}ms`,
    );
    process.exitCode = process.exitCode || 3;
  }

  if (
    ASSERT_P95_SAVINGS_MS !== null &&
    full?.p95Ms != null &&
    lean?.p95Ms != null &&
    full.p95Ms - lean.p95Ms < ASSERT_P95_SAVINGS_MS
  ) {
    console.error(
      `p95 savings assertion failed: observed ${(full.p95Ms - lean.p95Ms).toFixed(1)}ms < ${ASSERT_P95_SAVINGS_MS}ms`,
    );
    process.exitCode = process.exitCode || 4;
  }
}

async function runCommitOnce({
  revisionToken,
  includeRoadmap,
  includeTimeline,
  operation,
}) {
  const payload = {
    revision_token: revisionToken,
    include_roadmap: includeRoadmap,
    include_timeline: includeTimeline,
    operations: [operation],
  };

  const started = performance.now();
  let response = await fetchWithTimeout(commitEndpoint, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  // Stale token can happen if external writes race with benchmark run.
  if (response.status === 409) {
    const refreshed = await fetchRevisionToken();
    const retryPayload = { ...payload, revision_token: refreshed };
    response = await fetchWithTimeout(commitEndpoint, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(retryPayload),
    });
  }

  const elapsedMs = performance.now() - started;
  const body = await parseResponseBody(response);
  const revisionTokenAfter = readRevisionToken(body);

  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    revisionToken: revisionTokenAfter,
    body,
  };
}

async function fetchRoadmap() {
  // The node tree is served by /full; the bare roadmap endpoint returns
  // metadata only. Fall back to the bare endpoint for older APIs.
  const fullResponse = await fetchWithTimeout(`${roadmapEndpoint}/full`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (fullResponse.ok) {
    return parseResponseBody(fullResponse);
  }
  const response = await fetchWithTimeout(roadmapEndpoint, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET roadmap failed with ${response.status}: ${text}`);
  }
  return parseResponseBody(response);
}

async function fetchRevisionToken() {
  const roadmap = await fetchRoadmap();
  const token = readRevisionToken(roadmap);
  if (!token) {
    throw new Error("Unable to resolve revision token from roadmap response.");
  }
  return token;
}

function readRevisionToken(payload) {
  if (!payload || typeof payload !== "object") return null;
  const direct = safeString(payload.revision_token);
  if (direct) return direct;
  const updatedAt = safeString(payload.updated_at);
  if (updatedAt) return updatedAt;
  const dataObj =
    payload && typeof payload.data === "object" ? payload.data : null;
  if (dataObj && typeof dataObj === "object") {
    return safeString(dataObj.revision_token) || safeString(dataObj.updated_at);
  }
  return null;
}

function resolveOperationSeed(roadmapPayload, options) {
  const roadmap = unwrapDataPayload(roadmapPayload);
  const nodeType = options.nodeType;
  const explicitNodeId = options.nodeId;

  const epics = toArray(roadmap.roadmap_epics).length
    ? toArray(roadmap.roadmap_epics)
    : toArray(roadmap.epics);

  const features = epics.flatMap((epic) =>
    toArray(epic.roadmap_features).length
      ? toArray(epic.roadmap_features)
      : toArray(epic.features),
  );

  const tasks = features.flatMap((feature) =>
    toArray(feature.roadmap_tasks).length
      ? toArray(feature.roadmap_tasks)
      : toArray(feature.tasks),
  );

  const sourceList =
    nodeType === "epic" ? epics : nodeType === "feature" ? features : tasks;

  const selected = explicitNodeId
    ? sourceList.find((item) => safeString(item.id) === explicitNodeId)
    : sourceList[0];

  if (!selected) {
    throw new Error(
      `No ${nodeType} node available for benchmark operation${
        explicitNodeId ? ` (id=${explicitNodeId})` : ""
      }`,
    );
  }

  const nodeId = safeString(selected.id);
  if (!nodeId) {
    throw new Error(`Selected ${nodeType} node is missing id.`);
  }

  const title =
    safeString(selected.title) ||
    safeString(selected.name) ||
    safeString(selected.description) ||
    null;

  return {
    nodeType,
    nodeId,
    title,
    patch: buildNoopPatch(selected),
  };
}

function buildNoopPatch(node) {
  const title = safeString(node.title);
  if (title) return { title };
  const description = safeString(node.description);
  if (description) return { description };
  const status = safeString(node.status);
  if (status) return { status };
  const priority = safeString(node.priority);
  if (priority) return { priority };
  throw new Error("Unable to build noop patch from selected node.");
}

function buildNoopUpdateOperation(seed) {
  return {
    op: "update_node",
    node_type: seed.nodeType,
    node_id: seed.nodeId,
    patch: seed.patch,
  };
}

// Emits a single update_node op that fans out to every provided id via
// the targets[] field. Used to benchmark the bulk path that replaced the
// per-id op expansion (see "Assign all tasks to me" regression fix).
function buildBulkNoopUpdateOperation(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error("buildBulkNoopUpdateOperation requires at least one seed.");
  }
  const head = seeds[0];
  return {
    op: "update_node",
    node_type: head.nodeType,
    targets: seeds.map((seed) => seed.nodeId),
    patch: head.patch,
  };
}

function summarizeDurations({ label, durations, okCount, failCount }) {
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const avg =
    durations.length > 0
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null;

  return {
    label,
    calls: durations.length,
    okCount,
    failCount,
    p50Ms: p50,
    p95Ms: p95,
    avgMs: avg,
  };
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function authHeaders() {
  return {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return unwrapDataPayload(parsed);
  } catch {
    return { raw: text };
  }
}

function unwrapDataPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseBooleanEnv(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseBooleanList(value) {
  const seen = new Set();
  const values = String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => ["1", "true", "yes", "on"].includes(item));

  for (const flag of values) {
    seen.add(flag);
  }

  return [...seen];
}

function parseCliOptions(argv) {
  const options = {
    iterations: null,
    warmup: null,
    timeoutMs: null,
    includeTimeline: null,
    includeRoadmapModes: null,
    assertLeanP95Ms: null,
    assertP95SavingsMs: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--iterations=")) {
      options.iterations = Number(arg.slice("--iterations=".length));
      continue;
    }
    if (arg.startsWith("--warmup=")) {
      options.warmup = Number(arg.slice("--warmup=".length));
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg.startsWith("--include-timeline=")) {
      const value = arg.slice("--include-timeline=".length);
      options.includeTimeline = parseBooleanEnv(value, false);
      continue;
    }
    if (arg.startsWith("--include-roadmap-modes=")) {
      const value = arg.slice("--include-roadmap-modes=".length);
      options.includeRoadmapModes = parseBooleanList(value);
      continue;
    }
    if (arg.startsWith("--assert-lean-p95-ms=")) {
      options.assertLeanP95Ms = Number(
        arg.slice("--assert-lean-p95-ms=".length),
      );
      continue;
    }
    if (arg.startsWith("--assert-p95-savings-ms=")) {
      options.assertP95SavingsMs = Number(
        arg.slice("--assert-p95-savings-ms=".length),
      );
    }
  }

  return options;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function loadEnvFiles() {
  const cwdEnv = path.join(process.cwd(), ".env");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptEnv = path.join(scriptDir, ".env");
  const repoEnv = path.join(scriptDir, "..", ".env");
  const backendEnv = path.join(scriptDir, "..", "backend", ".env");

  const candidates = [cwdEnv, scriptEnv, repoEnv, backendEnv];
  for (const filePath of candidates) {
    applyEnvFile(filePath);
  }
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
