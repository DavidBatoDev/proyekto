import { useQuery } from "@tanstack/react-query";
import {
	type FinanceHub,
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";

/**
 * Whether the caller runs money for this team: the team owner or a team
 * admin, or anyone holding a finance role on the team book (a manager or
 * accountant who is not a team admin). A plain member is not — their share
 * of a team shows up in My finance instead.
 */
export function isManagedTeam(team: FinanceHubTeam): boolean {
	return (
		team.my_team_role === "owner" ||
		team.my_team_role === "admin" ||
		Boolean(team.book_role)
	);
}

/** The hub's teams the caller manages, owned teams first. */
export function useManagedTeams(hub: FinanceHub | undefined): FinanceHubTeam[] {
	return (hub?.teams ?? []).filter(isManagedTeam).sort((a, b) => {
		const rank = (team: FinanceHubTeam) =>
			team.my_team_role === "owner" ? 0 : 1;
		return rank(a) - rank(b) || a.team_name.localeCompare(b.team_name);
	});
}

/** The hub, shared by every finance page (the sidebar keeps it warm). */
export function useFinanceHub() {
	return useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
		staleTime: 60_000,
	});
}

/**
 * One team's slice of the hub, if the caller can see it. A team the caller is
 * not on but whose book was shared with them (the outside accountant) is
 * synthesized from that grant, so its pages still know its name and the
 * caller's role.
 */
export function useHubTeam(teamId: string) {
	const hubQuery = useFinanceHub();
	return { hubQuery, team: hubTeamFor(hubQuery.data, teamId) };
}

export function hubTeamFor(
	hub: FinanceHub | undefined,
	teamId: string,
): FinanceHubTeam | undefined {
	const own = hub?.teams.find((entry) => entry.team_id === teamId);
	if (own || !hub) return own;
	const grants = hub.shared.filter(
		(entry) => entry.book.owner_team_id === teamId,
	);
	if (grants.length === 0) return undefined;
	const teamGrant = grants.find((entry) => entry.book.kind === "team");
	return {
		team_id: teamId,
		team_name: grants[0].team_name ?? "Team",
		avatar_url: null,
		my_team_role: "guest",
		book: teamGrant?.book ?? null,
		can_create: false,
		book_role: teamGrant?.role ?? null,
		project_books: grants
			.filter((entry) => entry.book.kind === "project")
			.map((entry) => ({
				book: entry.book,
				project_title: entry.project_title ?? "Project",
				contract_status: "",
			})),
	};
}

/**
 * Where a project's finance lives: the team whose book holds it. Resolved from
 * the hub (the caller's teams' project books, then books shared with them), so
 * legacy project-scoped URLs (`/finance/invoices?projectId=…`) can forward to
 * the one place the project now has.
 */
export function findProjectHome(
	hub: FinanceHub | undefined,
	projectId: string | undefined,
): { teamId: string; bookId: string } | null {
	if (!hub || !projectId) return null;
	for (const team of hub.teams) {
		const entry = team.project_books.find(
			(candidate) => candidate.book.project_id === projectId,
		);
		if (entry) return { teamId: team.team_id, bookId: entry.book.id };
	}
	const shared = hub.shared.find(
		(entry) =>
			entry.book.kind === "project" && entry.book.project_id === projectId,
	);
	if (shared?.book.owner_team_id) {
		return { teamId: shared.book.owner_team_id, bookId: shared.book.id };
	}
	return null;
}
