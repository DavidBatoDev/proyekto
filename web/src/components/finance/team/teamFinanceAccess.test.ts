import { describe, expect, it, vi } from "vitest";

// `useManagedTeams` pulls in the API client; only its pure predicate is used.
vi.mock("@/services/financeBooks.service", () => ({ financeBooksService: {} }));

import { isManagedTeam } from "@/components/finance/nav/useManagedTeams";
import type { FinanceHubTeam } from "@/services/financeBooks.service";
import {
	resolveImportsProject,
	teamTabAccess,
	visibleTeamTabs,
} from "./teamFinanceAccess";

function hubTeam(patch: Partial<FinanceHubTeam>): FinanceHubTeam {
	return {
		team_id: "dc583f8a-0000-4000-8000-000000000000",
		team_name: "Prodigitality Services Inc. Team",
		avatar_url: null,
		my_team_role: "member",
		book: null,
		can_create: false,
		book_role: null,
		project_books: [],
		...patch,
	};
}

const loaded = (count: number) => ({ financeProjectCount: count });
const unknown = { financeProjectCount: null };

describe("visibleTeamTabs", () => {
	it("gives a team admin who is only a project editor the team-level tabs, not project finance", () => {
		// The PROD report: admin of the team, editor on its only project. Editors
		// do not hold finance.view, so the project list comes back empty.
		const team = hubTeam({ my_team_role: "admin" });
		expect(visibleTeamTabs(team, loaded(0))).toEqual([
			"overview",
			"time-logs",
			"rates",
			"payouts",
			"members",
		]);
	});

	it("adds invoices and imports once the admin can read a project's finance", () => {
		const team = hubTeam({ my_team_role: "admin" });
		const tabs = visibleTeamTabs(team, loaded(1));
		expect(tabs).toContain("invoices");
		expect(tabs).toContain("imports");
		// Team admin alone never opens expenses: the backend wants the team
		// owner or a finance role on the team book.
		expect(tabs).not.toContain("expenses");
	});

	it("hides project-dependent tabs while the project list is unknown", () => {
		const tabs = visibleTeamTabs(hubTeam({ my_team_role: "admin" }), unknown);
		expect(tabs).not.toContain("imports");
		expect(tabs).not.toContain("invoices");
	});

	it("gives the team owner expenses even before a team book exists", () => {
		const tabs = visibleTeamTabs(hubTeam({ my_team_role: "owner" }), loaded(0));
		expect(tabs).toContain("expenses");
		expect(tabs).not.toContain("imports");
	});

	it("lets a book manager who is not a team admin see invoices and expenses but not time and pay", () => {
		const tabs = visibleTeamTabs(
			hubTeam({ my_team_role: "member", book_role: "manager" }),
			loaded(0),
		);
		expect(tabs).toEqual(["overview", "invoices", "expenses", "members"]);
	});

	it("shows an accountant invoices and money out, following the backend gate", () => {
		const tabs = visibleTeamTabs(
			hubTeam({ my_team_role: "guest", book_role: "accountant" }),
			loaded(0),
		);
		expect(tabs).toEqual(["overview", "invoices", "expenses", "members"]);
	});

	it("gives an accountant imports once the book grant admits the team's projects", () => {
		const tabs = visibleTeamTabs(
			hubTeam({ my_team_role: "member", book_role: "accountant" }),
			loaded(2),
		);
		expect(tabs).toContain("imports");
	});

	it("never shows a client viewer the team's invoices or imports", () => {
		const tabs = visibleTeamTabs(
			hubTeam({ my_team_role: "guest", book_role: "viewer_client" }),
			loaded(0),
		);
		expect(tabs).toEqual(["overview", "members"]);
	});

	it("draws nothing for a team the hub does not know", () => {
		expect(visibleTeamTabs(undefined, loaded(3))).toEqual([]);
	});
});

describe("teamTabAccess", () => {
	const admin = hubTeam({ my_team_role: "admin" });

	it("refuses a direct imports URL when no project's finance is readable", () => {
		expect(teamTabAccess(admin, "imports", loaded(0))).toBe("denied");
	});

	it("waits, rather than refusing, while the project list loads", () => {
		expect(teamTabAccess(admin, "imports", unknown)).toBe("pending");
		expect(teamTabAccess(admin, "invoices", unknown)).toBe("pending");
	});

	it("answers team-level tabs without waiting for projects", () => {
		expect(teamTabAccess(admin, "time-logs", unknown)).toBe("allowed");
		expect(teamTabAccess(admin, "expenses", unknown)).toBe("denied");
	});

	it("refuses every tab of an unknown team", () => {
		expect(teamTabAccess(undefined, "overview", loaded(1))).toBe("denied");
	});
});

describe("resolveImportsProject", () => {
	const projects = [{ id: "allowed-1" }, { id: "allowed-2" }];

	it("does not trust a ?projectId outside the readable list", () => {
		expect(
			resolveImportsProject("0f9619e4-0000-4000-8000-000000000000", projects),
		).toEqual({ selected: undefined, refused: true });
	});

	it("accepts a ?projectId in the readable list", () => {
		expect(resolveImportsProject("allowed-2", projects)).toEqual({
			selected: "allowed-2",
			refused: false,
		});
	});

	it("auto-selects the only readable project", () => {
		expect(resolveImportsProject(undefined, [{ id: "only" }])).toEqual({
			selected: "only",
			refused: false,
		});
		expect(resolveImportsProject(undefined, projects)).toEqual({
			selected: undefined,
			refused: false,
		});
	});
});

describe("My teams (sidebar) listing", () => {
	it("keeps a team admin with zero finance-readable projects, who still has team-level tabs", () => {
		const team = hubTeam({ my_team_role: "admin" });
		expect(isManagedTeam(team)).toBe(true);
		expect(visibleTeamTabs(team, loaded(0)).length).toBeGreaterThan(1);
	});

	it("leaves out a plain member with no finance role", () => {
		expect(isManagedTeam(hubTeam({ my_team_role: "member" }))).toBe(false);
	});
});
