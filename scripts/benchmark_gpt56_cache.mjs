#!/usr/bin/env node
/**
 * GPT-5.6 live check: drives ONE multi-turn agent session per prompt-cache
 * arm against a running backend and reports, per model call, the counters
 * the 5.6 migration added (cached / cache-write / reasoning tokens) plus
 * the reply text, so the list-reply gate can be eyeballed.
 *
 * Arms (each spawns its own agent on BENCH_AGENT_PORT with the arm's env):
 *   OPENAI_V2_PROMPT_CACHE_MODE=implicit | explicit   (--arms=implicit,explicit)
 *
 * Prerequisites:
 * - Backend running (NEST_API_BASE_URL, default http://localhost:8000/api)
 * - Auth: BENCH_AUTH_TOKEN, or a Supabase password grant via
 *   SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY +
 *   BENCH_SUPABASE_EMAIL/PASSWORD (PLAYWRIGHT_* also accepted)
 * - BENCH_ROADMAP_ID (a roadmap the user can edit, on the backend's database)
 * - BENCH_MODEL (default gpt-5.6-luna), BENCH_AGENT_PORT (default 8011)
 *
 * Env files are auto-loaded (first value wins): cwd .env, scripts/.env,
 * repo .env, agent/.env, web/.env.development.local, web/.env.local, web/.env.
 *
 * Usage (repo root): node scripts/benchmark_gpt56_cache.mjs [--arms=implicit,explicit]
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const AGENT_DIR = path.join(REPO_ROOT, "agent");

loadEnvFiles();

const cli = parseCliOptions(process.argv.slice(2));
const ARMS = cli.arms ?? ["implicit", "explicit"];
const MODEL = process.env.BENCH_MODEL || "gpt-5.6-luna";
const ROADMAP_ID = (process.env.BENCH_ROADMAP_ID || "").trim();
const AGENT_PORT = Number(process.env.BENCH_AGENT_PORT || "8011");
const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;
const TURN_TIMEOUT_MS = Number(process.env.BENCH_TURN_TIMEOUT_MS || "180000");
const RESULTS_DIR = "C:/tmp/bench-gpt56-cache";

// One session, in order: a read-heavy list (the list-reply gate), a follow-up
// that needs the earlier context, a plan request (effort escalation), and a
// direct edit + its undo (execute + verify continuation).
const PROMPTS = [
  { key: "list_epics", text: "List every epic on this roadmap with its status. Show all of them." },
  { key: "follow_up", text: "Which of those have no features under them yet?" },
  { key: "plan_request", text: "Draft a plan for a 'Customer onboarding revamp' epic with 3 features, don't apply it yet." },
  { key: "direct_edit", text: "Add an epic called 'GPT-5.6 live check' to this roadmap." },
  { key: "undo", text: "Undo that." },
];

async function main() {
  if (!ROADMAP_ID) fail("BENCH_ROADMAP_ID is required");
  const token = await resolveAuthToken();
  const pythonBin = resolvePythonBin();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const report = { model: MODEL, roadmap_id: ROADMAP_ID, started_at: new Date().toISOString(), arms: {} };

  for (const arm of ARMS) {
    console.log(`\n=== arm: cache=${arm} model=${MODEL} ===`);
    const child = await startAgent(pythonBin, arm);
    try {
      const session = await agentFetch("/agent/sessions", token, {
        method: "POST",
        body: JSON.stringify({ roadmap_id: ROADMAP_ID }),
      });
      const sessionId = session.session_id || session.id;
      if (!sessionId) fail(`no session id in ${JSON.stringify(session).slice(0, 200)}`);
      const turns = [];
      for (const prompt of PROMPTS) {
        const turn = await runTurn(token, sessionId, prompt.text);
        turns.push({ key: prompt.key, ...turn });
        printTurn(prompt.key, turn);
      }
      report.arms[arm] = { session_id: sessionId, turns };
    } finally {
      await stopAgent(child);
    }
  }

  const outPath = path.join(RESULTS_DIR, `run-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${outPath}`);
  printSummary(report);
}

// ---------------------------------------------------------------------------
// Turn execution (message + continues until the run settles)
// ---------------------------------------------------------------------------

async function runTurn(token, sessionId, message) {
  const traceId = randomUUID();
  const started = performance.now();
  let response = await agentFetch(`/agent/sessions/${sessionId}/messages`, token, {
    method: "POST",
    headers: { "X-Trace-Id": traceId },
    body: JSON.stringify({ message, capabilities: ["continue"] }),
  });
  let steps = 1;
  const traceIds = new Set([response.debug_trace_id || traceId]);
  while (response.run && response.run.next === "continue" && steps < 12) {
    response = await agentFetch(
      `/agent/sessions/${sessionId}/runs/${response.run.run_id}/continue`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    );
    steps += 1;
    if (response.debug_trace_id) traceIds.add(response.debug_trace_id);
  }
  const wallMs = Math.round(performance.now() - started);

  const calls = [];
  let effort = null;
  for (const id of traceIds) {
    const trace = await agentFetch(
      `/agent/sessions/${sessionId}/traces/${id}/events?after_seq=0&limit=200&detail=verbose`,
      token,
      { method: "GET" },
    );
    for (const event of Array.isArray(trace?.events) ? trace.events : []) {
      const d = event.details || {};
      if (event.event === "provider_success") {
        calls.push({
          phase: d.phase ?? null,
          turn: d.turn ?? null,
          finish: d.finish_reason ?? null,
          input: num(d.tokens_input),
          cached: num(d.tokens_cached),
          write: num(d.tokens_cache_write),
          reasoning: num(d.tokens_reasoning),
          total: num(d.tokens_total),
        });
      }
      if (event.event === "reasoning_effort_selected") {
        effort = { effort: d.effort, escalated: d.escalated, trigger: d.trigger };
      }
    }
  }
  const links = (response.assistant_message || "").match(/proyekto:\/\/\w+\/[^)]+/g) || [];
  return {
    wall_ms: wallMs,
    steps,
    run_status: response.run?.status ?? null,
    parse_mode: response.parse_mode ?? null,
    effort,
    calls,
    reply: response.assistant_message || "",
    reply_links: links.length,
    reply_list_lines: (response.assistant_message || "").split("\n").filter((l) => /^\s*[-*•]\s/.test(l)).length,
  };
}

function printTurn(key, turn) {
  const calls = turn.calls
    .map(
      (c) =>
        `${c.phase ?? "?"}#${c.turn ?? "?"} in=${c.input ?? "?"} cached=${c.cached ?? 0} write=${c.write ?? 0} reasoning=${c.reasoning ?? 0} ${c.finish ?? ""}`,
    )
    .join("\n      ");
  console.log(
    `-- ${key}: ${turn.wall_ms}ms steps=${turn.steps} run=${turn.run_status} effort=${JSON.stringify(turn.effort)}\n` +
      `   calls:\n      ${calls || "(none)"}\n` +
      `   reply (${turn.reply_links} links, ${turn.reply_list_lines} list lines): ${turn.reply.slice(0, 600).replace(/\n/g, "\n      ")}`,
  );
}

function printSummary(report) {
  for (const [arm, data] of Object.entries(report.arms)) {
    let input = 0, cached = 0, write = 0, reasoning = 0, calls = 0, wall = 0;
    for (const turn of data.turns) {
      wall += turn.wall_ms;
      for (const c of turn.calls) {
        calls += 1;
        input += c.input ?? 0;
        cached += c.cached ?? 0;
        write += c.write ?? 0;
        reasoning += c.reasoning ?? 0;
      }
    }
    const pct = input > 0 ? Math.round((cached * 100) / input) : 0;
    console.log(
      `${arm}: calls=${calls} wall=${wall}ms input=${input} cached=${cached} (${pct}%) write=${write} reasoning=${reasoning}`,
    );
  }
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
      throw new Error(`${options.method} ${pathname} → ${response.status}: ${text.slice(0, 300)}`);
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
  fail("No agent Python found. Set AGENT_PYTHON_BIN.");
}

async function startAgent(pythonBin, cacheMode) {
  const logFile = path.join(RESULTS_DIR, `agent-${cacheMode}.log`);
  const child = spawn(
    pythonBin,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(AGENT_PORT)],
    {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        OPENAI_MODEL_V2: MODEL,
        AGENT_SUMMARY_MODEL: MODEL,
        OPENAI_V2_PROMPT_CACHE_MODE: cacheMode,
        AGENT_REALTIME_TRACE_PUSH_ENABLED: "false",
        AGENT_PROGRESS_EVENTS_ALLOW_VERBOSE: "true",
        AGENT_LOG_LEVEL: "INFO",
        AGENT_LOG_JSON: "false",
        AGENT_LOG_TO_CONSOLE: "false",
        AGENT_LOG_FILE: logFile,
        AGENT_LOG_INCLUDE_CONTENT: "true",
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
        console.log(`[bench] agent up (cache=${cacheMode}, log=${logFile})`);
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
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  const email = (process.env.BENCH_SUPABASE_EMAIL || process.env.PLAYWRIGHT_EMAIL || "").trim();
  const password = (process.env.BENCH_SUPABASE_PASSWORD || process.env.PLAYWRIGHT_PASSWORD || "").trim();
  if (!supabaseUrl || !anonKey || !email || !password) {
    fail("No auth. Set BENCH_AUTH_TOKEN, or SUPABASE_URL + SUPABASE_ANON_KEY + BENCH_SUPABASE_EMAIL/PASSWORD.");
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    fail(`Supabase password grant failed (${response.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  console.log(`[bench] minted token for ${email} at ${supabaseUrl}`);
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(`[bench] ${message}`);
  process.exit(1);
}

function parseCliOptions(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--arms=")) {
      out.arms = arg.slice("--arms=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

function loadEnvFiles() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(REPO_ROOT, "scripts", ".env"),
    path.join(REPO_ROOT, ".env"),
    path.join(AGENT_DIR, ".env"),
    path.join(REPO_ROOT, "web", ".env.development.local"),
    path.join(REPO_ROOT, "web", ".env.local"),
    path.join(REPO_ROOT, "web", ".env"),
  ];
  for (const filePath of candidates) applyEnvFile(filePath);
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
