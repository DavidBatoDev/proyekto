import { expect, test } from "@playwright/test";

/**
 * Operation-coverage drive: exercises the full mutation set + edge cases
 * through the real composer and asserts two production properties per turn:
 *
 *   1. COMMITTED — the response carries commit_summary.committed=true
 *      (sync auto-commit landed in the DB). A failed commit now auto-discards
 *      staged ops server-side, so one bad op can't cascade into later turns.
 *   2. INSTANT — where a UI assertion exists, the change is visible in the
 *      live roadmap (left sidebar) within ~2.5s, i.e. rendered from the
 *      optimistic apply, NOT the slow GET /full reconcile.
 *
 *   cd web && npm run pw:watch -- playwright/tests/roadmap-ai-ops-coverage.spec.ts
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const TEST_PREFIX = /^(PW-|UI-Watch|Live-)/;
const INSTANT_MS = 2_500;

test("v2 agent: operation-coverage drive", async ({ page }) => {
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
      // Backend wraps every response as { data: T } (ResponseInterceptor).
      const list = Array.isArray(j) ? j : (j as { data?: unknown } | null)?.data;
      if (Array.isArray(list)) return list as Array<{ id: string; title: string }>;
      await page.waitForTimeout(500);
    }
    return [] as Array<{ id: string; title: string }>;
  }

  // clean leftovers
  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }
  console.log(`[ops] clean start: ${(await epics()).map((e) => e.title).join(" | ") || "(none)"}`);

  type CommitSummary = {
    committed?: boolean;
    error_code?: string | null;
    error_message?: string | null;
    impacted_summary?: Record<string, number>;
  };
  const results: Array<{ label: string; ok: boolean; note: string }> = [];

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
    await expect(composer).toHaveValue("", { timeout: 15_000 });
    const resp = await respPromise;
    const body = resp ? await resp.json().catch(() => ({})) : {};
    await page.waitForTimeout(400);
    return body as {
      response_mode?: string;
      staged_operations_count?: number;
      fallback_used?: boolean;
      commit_summary?: CommitSummary | null;
      session_id?: string;
    };
  }

  // A mutation turn: must come back committed via commit_summary, and (when
  // given) the UI must reflect it instantly via the optimistic apply.
  async function edit(label: string, message: string, ui?: () => Promise<void>) {
    const body = await raw(message);
    const cs = body?.commit_summary;
    const committed = cs?.committed === true;
    let note = `mode=${body?.response_mode} committed=${committed}`;
    let ok = committed;
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
    if (!committed) {
      note += ` error=${cs?.error_code ?? "none"} staged=${body?.staged_operations_count}`;
    }
    results.push({ label, ok, note });
    console.log(`[ops] ${label}: ${note} -> ${ok ? "PASS" : "FAIL"}`);
    return body;
  }

  // A turn that must NOT mutate the roadmap (query/smalltalk/unresolvable).
  async function nonEdit(label: string, message: string) {
    const body = await raw(message);
    const committedSomething = body?.commit_summary?.committed === true;
    const ok = !committedSomething;
    const note = `mode=${body?.response_mode} committed=${committedSomething}`;
    results.push({ label, ok, note });
    console.log(`[ops] ${label}: ${note} -> ${ok ? "PASS" : "FAIL"}`);
    return body;
  }

  const seen = (text: string) =>
    expect(sidebar.getByText(text, { exact: false }).first()).toBeVisible({
      timeout: INSTANT_MS,
    });
  const gone = (text: string) =>
    expect(sidebar.getByText(text, { exact: false })).toHaveCount(0, {
      timeout: INSTANT_MS,
    });
  // Features/tasks render only under EXPANDED epics, so probe them through the
  // sidebar search — its results come straight from the (optimistically
  // updated) store regardless of collapse state.
  const seenDeep = async (text: string) => {
    const search = sidebar.getByPlaceholder("Search epics, features, tasks...");
    await search.fill(text);
    await expect(
      sidebar.getByText(text, { exact: false }).first(),
    ).toBeVisible({ timeout: INSTANT_MS });
    await search.fill("");
  };

  // Distinct stems: E must not be a substring of the others so `gone(E)`
  // can't match the surviving epics.
  const stamp = Date.now().toString().slice(-6);
  const E = `Live-A${stamp}`;
  const E2 = `Live-B${stamp}`;
  const EMULTI = `Live-C${stamp}`;

  // --- core mutation battery (each with an instant-UI assertion) ---
  await nonEdit("smalltalk", "Hi! What can you help me with on this roadmap?");
  await edit("add_epic", `Add an epic called "${E}".`, () => seen(E));
  await edit(
    "add_feature",
    `Add a feature called "Planning" under the epic "${E}".`,
    () => seenDeep("Planning"),
  );
  await edit(
    "add_tasks",
    `Add two tasks "Spec" and "Build" to the feature "Planning".`,
    () => seenDeep("Spec"),
  );
  await edit(
    "rename_feature",
    `Rename the feature "Planning" to "Roadmapping".`,
    () => seenDeep("Roadmapping"),
  );
  await edit("update_desc", `Set the description of the epic "${E}" to "Q3 initiative".`);
  await edit("add_epic2", `Add an epic called "${E2}".`, () => seen(E2));
  await edit(
    "move_feature",
    `Move the feature "Roadmapping" to the epic "${E2}".`,
  );
  await edit("mark_status", `Mark the task "Spec" as done.`);
  await edit(
    "set_dates",
    `Set the start date of the epic "${E}" to 2026-07-01 and the end date to 2026-07-31.`,
  );
  await edit("shift_dates", `Push the dates of the epic "${E}" out by 7 days.`);

  // --- edge cases ---
  await edit(
    "multi_op",
    `Create an epic "${EMULTI}" with two features "Alpha" and "Beta", and add a task "Kickoff" under "Alpha".`,
    () => seen(EMULTI),
  );
  await nonEdit("query_count", "How many epics are on this roadmap right now?");
  await nonEdit(
    "delete_missing",
    `Delete the epic "Zzz-DoesNotExist-42".`,
  );
  // Duplicate-name guard (Bug A regression): asking to add an epic that
  // already exists must not produce a second node with the same title.
  await raw(`Add an epic called "${E2}".`);
  const dupCount = (await epics()).filter((x) => x.title === E2).length;
  results.push({
    label: "duplicate_add",
    ok: dupCount === 1,
    note: `nodes_with_title=${dupCount}`,
  });
  console.log(`[ops] duplicate_add: nodes=${dupCount} -> ${dupCount === 1 ? "PASS" : "FAIL"}`);

  await edit(
    "delete_epic",
    `Delete the epic "${E}" and everything under it.`,
    () => gone(E),
  );

  // --- report ---
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[ops] SUMMARY: ${results.length - failed.length}/${results.length} passed.` +
      (failed.length
        ? ` FAILED: ${failed.map((f) => `${f.label}(${f.note})`).join(", ")}`
        : " all good"),
  );
  console.log(`[ops] epics left: ${(await epics()).map((e) => e.title).join(" | ") || "(none)"}`);

  // best-effort cleanup
  for (const e of (await epics()).filter((x) => TEST_PREFIX.test(x.title))) {
    await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, { headers: authHeaders });
  }

  expect(failed, `failed steps: ${failed.map((f) => f.label).join(", ")}`).toHaveLength(0);
});
