import { expect, test } from "@playwright/test";
import {
	findSheet,
	gotoTime,
	personaState,
	shouldSkip,
	sheet,
	sheetWeek,
	TIME_E2E_SKIP_REASON,
	tickAcknowledgements,
	workspace,
} from "./timePersonas";

/**
 * P2 Small Pro owner who logs (ux.md › Personas; plan › Phase C): confirm the policy card,
 * submit early and get self-approval, reopen.
 *
 * Seed: workspace "QA Pro Studio <run>" comped to Pro, one project with no team (workspace
 * context), entries last week (open, overdue) and on this week's past days. The workspace policy
 * row is created by the first entry with updated_by NULL, so it is unconfirmed (ux.md › API
 * Surface: policy_unconfirmed). Pia is the only workspace admin, so her sheets route `self`.
 */
test.describe("Pro owner (P2)", () => {
	test.skip(shouldSkip("pro"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("pro") });
	test.describe.configure({ mode: "serial" });

	/** This week's sheet when the seed had past days for it (not on a Monday), else last week's. */
	const early = () => (findSheet("proThisWeek") ? "proThisWeek" : "proLastWeek");

	test("confirms the policy card with Looks right", async ({ page }) => {
		const ws = workspace("pro");
		await gotoTime(page);
		const card = page.getByTestId("policy-confirm-card");
		await expect(card).toBeVisible();
		// ux.md › One-time cards: "Acme tracks time weekly from Monday in Asia/Manila. [Looks right] [Change]".
		await expect(card).toContainText(
			`${ws.name} tracks time weekly from Monday in Asia/Manila.`,
		);
		// SELECTOR: Change may be a link or a button that navigates.
		await expect(card.getByRole("link", { name: "Change" })).toHaveAttribute(
			"href",
			new RegExp(`/w/${ws.slug}/settings/time`),
		);
		await card.getByRole("button", { name: "Looks right" }).click();
		await expect(card).toHaveCount(0);
		await page.reload();
		await expect(page.getByTestId("policy-confirm-card")).toHaveCount(0);
	});

	test("an open self-routed card says it sends itself", async ({ page }) => {
		await gotoTime(page, `?week=${sheetWeek("proLastWeek")}`);
		const card = page.getByTestId("timesheet-card").first();
		await expect(card).toBeVisible();
		// ux.md › Timesheet cards: a card routed auto or self shows "Open · sends itself <date>"; past the
		// date with no cron run locally it may read "overdue".
		await expect(card.getByTestId("timesheet-card-sublabel")).toContainText(
			/sends itself|overdue/,
		);
	});

	test("submits early and is self-approved", async ({ page }) => {
		await gotoTime(page, `?week=${sheetWeek(early())}`);
		const card = page.getByTestId("timesheet-card").first();
		await card.getByRole("button", { name: /^Submit\b/ }).click();
		const dialog = page.getByRole("dialog");
		// ux.md › Submit flow, the `self` row of "Goes to".
		await expect(dialog.getByTestId("submit-goes-to")).toContainText(
			"You're the only approver here, so this approves itself.",
		);
		await tickAcknowledgements(dialog);
		await dialog.getByRole("button", { name: /^Submit\b/ }).click();
		// Toast for auto/self: "Approved · 38:15".
		await expect(page.getByText(/^Approved · \d+:\d{2}/).first()).toBeVisible();
		await expect(card.getByTestId("timesheet-card-status")).toContainText(
			"Approved",
		);
		await expect(card).toContainText("Self-approved");
	});

	test("reopens the self-approved sheet", async ({ page }) => {
		await page.goto(`/time/timesheets/${sheet(early()).id}`);
		await page.getByRole("button", { name: /^Reopen\b/ }).click();
		const dialog = page.getByRole("dialog");
		// A member's own auto/self reopen: the note is optional and the sheet goes to Open.
		await dialog.getByRole("button", { name: /^Reopen\b/ }).click();
		await expect(page.getByText("Reopened. You can edit again.")).toBeVisible();
		await expect(page.getByText("Reopened by you").first()).toBeVisible();
	});
});
