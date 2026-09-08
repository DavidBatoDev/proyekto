import { useQuery } from "@tanstack/react-query";
import {
	useTourDemo,
	useTourDemoActive,
} from "@/lib/tours/demo/TourDemoContext";
import { belongsToWorkspace, filterByWorkspace } from "@/lib/workspaceScope";
import {
	type Project,
	type ProjectInvite,
	projectService,
} from "@/services/project.service";
import {
	listMyTeamInvites,
	listMyTeams,
	type Team,
	type TeamInvite,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import { dashboardProjectsQueryOptions } from "./useDashboardProjectsQuery";
import { roadmapsPreviewQueryOptions } from "./useRoadmapsPreviewQuery";
import { useCurrentWorkspace } from "./useWorkspaceQueries";

/**
 * Does the selected workspace have any visible dashboard content?
 *
 * The dashboard used to render Teams, Projects and Roadmaps unconditionally,
 * so a new account met five "nothing here" panels (those three plus Meetings
 * and Activity) before it met a single thing it could do. Deciding that
 * centrally needs all three lists in one place, which is what this is.
 *
 * Every query key here is a copy of the one its own grid already uses, so
 * these are cache reads, not extra requests — mounting this hook alongside the
 * grids reuses cached results.
 *
 * `isEmpty` is derived from the TOUR-DEMO values, never the raw query data.
 * A tour replay swaps fixtures in (TourDemoContext), and the dashboard tour
 * spotlights `[data-tour="dashboard-teams"|"dashboard-projects"|
 * "dashboard-roadmaps"]` — if the gate read the real rows, a brand-new account
 * would hide the very sections the tour is about to point at, and every step
 * would silently fail to find its target.
 */
export function useDashboardContent() {
	const user = useUser();
	const { workspace, isLoading: workspaceLoading } = useCurrentWorkspace();
	const workspaceId = workspace?.id ?? null;
	const projectInvitesQuery = useQuery({
		queryKey: ["projects", "my-invites"],
		queryFn: () => projectService.getMyInvites(),
		enabled: Boolean(user?.id),
		staleTime: 30_000,
	});

	const projectsQuery = useQuery({
		...dashboardProjectsQueryOptions(user?.id),
		retry: 1,
	});
	const roadmapsQuery = useQuery(roadmapsPreviewQueryOptions(user?.id));
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30_000,
	});
	const teamInvitesQuery = useQuery({
		queryKey: ["teams", "my-invites"],
		queryFn: listMyTeamInvites,
		enabled: Boolean(user?.id),
		staleTime: 30_000,
	});

	const isDemo = useTourDemoActive();
	const projects = useTourDemo<Project[]>(
		"projects",
		filterByWorkspace(
			(projectsQuery.data as Project[] | undefined) ?? [],
			workspaceId,
		),
	);
	const roadmaps = useTourDemo(
		"roadmaps",
		(roadmapsQuery.data ?? []).filter((roadmap) =>
			belongsToWorkspace(roadmap.project, workspaceId),
		),
	);
	const teams = useTourDemo<Team[]>(
		"teams",
		filterByWorkspace(
			(teamsQuery.data as Team[] | undefined) ?? [],
			workspaceId,
		),
	);
	const teamInvites = useTourDemo<TeamInvite[]>(
		"teamInvites",
		((teamInvitesQuery.data as TeamInvite[] | undefined) ?? []).filter(
			(invite) =>
				invite.status === "pending" &&
				belongsToWorkspace(invite.team, workspaceId),
		),
	);

	const projectInvites = useTourDemo<ProjectInvite[]>(
		"projectInvites",
		(projectInvitesQuery.data ?? []).filter(
			(invite) =>
				invite.status === "pending" &&
				belongsToWorkspace(invite.project, workspaceId),
		),
	);

	// Every list has to have settled before the verdict means anything —
	// otherwise the onboarding panel flashes on each hard refresh and is then
	// yanked away, which reads as a bug to anyone who already has projects.
	const isLoading =
		!isDemo &&
		(workspaceLoading ||
			!workspaceId ||
			projectInvitesQuery.isPending ||
			projectsQuery.isPending ||
			roadmapsQuery.isPending ||
			teamsQuery.isPending ||
			teamInvitesQuery.isPending);

	// A pending project or team invite counts as content: someone who has been invited
	// somewhere is not staring at a blank account, and the invite card is the
	// most useful thing we could show them.
	const isEmpty =
		!isLoading &&
		projectInvites.length === 0 &&
		projects.length === 0 &&
		roadmaps.length === 0 &&
		teams.length === 0 &&
		teamInvites.length === 0;

	return {
		projectInvites,
		projects,
		roadmaps,
		teams,
		teamInvites,
		isLoading,
		isEmpty,
	};
}
