import { expect, test } from "@playwright/test";
import { canvasNodes, canvasRoot, waitForCanvasReady } from "./canvasLocators";
import {
	APP_URL,
	SHARE_TOKEN,
	TEMPLATE_SLUG,
} from "./canvasFixture";

/**
 * Phone-viewport coverage for the canvas surfaces that have NO mobile fallback.
 *
 * `useIsMobile()` is consulted only in `RoadmapViewContent`, so the app route
 * swaps in `MobileRoadmapView` on phones and the canvas never mounts there. The
 * two PUBLIC surfaces do not do that:
 *
 *   - `/roadmap/shared/:token`   renders `RoadmapCanvas` directly
 *   - `/roadmap-templates/:slug` renders `TemplateRoadmapFlow` -> `RoadmapView`
 *
 * So the canvas — and, after the renderer swap, hand-rolled touch pan/pinch —
 * ships to unauthenticated phone traffic on exactly the two least-tested routes.
 * Before this file there was no phone coverage of either. These tests pin the
 * current behaviour so the swap has something to be measured against.
 *
 * Both tests self-discover their fixture (a share link / a template slug) the
 * same way `playwright/audit/capture.mjs` does, and skip loudly rather than
 * silently passing when none exists.
 */

const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

async function firstHref(
	page: import("@playwright/test").Page,
	selector: string,
): Promise<string | null> {
	const link = page.locator(selector).first();
	if (!(await link.count())) return null;
	return link.getAttribute("href");
}

// KNOWN BROKEN — not a canvas bug, and not caused by the renderer refactor.
//
// The share page never renders a canvas at all, in any environment. It reads
// `data.epics` / `data.milestones` / `data.currentUserRole` from
// GET /api/roadmap-shares/token/:shareToken, but that endpoint returns the
// share ROW — `select('*, roadmap:roadmaps(id, name, status, owner_id)')` in
// roadmap-shares.repository.supabase.ts — which carries none of those fields.
// So `epics` is always undefined, the page falls back to its "No Epics Yet"
// empty state, and the canvas is never mounted.
//
// Un-fixme once the endpoint returns a FullRoadmap; the assertions below are
// already correct and this is exactly the R1 surface we need covered.
test.fixme("share link renders the canvas at phone width", async ({ page }) => {
	await page.goto("/roadmap/shared-with-me", {
		waitUntil: "domcontentloaded",
	});
	const href =
		SHARE_TOKEN !== null
			? `/roadmap/shared/${SHARE_TOKEN}`
			: await firstHref(page, 'a[href*="/roadmap/shared/"]');
	test.skip(
		!href,
		"no roadmap is shared with this account — create one to cover the public share route on phones",
	);

	await page.goto(href as string);

	// The share route has no mobile branch, so the real canvas must mount here.
	await waitForCanvasReady(page, 45_000);
	await expect(canvasRoot(page)).toBeVisible();
	await expect(canvasNodes(page).first()).toBeVisible({ timeout: 30_000 });

	// It must not overflow the viewport horizontally.
	const scrollWidth = await page.evaluate(
		() => document.documentElement.scrollWidth,
	);
	expect(scrollWidth).toBeLessThanOrEqual(PHONE.width + 1);
});

test("template preview renders the canvas at phone width", async ({ page }) => {
	await page.goto("/roadmap-templates", { waitUntil: "domcontentloaded" });
	const href =
		TEMPLATE_SLUG !== null
			? `/roadmap-templates/${TEMPLATE_SLUG}`
			: await firstHref(page, 'a[href*="/roadmap-templates/"]');
	test.skip(!href, "no roadmap templates are published");

	await page.goto(href as string);

	// TemplateRoadmapFlow mounts RoadmapView with fitView + minZoom 0.2. The
	// fitView path at that zoom is the case most likely to expose differences
	// between the old and new renderer's framing maths.
	await waitForCanvasReady(page, 45_000);
	await expect(canvasRoot(page)).toBeVisible();
	await expect(canvasNodes(page).first()).toBeVisible({ timeout: 30_000 });

	const scrollWidth = await page.evaluate(
		() => document.documentElement.scrollWidth,
	);
	expect(scrollWidth).toBeLessThanOrEqual(PHONE.width + 1);
});

test("app route falls back to the mobile tree instead of the canvas", async ({
	page,
}) => {
	// Documents the asymmetry that makes the two tests above matter: on phones the
	// app route deliberately does NOT mount the canvas. If this ever starts
	// rendering the canvas, phone users inherit the full drag/pan surface and
	// these expectations need revisiting.
	await page.goto(APP_URL);

	// Something from the roadmap page must render. Anchor on a control that only
	// the mobile tree renders ("Toggle AI assistant", MobileRoadmapView) rather
	// than the desktop top bar's "Toggle AI chat panel" — otherwise a regression
	// that mounted the *desktop* shell on a phone would still satisfy this.
	await expect(
		page.getByRole("button", { name: "Toggle AI assistant" }),
	).toBeVisible({ timeout: 45_000 });
	// ...but not the canvas shell.
	await expect(canvasRoot(page)).toHaveCount(0);
});
