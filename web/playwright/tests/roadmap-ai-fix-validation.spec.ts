import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * End-to-end validation of the Bug B fix (pending-plan bleed). Reproduces the
 * exact sweep scenario that misrouted a live rename into the plan-revision
 * lane: create a live epic, open a pending plan, then rename the live epic.
 * Pre-fix: response_mode=plan_proposal, staged=0 (silent no-op). Post-fix: the
 * loop guard rejects the misrouted revision and the model re-stages a real
 * update_node -> response_mode=edit_plan, staged>=1.
 *
 * Self-cleaning: deletes the PW-Fix-* epic by id via the backend at the end.
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const AGENT_BASE = process.env.VITE_AGENT_API_URL || "http://localhost:8010";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(
  /\/$/,
  "",
);
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;

test("v2 fix: live rename under a pending plan stages a real edit (Bug B)", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto(APP_URL);
  await expect(page.getByTitle("Toggle AI chat panel")).toBeVisible({
    timeout: 30_000,
  });
  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          const v = JSON.parse(localStorage.getItem(k) as string);
          return v?.access_token ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  expect(token, "supabase token").toBeTruthy();

  const agent = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const back = await pwRequest.newContext({
    baseURL: BACKEND_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });

  const sres = await agent.post("/agent/sessions", {
    data: { roadmap_id: ROADMAP_ID, metadata: { brain_version: "v2" } },
  });
  const sessionId = (await sres.json()).session_id as string;

  async function send(message: string) {
    const r = await agent.post(`/agent/sessions/${sessionId}/messages`, {
      data: { message },
      timeout: 150_000,
    });
    const body = await r.json();
    console.log(
      `[fix] "${message.slice(0, 40)}..." -> mode=${body.response_mode} staged=${body.staged_operations_count} intent=${body.intent_type}`,
    );
    return body;
  }

  async function epicsByTitlePrefix(prefix: string) {
    const list = await back.get(`/api/epics/roadmap/${ROADMAP_ID}`);
    const epics: Array<{ id: string; title: string }> = await list.json();
    return (Array.isArray(epics) ? epics : []).filter((e) =>
      (e.title || "").startsWith(prefix),
    );
  }

  async function waitForCommittedTitle(title: string) {
    // Generous: async auto-commit + occasionally flaky Upstash DNS on this box.
    for (let i = 0; i < 30; i++) {
      const hit = (await epicsByTitlePrefix("PW-Fix")).some(
        (e) => e.title === title,
      );
      if (hit) return true;
      await page.waitForTimeout(2000);
    }
    return false;
  }

  try {
    // 1. Live epic. Assert it staged + commits (isolates Bug B from infra).
    const add = await send(`Add an epic called "PW-Fix-A".`);
    expect(add.response_mode, "add epic should stage an edit").toBe("edit_plan");
    expect(
      await waitForCommittedTitle("PW-Fix-A"),
      "PW-Fix-A should auto-commit to the live roadmap",
    ).toBe(true);

    // 2. Pending plan, so revision_operations is in play on the next turn.
    await send("Propose a plan to add a referral program to this product.");

    // 3. The rename that used to be swallowed into the pending plan.
    const rename = await send(`Rename the epic "PW-Fix-A" to "PW-Fix-A2".`);
    expect(rename.response_mode, "rename should stage a live edit").toBe(
      "edit_plan",
    );
    expect(
      rename.staged_operations_count,
      "rename should stage >=1 operation",
    ).toBeGreaterThanOrEqual(1);
    expect(rename.intent_type).toBe("roadmap_edit");
    expect(
      await waitForCommittedTitle("PW-Fix-A2"),
      "rename should commit PW-Fix-A2 to the live roadmap",
    ).toBe(true);
  } finally {
    // Cleanup: remove every PW-Fix-* epic by id regardless of pass/fail.
    const doomed = await epicsByTitlePrefix("PW-Fix");
    for (const e of doomed) {
      const del = await back.delete(`/api/epics/${e.id}`);
      console.log(`[fix] cleanup delete ${e.title} -> ${del.status()}`);
    }
    console.log(`[fix] cleaned ${doomed.length} PW-Fix-* epic(s)`);
    await agent.dispose();
    await back.dispose();
  }
});
