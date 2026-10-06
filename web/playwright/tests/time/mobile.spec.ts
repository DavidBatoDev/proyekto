import { expect, test } from "@playwright/test";
import {
	expectNoHorizontalScroll,
	gotoTime,
	hideDevOverlays,
	personaPage,
	personaState,
	pickTask,
	project,
	shouldSkip,
	sheet,
	stopTimer,
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
	// The dev server's TanStack Devtools trigger covers the FAB's corner at 390 px.
	test.beforeEach(async ({ page }) => {
		await hideDevOverlays(page);
	});

	test("/time has no horizontal scroll", async ({ page }) => {
		await gotoTime(page);
		await expectNoHorizontalScroll(page);
	});

	test("the FAB offers Start timer and Add time", async ({ page }) => {
		await gotoTime(page);
		// ux.md › As Built › The Time page › Phones: Start timer and Add time move to a FAB ("Track time").
		await page.getByRole("button", { name: "Track time" }).click();
		await expect(page.getByRole("menuitem", { name: "Start timer" })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Add time" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("menuitem", { name: "Start timer" })).toHaveCount(0);
	});

	test("a running timer stays on screen while scrolling, and /time has no floating timer", async ({
		page,
	}) => {
		const web = project("web");
		await gotoTime(page, `?project=${web.id}`);
		// Phones: Start timer lives in the FAB menu, then the same TaskPickerModal as on desktop.
		await page.getByRole("button", { name: "Track time" }).click();
		await page.getByRole("menuitem", { name: "Start timer" }).click();
		const picker = await pickTask(page, {
			title: "Start timer",
			task: web.tasks[0].title,
			project: web.title,
		});
		await picker.getByRole("button", { name: /^Start\b/ }).click();
		await expect(picker).toHaveCount(0);
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
		await stopTimer(page);
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
