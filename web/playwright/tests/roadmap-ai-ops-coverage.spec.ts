import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * Operation-coverage drive: exercises the full mutation set through the real
 * composer (epic/feature/task add, feature rename, move task, mark status,
 * delete) and records which COMMITTED. With synchronous commit, an edit that
 * committed comes back staged=0; staged>0 means the backend rejected it. After
 * a failed commit the staged ops are discarded so one bad op can't cascade and
 * mask the rest — so a single run surfaces every broken op type.
 *
 *   cd web && npm run pw:watch -- playwright/tests/roadmap-ai-ops-coverage.spec.ts
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const AGENT_BASE = process.env.VITE_AGENT_API_URL || "http://localhost:8010";
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const TEST_PREFIX = /^(PW-|UI-Watch|Live-)/;

test("v2 agent: operation-coverage drive", async ({ page }) => {
  test.setTimeout(540_000);

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
  const agentApi = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: { ...authHeaders, "Content-Type": "application/json" },
  });

  async function epics() {
    // Retry: the backend read intermittently returns a non-array/empty.
    for (let i = 0; i < 4; i++) {
      const r = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
        headers: authHeaders,
      });
      const j = await r.json().catch(() => null);
      if (Array.isArray(j)) return j as Array<{ id: string; title: string }>;
      await page.waitForTimeout(500);
    }
    return [] as Array<{ id: string; title: string }>;
  }

  // clean leftovers
  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }
  console.log(`[ops] clean start: ${(await epics()).map((e) => e.title).join(" | ")}`);

  const results: Array<{ label: string; mode?: string; staged?: number; committed: boolean }> = [];

  async function raw(message: string) {
    await composer.click();
    await composer.pressSequentially(message, { delay: 14 });
    const respPromise = page
      .waitForResponse(
        (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 180_000 },
      )
      .catch(() => null);
    await composer.press("Enter");
    // The composer clears on send — a robust signal the message went out
    // (more reliable than matching a long bubble among many messages).
    await expect(composer).toHaveValue("", { timeout: 15_000 });
    const resp = await respPromise;
    const body = resp ? await resp.json().catch(() => ({})) : {};
    await page.waitForTimeout(700);
    return body;
  }

  // An edit: committed iff edit_plan AND staged cleared to 0. On failure,
  // discard staged ops so the next op is tested independently.
  async function edit(label: string, message: string) {
    const body = await raw(message);
    const staged = body?.staged_operations_count ?? 0;
    const committed = body?.response_mode === "edit_plan" && staged === 0;
    results.push({ label, mode: body?.response_mode, staged, committed });
    console.log(
      `[ops] ${label}: mode=${body?.response_mode} staged=${staged} fallback=${body?.fallback_used} -> ${committed ? "COMMITTED" : "FAILED"}`,
    );
    if (!committed && body?.session_id) {
      await agentApi.post(`/agent/sessions/${body.session_id}/discard`, { data: {} }).catch(() => {});
    }
    return body;
  }

  // Unique per-run epic name so a stale cleanup can't cause a collision
  // (features/tasks are scoped under it, so they never collide).
  const E = `Live-${Date.now().toString().slice(-6)}`;

  // --- coverage battery ---
  await raw("Hi! What can you help me with on this roadmap?");
  await edit("add_epic", `Add an epic called "${E}".`);
  await edit("add_feature", `Add a feature called "Planning" under the epic "${E}".`);
  await edit("add_tasks", `Add two tasks "Spec" and "Build" to the feature "Planning".`);
  await edit("rename_feature", `Rename the feature "Planning" to "Roadmapping".`);
  await edit("update_desc", `Set the description of the epic "${E}" to "Q3 initiative".`);
  await edit("add_feature2", `Add a feature "Delivery" under the epic "${E}".`);
  await edit("move_task", `Move the task "Build" to the feature "Delivery".`);
  await edit("mark_status", `Mark the task "Spec" as done.`);
  await edit("delete_epic", `Delete the epic "${E}" and everything under it.`);

  // --- report ---
  const failed = results.filter((r) => !r.committed);
  console.log(
    `\n[ops] SUMMARY: ${results.length - failed.length}/${results.length} committed.` +
      (failed.length ? ` FAILED: ${failed.map((f) => `${f.label}(staged=${f.staged})`).join(", ")}` : " all good"),
  );
  console.log(`[ops] epics left: ${(await epics()).map((e) => e.title).join(" | ")}`);

  // best-effort cleanup
  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }
  await agentApi.dispose();
});
