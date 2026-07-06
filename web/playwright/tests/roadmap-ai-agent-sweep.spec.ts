import fs from "node:fs";
import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * v2 roadmap AI agent — assessment sweep.
 *
 * Not a pass/fail feature test: a benchmark harness that drives a battery of
 * varied requests through the SAME pipeline the web uses (browser's refreshed
 * Supabase token -> agent at :8010, metadata.brain_version='v2') and records,
 * per request: wall-clock latency, the agent's MessageResponse telemetry
 * (response_mode / parse_mode / staged ops / provider / fallback), and the
 * trace timeline (turns, tools, tokens, route_lane, termination_reason).
 *
 * Output: console (one JSON line per request) + C:/tmp/v2-agent-assessment.md
 * and .json for the writeup. Edits auto-commit (async) on the real roadmap;
 * the final request deletes everything this sweep created (PW-*) to leave it
 * clean.
 */

const ROADMAP_ID = "a70b8373-55cd-415b-83da-fd69a44f5709";
const PROJECT_ID = "e968d25a-aee4-41e6-8129-a994d11c2554";
const AGENT_BASE = process.env.VITE_AGENT_API_URL || "http://localhost:8010";
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const OUT_DIR = "C:/tmp";

type Rec = {
  step: number;
  label: string;
  message: string;
  ms: number; // client wall-clock for the /messages round-trip
  http: number;
  response_mode?: string;
  parse_mode?: string;
  intent_type?: string;
  staged?: number;
  provider?: string;
  fallback?: boolean;
  error_code?: string | null;
  assistant: string;
  trace_elapsed_ms?: number | null;
  turns?: number | null;
  tool_calls_used?: number | null;
  route_lane?: string | null;
  termination?: string | null;
  tokens_total?: number | null;
  tools: string[];
  timeline: Array<{ event: string; status: string; summary: string }>;
};

test("v2 agent: assessment sweep (latency + smartness)", async ({ page }) => {
  test.setTimeout(360_000);

  // --- 1. Load the app so Supabase refreshes the session, then grab the token
  // the web would send to the agent (Authorization: Bearer ...).
  await page.goto(APP_URL);
  await expect(
    page.getByTitle("Toggle AI chat panel"),
    "roadmap shell should render (auth OK)",
  ).toBeVisible({ timeout: 30_000 });

  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          const v = JSON.parse(localStorage.getItem(k) as string);
          return v?.access_token ?? v?.currentSession?.access_token ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  expect(token, "supabase access token from localStorage").toBeTruthy();

  // --- 2. Talk to the agent directly, exactly as the web does.
  const api = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const sres = await api.post("/agent/sessions", {
    data: { roadmap_id: ROADMAP_ID, metadata: { brain_version: "v2" } },
  });
  expect(sres.ok(), `create session -> ${sres.status()}`).toBeTruthy();
  const sessionId = (await sres.json()).session_id as string;
  console.log(`\n[sweep] session=${sessionId} agent=${AGENT_BASE}\n`);

  const results: Rec[] = [];
  let step = 0;

  async function send(label: string, message: string): Promise<Rec> {
    step += 1;
    const t0 = Date.now();
    const r = await api.post(`/agent/sessions/${sessionId}/messages`, {
      data: { message },
      timeout: 180_000,
    });
    const ms = Date.now() - t0;
    const body = r.ok() ? await r.json() : await r.json().catch(() => ({}));

    // Pull the trace timeline — the agent's own per-step output for this turn.
    const timeline: Rec["timeline"] = [];
    const tools: string[] = [];
    let trace_elapsed_ms: number | null = null;
    let turns: number | null = null;
    let tool_calls_used: number | null = null;
    let route_lane: string | null = null;
    let termination: string | null = null;
    let tokens_total: number | null = null;

    const traceId = body?.debug_trace_id;
    if (traceId) {
      const tr = await api.get(
        `/agent/sessions/${sessionId}/traces/${traceId}/events?detail=verbose&limit=200`,
      );
      if (tr.ok()) {
        const tj = await tr.json();
        trace_elapsed_ms = tj.elapsed_ms ?? null;
        for (const e of tj.events ?? []) {
          timeline.push({
            event: e.event,
            status: e.status,
            summary: (e.summary || "").slice(0, 120),
          });
          const d = e.details ?? {};
          if (e.event === "tool_call_requested" && d.tool_name)
            tools.push(d.tool_name);
          if (e.event === "provider_success" && typeof d.tokens_total === "number")
            tokens_total = (tokens_total ?? 0) + d.tokens_total;
          if (e.event === "route_selected") {
            route_lane = d.route_lane ?? route_lane;
            turns = d.react_loop_turns ?? turns;
            tool_calls_used = d.tool_calls_used ?? tool_calls_used;
            termination = d.react_loop_termination_reason ?? termination;
          }
        }
      }
    }

    const rec: Rec = {
      step,
      label,
      message,
      ms,
      http: r.status(),
      response_mode: body?.response_mode,
      parse_mode: body?.parse_mode,
      intent_type: body?.intent_type,
      staged: body?.staged_operations_count,
      provider: body?.provider_used,
      fallback: body?.fallback_used,
      error_code: body?.provider_error_code ?? null,
      assistant: (body?.assistant_message || "").replace(/\s+/g, " ").slice(0, 200),
      trace_elapsed_ms,
      turns,
      tool_calls_used,
      route_lane,
      termination,
      tokens_total,
      tools,
      timeline,
    };
    results.push(rec);
    console.log(
      `[#${step} ${label}] ${ms}ms http=${rec.http} mode=${rec.response_mode} ` +
      `staged=${rec.staged} provider=${rec.provider} fallback=${rec.fallback} ` +
      `lane=${rec.route_lane} turns=${rec.turns} tools=[${tools.join(",")}] ` +
      `tokens=${rec.tokens_total}`,
    );
    return rec;
  }

  // --- 3. The battery (chat / query / create / deep-nest / clarifier / plan /
  // resolve+update / cleanup-delete). Varied on purpose to probe routing.
  await send("chat_capability", "Hey, what can you help me with on this roadmap?");
  await send(
    "query_read",
    "How many epics are in this roadmap right now, and what are their titles?",
  );
  await send("create_single", `Add an epic called "PW-Telemetry-A".`);
  await send(
    "create_deep_nested",
    `Add an epic called "PW-Telemetry-C" with a feature "Reporting" that has three tasks: "Draft", "Review", and "Publish".`,
  );
  await send(
    "ambiguous_clarifier",
    "Move the task to next sprint.",
  );
  await send(
    "plan_proposal",
    "Propose a plan to add a referral program to this product.",
  );
  // By now PW-Telemetry-A (step 3) has had ~3 turns to commit (async).
  await send(
    "resolve_update",
    `Rename the epic "PW-Telemetry-A" to "PW-Telemetry-A2".`,
  );
  // Let the rename commit land before we resolve it for deletion.
  await page.waitForTimeout(7_000);
  await send(
    "cleanup_delete",
    `Delete these epics and everything under them: "PW-Telemetry-A2" and "PW-Telemetry-C". Also delete any epic whose title starts with "PW-Smoke".`,
  );

  // --- 4. Reports.
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const sum = lat.reduce((a, b) => a + b, 0);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
  const stats = {
    count: results.length,
    avg_ms: Math.round(sum / results.length),
    median_ms: lat[Math.floor(lat.length / 2)],
    min_ms: lat[0],
    max_ms: lat[lat.length - 1],
    p95_ms: pct(95),
    fallbacks: results.filter((r) => r.fallback).length,
    http_errors: results.filter((r) => r.http >= 400).length,
    by_mode: results.reduce<Record<string, number>>((acc, r) => {
      const k = r.response_mode || "?";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    `${OUT_DIR}/v2-agent-assessment.json`,
    JSON.stringify({ session: sessionId, model: "gpt-5.4-mini", stats, results }, null, 2),
  );

  const md: string[] = [];
  md.push(`# v2 roadmap AI agent — assessment sweep`);
  md.push("");
  md.push(`- session: \`${sessionId}\`  •  model: \`gpt-5.4-mini\` (Responses API)`);
  md.push(
    `- latency ms — avg **${stats.avg_ms}**, median **${stats.median_ms}**, p95 **${stats.p95_ms}**, min ${stats.min_ms}, max ${stats.max_ms}`,
  );
  md.push(
    `- fallbacks: **${stats.fallbacks}** • http errors: **${stats.http_errors}** • modes: ${JSON.stringify(stats.by_mode)}`,
  );
  md.push("");
  md.push(
    `| # | label | ms | mode | staged | lane | turns | tools | tokens | fallback |`,
  );
  md.push(`|---|---|---:|---|---:|---|---:|---|---:|---|`);
  for (const r of results) {
    md.push(
      `| ${r.step} | ${r.label} | ${r.ms} | ${r.response_mode ?? "?"} | ${r.staged ?? "-"} | ${r.route_lane ?? "-"} | ${r.turns ?? "-"} | ${r.tools.join(" ") || "-"} | ${r.tokens_total ?? "-"} | ${r.fallback ? "⚠️" : ""} |`,
    );
  }
  md.push("");
  for (const r of results) {
    md.push(`### #${r.step} ${r.label} — ${r.ms}ms`);
    md.push(`> ${r.message}`);
    md.push("");
    md.push(`- mode=\`${r.response_mode}\` parse=\`${r.parse_mode}\` intent=\`${r.intent_type}\` staged=${r.staged} provider=\`${r.provider}\` fallback=${r.fallback} err=${r.error_code}`);
    md.push(`- assistant: ${r.assistant || "(none)"}`);
    if (r.timeline.length) {
      md.push(`- timeline: ${r.timeline.map((t) => `${t.event}(${t.status})`).join(" → ")}`);
    }
    md.push("");
  }
  fs.writeFileSync(`${OUT_DIR}/v2-agent-assessment.md`, md.join("\n"));

  console.log(`\n[sweep] wrote ${OUT_DIR}/v2-agent-assessment.{md,json}`);
  console.log(`[sweep] stats ${JSON.stringify(stats)}\n`);

  // Sanity floor: the sweep actually ran and the agent answered.
  expect(stats.http_errors, "no HTTP errors from the agent").toBe(0);
  expect(results.length).toBe(8);
  await api.dispose();
});
