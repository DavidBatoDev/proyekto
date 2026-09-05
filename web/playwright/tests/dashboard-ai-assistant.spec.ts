import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * Adaptive live drive of the DASHBOARD assistant (workspace scope), per the
 * agent re-architecture plan (PR4). Drives the real rail + fullscreen overlay
 * on /w/<slug>/dashboard against the live agent, so it is meant to be
 * WATCHED, not fired blind:
 *   cd web && PLAYWRIGHT_HEADED=1 PLAYWRIGHT_SLOW_MO=400 \
 *     npx playwright test playwright/tests/dashboard-ai-assistant.spec.ts --project=chromium-user
 *
 * What it checks, in order:
 *   1. /dashboard lands on the workspace dashboard; the rail is the
 *      "Proyekto assistant"; Expand opens ?assistant=full and the overlay is
 *      "Proyekto assistant, full screen" while the rail goes inert.
 *   2. `@` opens the mention listbox; picking a roadmap leaves an `@Title `
 *      pill in the composer and a chip in the sent bubble.
 *   3. A two-roadmap edit ("In @A and @B add an epic called PW-Dash-<ts>")
 *      always goes through a proposal in workspace scope (plan D4). Clarifiers
 *      are answered adaptively; Apply shows the "Applying changes" banner and
 *      then TWO "Committed changes" cards with distinct titles whose chips
 *      deep-link to /project/<id>/roadmap/<roadmapId>?nodeId=.
 *   4. Collapse: the rail shows the same thread (state is shared, not copied)
 *      and the roadmaps grid shows the new epic after invalidation.
 *   5. Negative: mentioning A then asking about B is still answered (refs
 *      bias, never restrict).
 *
 * Self-cleaning: deletes the epics it created via the backend. Two roadmaps
 * with distinct titles must be reachable by the Playwright user; override the
 * pick with PW_DASH_ROADMAP_A / PW_DASH_ROADMAP_B (titles) when the default
 * "first two from /api/roadmaps/preview" is not what you want to edit.
 */

const BACKEND_BASE = (process.env.VITE_API_URL || "http://localhost:8001").replace(
  /\/$/,
  "",
);
const RUN_TIMEOUT_MS = 150_000;
const TEST_PREFIX = /^PW-Dash-/;

interface PreviewRoadmap {
  id: string;
  title: string;
  project?: { id: string; title: string } | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readSupabaseToken(page: Page): Promise<string> {
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
  return token as string;
}

/**
 * Types `@` + a prefix of the title and clicks the matching roadmap option.
 * Mouse selection is what the picker supports for an arbitrary row; keyboard
 * (ArrowDown/Enter) only reliably picks the FIRST row, which is whatever
 * ranked highest, not necessarily the roadmap we want.
 */
async function mentionRoadmap(page: Page, composer: Locator, title: string) {
  await composer.pressSequentially(`@${title.slice(0, 4)}`, { delay: 40 });
  const listbox = page.getByRole("listbox", { name: "Mention an item" });
  await expect(listbox, "mention picker should open on @").toBeVisible();
  await listbox.getByRole("option", { name: title, exact: true }).first().click();
  await expect(listbox).toBeHidden();
  await expect(composer).toHaveValue(new RegExp(`@${escapeRegExp(title)} `));
}

/**
 * Observe-then-act loop for one turn: answers any clarifier with its first
 * option, applies a proposal when one appears, and returns when the run's
 * banner is gone AND either a proposal was applied or a plain reply landed.
 */
async function driveTurnAdaptively(
  page: Page,
  panel: Locator,
  opts: { expectProposal: boolean; deadlineMs: number },
) {
  const banner = page.getByTestId("ai-run-banner");
  const started = Date.now();
  let applied = false;
  while (Date.now() - started < opts.deadlineMs) {
    const clarifier = panel.getByTestId("clarifier-card").last();
    if (await clarifier.isVisible().catch(() => false)) {
      const submit = clarifier.getByTestId("clarifier-submit");
      if (await submit.isEnabled().catch(() => false)) {
        // Answer with the first concrete option of each question.
        const option = clarifier.getByTestId("clarifier-option").first();
        if (await option.isVisible().catch(() => false)) await option.click();
        const next = clarifier.getByTestId("clarifier-next");
        if (await next.isVisible().catch(() => false)) {
          await next.click();
          continue;
        }
        console.log("[dash-ai] answering clarifier");
        await submit.click();
        await page.waitForTimeout(1500);
        continue;
      }
    }

    const apply = panel.getByRole("button", { name: "Apply this plan" }).last();
    if (!applied && (await apply.isVisible().catch(() => false))) {
      console.log("[dash-ai] applying proposal");
      await apply.click();
      applied = true;
      await expect(banner, "run banner should show while applying").toContainText(
        /Applying changes/,
        { timeout: 30_000 },
      );
      continue;
    }

    const bannerVisible = await banner.isVisible().catch(() => false);
    if (!bannerVisible) {
      if (opts.expectProposal && !applied) {
        // Idle without a proposal yet: give the reply a moment, then re-check.
        await page.waitForTimeout(1500);
        continue;
      }
      return { applied };
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`[dash-ai] turn did not settle within ${opts.deadlineMs}ms`);
}

test("dashboard assistant: mentions, a two-roadmap proposal, commits, shared thread", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const ts = Date.now();
  const epicTitle = `PW-Dash-${ts}`;

  // 1. Land on the workspace dashboard. The rail is visible at Desktop Chrome
  //    width (1280 = xl), the switcher is not.
  await page.goto("/dashboard");
  await page.waitForURL(/\/w\/[^/]+\/dashboard/, { timeout: 30_000 });
  const rail = page.getByLabel("Proyekto assistant", { exact: true });
  await expect(rail, "rail should render").toBeVisible({ timeout: 30_000 });

  const token = await readSupabaseToken(page);
  const authHeaders = { Authorization: `Bearer ${token}` };

  // Pick two roadmaps to edit (backend = source of truth for what exists).
  const previewRes = await page.request.get(`${BACKEND_BASE}/api/roadmaps/preview`, {
    headers: authHeaders,
  });
  const previewJson = await previewRes.json();
  const roadmaps: PreviewRoadmap[] = Array.isArray(previewJson)
    ? previewJson
    : (previewJson?.data ?? []);
  const byTitle = (title: string | undefined) =>
    title ? roadmaps.find((r) => r.title === title) : undefined;
  const roadmapA =
    byTitle(process.env.PW_DASH_ROADMAP_A) ?? roadmaps.find((r) => r.title?.trim());
  const roadmapB =
    byTitle(process.env.PW_DASH_ROADMAP_B) ??
    roadmaps.find((r) => r.title?.trim() && r.id !== roadmapA?.id && r.title !== roadmapA?.title);
  expect(roadmapA, "need a first roadmap").toBeTruthy();
  expect(roadmapB, "need a second roadmap with a distinct title").toBeTruthy();
  const A = roadmapA as PreviewRoadmap;
  const B = roadmapB as PreviewRoadmap;
  console.log(`[dash-ai] roadmaps: A="${A.title}" (${A.id}) B="${B.title}" (${B.id})`);

  // Expand: the URL carries the shape, the overlay gets its own name, and the
  // rail is taken out of the accessibility tree.
  await page.getByRole("button", { name: "Expand assistant" }).click();
  await expect(page).toHaveURL(/assistant=full/);
  const panel = page.getByLabel("Proyekto assistant, full screen", { exact: true });
  await expect(panel, "fullscreen assistant should open").toBeVisible();
  await expect(page.locator("aside[aria-hidden='true']", { has: rail })).toHaveCount(1);

  // Fresh thread, so the assertions below are about this run only.
  await panel.locator('button[aria-haspopup="dialog"]').click();
  const picker = page.getByLabel("AI thread picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "New thread" }).last().click();
  await expect(panel.getByText("Ask Proyekto about your projects and roadmaps")).toBeVisible({
    timeout: 15_000,
  });

  const composer = panel.getByPlaceholder("Ask Proyekto...");
  await expect(composer).toBeEnabled({ timeout: 15_000 });

  try {
    // 2 + 3. Compose with two roadmap mentions and send.
    await composer.click();
    await composer.pressSequentially("In ", { delay: 30 });
    await mentionRoadmap(page, composer, A.title);
    await composer.pressSequentially("and ", { delay: 30 });
    await mentionRoadmap(page, composer, B.title);
    await composer.pressSequentially(`add an epic called ${epicTitle}`, { delay: 20 });
    await composer.press("Enter");

    // The sent bubble renders each mention as a chip (a link to the roadmap).
    await expect(panel.getByText(epicTitle).first()).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("link", { name: A.title, exact: true }).first()).toBeVisible();
    await expect(panel.getByRole("link", { name: B.title, exact: true }).first()).toBeVisible();

    // A multi-roadmap edit in workspace scope always proposes first (D4).
    const { applied } = await driveTurnAdaptively(page, panel, {
      expectProposal: true,
      deadlineMs: RUN_TIMEOUT_MS + 120_000,
    });
    expect(applied, "multi-roadmap edit should go through a proposal").toBe(true);

    // Two commit cards with distinct roadmap titles, chips deep-linking to
    // the node on each roadmap.
    const committed = panel.getByTestId("ai-commit-card").filter({
      hasText: "Committed changes",
    });
    await expect(committed, "two roadmaps should commit").toHaveCount(2, {
      timeout: RUN_TIMEOUT_MS,
    });
    const cardTexts = await committed.allTextContents();
    expect(cardTexts[0]).not.toEqual(cardTexts[1]);
    for (const roadmapId of [A.id, B.id]) {
      const chip = committed
        .locator(`a[href*="/roadmap/${roadmapId}"]`)
        .first();
      await expect(chip, `chip should deep-link into roadmap ${roadmapId}`).toHaveAttribute(
        "href",
        new RegExp(`/project/[^/]+/roadmap/${escapeRegExp(roadmapId)}\\?.*nodeId=`),
      );
    }

    // 4. Collapse. The rail is the same thread (shared state, not a copy) and
    //    the roadmaps grid picks up the new epic after invalidation.
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page).not.toHaveURL(/assistant=full/);
    await expect(rail).toBeVisible();
    await expect(
      rail.getByTestId("ai-commit-card").filter({ hasText: "Committed changes" }),
      "rail should show the same committed cards",
    ).toHaveCount(2, { timeout: 15_000 });
    await expect(
      page.getByRole("main").getByText(epicTitle).first(),
      "roadmaps grid should show the new epic",
    ).toBeVisible({ timeout: 30_000 });

    // 5. Negative: a mention biases, it does not restrict. Ask about B while
    //    mentioning A and expect an answer, not a refusal.
    const railComposer = rail.getByPlaceholder("Ask Proyekto...");
    await expect(railComposer).toBeEnabled({ timeout: 15_000 });
    await railComposer.click();
    await railComposer.pressSequentially("Given ", { delay: 30 });
    await mentionRoadmap(page, railComposer, A.title);
    await railComposer.pressSequentially(`, what's overdue in ${B.title}?`, { delay: 20 });
    const repliesBefore = await rail.getByTestId("ai-commit-card").count();
    await railComposer.press("Enter");
    await driveTurnAdaptively(page, rail, {
      expectProposal: false,
      deadlineMs: RUN_TIMEOUT_MS,
    });
    // The reply is a plain assistant bubble: no new commit card, banner gone,
    // and the composer is back.
    expect(await rail.getByTestId("ai-commit-card").count()).toBe(repliesBefore);
    await expect(railComposer).toBeEnabled();
  } finally {
    // Cleanup: delete the epics this run created on both roadmaps.
    for (const roadmapId of [A.id, B.id]) {
      const r = await page.request.get(`${BACKEND_BASE}/api/epics/roadmap/${roadmapId}`, {
        headers: authHeaders,
      });
      const j = await r.json().catch(() => null);
      const epics: Array<{ id: string; title: string }> = Array.isArray(j)
        ? j
        : (j?.data ?? j?.epics ?? []);
      for (const e of epics.filter((x) => TEST_PREFIX.test(x.title))) {
        const del = await page.request.delete(`${BACKEND_BASE}/api/epics/${e.id}`, {
          headers: authHeaders,
        });
        console.log(`[dash-ai] cleanup ${e.title} on ${roadmapId}: ${del.status()}`);
      }
    }
  }
});
