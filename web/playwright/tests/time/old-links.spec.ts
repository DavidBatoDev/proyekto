import { expect, test } from "@playwright/test";
import {
	persona,
	personaPage,
	personaState,
	project,
	shouldSkip,
	sheet,
	TIME_E2E_SKIP_REASON,
	team,
	workspace,
} from "./timePersonas";

/**
 * Phase C gate 8, old links (ux.md › Routes and Redirects): my-logs?log=, team-logs?log=,
 * time/log/:id, ?view=team, and the bare /teams/:t/time/** shells. Nothing returns 404.
 *
 * Signed in as Mia (member) unless a case needs Lito (the team manager).
 */
test.describe("Old time links redirect (gate 8)", () => {
	test.skip(shouldSkip("member", "lead"), TIME_E2E_SKIP_REASON);
	test.use({ storageState: personaState("member") });

	const teamBase = () =>
		`/w/${workspace("business").slug}/teams/${team("delivery").id}/time`;
	const memberEntry = () => sheet("memberLastWeek").entryIds[0];

	test("my-logs goes to /time for the team", async ({ page }) => {
		await page.goto(`${teamBase()}/my-logs?member=x&preset=week`);
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/time" &&
				url.searchParams.get("for") === `team:${team("delivery").id}` &&
				!url.searchParams.has("member") &&
				!url.searchParams.has("preset"),
		);
	});

	test("my-logs?log=X keeps the entry", async ({ page }) => {
		const entry = memberEntry();
		await page.goto(`${teamBase()}/my-logs?log=${entry}`);
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/time" &&
				url.searchParams.get("for") === `team:${team("delivery").id}` &&
				url.searchParams.get("entry") === entry,
		);
	});

	test("time/log/:id goes to /time?entry=", async ({ page }) => {
		const entry = memberEntry();
		await page.goto(`${teamBase()}/log/${entry}`);
		await expect(page).toHaveURL(
			(url) => url.pathname === "/time" && url.searchParams.get("entry") === entry,
		);
	});

	test("team-logs with no params sends a non-decider to /time", async ({ page }) => {
		await page.goto(`${teamBase()}/team-logs`);
		await expect(page).toHaveURL((url) => url.pathname === "/time" && url.hash !== "#waiting");
	});

	test("the bare /teams/:t/time/my-logs shell forwards too", async ({ page }) => {
		await page.goto(`/teams/${team("delivery").id}/time/my-logs`);
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/time" &&
				url.searchParams.get("for") === `team:${team("delivery").id}`,
		);
	});

	test("?view=mine on the project goes to /time?project=", async ({ page }) => {
		const web = project("web");
		await page.goto(`/project/${web.id}/time?view=mine`);
		await expect(page).toHaveURL(
			(url) => url.pathname === "/time" && url.searchParams.get("project") === web.id,
		);
	});

	test("manager links: team-logs, ?log= on a sheet, ?view=team, and the Report index", async ({
		browser,
		baseURL,
	}) => {
		const { context, page } = await personaPage(browser, "lead", baseURL);
		try {
			// team-logs?log=X → the sheet holding X when the manager can view it.
			const waitingSheet = sheet("memberWaiting");
			await page.goto(`${teamBase()}/team-logs?log=${waitingSheet.entryIds[0]}`);
			await expect(page).toHaveURL(
				(url) => url.pathname === `/time/timesheets/${waitingSheet.id}`,
			);

			// team-logs with no params (the stored approval links) → /time#waiting for a decider.
			await page.goto(`${teamBase()}/team-logs`);
			await expect(page).toHaveURL((url) => url.pathname === "/time" && url.hash === "#waiting");

			// team-logs?member=U → the Report with ?person=U.
			const memberId = persona("member").id;
			await page.goto(`${teamBase()}/team-logs?member=${memberId}`);
			await expect(page).toHaveURL(
				(url) => url.pathname === teamBase() && url.searchParams.get("person") === memberId,
			);

			// ?view=team → ?view=everyone.
			const web = project("web");
			await page.goto(`/project/${web.id}/time?view=team`);
			await expect(page).toHaveURL(
				(url) => url.pathname === `/project/${web.id}/time` && url.searchParams.get("view") === "everyone",
			);

			// The team Time index renders the Report in place for a manager (no redirect).
			await page.goto(teamBase());
			await expect(page).toHaveURL((url) => url.pathname === teamBase());
			await expect(page.getByText("Report").first()).toBeVisible();
		} finally {
			await context.close();
		}
	});
});
