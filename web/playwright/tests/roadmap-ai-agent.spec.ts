import { expect, test } from "@playwright/test";

// End-to-end smoke for the rebuilt v2 roadmap AI agent (single-loop brain,
// gpt-5.4-mini via the OpenAI Responses API). Drives the real web UI ->
// agent (8010) -> backend (8001) pipeline: open the AI assistant panel, ask
// it to create an epic, and confirm the agent stages + auto-commits it so the
// new epic node renders on the canvas *immediately* (optimistic apply), not
// after the slow full-roadmap reload.

const ROADMAP_URL =
  "/project/69d405c9-1eee-4b0f-91b4-2e677ba10c23/roadmap/5ebdbb85-87a6-4685-aba4-fcf7f2283afe?view=roadmapView";

test("v2 agent: chat request creates an epic on the canvas", async ({ page }) => {
  test.setTimeout(180_000);

  // Unique title so the assertion can't collide with pre-existing nodes.
  const epicTitle = `PW-Smoke-${Date.now().toString().slice(-6)}`;

  // Capture the agent response so we can assert the server emitted
  // commit_summary.committed (the signal the web applies + refreshes on).
  let commitSummary: unknown = null;
  page.on("response", async (response) => {
    if (/\/agent\/sessions\/.+\/messages$/.test(response.url())) {
      try {
        const body = (await response.json()) as { commit_summary?: unknown };
        if (body?.commit_summary) commitSummary = body.commit_summary;
      } catch {
        /* non-JSON / streamed — ignore */
      }
    }
  });

  await page.goto(ROADMAP_URL);

  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle, "roadmap top bar should render").toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".react-flow"), "canvas should render").toBeVisible({
    timeout: 30_000,
  });

  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel, "AI panel should open").toBeVisible();

  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");
  await composer.click();
  await composer.fill(`Add an epic called "${epicTitle}"`);
  await composer.press("Enter");

  await expect(
    panel.getByText(epicTitle, { exact: false }).first(),
    "user message should appear in the thread",
  ).toBeVisible({ timeout: 15_000 });

  // The agent stages + auto-commits. The panel shows a commit confirmation.
  await expect(
    panel.getByText(/Committed changes/i),
    "agent should stage and auto-commit the edit",
  ).toBeVisible({ timeout: 150_000 });

  // The node is applied optimistically from the commit summary, so it must
  // render effectively instantly after the commit confirmation — NOT gated on
  // the slow GET /full reload. Measured ~25ms; 2s ceiling guards regressions.
  const tCommitted = Date.now();
  await expect(
    page.locator("#roadmap-left-panel").getByText(epicTitle, { exact: false }),
    "new epic should appear in the roadmap structure sidebar instantly",
  ).toBeVisible({ timeout: 2_000 });
  console.log(`[gap] committed -> sidebar node visible: ${Date.now() - tCommitted}ms`);

  expect(
    (commitSummary as { committed?: boolean } | null)?.committed,
    "agent response should carry commit_summary.committed=true",
  ).toBe(true);
});
