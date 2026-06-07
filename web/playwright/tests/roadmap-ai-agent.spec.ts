import { expect, test } from "@playwright/test";

// End-to-end smoke for the rebuilt v2 roadmap AI agent (single-loop brain,
// gpt-5.4-mini via the OpenAI Responses API). Drives the real web UI ->
// agent (8010) -> backend (8001) pipeline: open the AI assistant panel, ask
// it to create an epic, and confirm the agent stages + auto-commits it so the
// new epic node renders on the canvas.

const ROADMAP_URL =
  "/project/69d405c9-1eee-4b0f-91b4-2e677ba10c23/roadmap/5ebdbb85-87a6-4685-aba4-fcf7f2283afe?view=roadmapView";

test("v2 agent: chat request creates an epic on the canvas", async ({ page }) => {
  test.setTimeout(180_000);

  // Unique title so the assertion can't collide with pre-existing nodes.
  const epicTitle = `PW-Smoke-${Date.now().toString().slice(-6)}`;

  await page.goto(ROADMAP_URL);

  // Roadmap shell + canvas are ready.
  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle, "roadmap top bar should render").toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".react-flow"), "canvas should render").toBeVisible({
    timeout: 30_000,
  });

  // Open the AI assistant panel.
  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel, "AI panel should open").toBeVisible();

  // Send an edit request.
  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");
  await composer.click();
  await composer.fill(`Add an epic called "${epicTitle}"`);
  // Submit with Enter (composer sends on Enter w/o Shift). Avoids the dev-only
  // TanStack Devtools floating widget that overlaps the Send button.
  await composer.press("Enter");

  // The user message lands in the thread (send succeeded).
  await expect(
    panel.getByText(epicTitle, { exact: false }).first(),
    "user message should appear in the thread",
  ).toBeVisible({ timeout: 15_000 });

  // The agent stages the add_epic op and the web auto-commits it. Generous
  // timeout: model turn + tool loop + async commit. The panel surfaces a
  // commit confirmation when this completes.
  await expect(
    panel.getByText(/Committed changes/i),
    "agent should stage and auto-commit the edit",
  ).toBeVisible({ timeout: 150_000 });

  // Proof the epic is in the real (committed + refreshed) roadmap, not just
  // the chat: it renders in the left Roadmap Structure sidebar.
  await expect(
    page.locator("#roadmap-left-panel").getByText(epicTitle, { exact: false }),
    "new epic should appear in the roadmap structure sidebar",
  ).toBeVisible({ timeout: 30_000 });
});
