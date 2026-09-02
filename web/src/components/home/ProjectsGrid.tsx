import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Calendar,
	ChevronDown,
	Inbox,
	Layers3,
	Plus,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { ProjectStatusBadge } from "@/components/common/SemanticBadge";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { dashboardProjectsQueryOptions } from "@/hooks/useDashboardProjectsQuery";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { supabase } from "@/lib/supabase";
import {
	useTourDemo,
	useTourDemoActive,
} from "@/lib/tours/demo/TourDemoContext";
import { groupByWorkspace } from "@/lib/workspaceScope";
import {
	type Project,
	type ProjectInvite,
	type ProjectRoadmapSummary,
	projectService,
} from "@/services/project.service";
import type { ProfileSummary } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

type DashboardCard =
	| { kind: "invite"; invite: ProjectInvite }
	| { kind: "project"; project: Project };

export const PROJECT_STATUS_CONFIG: Record<
	string,
	{ label: string; color: string }
> = {
	bidding: {
		label: "Bidding",
		color: "#7c3aed",
	},
	draft: {
		label: "Draft",
		color: "#f59e0b",
	},
	active: {
		label: "Active",
		color: "#22c55e",
	},
	completed: {
		label: "Completed",
		color: "#03a9f4",
	},
	paused: {
		label: "Paused",
		color: "#64748b",
	},
	archived: {
		label: "Archived",
		color: "#6b7280",
	},
};

const PRIMARY_EMPTY_COPY = {
	title: "No projects yet",
	description:
		"Your projects will appear here once you create one or accept an invitation.",
};

// Dashboard shows this many project/invite cards before the "View more" toggle
// reveals the rest with a staggered slide-up.
const INITIAL_VISIBLE_CARDS = 6;

function formatInviteSentLabel(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "just now";

	return parsed.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function ProjectsGrid() {
	const user = useUser();
	const queryClient = useQueryClient();
	const projectsQueryKey = useMemo(
		() => dashboardProjectsQueryOptions(user?.id).queryKey,
		[user?.id],
	);
	const projectsQuery = useQuery({
		...dashboardProjectsQueryOptions(user?.id),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	// See TeamsGrid: fixtures are swapped in ahead of the card-building memos so
	// the real derivation logic runs unchanged during a tour replay.
	const allProjects = useTourDemo<Project[]>(
		"projects",
		(projectsQuery.data as Project[] | undefined) ?? [],
	);

	// Scoped to the open workspace, keeping work reached through project access
	// rather than membership. Projects in the user's other workspaces surface
	// when they switch.
	const { workspace: currentWorkspace, workspaces } = useCurrentWorkspace();
	const projects = useMemo(() => {
		const grouped = groupByWorkspace(
			allProjects,
			currentWorkspace?.id ?? null,
			workspaces.map((item) => item.id),
		);
		return [...grouped.current, ...grouped.shared];
	}, [allProjects, currentWorkspace?.id, workspaces]);
	const invitesQuery = useQuery({
		queryKey: ["projects", "my-invites"],
		queryFn: () => projectService.getMyInvites(),
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	const realPendingInvites = useMemo(
		() =>
			((invitesQuery.data as ProjectInvite[] | undefined) ?? [])
				.filter((invite) => invite.status === "pending")
				.sort(
					(a, b) =>
						new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
				),
		[invitesQuery.data],
	);
	const pendingInvites = useTourDemo<ProjectInvite[]>(
		"projectInvites",
		realPendingInvites,
	);
	const isDemo = useTourDemoActive();
	const isLoading =
		!isDemo && (projectsQuery.isPending || invitesQuery.isPending);

	const primaryCards = useMemo<DashboardCard[]>(() => {
		const inviteCards: DashboardCard[] = pendingInvites.map((invite) => ({
			kind: "invite",
			invite,
		}));
		const projectCards: DashboardCard[] = projects.map((project) => ({
			kind: "project",
			project,
		}));
		return [...inviteCards, ...projectCards];
	}, [pendingInvites, projects]);

	useEffect(() => {
		if (!user?.id) return;

		const invalidateProjects = () => {
			void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
		};

		const channel = supabase
			.channel(`dashboard-projects-realtime-${user.id}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "projects",
					filter: `owner_id=eq.${user.id}`,
				},
				invalidateProjects,
			)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "projects",
				},
				invalidateProjects,
			)
			.subscribe();

		// Catches membership changes (project_access rows) for this user — e.g. being
		// invited/added as a member. The projects table never changes in that flow, so
		// the channel above would not fire for the invited user without this.
		// NOTE: the table was renamed project_shares -> project_access (May 2026);
		// the old subscription pointed at the dropped name and silently never fired.
		const sharesChannel = supabase
			.channel(`dashboard-access-realtime-${user.id}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "project_access",
					filter: `user_id=eq.${user.id}`,
				},
				invalidateProjects,
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
			supabase.removeChannel(sharesChannel);
		};
	}, [projectsQueryKey, queryClient, user?.id]);

	return (
		<div
			id="my-projects"
			data-tutorial="projects-grid"
			className="app-slide-up scroll-mt-6"
		>
			<div className="mb-4">
				<div className="flex items-center gap-2">
					<div className="h-3 w-3 rounded-full bg-primary sm:h-[18px] sm:w-[18px]" />
					<h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-[20px]">
						PROJECTS
					</h2>
				</div>
				<p className="mt-1 text-xs text-slate-600">
					Every project you own, share, or have been invited to.
				</p>
			</div>

			<ProjectsSection
				cards={primaryCards}
				isLoading={isLoading}
				emptyTitle={PRIMARY_EMPTY_COPY.title}
				emptyDescription={PRIMARY_EMPTY_COPY.description}
			/>
		</div>
	);
}

function ProjectsSection({
	cards,
	isLoading,
	emptyTitle,
	emptyDescription,
}: {
	cards: DashboardCard[];
	isLoading: boolean;
	emptyTitle: string;
	emptyDescription: string;
}) {
	const [showAll, setShowAll] = useState(false);
	const hasMore = cards.length > INITIAL_VISIBLE_CARDS;
	const visibleCards = showAll ? cards : cards.slice(0, INITIAL_VISIBLE_CARDS);

	return (
		<section data-tour="dashboard-projects">
			<div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
				{isLoading ? (
					<>
						<ProjectCardSkeleton />
						<ProjectCardSkeleton />
						<ProjectCardSkeleton />
					</>
				) : cards.length === 0 ? (
					<ProjectsEmptyState
						title={emptyTitle}
						description={emptyDescription}
						className="col-span-full"
					/>
				) : (
					visibleCards.map((card, index) => {
						// Cards past the initial fold slide up in a gentle stagger when
						// "View more" is expanded; the first page renders without it so
						// the section's own entrance animation stays clean on load.
						const isExtra = index >= INITIAL_VISIBLE_CARDS;
						const revealClassName = isExtra ? "app-slide-up" : undefined;
						const revealStyle: CSSProperties | undefined = isExtra
							? {
									animationDelay: `${(index - INITIAL_VISIBLE_CARDS) * 60}ms`,
								}
							: undefined;

						if (card.kind === "invite") {
							return (
								<InviteCard
									key={card.invite.id}
									invite={card.invite}
									className={revealClassName}
									style={revealStyle}
								/>
							);
						}

						const statusConfig = PROJECT_STATUS_CONFIG[
							(card.project.status || "").toLowerCase()
						] ?? {
							label: card.project.status || "Unknown",
							color: "#9c27b0",
						};

						return (
							<ProjectCard
								key={card.project.id}
								projectId={card.project.id}
								status={statusConfig.label}
								title={card.project.title}
								owner={card.project.owner?.display_name || "Assigned"}
								progress={
									card.project.roadmap_summary
										? card.project.roadmap_summary.progress
										: card.project.status === "completed"
											? 100
											: null
								}
								progressColor={statusConfig.color}
								roadmapSummary={card.project.roadmap_summary ?? null}
								dueDate={null}
								className={revealClassName}
								style={revealStyle}
							/>
						);
					})
				)}
			</div>

			{!isLoading && hasMore ? (
				<div className="mt-6 flex justify-center">
					<button
						type="button"
						onClick={() => setShowAll((prev) => !prev)}
						aria-expanded={showAll}
						data-testid="projects-view-more"
						className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:text-slate-900 hover:shadow-md"
					>
						<span>
							{showAll
								? "Show less"
								: `View more (${cards.length - INITIAL_VISIBLE_CARDS})`}
						</span>
						<ChevronDown
							className={`h-4 w-4 text-slate-500 transition-transform duration-300 group-hover:text-slate-700 ${
								showAll ? "rotate-180" : ""
							}`}
						/>
					</button>
				</div>
			) : null}
		</section>
	);
}

function InviteCard({
	invite,
	className,
	style,
}: {
	invite: ProjectInvite;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<button
			type="button"
			onClick={() => openProjectInviteModal(invite.id)}
			className={`group flex h-auto flex-col sm:h-[385px] rounded-2xl border border-slate-900 bg-slate-900 p-4 text-left text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg ${
				className ?? ""
			}`}
			style={style}
		>
			<div className="flex-1 space-y-4 sm:space-y-6">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<span className="inline-flex items-center rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
							Pending Invite
						</span>
					</div>
					<h3 className="mb-2 line-clamp-2 text-[18px] font-semibold tracking-tight text-white">
						{invite.project?.title || "Project invitation"}
					</h3>
					<p className="mb-1 text-[13px] text-slate-300">
						Invited by{" "}
						<span className="font-semibold text-white">
							{invite.inviter?.display_name || "Team lead"}
						</span>
					</p>
				</div>

				<div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
					<p className="text-[12px] font-semibold uppercase tracking-wide text-slate-300">
						Next Step
					</p>
					<p className="mt-1 text-[13px] text-white">
						Review this invitation and choose to join or decline.
					</p>
				</div>

				<div className="flex items-center gap-2 text-[12px] text-slate-300">
					<Inbox className="h-4 w-4 text-slate-300" />
					<span>Sent {formatInviteSentLabel(invite.created_at)}</span>
				</div>
			</div>

			<div className="border-t border-white/15 pt-4">
				<div className="flex items-center justify-end gap-1 text-[14px] font-semibold uppercase text-white/80 transition-colors group-hover:text-white">
					<span>Open invite</span>
					<ArrowRight className="h-4 w-4" />
				</div>
			</div>
		</button>
	);
}

function ProjectsEmptyState({
	title,
	description,
	className,
}: {
	title: string;
	description: string;
	className?: string;
}) {
	return (
		<div
			className={`rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm ${className ?? ""}`}
		>
			<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
				<Calendar className="h-6 w-6 text-slate-600" />
			</div>
			<h4 className="mb-2 text-lg font-semibold text-slate-900">{title}</h4>
			<p className="mx-auto mb-4 max-w-md text-sm text-slate-600">
				{description}
			</p>
			<Link
				to="/project/new"
				search={{ roadmapId: undefined }}
				className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
			>
				<Plus className="h-4 w-4" />
				Create project
			</Link>
		</div>
	);
}

export interface ProjectCardMember {
	user_id: string;
	user: ProfileSummary | null;
}

/**
 * Overlapping faces, capped at five with a "+n" tail. Negative margins rather
 * than a gap, so the stack stays a fixed width as the roster grows and cannot
 * push the view-project link off the card.
 */
function ProjectCardAvatars({ members }: { members: ProjectCardMember[] }) {
	const visible = members.slice(0, 5);
	const overflow = members.length - visible.length;

	return (
		<span
			className="flex items-center"
			aria-label={`${members.length} members`}
		>
			{visible.map((member, index) => (
				<span
					key={member.user_id}
					className="rounded-full ring-2 ring-(--app-surface-strong)"
					style={{
						marginLeft: index === 0 ? 0 : -8,
						zIndex: visible.length - index,
					}}
				>
					<Avatar user={member.user} size="xs" />
				</span>
			))}
			{overflow > 0 && (
				<span
					className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-(--app-surface-strong)"
					style={{ marginLeft: -8 }}
				>
					+{overflow}
				</span>
			)}
		</span>
	);
}

export function ProjectCard({
	projectId,
	status,
	title,
	owner,
	progress,
	progressColor,
	roadmapSummary,
	dueDate,
	members,
	className,
	style,
}: {
	projectId: string;
	status: string;
	title: string;
	owner: string;
	progress: number | null;
	progressColor: string;
	roadmapSummary: ProjectRoadmapSummary | null;
	dueDate: string | null;
	/**
	 * Optional avatar stack in the footer. The dashboard omits it — every
	 * project there is yours, so the faces add nothing — while the team's
	 * Projects tab passes that team's curated members, which is the one thing
	 * that differs between two projects in that list.
	 */
	members?: ProjectCardMember[];
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<div
			className={`group flex h-auto flex-col sm:h-[385px] rounded-2xl border border-border bg-(--app-surface-strong) p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-(--app-border-strong) hover:shadow-lg ${
				className ?? ""
			}`}
			style={style}
		>
			<div className="flex-1 space-y-4 sm:space-y-6">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<ProjectStatusBadge status={status} />
					</div>

					{/* Fixed two-line slot (leading-snug = 1.375 -> 2.75em) so the
					    Progress and ROADMAP sections line up across cards no matter
					    how long the project name is. */}
					<h3 className="mb-1 line-clamp-2 min-h-[2.75em] text-[14px] font-semibold leading-snug tracking-tight text-slate-900 sm:text-[16px]">
						{title}
					</h3>
					<p className="text-[13px] sm:text-[14px]">
						<span className="font-semibold text-slate-600">Owner:</span>
						<span className="text-slate-600"> {owner}</span>
					</p>
				</div>

				<div>
					<div className="mb-2 flex items-center justify-between text-[12px] text-slate-500">
						<span>Progress</span>
						<span>
							{progress === null ? "Not tracked yet" : `${progress}%`}
						</span>
					</div>
					<div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
						<div
							className="h-full rounded-full transition-all"
							style={{
								width: `${progress ?? 0}%`,
								backgroundColor: progressColor,
							}}
						/>
					</div>
				</div>

				<div className="flex gap-2">
					<Layers3 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-500" />
					<div className="min-w-0 space-y-2">
						<div>
							<p className="text-[12px] font-semibold text-slate-600 sm:text-[14px]">
								ROADMAP
							</p>
							{roadmapSummary ? (
								<>
									<p className="truncate text-[12px] font-semibold text-slate-900 sm:text-[14px]">
										{roadmapSummary.name}
									</p>
									<p className="text-[12px] text-slate-600 sm:text-[13px]">
										{roadmapSummary.epic_count}{" "}
										{roadmapSummary.epic_count === 1 ? "epic" : "epics"} ·{" "}
										{roadmapSummary.feature_count}{" "}
										{roadmapSummary.feature_count === 1
											? "feature"
											: "features"}
									</p>
									<p className="text-[12px] text-slate-600 sm:text-[13px]">
										{roadmapSummary.done_task_count}/{roadmapSummary.task_count}{" "}
										tasks done
									</p>
								</>
							) : (
								<p className="text-[12px] text-slate-600 sm:text-[14px]">
									No roadmap yet
								</p>
							)}
						</div>
						{dueDate && (
							<div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
								<Calendar className="h-[18px] w-[18px] text-slate-600" />
								<span className="text-[12px] text-slate-600">{dueDate}</span>
							</div>
						)}
					</div>
				</div>
			</div>

			<div className="border-t border-slate-200 pt-4">
				<div className="flex items-end justify-between gap-2">
					{members && members.length > 0 ? (
						<ProjectCardAvatars members={members} />
					) : (
						<span />
					)}
					<div className="flex flex-col items-end gap-1">
						<Link
							to="/project/$projectId/roadmap"
							params={{ projectId }}
							className="whitespace-nowrap text-[12px] font-semibold uppercase text-slate-700 transition-colors group-hover:text-slate-900 sm:text-[14px]"
						>
							VIEW PROJECT -&gt;
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}

function ProjectCardSkeleton() {
	return (
		<div className="flex h-[385px] flex-col rounded-xl border border-border bg-(--app-surface-strong) p-4 shadow-sm">
			<div className="flex-1 space-y-4 sm:space-y-6">
				<div>
					<div className="flex items-center gap-2 mb-2 w-full">
						<div className="flex items-center gap-1">
							<div className="w-3 h-3 rounded-full bg-gray-200 animate-pulse" />
							<div className="w-20 h-4 bg-gray-200 rounded animate-pulse" />
						</div>
					</div>
					<div className="w-3/4 h-5 bg-gray-200 rounded animate-pulse mb-2" />
					<div className="w-1/2 h-4 bg-gray-200 rounded animate-pulse" />
				</div>

				<div>
					<div className="flex items-center justify-between mb-2">
						<div className="w-16 h-3 bg-gray-200 rounded animate-pulse" />
						<div className="w-8 h-3 bg-gray-200 rounded animate-pulse" />
					</div>
					<div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden" />
				</div>

				<div className="flex gap-2">
					<div className="w-[18px] h-[18px] bg-gray-200 rounded-full animate-pulse shrink-0 mt-0.5" />
					<div className="space-y-2 w-full">
						<div>
							<div className="w-20 h-4 bg-gray-200 rounded animate-pulse mb-1.5" />
							<div className="w-1/2 h-4 bg-gray-200 rounded animate-pulse" />
						</div>
						<div className="w-24 h-6 bg-gray-200 rounded-[5px] animate-pulse" />
					</div>
				</div>
			</div>

			<div className="pt-4 border-t border-[#e3e5e8]/30">
				<div className="flex items-center justify-between">
					<div className="flex -space-x-2">
						<div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white animate-pulse" />
						<div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white animate-pulse" />
					</div>
					<div className="w-24 h-4 bg-gray-200 rounded animate-pulse" />
				</div>
			</div>
		</div>
	);
}
