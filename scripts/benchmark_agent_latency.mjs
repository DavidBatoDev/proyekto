#!/usr/bin/env node

/**
 * End-to-end latency benchmark for the roadmap AI agent on its production
 * model settings. Answers "where does a turn's time go?" and gates
 * before/after changes on the same prompts.
 *
 * Spawns the Python agent locally (from --agent-dir, default agent/) with the
 * production model knobs (.github/workflows/agent-deploy.yml) injected, so a
 * local agent/.env that still pins an older model does not skew the run. Each
 * sample is a fresh session (history never confounds prompt size); the edit
 * scenario renames a uniquely titled task and undoes it in the same session.
 *
 * Per request it records the client wall time, the server elapsed time, every
 * model call (latency from provider_attempt -> provider_success, input /
 * cached / output / reasoning tokens, effort), tool calls, the
 * verify report mode, and the reply text so quality can be read side by side.
 *
 * Required env (auto-loaded from .env files, first value wins):
 * - OPENAI_API_KEY (agent/.env)
 * - A backend the agent can reach (NEST_API_BASE_URL)
 * - BENCH_AUTH_TOKEN (a user access token for that backend's Supabase project)
 * - BENCH_ROADMAP_ID (a roadmap the user can edit)
 * - BENCH_WORKSPACE_ID (optional: enables the workspace-scope prompts)
 * - BENCH_EDIT_TASK_TITLE (optional: a uniquely titled task on the roadmap;
 *   enables the rename + undo scenario)
 *
 * Usage (repo root):
 *   node scripts/benchmark_agent_latency.mjs --out=C:/tmp/bench-latency/before.json
 *   node scripts/benchmark_agent_latency.mjs --out=after.json --compare=before.json
 * Options: --samples=N (per prompt, default 3), --agent-dir=<path> (benchmark
 *   another checkout, e.g. a worktree of main), --model=<id>,
 *   --only=<key,key> (prompt subset).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, "..");

loadEnvFiles();

const cli = parseCliOptions(process.argv.slice(2));
const AGENT_DIR = path.resolve(cli.agentDir || path.join(REPO_ROOT, "agent"));
const ROADMAP_ID = (process.env.BENCH_ROADMAP_ID || "").trim();
const WORKSPACE_ID = (process.env.BENCH_WORKSPACE_ID || "").trim();
const EDIT_TASK_TITLE = (process.env.BENCH_EDIT_TASK_TITLE || "").trim();
const AGENT_PORT = Number(process.env.BENCH_AGENT_PORT || "8011");
const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;
const SAMPLES = cli.samples ?? Number(process.env.BENCH_LATENCY_SAMPLES || "3");
const TURN_TIMEOUT_MS = Number(process.env.BENCH_TURN_TIMEOUT_MS || "180000");
const MODEL = cli.model || process.env.BENCH_MODEL || "gpt-5.6-luna";

// Production model knobs (agent-deploy.yml ENV_VARS). Realtime push is off:
// the local run has no worker, and both sides of a comparison must match.
const PROD_ENV = {
  OPENAI_MODEL_V2: MODEL,
  OPENAI_V2_REASONING_EFFORT: "low",
  OPENAI_V2_VERBOSITY: "low",
  OPENAI_V2_PROMPT_CACHE_MODE: "explicit",
  OPENAI_V2_MAX_OUTPUT_TOKENS: "16000",
  AGENT_SUMMARY_MODEL: MODEL,
  AGENT_SUMMARY_REASONING_EFFORT: "none",
  AGENT_V2_MAX_TOOL_CALLS: "24",
  OPENAI_V2_STREAMING_ENABLED: "true",
  OPENAI_V2_REASONING_SUMMARY_ENABLED: process.env.BENCH_REASONING_SUMMARY ?? "false",
  AGENT_PROJECT_CONTEXT_ENABLED: "true",
  AGENT_KNOWLEDGE_SEARCH_ENABLED: "true",
  AGENT_REALTIME_TRACE_PUSH_ENABLED: "false",
  AGENT_LOG_LEVEL: "WARNING",
  AGENT_LOG_JSON: "true",
  AGENT_LOG_FILE: "",
  APP_PORT: String(AGENT_PORT),
};

const SCENARIOS = [
  { key: "rm_question", scope: "roadmap", turns: ["What is this roadmap about, in two sentences?"] },
  { key: "rm_list", scope: "roadmap", turns: ["Which tasks are currently in progress?"] },
  {
    key: "rm_edit_undo",
    scope: "roadmap",
    needs: () => Boolean(EDIT_TASK_TITLE),
    turns: [
      () => `Rename the task "${EDIT_TASK_TITLE}" to "${EDIT_TASK_TITLE} (bench)".`,
      () => "Undo that.",
    ],
  },
  { key: "ws_hi", scope: "workspace", turns: ["hi"] },
  { key: "ws_summary", scope: "workspace", turns: ["Summarize my projects."] },
  {
    key: "ws_cross",
    scope: "workspace",
    turns: ["Across all my roadmaps, which epics have the most unfinished tasks?"],
  },
];

async function main() {
  if (!ROADMAP_ID) fail("BENCH_ROADMAP_ID is required");
  const token = (process.env.BENCH_AUTH_TOKEN || "").trim();
  if (!token) fail("BENCH_AUTH_TOKEN is required (a user access token for the backend's Supabase project)");
  if (!fs.existsSync(path.join(AGENT_DIR, "app", "main.py"))) fail(`no agent at ${AGENT_DIR}`);

  const scenarios = SCENARIOS.filter((s) => {
    if (cli.only && !cli.only.includes(s.key)) return false;
    if (s.scope === "workspace" && !WORKSPACE_ID) return false;
    if (s.needs && !s.needs()) return false;
    return true;
  });
  const skipped = SCENARIOS.filter((s) => !scenarios.includes(s)).map((s) => s.key);
  console.log(
    `[bench] agent=${AGENT_DIR} model=${MODEL} roadmap=${ROADMAP_ID} workspace=${WORKSPACE_ID || "-"} ` +
      `samples=${SAMPLES}` + (skipped.length ? ` skipped=${skipped.join(",")}` : ""),
  );

  const agent = await startAgent(resolvePythonBin());
  const samples = [];
  try {
    // Warm-up (excluded): connection pools + the prompt cache.
    await runScenario(token, scenarios[0]).catch((error) => console.warn(`[bench] warm-up failed: ${trimError(error)}`));
    for (let s = 0; s < SAMPLES; s++) {
      for (const scenario of scenarios) {
        try {
          const requests = await runScenario(token, scenario);
          requests.forEach((request, turnIndex) => {
            const key = requests.length > 1 ? `${scenario.key}#${turnIndex + 1}` : scenario.key;
            samples.push({ key, sample: s, ...request });
            console.log(
              `[bench] ${key.padEnd(16)} wall=${request.wall_ms}ms server=${request.elapsed_ms ?? "?"}ms ` +
                `model=${request.model_calls}x/${request.model_ms}ms tools=${request.tool_calls} ` +
                `effort=${request.efforts.join(">") || "-"} verify=${request.verify_report_mode || "-"}`,
            );
          });
        } catch (error) {
          samples.push({ key: scenario.key, sample: s, error: trimError(error) });
          console.warn(`[bench] ${scenario.key} FAILED: ${trimError(error)}`);
        }
      }
    }
  } finally {
    await stopAgent(agent);
  }

  const result = { model: MODEL, agent_dir: AGENT_DIR, at: new Date().toISOString(), samples };
  if (cli.out) {
    fs.mkdirSync(path.dirname(path.resolve(cli.out)), { recursive: true });
    fs.writeFileSync(cli.out, JSON.stringify(result, null, 2));
    console.log(`\n[bench] samples -> ${cli.out}`);
  }
  const summary = summarize(samples);
  printSummary(summary);
  if (cli.compare) {
    const baseline = JSON.parse(fs.readFileSync(cli.compare, "utf8"));
    printComparison(summarize(baseline.samples || []), summary);
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function runScenario(token, scenario) {
  const body =
    scenario.scope === "workspace"
      ? { scope: { kind: "workspace", workspace_id: WORKSPACE_ID } }
      : { roadmap_id: ROADMAP_ID };
  const session = await agentFetch("/agent/sessions", token, { method: "POST", body: JSON.stringify(body) });
  const sessionId = session.session_id || session.id;
  if (!sessionId) throw new Error(`no session id in ${JSON.stringify(session).slice(0, 200)}`);
  // Every turn first (the edit scenario's undo must run even if reading a
  // trace fails), then the traces.
  const turns = [];
  let turnError = null;
  for (const turn of scenario.turns) {
    const message = typeof turn === "function" ? turn() : turn;
    try {
      turns.push(await runTurn(token, sessionId, message));
    } catch (error) {
      turnError = error;
    }
  }
  const requests = [];
  for (const turn of turns) {
    const trace = await readTrace(token, sessionId, turn.trace_id);
    requests.push({ ...turn, ...traceMetrics(trace) });
  }
  if (turnError) throw turnError;
  return requests;
}

async function readTrace(token, sessionId, traceId) {
  const events = [];
  let afterSeq = 0;
  for (let page = 0; page < 20; page++) {
    const chunk = await agentFetch(
      `/agent/sessions/${sessionId}/traces/${traceId}/events?after_seq=${afterSeq}&limit=200&detail=verbose`,
      token,
      { method: "GET" },
    );
    const batch = Array.isArray(chunk?.events) ? chunk.events : [];
    events.push(...batch);
    if (batch.length < 200) break;
    afterSeq = Math.max(...batch.map((event) => Number(event.seq) || 0));
  }
  return { events };
}

async function runTurn(token, sessionId, message) {
  const traceId = randomUUID();
  const started = performance.now();
  let response = await agentFetch(`/agent/sessions/${sessionId}/messages`, token, {
    method: "POST",
    headers: { "X-Trace-Id": traceId },
    body: JSON.stringify({ message, capabilities: ["continue"] }),
  });
  let requestsMade = 1;
  // Client-driven continuation, exactly like the web.
  while (response?.run?.next === "continue" && requestsMade < 10) {
    response = await agentFetch(
      `/agent/sessions/${sessionId}/runs/${response.run.run_id}/continue`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    );
    requestsMade += 1;
  }
  const wallMs = Math.round(performance.now() - started);
  return {
    message,
    trace_id: response.debug_trace_id || response?.run?.trace_id || traceId,
    wall_ms: wallMs,
    http_requests: requestsMade,
    run_status: response?.run?.status ?? null,
    reply: String(response.assistant_message || "").slice(0, 600),
  };
}

function traceMetrics(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const ts = (event) => Date.parse(event.ts);
  // Model calls run one at a time: each success closes the latest attempt.
  let attemptTs = null;
  const calls = [];
  const efforts = [];
  let elapsedMs = null;
  let toolCalls = 0;
  let verifyReportMode = null;
  for (const event of events) {
    const d = event.details || {};
    if (event.event === "provider_attempt") {
      attemptTs = ts(event);
      if (d.reasoning_effort) efforts.push(d.reasoning_effort);
    }
    if (event.event === "provider_success") {
      const startedAt = attemptTs;
      attemptTs = null;
      calls.push({
        turn: d.turn ?? null,
        ms: Number.isFinite(startedAt) ? ts(event) - startedAt : null,
        input: num(d.tokens_input),
        cached: num(d.tokens_cached),
        output: num(d.tokens_total) != null && num(d.tokens_input) != null ? d.tokens_total - d.tokens_input : null,
        reasoning: num(d.tokens_reasoning),
        tools: d.tool_names || [],
      });
    }
    if (event.event === "tool_call_requested") toolCalls += 1;
    if (event.event === "verify_completed" && d.report_mode) {
      verifyReportMode = d.fast_path ? "staged_fast" : d.report_mode;
    }
    if (event.event === "message_completed") {
      if (d.elapsed_ms != null) elapsedMs = Number(d.elapsed_ms);
      if (d.verify_report_mode) verifyReportMode = d.verify_report_mode;
    }
  }
  const sum = (key) => calls.reduce((total, call) => total + (num(call[key]) ?? 0), 0);
  return {
    elapsed_ms: elapsedMs,
    model_calls: calls.length,
    model_ms: sum("ms"),
    tokens_input: sum("input"),
    tokens_cached: sum("cached"),
    tokens_output: sum("output"),
    tokens_reasoning: sum("reasoning"),
    tool_calls: toolCalls,
    efforts,
    verify_report_mode: verifyReportMode,
    calls,
    event_count: events.length,
    // Offsets from the first event: the gaps show where non-model time goes.
    timeline: events.map((event) => {
      const d = event.details || {};
      const label = d.tool_name || d.phase || d.roadmap_title || "";
      return `${Number.isFinite(ts(event)) && events.length ? ts(event) - ts(events[0]) : "?"}ms ${event.event}${label ? ` (${label})` : ""}${d.commit_ms != null ? ` commit_ms=${d.commit_ms}` : ""}`;
    }),
  };
}

async function agentFetch(pathname, token, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  try {
    const response = await fetch(`${AGENT_BASE}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${options.method} ${pathname} -> ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

function resolvePythonBin() {
  const mainAgent = path.join(REPO_ROOT, "agent");
  const candidates = [
    process.env.AGENT_PYTHON_BIN,
    path.join(AGENT_DIR, "venv", "Scripts", "python.exe"),
    path.join(mainAgent, "venv", "Scripts", "python.exe"),
    path.join(AGENT_DIR, "venv", "bin", "python"),
    path.join(mainAgent, "venv", "bin", "python"),
  ].filter(Boolean);
  // Absolute: the agent is spawned with its own cwd (--agent-dir).
  for (const candidate of candidates) if (fs.existsSync(candidate)) return path.resolve(candidate);
  fail("No agent Python found. Set AGENT_PYTHON_BIN, e.g. AGENT_PYTHON_BIN=agent/venv/Scripts/python.exe");
}

async function startAgent(pythonBin) {
  const child = spawn(
    pythonBin,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(AGENT_PORT)],
    { cwd: AGENT_DIR, env: { ...process.env, ...PROD_ENV }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const recent = [];
  const remember = (chunk) => {
    recent.push(String(chunk));
    if (recent.length > 30) recent.shift();
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) fail(`agent exited early (${child.exitCode}):\n${recent.join("")}`);
    try {
      if ((await fetch(`${AGENT_BASE}/health`)).ok) {
        console.log(`[bench] agent up on :${AGENT_PORT}`);
        return child;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  child.kill();
  fail(`agent did not become healthy in 60s:\n${recent.join("")}`);
}

async function stopAgent(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  const deadline = Date.now() + 10_000;
  while (child.exitCode == null && Date.now() < deadline) await sleep(200);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(samples) {
  const byKey = new Map();
  for (const sample of samples) {
    if (sample.error) continue;
    if (!byKey.has(sample.key)) byKey.set(sample.key, []);
    byKey.get(sample.key).push(sample);
  }
  const rows = {};
  for (const [key, cell] of byKey) {
    const callMs = cell.flatMap((s) => (s.calls || []).map((c) => c.ms)).filter(isNum);
    rows[key] = {
      n: cell.length,
      wall50: percentile(cell.map((s) => s.wall_ms), 50),
      wall90: percentile(cell.map((s) => s.wall_ms), 90),
      server50: percentile(cell.map((s) => s.elapsed_ms), 50),
      calls50: percentile(cell.map((s) => s.model_calls), 50),
      model50: percentile(cell.map((s) => s.model_ms), 50),
      call50: percentile(callMs, 50),
      nonModel50: percentile(cell.map((s) => (isNum(s.wall_ms) ? s.wall_ms - s.model_ms : null)), 50),
      reasoning50: percentile(cell.map((s) => s.tokens_reasoning), 50),
      cachedPct: pct(sumOf(cell, "tokens_cached"), sumOf(cell, "tokens_input")),
      efforts: [...new Set(cell.map((s) => (s.efforts || []).join(">")).filter(Boolean))].join(" | "),
      verify: [...new Set(cell.map((s) => s.verify_report_mode).filter(Boolean))].join(","),
      reply: cell[cell.length - 1]?.reply || "",
    };
  }
  return rows;
}

function printSummary(rows) {
  console.log("\n=== Agent latency (median [p90], ms) ===");
  for (const [key, r] of Object.entries(rows)) {
    console.log(
      `${key.padEnd(16)} n=${r.n} wall=${fmt(r.wall50)} [${fmt(r.wall90)}] server=${fmt(r.server50)} ` +
        `model=${fmt(r.calls50)}x ${fmt(r.model50)} (per call ${fmt(r.call50)}) wall-minus-model=${fmt(r.nonModel50)} ` +
        `reasoning_tok=${fmt(r.reasoning50)} cached=${fmt(r.cachedPct)}% effort=${r.efforts || "-"} verify=${r.verify || "-"}`,
    );
    console.log(`${"".padEnd(16)} reply: ${r.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

function printComparison(before, after) {
  console.log("\n=== Before -> after (median) ===");
  for (const key of Object.keys(after)) {
    const b = before[key];
    const a = after[key];
    if (!b) continue;
    const delta = (x, y) => (isNum(x) && isNum(y) ? `${y - x >= 0 ? "+" : ""}${Math.round(y - x)}` : "?");
    const pctDelta = isNum(b.wall50) && b.wall50 > 0 && isNum(a.wall50) ? ((a.wall50 - b.wall50) / b.wall50) * 100 : null;
    console.log(
      `${key.padEnd(16)} wall ${fmt(b.wall50)} -> ${fmt(a.wall50)} (${delta(b.wall50, a.wall50)}ms` +
        (pctDelta != null ? `, ${pctDelta.toFixed(0)}%` : "") +
        `) model calls ${fmt(b.calls50)} -> ${fmt(a.calls50)} non-model ${fmt(b.nonModel50)} -> ${fmt(a.nonModel50)} ` +
        `cached ${fmt(b.cachedPct)}% -> ${fmt(a.cachedPct)}%`,
    );
    console.log(`${"".padEnd(16)} before: ${b.reply.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`${"".padEnd(16)} after:  ${a.reply.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sumOf(cell, key) {
  return cell.reduce((total, s) => total + (num(s[key]) ?? 0), 0);
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null;
}

function percentile(values, p) {
  const usable = (values || []).filter(isNum);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
}

function num(value) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function fmt(value) {
  return isNum(value) ? String(Math.round(value)) : "?";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function fail(message) {
  console.error(`[bench] ${message}`);
  process.exit(1);
}

function parseCliOptions(argv) {
  const options = { samples: null, out: null, compare: null, agentDir: null, model: null, only: null };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (flag === "--samples") options.samples = Number(value);
    else if (flag === "--out") options.out = value;
    else if (flag === "--compare") options.compare = value;
    else if (flag === "--agent-dir") options.agentDir = value;
    else if (flag === "--model") options.model = value;
    else if (flag === "--only") options.only = value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return options;
}

function loadEnvFiles() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(SCRIPT_DIR, ".env"),
    path.join(REPO_ROOT, ".env"),
    path.join(REPO_ROOT, "agent", ".env"),
  ];
  for (const filePath of candidates) applyEnvFile(filePath);
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
