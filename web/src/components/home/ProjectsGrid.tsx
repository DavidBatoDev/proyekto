import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Calendar, Clock, Inbox, User } from "lucide-react";
import { useEffect, useMemo } from "react";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { supabase } from "@/lib/supabase";
import {
	type Project,
	type ProjectInvite,
	projectService,
} from "@/services/project.service";
import { useAuthStore, useUser } from "@/stores/authStore";

type DashboardRole = "client" | "consultant" | "freelancer";
type ProjectWithRole = { project: Project; role: DashboardRole };
type DashboardCard =
	| { kind: "invite"; invite: ProjectInvite }
	| { kind: "project"; item: ProjectWithRole };

const PROJECT_STATUS_CONFIG: Record<
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

const ROLE_CONFIG: Record<
	DashboardRole,
	{ label: string; badgeClass: string }
> = {
	client: {
		label: "Client",
		badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
	},
	consultant: {
		label: "Consultant",
		badgeClass: "bg-violet-100 text-violet-700 border-violet-200",
	},
	freelancer: {
		label: "Freelancer",
		badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
	},
};

const PRIMARY_SECTION_TITLE: Record<DashboardRole, string> = {
	client: "My Client Projects",
	consultant: "My Consultant Projects",
	freelancer: "My Freelancer Projects",
};

function normalizePersona(persona: string | undefined): DashboardRole {
	if (
		persona === "consultant" ||
		persona === "freelancer" ||
		persona === "client"
	) {
		return persona;
	}
	return "client";
}

function resolveProjectRole(
	project: Project,
	userId: string,
	activePersona: DashboardRole,
): DashboardRole {
	const isClient = project.client_id === userId;
	const isConsultant = project.consultant_id === userId;

	if (isClient && isConsultant) {
		return activePersona;
	}
	if (isClient) {
		return "client";
	}
	if (isConsultant) {
		return "consultant";
	}
	return "freelancer";
}

function primaryEmptyCopy(persona: DashboardRole): {
	title: string;
	description: string;
} {
	if (persona === "freelancer") {
		return {
			title: "No freelancer projects yet",
			description:
				"Once you are added to projects, they will appear here under your freelancer role.",
		};
	}
	if (persona === "consultant") {
		return {
			title: "No consultant projects yet",
			description:
				"Projects assigned to you as consultant will appear here for active delivery.",
		};
	}
	return {
		title: "No client projects yet",
		description:
			"Post your first project vision to begin consultant matching and move into roadmap execution.",
	};
}

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
	const { profile } = useAuthStore();
	const persona = normalizePersona(profile?.active_persona);
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
	const shouldMixInvitesIntoPrimary = persona === "freelancer";
	const isLoading =
		projectsQuery.isPending ||
		(shouldMixInvitesIntoPrimary && invitesQuery.isPending);

	const groupedProjects = useMemo(() => {
		if (!user?.id) {
			return {
				primaryCards: [] as DashboardCard[],
				otherProjects: [] as ProjectWithRole[],
			};
		}

		const resolved = projects.map((project) => ({
			project,
			role: resolveProjectRole(project, user.id, persona),
		}));

		const primaryProjectCards: DashboardCard[] = resolved
			.filter((item) => item.role === persona)
			.map((item) => ({ kind: "project", item }));

		const inviteCards: DashboardCard[] = shouldMixInvitesIntoPrimary
			? pendingInvites.map((invite) => ({ kind: "invite", invite }))
			: [];

		return {
			primaryCards: [...inviteCards, ...primaryProjectCards],
			otherProjects: resolved.filter((item) => item.role !== persona),
		};
	}, [pendingInvites, persona, projects, shouldMixInvitesIntoPrimary, user?.id]);

	const { primaryCards, otherProjects } = groupedProjects;
	const invitationCards = useMemo(
		() =>
			shouldMixInvitesIntoPrimary
				? []
				: pendingInvites.map(
						(invite): DashboardCard => ({ kind: "invite", invite }),
					),
		[pendingInvites, shouldMixInvitesIntoPrimary],
	);
	const emptyCopy = primaryEmptyCopy(persona);

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
			id="my-project-visions"
			data-tutorial="projects-grid"
			className="scroll-mt-6"
		>
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<div
						className="w-[18px] h-[18px] rounded-full"
						style={{ backgroundColor: "var(--secondary)" }}
					/>
					<h2 className="text-[20px] font-semibold text-[#333438]">
						MY PROJECT VISIONS
					</h2>
				</div>
				<button
					type="button"
					className="text-[20px] font-semibold text-[#333438] hover:text-[var(--secondary)]"
				>
					View All →
				</button>
			</div>

			<ProjectsSection
				title={PRIMARY_SECTION_TITLE[persona]}
				cards={primaryCards}
				isLoading={isLoading}
				emptyTitle={emptyCopy.title}
				emptyDescription={emptyCopy.description}
			/>

			{invitationCards.length > 0 && (
				<div className="mt-8">
					<ProjectsSection
						title="Project Invitations"
						cards={invitationCards}
						isLoading={invitesQuery.isPending}
						emptyTitle="No pending invitations"
						emptyDescription="Pending project invitations will appear here."
					/>
				</div>
			)}

			{otherProjects.length > 0 && (
				<div className="mt-8">
					<ProjectsSection
						title="Other Projects"
						cards={otherProjects.map((item) => ({ kind: "project", item }))}
						isLoading={false}
						emptyTitle="No other projects"
						emptyDescription="Projects where your role is different from your current persona will appear here."
					/>
				</div>
			)}

		</div>
	);
}

function ProjectsSection({
	title,
	cards,
	isLoading,
	emptyTitle,
	emptyDescription,
}: {
	title: string;
	cards: DashboardCard[];
	isLoading: boolean;
	emptyTitle: string;
	emptyDescription: string;
}) {
	return (
		<section>
			<div className="mb-3">
				<h3 className="text-[16px] font-semibold text-[#333438]">{title}</h3>
			</div>
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
							(card.item.project.status || "").toLowerCase()
						] ?? {
							label: card.item.project.status || "Unknown",
							color: "#9c27b0",
							badgeClass: "bg-purple-100 text-purple-700 border-purple-200",
						};
						const roleConfig = ROLE_CONFIG[card.item.role];

						return (
							<ProjectCard
								key={card.item.project.id}
								number={index + 1}
								projectId={card.item.project.id}
								status={statusConfig.label}
								statusColor={statusConfig.color}
								statusBadgeClass={statusConfig.badgeClass}
								roleLabel={roleConfig.label}
								roleBadgeClass={roleConfig.badgeClass}
								title={card.item.project.title}
								client={card.item.project.client?.display_name || "Assigned"}
								progress={card.item.project.status === "completed" ? 100 : null}
								progressColor={statusConfig.color}
								nextUp={
									card.item.project.brief
										? "Review project brief"
										: "Add project brief"
								}
								dueDate={
									card.item.project.custom_start_date ||
									card.item.project.start_date ||
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
			className="group bg-linear-to-b from-amber-50 to-white rounded-xl shadow-sm p-4 h-[385px] flex flex-col border border-amber-200 transition-all hover:border-amber-300 hover:shadow-xl text-left"
		>
			<div className="flex-1 space-y-6">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<span className="text-[16px] font-semibold text-[#b45309]">
							#{number}
						</span>
						<div className="w-px h-[25px] bg-amber-300" />
						<span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
							Pending Invite
						</span>
					</div>
					<h3 className="text-[18px] font-bold text-[#333438] mb-2 line-clamp-2">
						{invite.project?.title || "Project invitation"}
					</h3>
					<p className="text-[13px] text-[#61636c] mb-1">
						Invited by{" "}
						<span className="font-semibold text-[#333438]">
							{invite.inviter?.display_name || "Team lead"}
						</span>
					</p>
					{invite.invited_position ? (
						<div className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-[12px] text-amber-800">
							<User className="h-3.5 w-3.5" />
							<span>{invite.invited_position}</span>
						</div>
					) : null}
				</div>

				<div className="rounded-lg border border-amber-100 bg-white px-3 py-2">
					<p className="text-[12px] font-semibold uppercase tracking-wide text-amber-700">
						Next Step
					</p>
					<p className="text-[13px] text-[#333438] mt-1">
						Review this invitation and choose to join or decline.
					</p>
				</div>

				<div className="flex items-center gap-2 text-[12px] text-[#61636c]">
					<Inbox className="h-4 w-4 text-amber-700" />
					<span>Sent {formatInviteSentLabel(invite.created_at)}</span>
				</div>
			</div>

			<div className="pt-4 border-t border-amber-100">
				<div className="flex items-center justify-end gap-1 text-[14px] font-semibold text-amber-800 uppercase transition-colors group-hover:text-amber-900">
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
			className={`rounded-xl border border-gray-200 bg-white px-6 py-10 text-center ${className ?? ""}`}
		>
			<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#ff9933]/10">
				<Calendar className="h-8 w-8 text-[#ff9933]" />
			</div>
			<h4 className="mb-2 text-lg font-semibold text-gray-900">{title}</h4>
			<p className="mx-auto max-w-md text-sm text-[#61636c]">{description}</p>
		</div>
	);
}

function ProjectCard({
	number,
	projectId,
	status,
	statusColor,
	statusBadgeClass,
	roleLabel,
	roleBadgeClass,
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
	roleLabel: string;
	roleBadgeClass: string;
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
			className="group bg-linear-to-b from-white from-98% to-transparent rounded-xl shadow-sm p-4 h-[385px] flex flex-col border border-gray-200 transition-all hover:border-[var(--secondary)] hover:shadow-xl"
			style={{
				backgroundImage: `linear-gradient(to bottom, white 98%, ${statusColor}20)`,
			}}
		>
			<div className="flex-1 space-y-6">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<span className="text-[16px] font-semibold text-[#61636c]">
							#{number}
						</span>
						<div className="w-px h-[25px] bg-[#92969f]" />
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

					<h3 className="text-[16px] font-bold text-[#333438] mb-1">{title}</h3>
					<div className="flex items-center gap-2 mb-1">
						<span className="text-[14px] font-semibold text-[#61636c]">
							Role:
						</span>
						<span
							className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${roleBadgeClass}`}
						>
							{roleLabel}
						</span>
					</div>
					<p className="text-[14px]">
						<span className="font-semibold text-[#61636c]">Client:</span>
						<span className="text-[#61636c]"> {client}</span>
					</p>
				</div>

				<div>
					<div className="flex items-center justify-between text-[12px] text-[#92969f] mb-2">
						<span>Progress</span>
						<span>
							{progress === null ? "Not tracked yet" : `${progress}%`}
						</span>
					</div>
					<div className="w-full h-2 bg-[#e3e5e8] rounded-full overflow-hidden">
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
					<Clock className="w-[18px] h-[18px] text-[#92969f] shrink-0 mt-0.5" />
					<div className="space-y-2">
						<div>
							<p className="text-[14px] font-semibold text-[#61636c]">
								NEXT UP
							</p>
							<p className="text-[14px] text-[#333438]">• {nextUp}</p>
						</div>
						{dueDate && (
							<div className="bg-[#f6f7f8] border border-[#e3e5e8] rounded-[5px] px-2 py-0.5 inline-flex items-center gap-1">
								<Calendar className="w-[18px] h-[18px] text-[#61636c]" />
								<span className="text-[12px] text-[#61636c]">{dueDate}</span>
							</div>
						)}
					</div>
				</div>
			</div>

			<div className="pt-4 border-t border-[#e3e5e8]">
				<div className="flex flex-col items-end gap-1">
					<Link
						to="/project/$projectId/overview"
						params={{ projectId }}
						className="text-[14px] font-semibold text-[#333438] uppercase transition-colors whitespace-nowrap group-hover:text-[var(--secondary)]"
					>
						VIEW PROJECT →
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
