import { expect, test } from "@playwright/test";

/**
 * UI-driven walkthrough of the roadmap AI assistant — drives the REAL panel
 * (not the agent API): open the side panel, start a NEW thread, and chat a
 * short conversation through the composer (chat -> query -> edit), watching
 * each turn render in the thread.
 *
 * Meant to be watched. Run headed + slowed:
 *   cd web
 *   PLAYWRIGHT_HEADED=1 PLAYWRIGHT_SLOW_MO=800 \
 *     npx playwright test playwright/tests/roadmap-ai-chat-ui.spec.ts --project=chromium-user
 *
 * Self-cleaning: deletes the demo epic it creates via the backend.
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(
  /\/$/,
  "",
);
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const DEMO_EPIC = "UI-Watch-Demo";

test("roadmap AI: open panel, start a new thread, and chat", async ({ page }) => {
  test.setTimeout(240_000);

  // 1. Open the roadmap and the AI side panel.
  await page.goto(APP_URL);
  const toggle = page.getByTitle("Toggle AI chat panel");
  await expect(toggle, "roadmap top bar should render").toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });
  await toggle.click();

  const panel = page.getByLabel("AI Assistant Panel");
  await expect(panel, "AI panel should open").toBeVisible();

  // 2. Start a brand-new thread via the thread picker in the panel header.
  await panel.locator('button[aria-haspopup="dialog"]').click(); // thread menu
  const picker = page.getByLabel("AI thread picker");
  await expect(picker, "thread picker should open").toBeVisible();
  // The footer "New thread" create button (last match; untitled threads in the
  // list also render with the title "New thread").
  await picker.getByRole("button", { name: "New thread" }).last().click();

  // Empty-thread coaching copy confirms we're on a fresh conversation.
  await expect(
    panel.getByText("Ask questions or request roadmap edits"),
    "fresh thread should show the empty state",
  ).toBeVisible({ timeout: 15_000 });

  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");

  // Helper: type into the composer, send with Enter (avoids the dev-only
  // TanStack Devtools widget overlapping the Send button), then wait for the
  // agent round-trip and the user's bubble to land in the thread.
  async function chat(message: string) {
    await composer.click();
    await composer.fill(message);
    const responsePromise = page
      .waitForResponse(
        (r) =>
          /\/agent\/sessions\/.+\/messages$/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 150_000 },
      )
      .catch(() => null);
    await composer.press("Enter");
    await expect(
      panel.getByText(message, { exact: false }).first(),
      "user message should appear in the thread",
    ).toBeVisible({ timeout: 15_000 });
    const resp = await responsePromise;
    console.log(
      `[chat] "${message.slice(0, 48)}" -> agent ${resp ? resp.status() : "no-response"}`,
    );
    // Let the assistant bubble render before the next turn (visible at slowMo).
    await page.waitForTimeout(1500);
  }

  // 3. A short thread: greet -> ask a read question -> request an edit.
  await chat("Hi! What can you help me with on this roadmap?");
  await chat("How many epics are in this roadmap, and what are their titles?");
  await chat(`Add an epic called "${DEMO_EPIC}".`);

  // The edit surfaces a commit confirmation in the panel when it lands.
  await expect(
    panel.getByText(/Committed changes/i),
    "the edit should stage and auto-commit",
  ).toBeVisible({ timeout: 60_000 });

  // 4. Cleanup the demo epic via the backend (reliable; not Redis-dependent).
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
  if (token) {
    const ctx = page.request;
    const list = await ctx.get(`${BACKEND_BASE}/api/epics/roadmap/${ROADMAP_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const epics: Array<{ id: string; title: string }> = await list.json();
    for (const e of (Array.isArray(epics) ? epics : []).filter(
      (x) => x.title === DEMO_EPIC,
    )) {
      const del = await ctx.delete(`${BACKEND_BASE}/api/epics/${e.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`[chat] cleanup delete ${e.title} -> ${del.status()}`);
    }
  }
});
