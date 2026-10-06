import { expect, test } from "@playwright/test";
import {
	AMOUNT_PATTERN,
	persona,
	personaState,
	project,
	seed,
	shouldSkip,
	sheet,
	sidebarTimeLink,
	TIME_E2E_SKIP_REASON,
} from "./timePersonas";

/**
 * P8 Client party (ux.md › Personas, Reports › Client hours; plan › Phase C): Client hours only,
 * rows read "Delivery team", no cost, and a talent sheet URL is a 404 card.
 *
 * Seed: Cleo Aquino is the hirer on the client agreement (client hours level `summary`) and a
 * viewer on "[QA] Acme Corp Rebrand". Theo's w-2 (3 × 6h) is approved, so it shows as client
 * hours; his w-1 is still waiting and must not.
 */
test.describe("Client (P8)", () => {
	test.skip(shouldSkip("client", "talent"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("client") });

	test("has no Time item in the sidebar (she logs nowhere)", async ({ page }) => {
		await page.goto("/dashboard");
		await expect(page.getByRole("navigation").first()).toBeVisible();
		await expect(sidebarTimeLink(page)).toHaveCount(0);
	});

	test("sees approved hours as Delivery team, with no identity and no cost", async ({
		page,
	}) => {
		const rebrand = project("rebrand");
		await page.goto(`/project/${rebrand.id}/time?view=client`);
		await expect(page.getByText("Delivery team").first()).toBeVisible();
		// Summary level: hours by week per agreement; 18:00 approved, the waiting week absent.
		await expect(page.getByText("18:00").first()).toBeVisible();
		const body = page.locator("main");
		await expect(body).not.toContainText(persona("talent").displayName);
		await expect(body).not.toContainText(AMOUNT_PATTERN);
		// No Everyone tab for a client (L22).
		await expect(page.getByRole("tab", { name: "Everyone" })).toHaveCount(0);
	});

	test("a talent timesheet URL is a 404 card", async ({ page }) => {
		await page.goto(`/time/timesheets/${sheet("talentWaiting").id}`);
		await expect(
			page.getByText("This timesheet doesn't exist or you can't open it."),
		).toBeVisible();
		await expect(page.locator("main")).not.toContainText(persona("talent").displayName);
	});

	test("a talent entry URL is a 404 card", async ({ page }) => {
		const entryId = seed().entries.talent?.[0];
		test.skip(!entryId, "no talent entry was seeded");
		await page.goto(`/time?entry=${entryId}`);
		await expect(
			page.getByText("This time entry doesn't exist or you can't open it."),
		).toBeVisible();
	});
});
