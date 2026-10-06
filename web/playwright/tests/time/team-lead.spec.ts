import { expect, test } from "@playwright/test";
import {
	gotoTime,
	persona,
	personaPage,
	personaState,
	shouldSkip,
	sheet,
	sheetWeek,
	sidebarTimeLink,
	TIME_E2E_SKIP_REASON,
	team,
	tickAcknowledgements,
} from "./timePersonas";

/**
 * P4 Team lead, Business team override (ux.md › Personas, Approvals; plan › Phase C): the
 * badge, the review grid, return with a note, the member fixes and resubmits, bulk approve,
 * reopen with a note.
 *
 * Seed: Lito Garcia owns "QA Delivery Team <run>" (team override, approver_scope team) and
 * "[QA] Acme Website"; he cannot open "[QA] Internal Ops". Waiting for him: Mia's w-3
 * (memberWaiting), Mia's w-2 with Internal Ops hours (memberWaitingRedacted) and Nico's w-1 with a
 * 10h 30m entry (member2Flagged, never bulk-approvable). Mia's w-4 is approved (memberApproved).
 * member2Flagged is left Submitted for mobile.spec.ts.
 */
test.describe("Team lead (P4)", () => {
	test.skip(shouldSkip("lead", "member", "member2"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("lead") });
	test.describe.configure({ mode: "serial" });

	test("sees the Waiting badge in the sidebar and the Waiting for you section", async ({
		page,
	}) => {
		await gotoTime(page);
		// SidebarNavLink badge (W0-C): screen readers get "N timesheets waiting".
		// The badge is part of the link's name ("Time 3 timesheets waiting"): the count is visible and
		// its sr-only label reads it out.
		await expect(sidebarTimeLink(page)).toBeVisible();
		await expect(sidebarTimeLink(page)).toHaveAccessibleName(
			/^Time\b.*\b\d+ timesheets? waiting$/,
		);
		const waiting = page.getByTestId("waiting-for-you");
		await expect(waiting).toBeVisible();
		await expect(page.getByText(/Waiting for you \(\d+\)/).first()).toBeVisible();
		// Rows are grouped per person (ux.md › Bulk approve: the per-member grouping); a grouped row
		// names the person only in its checkbox label, so match rows by that.
		const rowsOf = (name: string) =>
			waiting.getByTestId("waiting-row").filter({
				has: page.getByRole("checkbox", { name: `Select ${name}'s timesheet,` }),
			});
		await expect(rowsOf(persona("member").displayName)).toHaveCount(2);
		// Flagged sheets can't be selected (ux.md › Bulk approve).
		const flagged = rowsOf(persona("member2").displayName);
		await expect(flagged.getByRole("checkbox")).toBeDisabled();
		await expect(flagged).toContainText(/Has flags|⚠/);
	});

	test("opens the review grid, with the project he can't open merged", async ({
		page,
	}) => {
		const member = persona("member");
		await page.goto(`/time/timesheets/${sheet("memberWaitingRedacted").id}`);
		await expect(page.getByText(member.displayName).first()).toBeVisible();
		await expect(page.getByText(team("delivery").name).first()).toBeVisible();
		// L21: hours on a project the reader can't open merge into one row; titles and notes are hidden.
		await expect(page.getByText("Projects you can't open").first()).toBeVisible();
		await expect(page.getByText(/Internal Ops/)).toHaveCount(0);
		await expect(page.getByText("Interview loop")).toHaveCount(0);
	});

	test("returns it with a note", async ({ page }) => {
		const first = persona("member").firstName;
		await page.goto(`/time/timesheets/${sheet("memberWaitingRedacted").id}`);
		await page.getByRole("button", { name: /^Return/ }).first().click();
		const dialog = page.getByRole("dialog");
		const note = dialog.getByPlaceholder(`What should ${first} change?`);
		// The note is required: the button stays disabled until there is one.
		await expect(dialog.getByRole("button", { name: `Return to ${first}` })).toBeDisabled();
		await note.fill("Split Thursday");
		await dialog.getByRole("button", { name: `Return to ${first}` }).click();
		await expect(page.getByText(`Returned to ${first}`)).toBeVisible();
	});

	test("the member fixes it and resubmits", async ({ browser, baseURL }) => {
		const { context, page } = await personaPage(browser, "member", baseURL);
		try {
			await gotoTime(page, `?week=${sheetWeek("memberWaitingRedacted")}`);
			const card = page.getByTestId("timesheet-card").first();
			await expect(card.getByTestId("timesheet-card-status")).toContainText("Returned");
			await expect(card).toContainText("Split Thursday");
			await card.getByRole("button", { name: /^Fix\b/ }).click();
			await card.getByRole("button", { name: /^Resubmit\b/ }).click();
			const dialog = page.getByRole("dialog");
			await tickAcknowledgements(dialog);
			await dialog.getByRole("button", { name: /^(Resubmit|Submit)\b/ }).click();
			await expect(page.getByText(/^Sent to .+ for approval\.$/)).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("bulk approves the two clean sheets", async ({ page }) => {
		await gotoTime(page);
		const waiting = page.getByTestId("waiting-for-you");
		for (const alias of ["memberWaiting", "memberWaitingRedacted"]) {
			// SELECTOR: a row's checkbox; rows link to /time/timesheets/<id>.
			const row = waiting.getByTestId("waiting-row").filter({
				has: page.locator(`a[href*="${sheet(alias).id}"]`),
			});
			await row.getByRole("checkbox").check();
		}
		// The list header's button reads "Approve selected (2)"; the floating bar repeats it.
		await waiting.getByRole("button", { name: /^Approve selected/ }).first().click();
		const dialog = page.getByRole("dialog", { name: "Approve 2 timesheets" });
		await dialog.getByRole("button", { name: "Approve", exact: true }).click();
		await expect(page.getByText("Approved 2 timesheets")).toBeVisible();
	});

	test("reopens an approved sheet with a required note", async ({ page }) => {
		const first = persona("member").firstName;
		await page.goto(`/time/timesheets/${sheet("memberApproved").id}`);
		await page.getByRole("button", { name: /^Reopen\b/ }).click();
		const dialog = page.getByRole("dialog");
		const confirm = dialog.getByRole("button", { name: /^Reopen\b/ });
		await expect(confirm).toBeDisabled();
		await dialog.getByRole("textbox").fill("Thursday needs a task name");
		await confirm.click();
		await expect(page.getByText(`Reopened. ${first} can edit again.`)).toBeVisible();
		// A decider reopen sends the sheet to Returned (ux.md › Reopen).
		await expect(page.getByText("Returned").first()).toBeVisible();
	});
});
