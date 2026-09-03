import { useQuery } from "@tanstack/react-query";
import { getRoadmapsPreview } from "@/api/endpoints/roadmap";
import {
	useTourDemo,
	useTourDemoActive,
} from "@/lib/tours/demo/TourDemoContext";
import type { Project } from "@/services/project.service";
import {
	listMyTeamInvites,
	listMyTeams,
	type Team,
	type TeamInvite,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import { dashboardProjectsQueryOptions } from "./useDashboardProjectsQuery";

/**
 * Does this account have anything on it yet?
 *
 * The dashboard used to render Teams, Projects and Roadmaps unconditionally,
 * so a new account met five "nothing here" panels (those three plus Meetings
 * and Activity) before it met a single thing it could do. Deciding that
 * centrally needs all three lists in one place, which is what this is.
 *
 * Every query key here is a copy of the one its own grid already uses, so
 * these are cache reads, not extra requests — mounting this hook alongside the
 * grids costs one render, not four round-trips.
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

	const projectsQuery = useQuery({
		...dashboardProjectsQueryOptions(user?.id),
		retry: 1,
	});
	const roadmapsQuery = useQuery({
		queryKey: ["dashboard", "roadmaps-preview"],
		queryFn: () => getRoadmapsPreview(),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
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
		(projectsQuery.data as Project[] | undefined) ?? [],
	);
	const roadmaps = useTourDemo("roadmaps", roadmapsQuery.data ?? []);
	const teams = useTourDemo<Team[]>(
		"teams",
		(teamsQuery.data as Team[] | undefined) ?? [],
	);
	const teamInvites = useTourDemo<TeamInvite[]>(
		"teamInvites",
		((teamInvitesQuery.data as TeamInvite[] | undefined) ?? []).filter(
			(invite) => invite.status === "pending",
		),
	);

	// Every list has to have settled before the verdict means anything —
	// otherwise the onboarding panel flashes on each hard refresh and is then
	// yanked away, which reads as a bug to anyone who already has projects.
	const isLoading =
		!isDemo &&
		(projectsQuery.isPending ||
			roadmapsQuery.isPending ||
			teamsQuery.isPending ||
			teamInvitesQuery.isPending);

	// A pending team invite counts as content: someone who has been invited
	// somewhere is not staring at a blank account, and the invite card is the
	// most useful thing we could show them.
	const isEmpty =
		!isLoading &&
		projects.length === 0 &&
		roadmaps.length === 0 &&
		teams.length === 0 &&
		teamInvites.length === 0;

	return {
		projects,
		roadmaps,
		teams,
		teamInvites,
		isLoading,
		isEmpty,
	};
}
