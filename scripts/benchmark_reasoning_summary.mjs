#!/usr/bin/env node

/**
 * A/B benchmark: do OpenAI reasoning summaries (assistant_thought narration)
 * slow the roadmap AI agent?
 *
 * Spawns the Python agent locally per arm (OPENAI_V2_REASONING_SUMMARY_ENABLED
 * true vs false — the flag is process-level), runs an identical read-only
 * prompt set against a real roadmap through a real backend, and compares:
 *   - wall_ms            client-measured message POST duration (the con)
 *   - server elapsed_ms  from the trace's message_completed event
 *   - output tokens      sum over provider_success (tokens_total - tokens_input)
 *   - thought_count      assistant_thought events (sanity: >0 ON, 0 OFF)
 *   - ttfs_ms            time to first meaningful signal (the pro): first
 *                        assistant_thought / assistant_delta / tool_call_requested
 *
 * Blocks alternate ON/OFF to absorb OpenAI latency drift. Fresh session per
 * sample so history length never confounds prompt size. One excluded warm-up
 * turn per agent spawn.
 *
 * Required env (auto-loaded from .env files):
 * - OPENAI_API_KEY (agent/.env)
 * - Backend running (NEST_API_BASE_URL, default http://localhost:8001/api)
 * - Auth: BENCH_AUTH_TOKEN, or Supabase password grant via
 *   BENCH_SUPABASE_EMAIL/BENCH_SUPABASE_PASSWORD (falls back to
 *   PLAYWRIGHT_EMAIL/PLAYWRIGHT_PASSWORD from web/.env) +
 *   (VITE_)SUPABASE_URL / (VITE_)SUPABASE_ANON_KEY
 *
 * Optional env / CLI:
 * - BENCH_ROADMAP_ID (default: the QA roadmap used by web/playwright/drive.mjs)
 * - BENCH_SUMMARY_SAMPLES (per prompt per block, default 5) / --samples=
 * - BENCH_SUMMARY_BLOCKS (default 4, alternating on/off) / --blocks=
 * - BENCH_AGENT_PORT (default 8011)
 * - BENCH_TURN_TIMEOUT_MS (default 180000)
 * - --assert-max-overhead-pct=10 (exit 1 if median wall overhead exceeds it)
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
const AGENT_DIR = path.join(REPO_ROOT, "agent");

loadEnvFiles();

const cli = parseCliOptions(process.argv.slice(2));

const ROADMAP_ID = (
  process.env.BENCH_ROADMAP_ID || "5ebdbb85-87a6-4685-aba4-fcf7f2283afe"
).trim();
const AGENT_PORT = Number(process.env.BENCH_AGENT_PORT || "8011");
const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;
const SAMPLES = cli.samples ?? Number(process.env.BENCH_SUMMARY_SAMPLES || "5");
const BLOCKS = cli.blocks ?? Number(process.env.BENCH_SUMMARY_BLOCKS || "4");
const TURN_TIMEOUT_MS = Number(process.env.BENCH_TURN_TIMEOUT_MS || "180000");
const RESULTS_DIR = "C:/tmp/bench-reasoning-summary";

const PROMPTS = [
  { key: "no_tool", text: "thanks, that's all!" },
  { key: "single_read", text: "How many tasks are currently in progress?" },
  {
    key: "multi_read",
    text: "Which feature has the most unfinished tasks, and what's blocked right now?",
  },
];

async function main() {
  if (!Number.isFinite(SAMPLES) || SAMPLES < 1) {
    fail("BENCH_SUMMARY_SAMPLES must be >= 1");
  }
  if (!Number.isFinite(BLOCKS) || BLOCKS < 2) {
    fail("BENCH_SUMMARY_BLOCKS must be >= 2 (arms must alternate)");
  }

  const token = await resolveAuthToken();
  const pythonBin = resolvePythonBin();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const totalTurns = BLOCKS * (PROMPTS.length * SAMPLES + 1);
  console.log(
    `[bench] roadmap=${ROADMAP_ID} blocks=${BLOCKS} samples/cell=${
      SAMPLES * Math.ceil(BLOCKS / 2)
    } (~${totalTurns} turns incl. warm-ups)`,
  );

  const samples = [];
  for (let block = 0; block < BLOCKS; block++) {
    const summaryOn = block % 2 === 0;
    const arm = summaryOn ? "on" : "off";
    console.log(`\n[bench] block ${block + 1}/${BLOCKS} — arm=${arm}`);
    const agent = await startAgent(pythonBin, summaryOn);
    try {
      // Warm-up turn (excluded): prompt cache + connection pools.
      await runTurn(token, PROMPTS[1].text).catch((error) => {
        console.warn(`[bench] warm-up failed: ${trimError(error)}`);
      });
      for (let s = 0; s < SAMPLES; s++) {
        for (const prompt of PROMPTS) {
          try {
            const sample = await runTurn(token, prompt.text);
            samples.push({ arm, block, prompt: prompt.key, ...sample });
            console.log(
              `[bench]   ${prompt.key.padEnd(12)} wall=${sample.wall_ms}ms ` +
                `server=${sample.elapsed_ms ?? "?"}ms out_tok=${sample.tokens_output ?? "?"} ` +
                `thoughts=${sample.thought_count} ttfs=${sample.ttfs_ms ?? "?"}ms`,
            );
          } catch (error) {
            samples.push({ arm, block, prompt: prompt.key, error: trimError(error) });
            console.warn(`[bench]   ${prompt.key} FAILED: ${trimError(error)}`);
          }
          await sleep(400);
        }
      }
    } finally {
      await stopAgent(agent);
    }
  }

  const resultsPath = path.join(RESULTS_DIR, "results.json");
  fs.writeFileSync(resultsPath, JSON.stringify({ samples }, null, 2));
  console.log(`\n[bench] raw samples → ${resultsPath}`);

  const overheadPct = report(samples);
  if (cli.assertMaxOverheadPct != null && overheadPct != null) {
    if (overheadPct > cli.assertMaxOverheadPct) {
      fail(
        `median wall overhead ${overheadPct.toFixed(1)}% exceeds --assert-max-overhead-pct=${cli.assertMaxOverheadPct}`,
      );
    }
    console.log(
      `[bench] PASS: overhead ${overheadPct.toFixed(1)}% <= ${cli.assertMaxOverheadPct}%`,
    );
  }
}

// ---------------------------------------------------------------------------
// Turn execution
// ---------------------------------------------------------------------------

async function runTurn(token, message) {
  const session = await agentFetch("/agent/sessions", token, {
    method: "POST",
    body: JSON.stringify({ roadmap_id: ROADMAP_ID }),
  });
  const sessionId = session.session_id || session.id;
  if (!sessionId) throw new Error(`no session id in ${JSON.stringify(session).slice(0, 200)}`);

  const traceId = randomUUID();
  const started = performance.now();
  const response = await agentFetch(
    `/agent/sessions/${sessionId}/messages`,
    token,
    {
      method: "POST",
      headers: { "X-Trace-Id": traceId },
      body: JSON.stringify({ message }),
    },
  );
  const wallMs = Math.round(performance.now() - started);

  const effectiveTraceId = response.debug_trace_id || traceId;
  const trace = await agentFetch(
    `/agent/sessions/${sessionId}/traces/${effectiveTraceId}/events?after_seq=0&limit=200&detail=structured`,
    token,
    { method: "GET" },
  );
  return { wall_ms: wallMs, ...extractTraceMetrics(trace) };
}

function extractTraceMetrics(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const baseTs = events.length > 0 ? Date.parse(events[0].ts) : NaN;
  const offset = (event) => {
    const ts = Date.parse(event.ts);
    return Number.isFinite(ts) && Number.isFinite(baseTs)
      ? Math.max(0, ts - baseTs)
      : null;
  };

  let elapsedMs = null;
  let providerCalls = 0;
  let tokensTotal = 0;
  let tokensInput = 0;
  let thoughtCount = 0;
  let firstThoughtMs = null;
  let firstSignalMs = null;

  for (const event of events) {
    const details = event.details || {};
    if (event.event === "message_completed" && details.elapsed_ms != null) {
      elapsedMs = Number(details.elapsed_ms);
    }
    if (event.event === "provider_success") {
      providerCalls += 1;
      tokensTotal += Number(details.tokens_total || 0);
      tokensInput += Number(details.tokens_input || 0);
    }
    if (event.event === "assistant_thought") {
      thoughtCount += 1;
      if (firstThoughtMs == null) firstThoughtMs = offset(event);
    }
    if (
      firstSignalMs == null &&
      ["assistant_thought", "assistant_delta", "tool_call_requested"].includes(
        event.event,
      )
    ) {
      firstSignalMs = offset(event);
    }
  }

  return {
    elapsed_ms: elapsedMs,
    provider_calls: providerCalls,
    tokens_output: tokensTotal > 0 ? tokensTotal - tokensInput : null,
    thought_count: thoughtCount,
    first_thought_ms: firstThoughtMs,
    ttfs_ms: firstSignalMs,
    event_count: events.length,
  };
}

async function agentFetch(pathname, token, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  try {
    const response = await fetch(`${AGENT_BASE}${pathname}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${options.method} ${pathname} → ${response.status}: ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

function resolvePythonBin() {
  const candidates = [
    process.env.AGENT_PYTHON_BIN,
    path.join(AGENT_DIR, "venv", "Scripts", "python.exe"),
    path.join(AGENT_DIR, ".venv", "Scripts", "python.exe"),
    path.join(AGENT_DIR, "venv", "bin", "python"),
    path.join(AGENT_DIR, ".venv", "bin", "python"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(
    "No agent Python found. Set AGENT_PYTHON_BIN, e.g. AGENT_PYTHON_BIN=agent\\venv\\Scripts\\python.exe",
  );
}

async function startAgent(pythonBin, summaryOn) {
  const child = spawn(
    pythonBin,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(AGENT_PORT)],
    {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        OPENAI_V2_REASONING_SUMMARY_ENABLED: summaryOn ? "true" : "false",
        // Keep both arms identical and self-contained: no realtime push, no
        // console noise beyond warnings.
        AGENT_REALTIME_TRACE_PUSH_ENABLED: "false",
        AGENT_LOG_LEVEL: "WARNING",
        AGENT_LOG_JSON: "true",
        APP_PORT: String(AGENT_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const recentOutput = [];
  const remember = (chunk) => {
    recentOutput.push(String(chunk));
    if (recentOutput.length > 20) recentOutput.shift();
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      fail(`agent exited early (${child.exitCode}):\n${recentOutput.join("")}`);
    }
    try {
      const response = await fetch(`${AGENT_BASE}/health`);
      if (response.ok) {
        console.log(`[bench] agent up (summary=${summaryOn ? "on" : "off"})`);
        return child;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  child.kill();
  fail(`agent did not become healthy in 60s:\n${recentOutput.join("")}`);
}

async function stopAgent(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  const deadline = Date.now() + 10_000;
  while (child.exitCode == null && Date.now() < deadline) {
    await sleep(200);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function resolveAuthToken() {
  const explicit = (process.env.BENCH_AUTH_TOKEN || "").trim();
  if (explicit) return explicit;

  const supabaseUrl = (
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
  ).trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
  ).trim();
  const email = (
    process.env.BENCH_SUPABASE_EMAIL || process.env.PLAYWRIGHT_EMAIL || ""
  ).trim();
  const password = (
    process.env.BENCH_SUPABASE_PASSWORD || process.env.PLAYWRIGHT_PASSWORD || ""
  ).trim();
  if (!supabaseUrl || !anonKey || !email || !password) {
    fail(
      "No auth. Set BENCH_AUTH_TOKEN, or SUPABASE_URL + SUPABASE_ANON_KEY + BENCH_SUPABASE_EMAIL/PASSWORD (PLAYWRIGHT_* also accepted).",
    );
  }
  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    fail(`Supabase password grant failed (${response.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  console.log(`[bench] minted token for ${email}`);
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(samples) {
  const ok = samples.filter((sample) => !sample.error);
  const failed = samples.length - ok.length;
  if (failed > 0) console.warn(`[bench] ${failed} sample(s) failed and were excluded`);

  console.log("\n=== Reasoning-summary A/B (median [p90]) ===");
  const overheads = [];
  for (const prompt of PROMPTS) {
    const rows = {};
    for (const arm of ["off", "on"]) {
      const cell = ok.filter((s) => s.arm === arm && s.prompt === prompt.key);
      rows[arm] = {
        n: cell.length,
        wall50: percentile(cell.map((s) => s.wall_ms), 50),
        wall90: percentile(cell.map((s) => s.wall_ms), 90),
        server50: percentile(cell.map((s) => s.elapsed_ms).filter(isNum), 50),
        out50: percentile(cell.map((s) => s.tokens_output).filter(isNum), 50),
        calls50: percentile(cell.map((s) => s.provider_calls).filter(isNum), 50),
        thoughts50: percentile(cell.map((s) => s.thought_count).filter(isNum), 50),
        ttfs50: percentile(cell.map((s) => s.ttfs_ms).filter(isNum), 50),
      };
    }
    console.log(`\n--- ${prompt.key} ---`);
    for (const arm of ["off", "on"]) {
      const r = rows[arm];
      console.log(
        `  ${arm.padEnd(3)} n=${r.n} wall=${fmt(r.wall50)} [${fmt(r.wall90)}] ` +
          `server=${fmt(r.server50)} out_tok=${fmt(r.out50)} calls=${fmt(r.calls50)} ` +
          `thoughts=${fmt(r.thoughts50)} ttfs=${fmt(r.ttfs50)}`,
      );
    }
    if (isNum(rows.on.wall50) && isNum(rows.off.wall50) && rows.off.wall50 > 0) {
      const deltaMs = rows.on.wall50 - rows.off.wall50;
      const deltaPct = (deltaMs / rows.off.wall50) * 100;
      overheads.push(deltaPct);
      const ttfsGain =
        isNum(rows.on.ttfs50) && isNum(rows.off.ttfs50)
          ? rows.off.ttfs50 - rows.on.ttfs50
          : null;
      console.log(
        `  Δ   wall ${deltaMs >= 0 ? "+" : ""}${deltaMs}ms (${deltaPct.toFixed(1)}%)` +
          (ttfsGain != null
            ? `, first-signal ${ttfsGain >= 0 ? `${ttfsGain}ms earlier` : `${-ttfsGain}ms later`} with summaries`
            : ""),
      );
    }
  }

  const overallPct = percentile(overheads, 50);
  if (overallPct != null) {
    console.log(`\n[bench] overall median wall-clock overhead: ${overallPct.toFixed(1)}%`);
  }
  return overallPct;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function percentile(values, p) {
  const usable = (values || []).filter(isNum);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
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
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

function fail(message) {
  console.error(`[bench] ${message}`);
  process.exit(1);
}

function parseCliOptions(argv) {
  const options = { samples: null, blocks: null, assertMaxOverheadPct: null };
  for (const arg of argv) {
    if (arg.startsWith("--samples=")) {
      options.samples = Number(arg.slice("--samples=".length));
    } else if (arg.startsWith("--blocks=")) {
      options.blocks = Number(arg.slice("--blocks=".length));
    } else if (arg.startsWith("--assert-max-overhead-pct=")) {
      options.assertMaxOverheadPct = Number(
        arg.slice("--assert-max-overhead-pct=".length),
      );
    }
  }
  return options;
}

function loadEnvFiles() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(SCRIPT_DIR, ".env"),
    path.join(REPO_ROOT, ".env"),
    path.join(AGENT_DIR, ".env"),
    path.join(REPO_ROOT, "backend", ".env"),
    path.join(REPO_ROOT, "web", ".env"),
  ];
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
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
