/* @vitest-environment jsdom */

/**
 * The second hop of the ux.md › Routes and Redirects map: the slugged team
 * time stubs send old links on to `/time`, the review screen or the Report.
 * (The first hop, bare `/teams/:t/time/**` → `/w/<slug>/…`, is in
 * `routes/_execution/workspaceRedirectStubs.test.ts`.)
 *
 * | Old                                  | New                                              |
 * |--------------------------------------|--------------------------------------------------|
 * | `…/time` (index), member             | `/time?for=team:<t>`                             |
 * | `…/time` (index), manager / neither  | renders (Report / refusal card)                  |
 * | `…/time/my-logs[?member&preset…]`    | `/time?for=team:<t>` (old params dropped)        |
 * | `…/time/my-logs?log=X`               | `/time?for=team:<t>&entry=X`                     |
 * | `…/time/team-logs?log=X`             | `/time/timesheets/<sheet>?entry=X`, else `/time?entry=X` |
 * | `…/time/team-logs?member=U`          | `/w/<s>/teams/<t>/time?person=U`                 |
 * | `…/time/team-logs`, decider          | `/time#waiting`                                  |
 * | `…/time/team-logs`, others           | `/time`                                          |
 * | `…/time/log/:id`                     | `/time?entry=:id`                                |
 */

import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMember } from "@/services/teams.service";
import { TimeApiError, timeService } from "@/services/time.service";

const mocks = vi.hoisted(() => ({
	getTeam: vi.fn(),
	listTeamMembers: vi.fn(),
	auth: {
		isAuthenticated: true,
		user: { id: "11111111-1111-4111-8111-111111111111" } as {
			id: string;
		} | null,
	},
}));

vi.mock("@/services/teams.service", () => ({
	getTeam: mocks.getTeam,
	listTeamMembers: mocks.listTeamMembers,
}));
vi.mock("@/stores/authStore", () => ({
	useAuthStore: Object.assign(() => mocks.auth, {
		getState: () => mocks.auth,
	}),
	useUser: () => mocks.auth.user,
}));

import { Route as IndexRoute } from "./index";
import { Route as LogRoute } from "./log/$logId";
import { Route as MyLogsRoute } from "./my-logs";
import { Route as TeamLogsRoute } from "./team-logs";

const ME = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const SHEET = "44444444-4444-4444-8444-444444444444";
const MEMBER = "55555555-5555-4555-8555-555555555555";
const PARAMS = { workspaceSlug: "acme", teamId: TEAM };

type RedirectOptions = {
	to?: string;
	params?: unknown;
	search?: unknown;
	hash?: unknown;
	replace?: boolean;
};

type RouteLike = {
	options: { beforeLoad?: unknown; validateSearch?: unknown };
};

let client: QueryClient;

function newClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
	});
}

/** Runs a stub as the router would: validate the raw search, then beforeLoad. */
function load(
	route: RouteLike,
	{
		params = PARAMS as Record<string, string>,
		search = {} as Record<string, unknown>,
	} = {},
): Promise<unknown> {
	const validate = route.options.validateSearch as
		| ((raw: Record<string, unknown>) => Record<string, unknown>)
		| undefined;
	const beforeLoad = route.options.beforeLoad as (args: {
		params: Record<string, string>;
		search: Record<string, unknown>;
		context: { queryClient: QueryClient };
		location: { href: string; pathname: string };
	}) => unknown;
	return Promise.resolve().then(() =>
		beforeLoad({
			params,
			search: validate ? validate(search) : search,
			context: { queryClient: client },
			location: { href: "/w/acme", pathname: "/w/acme" },
		}),
	);
}

async function redirectOf(promise: Promise<unknown>): Promise<RedirectOptions> {
	try {
		await promise;
	} catch (err) {
		if (isRedirect(err)) return (err as { options: RedirectOptions }).options;
		throw err;
	}
	throw new Error("expected a redirect");
}

function member(userId: string, role: TeamMember["role"]): TeamMember {
	return {
		id: `m-${userId}`,
		team_id: TEAM,
		user_id: userId,
		role,
		position: null,
		joined_at: "2026-09-01T00:00:00.000Z",
	};
}

function notFound() {
	return new TimeApiError({
		status: 404,
		code: "TIME_NOT_FOUND",
		message: "Not found",
	});
}

beforeEach(() => {
	client = newClient();
	mocks.auth.isAuthenticated = true;
	mocks.auth.user = { id: ME };
	mocks.getTeam.mockReset().mockResolvedValue({
		id: TEAM,
		owner_id: "someone-else",
		name: "Delivery",
	});
	mocks.listTeamMembers.mockReset().mockResolvedValue([member(ME, "member")]);
});

afterEach(() => {
	client.clear();
	vi.restoreAllMocks();
});

describe("…/time (the team Report index)", () => {
	it("sends a member who doesn't manage the team to their own time for it", async () => {
		const options = await redirectOf(load(IndexRoute));
		expect(options).toMatchObject({
			to: "/time",
			search: { for: `team:${TEAM}` },
			replace: true,
		});
	});

	it.each([
		["an admin member", [member(ME, "admin")], "someone-else"],
		["an owner member", [member(ME, "owner")], "someone-else"],
		["the team owner", [], ME],
	])("renders the Report in place for %s", async (_who, members, ownerId) => {
		mocks.listTeamMembers.mockResolvedValue(members);
		mocks.getTeam.mockResolvedValue({ id: TEAM, owner_id: ownerId });
		await expect(load(IndexRoute)).resolves.toBeUndefined();
	});

	it("renders (the layout's refusal card) for someone with no standing on the team", async () => {
		mocks.listTeamMembers.mockResolvedValue([member(MEMBER, "member")]);
		await expect(load(IndexRoute)).resolves.toBeUndefined();
	});

	it("decides nothing when the team can't be read, so the layout can say why", async () => {
		mocks.getTeam.mockRejectedValue(new Error("403"));
		await expect(load(IndexRoute)).resolves.toBeUndefined();
	});

	it("reads the team under the keys the layout renders from", async () => {
		await redirectOf(load(IndexRoute));
		expect(client.getQueryData(["team", TEAM])).toBeTruthy();
		expect(client.getQueryData(["team", TEAM, "members"])).toBeTruthy();
	});

	it("keeps the Report's filters from the URL (person, from/to, group)", () => {
		const validate = IndexRoute.options.validateSearch as (
			raw: Record<string, unknown>,
		) => unknown;
		expect(
			validate({
				person: MEMBER,
				from: "2026-09-01",
				to: "2026-09-30",
				group: "week",
				member: "old",
			}),
		).toEqual({
			person: MEMBER,
			from: "2026-09-01",
			to: "2026-09-30",
			group: "week",
		});
	});
});

describe("…/time/my-logs", () => {
	it("goes to /time for the team and drops ?member and the old period", async () => {
		const options = await redirectOf(
			load(MyLogsRoute, {
				search: { member: "x", preset: "week", from: "2026-09-01" },
			}),
		);
		expect(options).toMatchObject({ to: "/time", replace: true });
		expect(options.search).toEqual({ for: `team:${TEAM}` });
	});

	it("keeps ?log=X as the entry to open", async () => {
		const options = await redirectOf(
			load(MyLogsRoute, { search: { log: ENTRY } }),
		);
		expect(options.search).toEqual({ for: `team:${TEAM}`, entry: ENTRY });
	});

	it("still lands on /time when the team id is not a uuid", async () => {
		const options = await redirectOf(
			load(MyLogsRoute, {
				params: { workspaceSlug: "acme", teamId: "not-a-team" },
				search: { log: ENTRY },
			}),
		);
		expect(options).toMatchObject({ to: "/time", search: { entry: ENTRY } });
		expect((options.search as Record<string, unknown>).for).toBeUndefined();
	});
});

describe("…/time/log/:id", () => {
	it("goes to /time?entry=:id", async () => {
		const options = await redirectOf(
			load(LogRoute, { params: { ...PARAMS, logId: ENTRY } }),
		);
		expect(options).toMatchObject({
			to: "/time",
			search: { entry: ENTRY },
			replace: true,
		});
	});
});

describe("…/time/team-logs?log=X", () => {
	it("opens the sheet holding X, with X open, when the caller can view the sheet", async () => {
		const getEntry = vi.spyOn(timeService, "getEntry").mockResolvedValue({
			id: ENTRY,
			timesheet_id: SHEET,
		} as never);
		const getTimesheet = vi
			.spyOn(timeService, "getTimesheet")
			.mockResolvedValue({ timesheet: { id: SHEET } } as never);

		const options = await redirectOf(
			load(TeamLogsRoute, { search: { log: ENTRY } }),
		);

		expect(getEntry).toHaveBeenCalledWith(ENTRY);
		expect(getTimesheet).toHaveBeenCalledWith(SHEET);
		expect(options).toMatchObject({
			to: "/time/timesheets/$timesheetId",
			params: { timesheetId: SHEET },
			search: { entry: ENTRY },
			replace: true,
		});
	});

	it("goes to /time?entry=X when the sheet doesn't open for the caller (D49)", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue({
			id: ENTRY,
			timesheet_id: SHEET,
		} as never);
		vi.spyOn(timeService, "getTimesheet").mockRejectedValue(notFound());

		const options = await redirectOf(
			load(TeamLogsRoute, { search: { log: ENTRY } }),
		);
		expect(options).toMatchObject({ to: "/time", search: { entry: ENTRY } });
	});

	it("goes to /time?entry=X (the 404 card) when the entry can't be read", async () => {
		vi.spyOn(timeService, "getEntry").mockRejectedValue(notFound());
		const getTimesheet = vi.spyOn(timeService, "getTimesheet");

		const options = await redirectOf(
			load(TeamLogsRoute, { search: { log: ENTRY } }),
		);
		expect(options).toMatchObject({ to: "/time", search: { entry: ENTRY } });
		expect(getTimesheet).not.toHaveBeenCalled();
	});

	it("goes to /time?entry=X for an entry on no sheet", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue({
			id: ENTRY,
			timesheet_id: null,
			timesheet: null,
		} as never);
		const getTimesheet = vi.spyOn(timeService, "getTimesheet");

		const options = await redirectOf(
			load(TeamLogsRoute, { search: { log: ENTRY } }),
		);
		expect(options).toMatchObject({ to: "/time", search: { entry: ENTRY } });
		expect(getTimesheet).not.toHaveBeenCalled();
	});

	it("asks nothing for an id that isn't a uuid", async () => {
		const getEntry = vi.spyOn(timeService, "getEntry");
		const options = await redirectOf(
			load(TeamLogsRoute, { search: { log: "abc-123" } }),
		);
		expect(options).toMatchObject({
			to: "/time",
			search: { entry: "abc-123" },
		});
		expect(getEntry).not.toHaveBeenCalled();
	});

	it("puts the review screen's sheet in the cache it reads", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue({
			id: ENTRY,
			timesheet_id: SHEET,
		} as never);
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			timesheet: { id: SHEET },
		} as never);
		await redirectOf(load(TeamLogsRoute, { search: { log: ENTRY } }));
		expect(client.getQueryData(["time", "timesheet", SHEET])).toEqual({
			timesheet: { id: SHEET },
		});
	});
});

describe("…/time/team-logs?member=U", () => {
	it("opens the Report filtered to that person", async () => {
		const options = await redirectOf(
			load(TeamLogsRoute, { search: { member: MEMBER, preset: "week" } }),
		);
		expect(options).toMatchObject({
			to: "/w/$workspaceSlug/teams/$teamId/time",
			params: PARAMS,
			search: { person: MEMBER },
			replace: true,
		});
	});

	it("drops a person id that isn't a uuid", async () => {
		const options = await redirectOf(
			load(TeamLogsRoute, { search: { member: "nobody" } }),
		);
		expect(options).toMatchObject({
			to: "/w/$workspaceSlug/teams/$teamId/time",
			search: {},
		});
	});
});

describe("…/time/team-logs (no params: the stored approval links)", () => {
	it("sends a decider with timesheets waiting to /time#waiting", async () => {
		vi.spyOn(timeService, "getApprovalsCount").mockResolvedValue({
			waiting: 3,
		});
		const options = await redirectOf(load(TeamLogsRoute));
		expect(options).toMatchObject({
			to: "/time",
			hash: "waiting",
			replace: true,
		});
	});

	it("sends anyone else to /time", async () => {
		vi.spyOn(timeService, "getApprovalsCount").mockResolvedValue({
			waiting: 0,
		});
		const options = await redirectOf(load(TeamLogsRoute));
		expect(options).toMatchObject({ to: "/time", replace: true });
		expect(options.hash).toBeUndefined();
	});

	it("sends the caller to /time when the count can't be read", async () => {
		vi.spyOn(timeService, "getApprovalsCount").mockRejectedValue(
			new Error("down"),
		);
		const options = await redirectOf(load(TeamLogsRoute));
		expect(options).toMatchObject({ to: "/time" });
		expect(options.hash).toBeUndefined();
	});

	it("treats the old period-only params as no params", async () => {
		vi.spyOn(timeService, "getApprovalsCount").mockResolvedValue({
			waiting: 1,
		});
		const options = await redirectOf(
			load(TeamLogsRoute, { search: { preset: "week", status: "pending" } }),
		);
		expect(options).toMatchObject({ to: "/time", hash: "waiting" });
	});
});
