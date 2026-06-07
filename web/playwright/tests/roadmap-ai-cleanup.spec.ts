import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * Deterministic cleanup of the PW-* test epics the assessment sweep created
 * (including the duplicate "PW-Telemetry-A" the duplication bug produced, plus
 * any "PW-Smoke" leftovers from earlier manual e2e runs). Deletes by ID via
 * the backend so name ambiguity / the agent's clarifier path don't get in the
 * way. FK cascades remove child features/tasks.
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
// Host only — /api goes in the request paths. Playwright's baseURL join
// resolves a leading-slash path against the host root, which would drop a
// path segment baked into baseURL.
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(
  /\/$/,
  "",
);
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;

test("cleanup: delete PW-* test epics by id", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(APP_URL);
  await expect(page.getByTitle("Toggle AI chat panel")).toBeVisible({
    timeout: 30_000,
  });

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
  expect(token, "supabase access token").toBeTruthy();

  const api = await pwRequest.newContext({
    baseURL: BACKEND_BASE,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const listRes = await api.get(`/api/epics/roadmap/${ROADMAP_ID}`);
  expect(listRes.ok(), `list epics -> ${listRes.status()}`).toBeTruthy();
  const listBody = await listRes.json();
  const epics: Array<{ id: string; title: string }> = Array.isArray(listBody)
    ? listBody
    : (listBody.data ?? listBody.epics ?? listBody.items ?? []);
  if (!Array.isArray(epics) || epics.length === 0) {
    console.log("[cleanup] raw list keys:", Object.keys(listBody ?? {}));
  }

  const doomed = epics.filter((e) => (e.title || "").startsWith("PW-"));
  console.log(
    `\n[cleanup] roadmap has ${epics.length} epics; ${doomed.length} match PW-*:`,
  );
  for (const e of doomed) console.log(`  - ${e.title}  ${e.id}`);

  for (const e of doomed) {
    const del = await api.delete(`/api/epics/${e.id}`);
    console.log(`  delete ${e.title} ${e.id} -> ${del.status()}`);
    expect(del.ok(), `delete ${e.title} -> ${del.status()}`).toBeTruthy();
  }

  const after = await api.get(`/api/epics/roadmap/${ROADMAP_ID}`);
  const afterBody = await after.json();
  const remaining: Array<{ title: string }> = Array.isArray(afterBody)
    ? afterBody
    : (afterBody.data ?? afterBody.epics ?? afterBody.items ?? []);
  const leftoverPw = remaining.filter((e) => (e.title || "").startsWith("PW-"));
  console.log(
    `\n[cleanup] after: ${remaining.length} epics, PW-* remaining = ${leftoverPw.length}`,
  );
  console.log(
    `[cleanup] surviving epics: ${remaining.map((e) => e.title).join(" | ")}\n`,
  );
  expect(leftoverPw.length, "no PW-* epics should remain").toBe(0);
  await api.dispose();
});
