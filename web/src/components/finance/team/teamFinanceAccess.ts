import type { FinanceHubTeam } from "@/services/financeBooks.service";
import type { TeamFinanceProject } from "@/services/teamFinance.service";

export type TeamFinanceTab =
	| "overview"
	| "invoices"
	| "time-logs"
	| "rates"
	| "payouts"
	| "expenses"
	| "imports"
	| "members";

export const TEAM_FINANCE_TAB_ORDER: TeamFinanceTab[] = [
	"overview",
	"invoices",
	"time-logs",
	"rates",
	"payouts",
	"expenses",
	"imports",
	"members",
];

/**
 * What the caller can read beyond their hub entry: how many of the team's
 * projects pass the PROJECT-level finance gate (`finance.view` on their own
 * project_access row — what imports and the project invoice workspace check).
 * `null` while unknown; a tab that depends on it stays hidden until then.
 */
export interface TeamFinanceProjectAccess {
	financeProjectCount: number | null;
}

/**
 * Which team tabs the caller can use, mirroring the backend gate behind each:
 *
 * - Overview, Members: anyone the hub lists the team for (the team list and
 *   the hub itself are team-membership/book-role gated).
 * - Time logs, Rates, Payouts: team owner or admin (`TeamTimeService`'s
 *   approver gate — team level, independent of any project's finance).
 * - Invoices: for a team owner/admin, at least one project they hold
 *   `finance.view` on (`TeamFinanceAccessService.listTeamProjects` filters
 *   administrators per project — an admin with none would only ever get an
 *   empty list that looks like "no invoices"); for anyone else, an
 *   owner/manager/accountant role on the team book (`view_contracts`), whose
 *   grant covers every attached project.
 * - Expenses: the team owner, or an owner/manager/accountant on the team book
 *   (`FinanceExpensesService.resolveTeamAccess`). Team admin alone is NOT
 *   enough there, so it does not show the tab.
 * - Imports: at least one project passing the project-scoped finance gate
 *   (`assertProjectFinanceActor`: `finance.view` on the project, or a
 *   team-running role on the team book); a team role alone never admits it.
 *
 * A tab the caller cannot use is not drawn — never drawn-then-refused.
 */
export function visibleTeamTabs(
	team: FinanceHubTeam | undefined,
	access: TeamFinanceProjectAccess = { financeProjectCount: null },
): TeamFinanceTab[] {
	if (!team) return [];
	const isAdmin =
		team.my_team_role === "owner" || team.my_team_role === "admin";
	const bookRole = team.my_team_role === "owner" ? "owner" : team.book_role;
	// The backend checks administration FIRST and only consults the book for
	// non-administrators, so a book grant widens nothing for a team admin.
	const bookOnlyRuns =
		!isAdmin &&
		(team.book_role === "owner" ||
			team.book_role === "manager" ||
			team.book_role === "accountant");
	const hasFinanceProjects = (access.financeProjectCount ?? 0) > 0;

	return TEAM_FINANCE_TAB_ORDER.filter((tab) => {
		switch (tab) {
			case "time-logs":
			case "rates":
			case "payouts":
				return isAdmin;
			case "invoices":
				return isAdmin ? hasFinanceProjects : bookOnlyRuns;
			case "expenses":
				return (
					team.my_team_role === "owner" ||
					bookRole === "owner" ||
					bookRole === "manager" ||
					bookRole === "accountant"
				);
			case "imports":
				return hasFinanceProjects;
			default:
				return true;
		}
	});
}

/**
 * Whether a direct URL to `section` should render or be refused, given the
 * resolved tabs. `"pending"` while the answer depends on data still loading.
 */
export function teamTabAccess(
	team: FinanceHubTeam | undefined,
	section: TeamFinanceTab,
	access: TeamFinanceProjectAccess,
): "allowed" | "denied" | "pending" {
	if (!team) return "denied";
	if (visibleTeamTabs(team, access).includes(section)) return "allowed";
	const dependsOnProjects =
		section === "imports" ||
		(section === "invoices" &&
			(team.my_team_role === "owner" || team.my_team_role === "admin"));
	if (dependsOnProjects && access.financeProjectCount === null) {
		return "pending";
	}
	return "denied";
}

/**
 * Which project the imports page shows, given the URL's `?projectId` and the
 * projects the caller may read finance for. The URL is never trusted on its
 * own: a project outside the list is reported as refused rather than queried.
 */
export function resolveImportsProject(
	requested: string | undefined,
	projects: Array<Pick<TeamFinanceProject, "id">>,
): { selected: string | undefined; refused: boolean } {
	if (requested) {
		const allowed = projects.some((project) => project.id === requested);
		return { selected: allowed ? requested : undefined, refused: !allowed };
	}
	// With one project there is nothing to choose.
	return {
		selected: projects.length === 1 ? projects[0].id : undefined,
		refused: false,
	};
}
