import { expect, test } from "@playwright/test";
import {
	chipLabel,
	gotoTime,
	personaState,
	project,
	seed,
	shouldSkip,
	sheetWeek,
	TIME_E2E_SKIP_REASON,
	team,
	tickAcknowledgements,
} from "./timePersonas";

/**
 * P3 Team member who logs (ux.md › Personas; plan › Phase C): a read-only For chip,
 * a back-dated manual entry, submit ("Goes to …"), entries lock, withdraw.
 *
 * Seed: Mia Santos is on "QA Delivery Team <run>" in the Business workspace, whose team override
 * routes team sheets to the team's owners and admins (Lito Garcia). She is curated on
 * "[QA] Acme Website" (one option: the team) and "[QA] Internal Ops". Her weeks: w-4 approved,
 * w-3 and w-2 submitted, w-1 open (overdue), w0 open.
 *
 * Only her w-1 sheet (memberLastWeek) changes here; team-lead.spec.ts acts on her other weeks, so
 * the two files can run in either order.
 */
test.describe("Team member (P3)", () => {
	test.skip(shouldSkip("member", "lead"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("member") });
	test.describe.configure({ mode: "serial" });

	test("sees the team as a read-only For chip", async ({ page }) => {
		const delivery = team("delivery");
		await gotoTime(page, `?project=${project("web").id}`);
		// One option: the chip is read-only, "Only option on this project" (ux.md › For chip).
		// SELECTOR: W0-D ForChip renders the label (22 characters + "…").
		const chip = page.getByRole("button", { name: new RegExp(escapeRegExp(chipLabel(delivery.name).replace(/…$/, ""))) }).first();
		await expect(chip).toBeVisible();
		await chip.click();
		await expect(page.getByText("Who approves this time")).toBeVisible();
		await expect(
			page.getByText(`Goes to: ${delivery.name}'s owners and admins`),
		).toBeVisible();
	});

	test("adds a back-dated manual entry through More options", async ({
		page,
	}) => {
		const web = project("web");
		// The open last week, so the entry lands on an Open sheet (w-1 Friday, which the seed left empty).
		const day = seed().weeks["w-1"];
		await gotoTime(page, `?week=${day}`);
		// W1-2 QuickAddBar "More options →" opens ManualEntryModal ("Add time"). Its Project and
		// "Task or preset" controls are the shared Dropdown (a button + listbox); Start and End are
		// DateTimeField (a calendar button "<Start|End> date" + a typeable "<Start|End> time").
		await page
			.getByRole("region", { name: "Quick add" })
			.getByRole("button", { name: /More options/ })
			.click();
		const dialog = page.getByRole("dialog", { name: "Add time" });
		await dialog.getByRole("button", { name: "Project", exact: true }).click();
		await page.getByRole("option", { name: web.title }).click();
		await dialog.getByRole("button", { name: "Task or preset", exact: true }).click();
		await page.getByRole("option", { name: web.tasks[0].title }).click();
		const friday = addDays(day, 4);
		for (const edge of ["Start", "End"] as const) {
			await dialog.getByRole("button", { name: `${edge} date` }).click();
			await page.getByRole("button", { name: calendarDayName(friday), exact: true }).click();
		}
		for (const [edge, time] of [
			["Start", "10:00"],
			["End", "11:30"],
		] as const) {
			const field = dialog.getByRole("textbox", { name: `${edge} time` });
			await field.fill(time);
			await field.press("Enter");
		}
		await expect(dialog.getByText("1h 30m added")).toBeVisible();
		await dialog.getByRole("button", { name: /^Add (time|for)\b/ }).click();
		await expect(dialog).toHaveCount(0);
		// The view week is w-1, so Friday's new row shows: in 10:00, out 11:30, 1:30.
		await expect(
			page
				.getByRole("row")
				.filter({ hasText: web.tasks[0].title })
				.filter({ hasText: "10:00" })
				.filter({ hasText: "11:30" })
				.first(),
		).toBeVisible();
	});

	test("submits last week: Goes to the team, then the rows lock", async ({
		page,
	}) => {
		const delivery = team("delivery");
		await gotoTime(page, `?week=${sheetWeek("memberLastWeek")}`);
		const card = page
			.getByTestId("timesheet-card")
			.filter({ hasText: delivery.name.slice(0, 12) })
			.first();
		await card.getByRole("button", { name: /^Submit\b/ }).click();
		const dialog = page.getByRole("dialog");
		// ux.md › Submit flow: approver_scope `team`.
		await expect(dialog.getByTestId("submit-goes-to")).toContainText(
			`Goes to ${delivery.name}'s owners and admins`,
		);
		await tickAcknowledgements(dialog);
		await dialog.getByRole("button", { name: /^Submit\b/ }).click();
		// ux.md › Copy toast table: "Sent to <approver> for approval.". The build names the approver the
		// way the Goes-to line does ("<team>'s owners and admins", lib/timeFormat goesToTarget, unit
		// tested); ux.md:406's example shortens it to the team name, so accept both.
		await expect(
			page.getByText(
				new RegExp(
					`^Sent to ${escapeRegExp(delivery.name)}(?:'s owners and admins)? for approval\\.$`,
				),
			),
		).toBeVisible();
		await expect(card.getByTestId("timesheet-card-status")).toContainText(
			"Submitted",
		);
		// Locked rows keep only "View details" and "Comment" in ⋯ (ux.md › Submit, Return, Reopen).
		// The ⋯ trigger is "Entry actions" (RowActionsMenu); its items are plain buttons in a portal.
		// A locked row has no hover quick actions either, so no Edit or Delete button exists at all.
		const row = page.getByRole("row").filter({ hasText: project("web").tasks[0].title }).first();
		await expect(row.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
		await row.getByRole("button", { name: "Entry actions" }).click();
		await expect(page.getByRole("button", { name: "View details", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Comment", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
		await page.keyboard.press("Escape");
	});

	test("withdraws it and can edit again", async ({ page }) => {
		const delivery = team("delivery");
		await gotoTime(page, `?week=${sheetWeek("memberLastWeek")}`);
		const card = page
			.getByTestId("timesheet-card")
			.filter({ hasText: delivery.name.slice(0, 12) })
			.first();
		await card.getByRole("button", { name: /^Withdraw\b/ }).click();
		const confirm = page.getByRole("dialog");
		if (await confirm.isVisible().catch(() => false)) {
			await confirm.getByRole("button", { name: /^Withdraw\b/ }).click();
		}
		await expect(page.getByText("Withdrawn. You can edit again.")).toBeVisible();
		await expect(card.getByTestId("timesheet-card-status")).toContainText("Open");
	});
});

function addDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

/** DateTimeField's calendar day buttons are named "October 2, 2026" (date-fns "MMMM d, yyyy"). */
function calendarDayName(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
