import { expect, test } from "@playwright/test";
import {
	gotoTime,
	personaState,
	project,
	shouldSkip,
	TIME_E2E_SKIP_REASON,
} from "./timePersonas";

/**
 * P1 Solo Free owner (ux.md › Personas; plan › Phase C): log "Just me", quick add `1:30`,
 * never see a Submit button, see the owner-only Pro notice.
 *
 * Seed: workspace "QA Solo <run>" on Free, project "[QA] Solo Side Project <run>", personal
 * entries last week and on this week's past days. "Just me" has no timesheets.
 */
test.describe("Solo Free owner (P1)", () => {
	test.skip(shouldSkip("solo"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("solo") });
	test.describe.configure({ mode: "serial" });

	test("lands on /time with the timer bar and no timesheet cards", async ({
		page,
	}) => {
		await gotoTime(page);
		await expect(
			page.getByRole("button", { name: "Start timer" }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Add time" }).first(),
		).toBeVisible();
		// "Just me" has no sheets, so no card and never a Submit button.
		await expect(page.getByTestId("timesheet-card")).toHaveCount(0);
		await expect(page.getByRole("button", { name: /^Submit\b/ })).toHaveCount(
			0,
		);
	});

	test("shows the owner-only plan notice once, and it can be dismissed", async ({
		page,
	}) => {
		await gotoTime(page);
		// ux.md P1: one dismissible owner-only PlanLimitNotice. The exact wording is lib/timeErrors'
		// timePlanCopy('time_tracking'): "Timesheets and approvals are part of Pro. Upgrade … to send time for approval."
		const notice = page.getByText(/Timesheets and approvals (are part of|come with) Pro/);
		await expect(notice).toHaveCount(1);
		// No prices on the notice, ever (Plan copy).
		await expect(notice).not.toContainText(/\$|₱|per user|\/month/i);
		// SELECTOR: PlanLimitNotice's dismiss control.
		await page.getByRole("button", { name: /dismiss|close/i }).first().click();
		await expect(notice).toHaveCount(0);
		await page.reload();
		await expect(
			page.getByText(/Timesheets and approvals (are part of|come with) Pro/),
		).toHaveCount(0);
	});

	test("Why? explains that this time is just for them", async ({ page }) => {
		await gotoTime(page, `?project=${project("solo").id}`);
		// SELECTOR: W1-7 WhyPersonalPopover trigger.
		await page.getByRole("button", { name: /Why\?/ }).first().click();
		await expect(
			page.getByText(
				"Your workspace's plan doesn't include timesheets; this time is just for you.",
			),
		).toBeVisible();
	});

	test("quick add 1:30 logs a Just me entry", async ({ page }) => {
		const solo = project("solo");
		await gotoTime(page, `?project=${solo.id}`);
		// Quick add: [Task or preset ▾] [1:30] [Yesterday ▾] [For: Just me] [Add] (ux.md › Quick add).
		// W1-2 QuickAddBar: a "Quick add" region; the work button opens TaskPickerModal.
		const quickAdd = page.getByRole("region", { name: "Quick add" });
		await quickAdd.getByRole("button", { name: /Task or preset/ }).click();
		// SELECTOR: TaskPickerModal's task row.
		await page.getByRole("dialog").getByText(solo.tasks[0].title).first().click();
		await quickAdd.getByLabel("Duration").fill("1:30");
		await expect(quickAdd.getByText("Just me")).toBeVisible();
		await quickAdd.getByRole("button", { name: "Add", exact: true }).click();
		await expect(
			page.getByRole("row").filter({ hasText: solo.tasks[0].title }).filter({
				hasText: "1:30",
			}).first(),
		).toBeVisible();
	});

	test("a timer starts and stops on a task, for Just me", async ({ page }) => {
		const solo = project("solo");
		await gotoTime(page, `?project=${solo.id}`);
		await page.getByRole("button", { name: "Start timer" }).first().click();
		// One option: picked automatically, never asked (ux.md › For chip).
		// SELECTOR: the W0-D start flow's task picker.
		await page.getByRole("option", { name: solo.tasks[1].title }).click();
		await expect(page.getByTestId("timer-clock")).toBeVisible();
		await expect(page.getByText("Just me").first()).toBeVisible();
		await page.getByRole("button", { name: /^Stop\b/ }).first().click();
		await expect(page.getByTestId("timer-clock")).toHaveCount(0);
	});
});
