import { expect, test } from "@playwright/test";
import {
	gotoTime,
	persona,
	personaPage,
	personaState,
	project,
	seed,
	shouldSkip,
	startTimerOn,
	sheet,
	stopTimer,
	TIME_E2E_SKIP_REASON,
} from "./timePersonas";

/**
 * P5 Consultant who approves talent and P6 Talent on an agreement (ux.md › Personas,
 * Project Surfaces › Engagement page; plan › Phase C): assign talent (W1-13), the talent logs on
 * the agreement, the consultant approves in approver mode.
 *
 * Seed: Cora Villanueva (verified consultant) hires Theo Ramos on a talent agreement and serves
 * Cleo Aquino on a client agreement linked to "[QA] Acme Corp Rebrand". Theo is placed on the
 * Rebrand project from 40 days ago: w-2 approved by Cora (talentApproved), w-1 waiting
 * (talentWaiting). "[QA] Acme Corp Mobile App" has no assignment yet. Cora logs nothing, so she
 * gets approver mode (L36).
 */
test.describe("Consultant and talent (P5, P6)", () => {
	test.skip(shouldSkip("consultant", "talent"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("consultant") });
	test.describe.configure({ mode: "serial" });

	test("lands in approver mode with the talent's sheet waiting", async ({
		page,
	}) => {
		await gotoTime(page);
		// Approver mode: the timer bar collapses to one Start timer button; no day strip, no list.
		await expect(page.getByRole("button", { name: "Start timer" })).toHaveCount(1);
		await expect(page.getByTestId("day-total")).toHaveCount(0);
		const waiting = page.getByTestId("waiting-for-you");
		await expect(
			waiting.getByTestId("waiting-row").filter({ hasText: persona("talent").displayName }),
		).toHaveCount(1);
		// Decided in the last 30 days: the w-2 sheet she approved while seeding.
		await expect(
			page.getByTestId("decided-row").filter({ hasText: persona("talent").displayName }).first(),
		).toContainText(/Approved by you/);
	});

	test("assigns the talent to the Mobile App project from the engagement page (W1-13)", async ({
		page,
	}) => {
		const mobile = project("mobile");
		const talentEngagement = seed().engagements.talent;
		test.skip(!talentEngagement, "the talent engagement was not seeded");
		await page.goto(`/engagements/${talentEngagement}`);
		await page.getByRole("button", { name: "Assign to project" }).click();
		const dialog = page.getByRole("dialog", { name: "Assign to project" });
		// W1-13's project picker is the shared Dropdown: a button named "Project" that opens a listbox.
		await dialog.getByRole("button", { name: "Project", exact: true }).click();
		await page.getByRole("option", { name: mobile.title }).click();
		await dialog.getByRole("button", { name: "Assign", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		// The new assignment row links the project (ux.md › Engagement page).
		await expect(
			page.getByRole("listitem").filter({ hasText: mobile.title }).first(),
		).toBeVisible();
		// "End assignment" warns about a running timer (L37) without ending anything here.
		await expect(page.getByRole("button", { name: /End assignment/ }).first()).toBeVisible();
	});

	test("the talent logs on the agreement chip", async ({ browser, baseURL }) => {
		const mobile = project("mobile");
		const { context, page } = await personaPage(browser, "talent", baseURL);
		try {
			await gotoTime(page, `?project=${mobile.id}`);
			// One option (the agreement), so Start goes straight on (ux.md › For chip).
			await startTimerOn(page, { task: mobile.tasks[0].title, project: mobile.title });
			const bar = page.getByRole("region", { name: "Timer running" });
			await expect(bar).toContainText(mobile.tasks[0].title);
			// Agreement chip: Briefcase + counterparty (ux.md › Chip details), never "contract".
			const consultantName = persona("consultant").displayName;
			const studio = seed().teams.studio?.name ?? consultantName;
			await expect(bar).toContainText(
				new RegExp(`${escapeRegExp(consultantName.slice(0, 12))}|${escapeRegExp(studio.slice(0, 12))}`),
			);
			await expect(bar).not.toContainText(/contract/i);
			await stopTimer(page, bar);
		} finally {
			await context.close();
		}
	});

	test("approves the waiting talent sheet from approver mode", async ({
		page,
	}) => {
		await page.goto(`/time/timesheets/${sheet("talentWaiting").id}`);
		await expect(page.getByText(persona("talent").displayName).first()).toBeVisible();
		// Agreement rules line, web only: "Rules from your agreement with … · [View terms →]".
		await expect(page.getByRole("link", { name: /View terms/ }).first()).toBeVisible();
		await page.getByRole("button", { name: /^Approve/ }).first().click();
		await page.getByRole("dialog").getByRole("button", { name: /^Approve\b/ }).click();
		// "Approved · 38:15 frozen": the seeded week is 3 × 5h.
		await expect(page.getByText(/^Approved · 15:00 frozen$/)).toBeVisible();
	});
});

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
