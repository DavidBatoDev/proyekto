import { expect, test } from "@playwright/test";

/**
 * Reference-resolution edge cases through the real composer:
 *
 *  - typos in the operation verb, the target name, and the parent epic name
 *    (fuzzy resolve should still land the edit)
 *  - a genuinely ambiguous reference (same feature title under two epics)
 *    must produce a clarifier — NOT a silent edit of an arbitrary node
 *  - answering the clarifier completes the original edit
 *  - pronoun follow-up ("add a task to it") binds to the last touched node
 *  - lowercase reference resolves case-insensitively
 *
 *   cd web && npm run pw:watch -- playwright/tests/roadmap-ai-edge-cases.spec.ts
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const TEST_PREFIX = /^(PW-|UI-Watch|Live-)/;
const INSTANT_MS = 2_500;

test("v2 agent: typo / ambiguity / pronoun edge cases", async ({ page }) => {
  test.setTimeout(720_000);

  await page.goto(APP_URL);
  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });
  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel).toBeVisible();
  await panel.locator('button[aria-haspopup="dialog"]').click();
  const picker = page.getByLabel("AI thread picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "New thread" }).last().click();
  await expect(panel.getByText("Ask questions or request roadmap edits")).toBeVisible({
    timeout: 15_000,
  });
  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");
  const sidebar = page.locator("#roadmap-left-panel");

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
  expect(token).toBeTruthy();
  const authHeaders = { Authorization: `Bearer ${token}` };

  async function epics() {
    for (let i = 0; i < 4; i++) {
      const r = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
        headers: authHeaders,
      });
      const j = await r.json().catch(() => null);
      const list = Array.isArray(j) ? j : (j as { data?: unknown } | null)?.data;
      if (Array.isArray(list)) return list as Array<{ id: string; title: string }>;
      await page.waitForTimeout(500);
    }
    return [] as Array<{ id: string; title: string }>;
  }

  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }

  type CommitSummary = { committed?: boolean; error_message?: string | null };
  type Body = {
    response_mode?: string;
    commit_summary?: CommitSummary | null;
    clarifier?: { question?: string; options?: string[] } | null;
  };
  const results: Array<{ label: string; ok: boolean; note: string }> = [];

  async function raw(message: string): Promise<Body> {
    await composer.click();
    await composer.pressSequentially(message, { delay: 14 });
    const respPromise = page
      .waitForResponse(
        (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 180_000 },
      )
      .catch(() => null);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 15_000 });
    const resp = await respPromise;
    const body = resp ? await resp.json().catch(() => ({})) : {};
    await page.waitForTimeout(400);
    return body as Body;
  }

  async function edit(label: string, message: string, ui?: () => Promise<void>) {
    const body = await raw(message);
    const committed = body?.commit_summary?.committed === true;
    let ok = committed;
    let note = `mode=${body?.response_mode} committed=${committed}`;
    if (committed && ui) {
      const t0 = Date.now();
      try {
        await ui();
        note += ` ui=${Date.now() - t0}ms`;
      } catch {
        ok = false;
        note += ` ui=TIMEOUT(${INSTANT_MS}ms)`;
      }
    }
    if (!committed) note += ` err=${body?.commit_summary?.error_message ?? "n/a"}`;
    results.push({ label, ok, note });
    console.log(`[edge] ${label}: ${note} -> ${ok ? "PASS" : "FAIL"}`);
    return body;
  }

  // An ambiguous reference must NOT silently commit, and the question must be
  // a STRUCTURED clarifier (clickable options) — a plain-text question strands
  // the user.
  async function ambiguous(label: string, message: string) {
    const body = await raw(message);
    const committed = body?.commit_summary?.committed === true;
    const ok = !committed && Boolean(body?.clarifier);
    const note = `mode=${body?.response_mode} committed=${committed} clarifier=${Boolean(body?.clarifier)}`;
    results.push({ label, ok, note });
    console.log(`[edge] ${label}: ${note} -> ${ok ? "PASS" : "FAIL"}`);
    return body;
  }

  // Pick a clarifier option (preferring one matching `prefer`) and submit;
  // returns the follow-up response body.
  async function answerClarifier(prefer: string): Promise<Body> {
    const card = panel
      .locator("div")
      .filter({ has: page.getByRole("button", { name: "Submit answer" }) })
      .last();
    const preferred = card.locator("label").filter({ hasText: prefer }).first();
    if ((await preferred.count()) > 0) {
      await preferred.click();
    } else {
      await card.locator('input[type="radio"]').first().check();
    }
    const respPromise = page
      .waitForResponse(
        (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 180_000 },
      )
      .catch(() => null);
    await page.getByRole("button", { name: "Submit answer" }).last().click();
    const resp = await respPromise;
    const body = (resp ? await resp.json().catch(() => ({})) : {}) as Body;
    await page.waitForTimeout(400);
    return body;
  }

  const seenDeep = async (text: string) => {
    const search = sidebar.getByPlaceholder("Search epics, features, tasks...");
    await search.fill(text);
    await expect(sidebar.getByText(text, { exact: false }).first()).toBeVisible({
      timeout: INSTANT_MS,
    });
    await search.fill("");
  };
  const seen = (text: string) =>
    expect(sidebar.getByText(text, { exact: false }).first()).toBeVisible({
      timeout: INSTANT_MS,
    });

  const stamp = Date.now().toString().slice(-6);
  const EA = `Live-Alpha${stamp}`;
  const EB = `Live-Beta${stamp}`;

  // --- setup + typo battery ---
  await edit("setup_epicA", `Add an epic called "${EA}".`, () => seen(EA));
  await edit(
    "typo_in_verb",
    `Add a fature called "Edge-Typo" under the epic "${EA}".`,
    () => seenDeep("Edge-Typo"),
  );
  await edit(
    "typo_in_target",
    `Rename the feature "Edge-Typoo" to "Edge-Fixed".`,
    () => seenDeep("Edge-Fixed"),
  );
  await edit(
    "typo_in_epic",
    `Add a feature called "Edge-F2" under the epic "Live-Alpa${stamp}".`,
    () => seenDeep("Edge-F2"),
  );

  // --- ambiguity battery: same feature title under two epics ---
  await edit("setup_epicB", `Add an epic called "${EB}".`, () => seen(EB));
  await edit("dup_feature", `Add a feature called "Edge-F2" under the epic "${EB}".`);
  const ambiguousBody = await ambiguous(
    "ambiguous_ref",
    `Rename the feature "Edge-F2" to "Edge-Renamed".`,
  );

  // --- answer the clarifier and expect the original rename to land ---
  if (ambiguousBody?.clarifier) {
    const body = await answerClarifier(EA);
    const committed = body?.commit_summary?.committed === true;
    results.push({
      label: "clarifier_answer",
      ok: committed,
      note: `mode=${body?.response_mode} committed=${committed}`,
    });
    console.log(
      `[edge] clarifier_answer: committed=${committed} -> ${committed ? "PASS" : "FAIL"}`,
    );
    if (committed) await seenDeep("Edge-Renamed").catch(() => {});
  } else {
    console.log("[edge] clarifier_answer: SKIPPED (no clarifier card rendered)");
  }

  // --- pronoun follow-up: committing directly to the most recent feature OR
  // asking a clarifier are both acceptable; a clarifier must then complete the
  // edit once answered.
  {
    const label = "pronoun_ref";
    let body = await raw(`Add a task called "Edge-Task" to it.`);
    let committed = body?.commit_summary?.committed === true;
    let note = `mode=${body?.response_mode} committed=${committed}`;
    if (!committed && body?.clarifier) {
      body = await answerClarifier("Edge");
      committed = body?.commit_summary?.committed === true;
      note += ` then-clarifier committed=${committed}`;
    }
    let ok = committed;
    if (committed) {
      try {
        await seenDeep("Edge-Task");
        note += " ui=ok";
      } catch {
        ok = false;
        note += " ui=TIMEOUT";
      }
    }
    results.push({ label, ok, note });
    console.log(`[edge] ${label}: ${note} -> ${ok ? "PASS" : "FAIL"}`);
  }

  // --- case-insensitive resolve (independent target: Edge-Fixed exists from
  // the typo_in_target step) ---
  await edit(
    "lowercase_ref",
    `Rename the feature "edge-fixed" to "Edge-Lower".`,
    () => seenDeep("Edge-Lower"),
  );

  // --- report + cleanup ---
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[edge] SUMMARY: ${results.length - failed.length}/${results.length} passed.` +
      (failed.length
        ? ` FAILED: ${failed.map((f) => `${f.label}(${f.note})`).join(", ")}`
        : " all good"),
  );
  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }

  expect(failed, `failed steps: ${failed.map((f) => f.label).join(", ")}`).toHaveLength(0);
});
