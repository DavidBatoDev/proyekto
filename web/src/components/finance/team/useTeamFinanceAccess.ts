import { useQuery } from "@tanstack/react-query";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import {
	type TeamFinanceTab,
	teamTabAccess,
	visibleTeamTabs,
} from "@/components/finance/team/teamFinanceAccess";
import { retryUnlessAccessDenied } from "@/lib/apiErrors";
import {
	type TeamFinanceProject,
	teamFinanceService,
} from "@/services/teamFinance.service";

export function teamFinanceProjectsKey(teamId: string) {
	return ["team-finance", "finance-projects", teamId] as const;
}

/**
 * The team's projects whose finance the caller may read at the project level
 * (see `TeamFinanceProject`). The endpoint never refuses — a caller with no
 * such project gets an empty list — so an error here is a real failure.
 */
export function useTeamFinanceProjects(teamId: string, enabled = true) {
	return useQuery({
		queryKey: teamFinanceProjectsKey(teamId),
		queryFn: () => teamFinanceService.financeProjects(teamId),
		enabled: enabled && Boolean(teamId),
		staleTime: 60_000,
		retry: retryUnlessAccessDenied(),
	});
}

export interface TeamFinanceAccess {
	team: ReturnType<typeof useHubTeam>["team"];
	hubQuery: ReturnType<typeof useHubTeam>["hubQuery"];
	/** True until the hub (and, for a known team, the project list) resolves. */
	isLoading: boolean;
	/** The project list failed for a reason other than access. */
	projectsError: unknown;
	refetchProjects: () => void;
	financeProjects: TeamFinanceProject[];
	tabs: TeamFinanceTab[];
	/** Whether a direct URL to this tab renders, is refused, or is unknown yet. */
	tabAccess: (section: TeamFinanceTab) => "allowed" | "denied" | "pending";
	/** Whether the project-level finance gate admits the caller on `projectId`. */
	canReadProject: (projectId: string | undefined | null) => boolean;
}

/**
 * Everything a team-finance page needs to decide what to draw: the caller's
 * hub entry (team role, book role) plus the project-level finance list. One
 * hook, so the tab bar, the direct-URL gate, and the pickers cannot disagree.
 */
export function useTeamFinanceAccess(teamId: string): TeamFinanceAccess {
	const { team, hubQuery } = useHubTeam(teamId);
	const projectsQuery = useTeamFinanceProjects(teamId, Boolean(team));
	const financeProjects = projectsQuery.data ?? [];
	const access = {
		financeProjectCount: projectsQuery.isSuccess
			? financeProjects.length
			: null,
	};

	return {
		team,
		hubQuery,
		isLoading: hubQuery.isPending || (Boolean(team) && projectsQuery.isPending),
		projectsError: projectsQuery.isError ? projectsQuery.error : null,
		refetchProjects: () => void projectsQuery.refetch(),
		financeProjects,
		tabs: visibleTeamTabs(team, access),
		tabAccess: (section) => teamTabAccess(team, section, access),
		canReadProject: (projectId) =>
			Boolean(projectId) &&
			financeProjects.some((project) => project.id === projectId),
	};
}
