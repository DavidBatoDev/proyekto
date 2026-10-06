import { expect, test } from "@playwright/test";
import {
	expectNoHorizontalScroll,
	gotoTime,
	personaPage,
	personaState,
	project,
	shouldSkip,
	sheet,
	TIME_E2E_SKIP_REASON,
} from "./timePersonas";

/**
 * Mobile at 390×844 (ux.md › The Time Page › Mobile, Approvals › review screen; plan › Phase C):
 * no horizontal scroll, the sticky timer, the FAB, the review action bar, and no floating timer
 * on /time. Runs only in the `time-mobile` project (Chromium phone emulation, not the Capacitor
 * shell, so the native copy rules are covered by the component tests instead).
 *
 * Signed in as Mia (member); the review bar uses Lito (lead) on Nico's flagged sheet
 * (member2Flagged), which team-lead.spec.ts leaves Submitted.
 */
test.describe("Mobile 390×844", () => {
	test.skip(shouldSkip("member", "lead", "member2"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("member") });
	test.describe.configure({ mode: "serial" });

	test("/time has no horizontal scroll", async ({ page }) => {
		await gotoTime(page);
		await expectNoHorizontalScroll(page);
	});

	test("the FAB offers Start timer and Add time", async ({ page }) => {
		await gotoTime(page);
		// SELECTOR: W2-1 TimeMobileFab.
		await page.getByRole("button", { name: /^(New|Add|Start)( time| timer)?$|time actions/i }).last().click();
		await expect(page.getByRole("menuitem", { name: "Start timer" }).or(page.getByRole("button", { name: "Start timer" })).first()).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Add time" }).or(page.getByRole("button", { name: "Add time" })).first()).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("a running timer stays on screen while scrolling, and /time has no floating timer", async ({
		page,
	}) => {
		const web = project("web");
		await gotoTime(page, `?project=${web.id}`);
		await page.getByRole("button", { name: "Start timer" }).first().click();
		await page.getByRole("option", { name: web.tasks[0].title }).click();
		const clock = page.getByTestId("timer-clock");
		await expect(clock).toBeVisible();
		await page.mouse.wheel(0, 2000);
		await expect(clock).toBeInViewport();
		// FloatingActiveTimer never mounts on /time (its allowlist omits it; the page has its own bar).
		await expect(page.getByRole("group", { name: "Timer position" })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Open in Time" })).toHaveCount(0);
		await expectNoHorizontalScroll(page);

		// Elsewhere (a project page) the floating timer does show, with "Open in Time".
		await page.goto(`/project/${web.id}`);
		await expect(page.getByRole("link", { name: "Open in Time" }).first()).toBeVisible();

		await gotoTime(page);
		await page.getByRole("button", { name: /^Stop\b/ }).first().click();
		await expect(page.getByTestId("timer-clock")).toHaveCount(0);
	});

	test("the review screen keeps Return and Approve in a sticky bottom bar", async ({
		browser,
		baseURL,
	}) => {
		const { context, page } = await personaPage(browser, "lead", baseURL);
		try {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`/time/timesheets/${sheet("member2Flagged").id}`);
			await page.mouse.wheel(0, 3000);
			await expect(page.getByRole("button", { name: /^Return/ }).last()).toBeInViewport();
			await expect(page.getByRole("button", { name: /^Approve/ }).last()).toBeInViewport();
			await expectNoHorizontalScroll(page);
		} finally {
			await context.close();
		}
	});
});
