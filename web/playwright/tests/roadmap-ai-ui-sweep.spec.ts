import fs from "node:fs";
import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * UI-driven assessment sweep — every operation goes through real human steps:
 * open the AI side panel, start a new thread, TYPE the request into the
 * composer, send, and watch the answer / commit render. Captures per-turn
 * wall-clock latency (what the user actually feels) + the agent telemetry
 * (response_mode / staged / provider / fallback / tools / tokens) read off the
 * page's own network + trace endpoint.
 *
 * Meant to be WATCHED. Run headed + slowed:
 *   cd web && npm run pw:watch -- playwright/tests/roadmap-ai-ui-sweep.spec.ts
 *
 * Self-cleaning: deletes the PW-UI-* epics it creates via the backend.
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const AGENT_BASE = process.env.VITE_AGENT_API_URL || "http://localhost:8010";
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const OUT_DIR = "C:/tmp";

type Rec = {
  step: number;
  label: string;
  message: string;
  ms: number;
  response_mode?: string;
  parse_mode?: string;
  staged?: number;
  provider?: string;
  fallback?: boolean;
  tools: string[];
  tokens_total?: number | null;
};

test("v2 agent: UI-driven sweep (human steps, watch speed + UX)", async ({ page }) => {
  test.setTimeout(420_000);

  // --- Open the roadmap + AI side panel (human step).
  await page.goto(APP_URL);
  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle, "roadmap top bar should render").toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });
  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel, "AI panel should open").toBeVisible();

  // --- Start a fresh thread (human step).
  await panel.locator('button[aria-haspopup="dialog"]').click();
  const picker = page.getByLabel("AI thread picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "New thread" }).last().click();
  await expect(panel.getByText("Ask questions or request roadmap edits")).toBeVisible({
    timeout: 15_000,
  });

  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");

  // Token + agent context for reading the per-turn trace timeline (tools/tokens).
  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          return JSON.parse(localStorage.getItem(k) as string)?.access_token ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const agentApi = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : {},
  });

  const results: Rec[] = [];
  let step = 0;

  // One turn, the way a user does it: click composer, TYPE the request, send,
  // watch the user bubble + the agent's answer render. Times the round-trip.
  async function chat(label: string, message: string): Promise<Rec> {
    step += 1;
    await composer.click();
    // Visible typing (not an instant fill) so the feel is watchable. Timed
    // separately from agent latency below.
    await composer.pressSequentially(message, { delay: 18 });
    const respPromise = page
      .waitForResponse(
        (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 180_000 },
      )
      .catch(() => null);
    // Start the clock at SEND so ms is the agent round-trip the user waits on.
    const t0 = Date.now();
    await composer.press("Enter");

    // User's message lands in the thread.
    await expect(
      panel.getByText(message, { exact: false }).first(),
      "typed message should appear in the thread",
    ).toBeVisible({ timeout: 15_000 });

    const resp = await respPromise;
    const ms = Date.now() - t0;
    const body = resp ? await resp.json().catch(() => ({})) : {};

    // Pull the trace timeline for this turn (tools + tokens) from the agent.
    const tools: string[] = [];
    let tokens_total: number | null = null;
    if (body?.debug_trace_id) {
      const tr = await agentApi
        .get(`/agent/sessions/${body.session_id}/traces/${body.debug_trace_id}/events?detail=verbose&limit=200`)
        .catch(() => null);
      if (tr && tr.ok()) {
        const tj = await tr.json();
        for (const e of tj.events ?? []) {
          const d = e.details ?? {};
          if (e.event === "tool_call_requested" && d.tool_name) tools.push(d.tool_name);
          if (e.event === "provider_success" && typeof d.tokens_total === "number")
            tokens_total = (tokens_total ?? 0) + d.tokens_total;
        }
      }
    }

    const rec: Rec = {
      step,
      label,
      message,
      ms,
      response_mode: body?.response_mode,
      parse_mode: body?.parse_mode,
      staged: body?.staged_operations_count,
      provider: body?.provider_used,
      fallback: body?.fallback_used,
      tools,
      tokens_total,
    };
    results.push(rec);
    console.log(
      `[#${step} ${label}] ${ms}ms mode=${rec.response_mode} staged=${rec.staged} ` +
        `provider=${rec.provider} fallback=${rec.fallback} tools=[${tools.join(",")}] tokens=${tokens_total}`,
    );

    // Let the assistant bubble / commit card render before the next turn so
    // the result is visible while watching.
    if (rec.response_mode === "edit_plan") {
      await panel
        .getByText(/Committed changes/i)
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(1200);
    return rec;
  }

  // --- The battery, ordered so dependent ops have committed state. Rename
  // happens before the plan proposal (keeps the thread clean).
  await chat("chat", "Hi! What can you help me with on this roadmap?");
  await chat("query", "How many epics are in this roadmap, and what are their titles?");
  await chat("create", `Add an epic called "PW-UI-A".`);
  await chat(
    "deep_create",
    `Add an epic "PW-UI-B" with a feature "Reporting" that has tasks "Draft", "Review", and "Publish".`,
  );
  await chat("resolve_update", `Rename the epic "PW-UI-A" to "PW-UI-A2".`);
  await chat("clarifier", "Move the task to next sprint.");
  await chat("plan", "Propose a plan to add a referral program to this product.");
  await chat(
    "cleanup_delete",
    `Delete every epic whose title starts with "PW-UI", including everything under them.`,
  );

  // --- Report.
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const stats = {
    count: results.length,
    avg_ms: Math.round(lat.reduce((a, b) => a + b, 0) / results.length),
    median_ms: lat[Math.floor(lat.length / 2)],
    min_ms: lat[0],
    max_ms: lat[lat.length - 1],
    fallbacks: results.filter((r) => r.fallback).length,
    by_mode: results.reduce<Record<string, number>>((acc, r) => {
      const k = r.response_mode || "?";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/v2-ui-sweep.json`, JSON.stringify({ stats, results }, null, 2));
  const md = [
    `# v2 roadmap AI — UI-driven sweep (human steps)`,
    "",
    `- latency ms — avg **${stats.avg_ms}**, median **${stats.median_ms}**, min ${stats.min_ms}, max ${stats.max_ms}`,
    `- fallbacks: **${stats.fallbacks}** • modes: ${JSON.stringify(stats.by_mode)}`,
    "",
    `| # | step | ms | mode | staged | tools | tokens | fallback |`,
    `|---|---|---:|---|---:|---|---:|---|`,
    ...results.map(
      (r) =>
        `| ${r.step} | ${r.label} | ${r.ms} | ${r.response_mode ?? "?"} | ${r.staged ?? "-"} | ${r.tools.join(" ") || "-"} | ${r.tokens_total ?? "-"} | ${r.fallback ? "⚠️" : ""} |`,
    ),
  ].join("\n");
  fs.writeFileSync(`${OUT_DIR}/v2-ui-sweep.md`, md);
  console.log(`\n[ui-sweep] stats ${JSON.stringify(stats)}`);
  console.log(`[ui-sweep] wrote ${OUT_DIR}/v2-ui-sweep.{md,json}`);

  // --- Cleanup: delete PW-UI-* epics by id via the backend (reliable).
  if (token) {
    const list = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const epics: Array<{ id: string; title: string }> = await list.json();
    for (const e of (Array.isArray(epics) ? epics : []).filter((x) =>
      (x.title || "").startsWith("PW-UI"),
    )) {
      const del = await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`[ui-sweep] cleanup delete ${e.title} -> ${del.status()}`);
    }
  }

  await agentApi.dispose();
  expect(stats.fallbacks, "no rule-based fallbacks").toBe(0);
  expect(results.length).toBe(8);
});
