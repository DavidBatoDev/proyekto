import { expect, test } from "@playwright/test";
import { PROJECT_ID, ROADMAP_ID } from "./canvasFixture";

/**
 * Phone-viewport coverage for the Timeline.
 *
 * Until this landed, `/project/:id/timeline/:roadmapId` rendered a placeholder
 * below 768px ("The Timeline is best viewed on a larger screen"), so there was
 * nothing to test. These pin the three things most likely to regress:
 *
 *   1. the chart renders at all, rather than the old wall;
 *   2. the chart scrolls horizontally under touch — the whole point of dropping
 *      desktop's drag-to-pan, which fought native scrolling;
 *   3. a tap on a bar opens the detail sheet and CANNOT reschedule the bar,
 *      which is the failure mode the mobile view exists to prevent. On desktop
 *      a bar begins a move on pointerdown, so a naive port would have let every
 *      scroll attempt silently move real work.
 */

const PHONE = { width: 390, height: 844 };
const TIMELINE_URL = `/project/${PROJECT_ID}/timeline/${ROADMAP_ID}`;

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/** The scroll viewport is the only two-axis `overflow-auto` box on the page. */
const viewport = (page: import("@playwright/test").Page) =>
	page.locator("div.overflow-auto.overscroll-contain").first();

async function gotoTimeline(page: import("@playwright/test").Page) {
	await page.goto(TIMELINE_URL, { waitUntil: "domcontentloaded" });
	// The toolbar is the first thing the mobile view paints and does not depend
	// on the roadmap having any dated work.
	await expect(
		page.getByRole("button", { name: "Today" }),
	).toBeVisible({ timeout: 30_000 });
}

test("renders the chart, not the desktop-only placeholder", async ({ page }) => {
	await gotoTimeline(page);

	await expect(
		page.getByText("best viewed on a larger screen"),
	).toHaveCount(0);

	// The time-scale segmented control is unique to the mobile toolbar.
	for (const label of ["Day", "Week", "Month", "Year"]) {
		await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
	}
	await expect(page.getByText("Task", { exact: true })).toBeVisible();
});

test("scrolls horizontally under touch", async ({ page }) => {
	await gotoTimeline(page);

	const scroller = viewport(page);
	await expect(scroller).toBeVisible();

	const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
	const clientWidth = await scroller.evaluate((el) => el.clientWidth);
	test.skip(
		scrollWidth <= clientWidth,
		"roadmap is too small to scroll at this viewport",
	);

	const before = await scroller.evaluate((el) => el.scrollLeft);
	await scroller.evaluate((el) => {
		el.scrollLeft = el.scrollLeft + 240;
	});
	const after = await scroller.evaluate((el) => el.scrollLeft);
	expect(after).toBeGreaterThan(before);

	// touch-action must leave one-finger panning to the browser; `none` would
	// mean we had taken the gesture and broken native scrolling.
	await expect(scroller).toHaveCSS("touch-action", "pan-x pan-y");
});

test("tapping a bar opens the detail sheet without moving it", async ({
	page,
}) => {
	await gotoTimeline(page);

	// Bars are the only absolutely-positioned children of a row that carry a
	// title attribute; skip when this roadmap has no dated work to tap.
	const bar = page.locator('[data-no-pan="true"][title]').first();
	test.skip(
		(await bar.count()) === 0,
		"roadmap has no scheduled work at this viewport",
	);

	const geometryBefore = await bar.evaluate((el) => ({
		left: (el as HTMLElement).style.left,
		width: (el as HTMLElement).style.width,
	}));

	await bar.tap();

	const sheet = page.getByRole("dialog");
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("button", { name: /^Open (epic|feature)$/ })).toBeVisible();

	// The tap must not have been read as the start of a drag.
	const geometryAfter = await bar.evaluate((el) => ({
		left: (el as HTMLElement).style.left,
		width: (el as HTMLElement).style.width,
	}));
	expect(geometryAfter).toEqual(geometryBefore);
});
