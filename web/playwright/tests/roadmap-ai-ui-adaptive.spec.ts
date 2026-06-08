import { expect, test } from "@playwright/test";

/**
 * Adaptive live drive of the roadmap AI panel. Instead of a fixed battery, it
 * READS the live roadmap before each turn and picks the command from actual
 * state: clean leftover test epics first, then create a name that does NOT
 * exist, rename the one it just created, delete what it created — verifying
 * every commit against the backend (the source of truth). Drives the real
 * composer; meant to be watched:
 *   cd web && npm run pw:watch -- playwright/tests/roadmap-ai-ui-adaptive.spec.ts
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const TEST_PREFIX = /^(PW-|UI-Watch|Live-)/;

test("v2 agent: adaptive live drive (assess state, then act)", async ({ page }) => {
  test.setTimeout(420_000);

  await page.goto(APP_URL);
  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });
  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel).toBeVisible();

  // Fresh thread.
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
  expect(token, "supabase token").toBeTruthy();
  const authHeaders = { Authorization: `Bearer ${token}` };

  // --- Live state helpers (backend = source of truth) ---
  async function listEpics(): Promise<Array<{ id: string; title: string }>> {
    const r = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
      headers: authHeaders,
    });
    const j = await r.json();
    return Array.isArray(j) ? j : (j?.data ?? j?.epics ?? []);
  }
  const titles = (eps: Array<{ title: string }>) => eps.map((e) => e.title);
  async function waitFor(pred: (titles: string[]) => boolean, label: string) {
    for (let i = 0; i < 20; i++) {
      if (pred(titles(await listEpics()))) return true;
      await page.waitForTimeout(1000);
    }
    console.log(`[adaptive] WARN: condition not met: ${label}`);
    return false;
  }

  // --- Step 0: assess + clean leftover test epics ---
  let epics = await listEpics();
  console.log(`[adaptive] live epics now: ${titles(epics).join(" | ")}`);
  for (const e of epics.filter((x) => TEST_PREFIX.test(x.title))) {
    const del = await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, {
      headers: authHeaders,
    });
    console.log(`[adaptive] cleaned leftover "${e.title}" -> ${del.status()}`);
  }
  epics = await listEpics();
  console.log(`[adaptive] after clean: ${titles(epics).join(" | ")}`);

  // --- Send through the composer; report mode + commit + staged ---
  async function send(message: string) {
    await composer.click();
    await composer.pressSequentially(message, { delay: 16 });
    const respPromise = page
      .waitForResponse(
        (r) => /\/agent\/sessions\/.+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 180_000 },
      )
      .catch(() => null);
    const t0 = Date.now();
    await composer.press("Enter");
    await expect(panel.getByText(message, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    const resp = await respPromise;
    const body = resp ? await resp.json().catch(() => ({})) : {};
    console.log(
      `[adaptive] "${message.slice(0, 52)}" -> ${Date.now() - t0}ms mode=${body?.response_mode} ` +
        `staged=${body?.staged_operations_count} fallback=${body?.fallback_used}`,
    );
    await page.waitForTimeout(1000);
    return body;
  }

  // --- 1) chat, 2) query (read-only) ---
  await send("Hi! What can you help me with on this roadmap?");
  await send("How many epics are in this roadmap, and what are their titles?");

  // --- 3) CREATE: choose a name that is NOT present ---
  const existing = new Set(titles(epics));
  let createName = "Live-Demo";
  for (let n = 2; existing.has(createName); n++) createName = `Live-Demo-${n}`;
  console.log(`[adaptive] creating absent epic "${createName}"`);
  const created = await send(`Add an epic called "${createName}".`);
  expect(created?.response_mode, "create should be an edit").toBe("edit_plan");
  expect(await waitFor((t) => t.includes(createName), `commit ${createName}`)).toBe(true);
  console.log(`[adaptive] ✓ committed "${createName}"`);

  // --- 4) RENAME: act on the epic that now exists ---
  const renamed = `${createName}-Renamed`;
  const upd = await send(`Rename the epic "${createName}" to "${renamed}".`);
  expect(upd?.response_mode, "rename should be an edit").toBe("edit_plan");
  expect(await waitFor((t) => t.includes(renamed) && !t.includes(createName), `rename`)).toBe(true);
  console.log(`[adaptive] ✓ renamed -> "${renamed}"`);

  // --- 5) DELETE: remove what we created ---
  const del = await send(`Delete the epic "${renamed}" and everything under it.`);
  expect(del?.response_mode, "delete should be an edit").toBe("edit_plan");
  expect(await waitFor((t) => !t.includes(renamed), `delete`)).toBe(true);
  console.log(`[adaptive] ✓ deleted "${renamed}"`);

  // --- Final state ---
  console.log(`[adaptive] final epics: ${titles(await listEpics()).join(" | ")}`);
});
