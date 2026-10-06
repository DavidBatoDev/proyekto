import { expect, test } from "@playwright/test";
import {
	personaState,
	project,
	shouldSkip,
	sidebarTimeLink,
	TIME_E2E_SKIP_REASON,
} from "./timePersonas";

/**
 * P10 Internal viewer (ux.md › Personas, For chip › Why? reasons; plan › Phase C): no ▶ buttons,
 * and the inline reason says why.
 *
 * Seed: Vince Tan has a seat in the Business workspace and viewer access on "[QA] Acme Website".
 * Viewers lose logging (L1), so the resolver gives him no option there and nowhere else.
 */
test.describe("Viewer (P10)", () => {
	test.skip(shouldSkip("viewer"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("viewer") });

	test("has no Time item in the sidebar", async ({ page }) => {
		await page.goto("/dashboard");
		await expect(page.getByRole("navigation").first()).toBeVisible();
		await expect(sidebarTimeLink(page)).toHaveCount(0);
	});

	test("sees no timer buttons on the project's tasks, and the reason", async ({
		page,
	}) => {
		const web = project("web");
		test.skip(!web.roadmapId, "the web project has no roadmap");
		await page.goto(`/project/${web.id}/roadmap/${web.roadmapId}`);
		await expect(page.getByText(web.tasks[0].title).first()).toBeVisible();
		// TaskTimerButton is not rendered with 0 options (ux.md › For chip).
		await expect(page.getByRole("button", { name: /Start timer/ })).toHaveCount(0);
		// Open a task: TaskTimerInline says "You can't log time on this project" with a Why? popover
		// that gives the reason (ux.md › For chip, 0 options; Why? reasons).
		await page.getByText(web.tasks[0].title).first().click();
		await expect(page.getByText("You can't log time on this project")).toBeVisible();
		await page.getByRole("button", { name: "Why?" }).click();
		await expect(
			page.getByText(
				"You're a viewer on this project. Ask a project admin for editor access to log time.",
			),
		).toBeVisible();
	});

	test("cannot start a timer from /time either", async ({ page }) => {
		await page.goto(`/time?project=${project("web").id}`);
		await expect(page.getByTestId("timer-clock")).toHaveCount(0);
		// No project where he can log, so the picker offers none.
		const start = page.getByRole("button", { name: "Start timer" });
		if ((await start.count()) > 0) {
			await start.first().click();
			await expect(page.getByRole("option", { name: project("web").tasks[0].title })).toHaveCount(0);
		}
	});
});
