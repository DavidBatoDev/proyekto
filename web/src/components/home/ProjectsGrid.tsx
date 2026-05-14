import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Calendar, Clock, Inbox } from "lucide-react";
import { useEffect, useMemo } from "react";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { supabase } from "@/lib/supabase";
import {
	type Project,
	type ProjectInvite,
	projectService,
} from "@/services/project.service";
import { useUser } from "@/stores/authStore";

type DashboardCard =
	| { kind: "invite"; invite: ProjectInvite }
	| { kind: "project"; project: Project };

export const PROJECT_STATUS_CONFIG: Record<
	string,
	{ label: string; color: string; badgeClass: string }
> = {
	bidding: {
		label: "Bidding",
		color: "#7c3aed",
		badgeClass: "bg-violet-100 text-violet-700 border-violet-200",
	},
	draft: {
		label: "Draft",
		color: "#f59e0b",
		badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
	},
	active: {
		label: "Active",
		color: "#22c55e",
		badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
	},
	completed: {
		label: "Completed",
		color: "#03a9f4",
		badgeClass: "bg-sky-100 text-sky-700 border-sky-200",
	},
	paused: {
		label: "Paused",
		color: "#64748b",
		badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
	},
	archived: {
		label: "Archived",
		color: "#6b7280",
		badgeClass: "bg-gray-100 text-gray-700 border-gray-200",
	},
};

const PRIMARY_EMPTY_COPY = {
	title: "No projects yet",
	description:
		"Your projects will appear here once you create one or accept an invitation.",
};

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
		() => ["dashboard", "projects", user?.id ?? "anonymous"] as const,
		[user?.id],
	);
	const projectsQuery = useQuery({
		queryKey: projectsQueryKey,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(user?.id),
		staleTime: 0,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		retry: 1,
	});
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];
	const invitesQuery = useQuery({
		queryKey: ["projects", "my-invites"],
		queryFn: () => projectService.getMyInvites(),
		enabled: Boolean(user?.id),
		staleTime: 0,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		retry: 1,
	});
	const pendingInvites = useMemo(
		() =>
			((invitesQuery.data as ProjectInvite[] | undefined) ?? [])
				.filter((invite) => invite.status === "pending")
				.sort(
					(a, b) =>
						new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
				),
		[invitesQuery.data],
	);
	const isLoading = projectsQuery.isPending || invitesQuery.isPending;

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
					filter: `client_id=eq.${user.id}`,
				},
				invalidateProjects,
			)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "projects",
					filter: `consultant_id=eq.${user.id}`,
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

		return () => {
			supabase.removeChannel(channel);
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
					<div className="h-[18px] w-[18px] rounded-full bg-slate-900" />
					<h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
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
	return (
		<section>
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
						className="col-span-3"
					/>
				) : (
					cards.slice(0, 6).map((card, index) => {
						if (card.kind === "invite") {
							return (
								<InviteCard
									key={card.invite.id}
									invite={card.invite}
									number={index + 1}
								/>
							);
						}

						const statusConfig = PROJECT_STATUS_CONFIG[
							(card.project.status || "").toLowerCase()
						] ?? {
							label: card.project.status || "Unknown",
							color: "#9c27b0",
							badgeClass: "bg-purple-100 text-purple-700 border-purple-200",
						};

						return (
							<ProjectCard
								key={card.project.id}
								number={index + 1}
								projectId={card.project.id}
								status={statusConfig.label}
								statusColor={statusConfig.color}
								statusBadgeClass={statusConfig.badgeClass}
								title={card.project.title}
								client={card.project.client?.display_name || "Assigned"}
								progress={card.project.status === "completed" ? 100 : null}
								progressColor={statusConfig.color}
								nextUp={
									card.project.brief
										? "Review project brief"
										: "Add project brief"
								}
								dueDate={
									card.project.custom_start_date ||
									card.project.start_date ||
									null
								}
							/>
						);
					})
				)}
			</div>
		</section>
	);
}

function InviteCard({
	invite,
	number,
}: {
	invite: ProjectInvite;
	number: number;
}) {
	return (
		<button
			type="button"
			onClick={() => openProjectInviteModal(invite.id)}
			className="group flex h-[385px] flex-col rounded-2xl border border-slate-900 bg-slate-900 p-4 text-left text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg"
		>
			<div className="flex-1 space-y-6">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<span className="text-[16px] font-semibold text-slate-400">
							#{number}
						</span>
						<div className="h-[25px] w-px bg-white/20" />
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
			<p className="mx-auto max-w-md text-sm text-slate-600">{description}</p>
		</div>
	);
}

export function ProjectCard({
	number,
	projectId,
	status,
	statusColor,
	statusBadgeClass,
	title,
	client,
	progress,
	progressColor,
	nextUp,
	dueDate,
}: {
	number: number;
	projectId: string;
	status: string;
	statusColor: string;
	statusBadgeClass: string;
	title: string;
	client: string;
	progress: number | null;
	progressColor: string;
	nextUp: string;
	dueDate: string | null;
}) {
	const isDraft = status.toLowerCase() === "draft";

	return (
		<div
			className="group flex h-[385px] flex-col rounded-2xl border border-slate-200 bg-linear-to-b from-white from-95% to-transparent p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg"
			style={{
				backgroundImage: `linear-gradient(to bottom, white 98%, ${statusColor}20)`,
			}}
		>
			<div className="flex-1 space-y-6">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<span className="text-[16px] font-semibold text-slate-500">
							#{number}
						</span>
						<div className="h-[25px] w-px bg-slate-300" />
						<div className="flex items-center gap-2">
							{!isDraft ? (
								<div
									className="w-3 h-3 rounded-full flex items-center justify-center"
									style={{ backgroundColor: statusColor }}
								>
									<div className="w-1.5 h-1.5 rounded-full bg-white" />
								</div>
							) : null}
							<span
								className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBadgeClass}`}
							>
								{status}
							</span>
						</div>
					</div>

					<h3 className="mb-1 text-[16px] font-semibold tracking-tight text-slate-900">
						{title}
					</h3>
					<p className="text-[14px]">
						<span className="font-semibold text-slate-600">Client:</span>
						<span className="text-slate-600"> {client}</span>
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
					<Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-500" />
					<div className="space-y-2">
						<div>
							<p className="text-[14px] font-semibold text-slate-600">
								NEXT UP
							</p>
							<p className="text-[14px] text-slate-900">• {nextUp}</p>
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
				<div className="flex flex-col items-end gap-1">
					<Link
						to="/project/$projectId/roadmap"
						params={{ projectId }}
						className="whitespace-nowrap text-[14px] font-semibold uppercase text-slate-700 transition-colors group-hover:text-slate-900"
					>
						VIEW PROJECT -&gt;
					</Link>
				</div>
			</div>
		</div>
	);
}

function ProjectCardSkeleton() {
	return (
		<div className="bg-white rounded-xl shadow-sm p-4 h-[385px] flex flex-col border border-gray-100">
			<div className="flex-1 space-y-6">
				<div>
					<div className="flex items-center gap-2 mb-2 w-full">
						<div className="w-8 h-4 bg-gray-200 rounded animate-pulse" />
						<div className="w-px h-[25px] bg-[#92969f]/30" />
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
