/**
 * Interactive AI-panel driver. Holds a real browser session open and executes
 * one command at a time from C:/tmp/ai-drive/cmd.json, writing each result to
 * C:/tmp/ai-drive/res-<seq>.json. This lets the operator OBSERVE every agent
 * response (mode / clarifier / commit) and choose the next prompt based on the
 * actual session state instead of firing a blind scripted battery.
 *
 * Commands:
 *   {seq, action: "send",      text}            -> send a chat message
 *   {seq, action: "clarifier", prefer}          -> answer the visible clarifier card
 *   {seq, action: "probe",     text}            -> sidebar-search for text (visible?)
 *   {seq, action: "epics"}                      -> backend epic list
 *   {seq, action: "shot",      name}            -> full-page screenshot
 *   {seq, action: "newthread"}                  -> start a fresh AI thread
 *   {seq, action: "exit"}                       -> close browser and quit
 *
 * Run from web/:  node playwright/drive.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const APP_URL = `http://localhost:3000/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const DIR = "C:/tmp/ai-drive";
const CMD = path.join(DIR, "cmd.json");

fs.mkdirSync(DIR, { recursive: true });
for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState: "playwright/.auth/user.json",
  viewport: { width: 1600, height: 900 },
});
const page = await context.newPage();

function trim(value, n = 300) {
  if (typeof value !== "string") return value;
  return value.length > n ? `${value.slice(0, n)}…` : value;
}

function summarize(body) {
  if (!body || typeof body !== "object") return { empty: true };
  return {
    assistant: trim(body.assistant_message),
    intent: body.intent_type,
    mode: body.response_mode,
    committed: body.commit_summary?.committed === true,
    commit_error: body.commit_summary?.error_message ?? null,
    impacted: (body.commit_summary?.impacted_items ?? []).map(
      (i) => `${i.impact}:${i.node_type}:${i.title}`,
    ),
    clarifier: body.clarifier
      ? { q: trim(body.clarifier.question, 160), options: body.clarifier.options }
      : null,
    plan: body.plan_proposal ? "plan_proposal_present" : null,
    staged: body.staged_operations_count,
  };
}

async function captureSend(fire) {
  const respPromise = page
    .waitForResponse(
      (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
      { timeout: 150_000 },
    )
    .catch(() => null);
  await fire();
  const resp = await respPromise;
  const body = resp ? await resp.json().catch(() => ({})) : {};
  await page.waitForTimeout(250);
  const clarifierCardVisible = await page
    .getByRole("button", { name: "Submit answer" })
    .last()
    .isVisible()
    .catch(() => false);
  return { ...summarize(body), clarifier_card_visible: clarifierCardVisible };
}

const panel = () => page.getByLabel("AI Assistant Panel");
const composer = () => panel().getByPlaceholder("Chat or request roadmap edits...");
const sidebar = () => page.locator("#roadmap-left-panel");

async function init() {
  await page.goto(APP_URL);
  await page.getByTitle("Toggle AI chat panel").waitFor({ timeout: 30_000 });
  await page.locator(".react-flow").waitFor({ timeout: 30_000 });
  // Dev-only devtools toggles overlap the panel's send button in screenshots.
  // The TanStack toggle uses generated goober classes, so locate it by
  // position (bottom-right corner) instead of selector.
  await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth - 20, window.innerHeight - 20);
    const btn = el && el.closest("button");
    if (btn) btn.style.display = "none";
  });
  await page.getByTitle("Toggle AI chat panel").click();
  await panel().waitFor({ timeout: 10_000 });
  await newThread();
}

async function newThread() {
  await panel().locator('button[aria-haspopup="dialog"]').click();
  const picker = page.getByLabel("AI thread picker");
  await picker.waitFor({ timeout: 10_000 });
  await picker.getByRole("button", { name: "New thread" }).last().click();
  await panel()
    .getByText("Ask questions or request roadmap edits")
    .waitFor({ timeout: 15_000 });
}

async function authToken() {
  return page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          return JSON.parse(localStorage.getItem(k))?.access_token ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

const handlers = {
  async send({ text }) {
    return captureSend(async () => {
      await composer().click();
      await composer().fill(text);
      await composer().press("Enter");
    });
  },
  async clarifier({ prefer }) {
    // The clarifier is the only radio group in the panel (and renders only on
    // the newest message), so target labels/radios directly.
    const labels = panel().locator("label").filter({ hasText: prefer ?? "" });
    if (prefer && (await labels.count()) > 0) await labels.first().click();
    else await panel().locator('input[type="radio"]').first().check();
    return captureSend(async () => {
      await page.getByRole("button", { name: "Submit answer" }).last().click();
    });
  },
  async probe({ text }) {
    const search = sidebar().getByPlaceholder("Search epics, features, tasks...");
    await search.fill(text);
    const visible = await sidebar()
      .getByText(text, { exact: false })
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    await search.fill("");
    return { probe: text, visible };
  },
  async epics() {
    const token = await authToken();
    const r = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => null);
    const list = Array.isArray(j) ? j : j?.data;
    return {
      epics: Array.isArray(list) ? list.map((e) => e.title) : `unexpected:${r.status()}`,
    };
  },
  // Arbitrary backend call — lets the operator simulate a COLLABORATOR
  // editing the roadmap outside the AI session (concurrency scenarios).
  async api({ method, path, body }) {
    const token = await authToken();
    const r = await page.request.fetch(`${BACKEND_BASE}${path}`, {
      method: method || "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: body,
    });
    const j = await r.json().catch(() => null);
    return { status: r.status(), body: JSON.stringify(j)?.slice(0, 500) };
  },
  async shot({ name }) {
    const file = path.join(DIR, `${name || "shot"}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return { saved: file };
  },
  // Arbitrary page-side JS — e.g. computed-style checks the screenshots can't
  // resolve at thumbnail resolution.
  async eval({ code }) {
    const value = await page.evaluate(code);
    return { value };
  },
  async newthread() {
    await newThread();
    return { thread: "fresh" };
  },
};

await init();
fs.writeFileSync(path.join(DIR, "ready.json"), JSON.stringify({ ready: true, pid: process.pid }));
console.log("[drive] ready — watching", CMD);

let lastSeq = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 250));
  let cmd;
  try {
    cmd = JSON.parse(fs.readFileSync(CMD, "utf-8"));
  } catch {
    continue;
  }
  if (!cmd || typeof cmd.seq !== "number" || cmd.seq <= lastSeq) continue;
  lastSeq = cmd.seq;
  const out = path.join(DIR, `res-${cmd.seq}.json`);
  if (cmd.action === "exit") {
    fs.writeFileSync(out, JSON.stringify({ ok: true, bye: true }));
    break;
  }
  try {
    const handler = handlers[cmd.action];
    const data = handler ? await handler(cmd) : { error: `unknown action ${cmd.action}` };
    fs.writeFileSync(out, JSON.stringify({ ok: true, ...data }, null, 1));
  } catch (error) {
    fs.writeFileSync(
      out,
      JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 400) }),
    );
  }
}

await browser.close();
console.log("[drive] closed");
