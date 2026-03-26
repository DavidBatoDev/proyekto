import { useQueries, useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Clock3, FolderOpen, ShieldCheck } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { getRoadmapFull, getRoadmaps } from "@/api";
import { type Project, projectService } from "@/services/project.service";
import { projectTimeService } from "@/services/project-time.service";
import { useAuthStore, useUser } from "@/stores/authStore";

type ActionItem = {
	id: string;
	title: string;
	subtitle: string;
	status: string;
};

type TimelineItem = {
	id: string;
	title: string;
	roadmapName: string;
	targetDate: string;
	assigneeId?: string | null;
	actualHours?: number;
	status?: string;
	projectId?: string | null;
};

type DashboardRole = "client" | "consultant" | "freelancer";

const PERSONA_UI: Record<
	DashboardRole,
	{
		badgeLabel: string;
		badgeClass: string;
		workloadSubtext: string;
		primaryMetricLabel: string;
		secondaryMetricLabel: string;
		timelineTitle: string;
		timelineSubtitle: string;
		timelineEmptyTitle: string;
		timelineEmptySubtitle: string;
		attentionTitle: string;
		attentionSubtitle: string;
		attentionEmptyTitle: string;
		attentionEmptySubtitle: string;
	}
> = {
	client: {
		badgeLabel: "Client View",
		badgeClass: "bg-blue-100 text-blue-700",
		workloadSubtext:
			"Here is a quick view of your project portfolio and approval pipeline.",
		primaryMetricLabel: "ACTIVE PROJECTS",
		secondaryMetricLabel: "PENDING PROJECTS",
		timelineTitle: "Upcoming Milestones",
		timelineSubtitle:
			"Track upcoming roadmap deadlines and delivery checkpoints.",
		timelineEmptyTitle: "No upcoming milestones",
		timelineEmptySubtitle:
			"Milestones with future target dates will appear here.",
		attentionTitle: "Needs Your Attention",
		attentionSubtitle:
			"Review approvals and unblock project work that needs your decision.",
		attentionEmptyTitle: "No approvals pending",
		attentionEmptySubtitle:
			"Milestone and roadmap approvals will appear here when consultant updates are ready for your review.",
	},
	consultant: {
		badgeLabel: "Consultant View",
		badgeClass: "bg-violet-100 text-violet-700",
		workloadSubtext:
			"Here is a quick view of your consultant delivery workload and reviews.",
		primaryMetricLabel: "ACTIVE PROJECTS",
		secondaryMetricLabel: "TIME TO REVIEW",
		timelineTitle: "Upcoming Milestones",
		timelineSubtitle: "Track client commitments and upcoming delivery targets.",
		timelineEmptyTitle: "No upcoming milestones",
		timelineEmptySubtitle:
			"Milestones with future target dates will appear here.",
		attentionTitle: "Needs Your Attention",
		attentionSubtitle:
			"Review paused, draft, and bidding items that need consultant action.",
		attentionEmptyTitle: "Nothing urgent right now",
		attentionEmptySubtitle:
			"New items will appear here when something needs your action.",
	},
	freelancer: {
		badgeLabel: "Freelancer View",
		badgeClass: "bg-emerald-100 text-emerald-700",
		workloadSubtext:
			"Here is your delivery view with assigned deadlines and execution hours.",
		primaryMetricLabel: "ASSIGNED TASKS",
		secondaryMetricLabel: "HOURS LOGGED",
		timelineTitle: "My Upcoming Deadlines",
		timelineSubtitle: "Track your task due dates across active workspaces.",
		timelineEmptyTitle: "No upcoming deadlines",
		timelineEmptySubtitle:
			"Task due dates with upcoming deadlines will appear here.",
		attentionTitle: "Tasks",
		attentionSubtitle: "Execution-focused items that need your action now.",
		attentionEmptyTitle: "Nothing urgent right now",
		attentionEmptySubtitle:
			"Task execution priorities will appear here when work is assigned.",
	},
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

	if (isClient && isConsultant) return activePersona;
	if (isClient) return "client";
	if (isConsultant) return "consultant";
	return "freelancer";
}

function formatDateLabel(value: string): string {
	return new Date(value).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function startOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toProjectActionItem(project: Project): ActionItem | null {
	const status = (project.status || "").toLowerCase();

	if (status === "draft") {
		return {
			id: `draft-${project.id}`,
			title: `Finalize scope for "${project.title}"`,
			subtitle: "Confirm scope details so this project can move forward.",
			status: "Draft",
		};
	}

	if (status === "bidding") {
		return {
			id: `bidding-${project.id}`,
			title: `Review bids for "${project.title}"`,
			subtitle: "Compare applicants and approve the best next step.",
			status: "Bidding",
		};
	}

	if (status === "paused") {
		return {
			id: `paused-${project.id}`,
			title: `Unblock paused project "${project.title}"`,
			subtitle: "Resolve pending blockers to resume roadmap delivery.",
			status: "Paused",
		};
	}

	return null;
}

export function DashboardWidgets({
	leadContent,
	children,
}: {
	leadContent?: ReactNode;
	children?: ReactNode;
}) {
	const user = useUser();
	const { profile } = useAuthStore();
	const persona = normalizePersona(profile?.active_persona);
	const ui = PERSONA_UI[persona];
	const isFreelancer = persona === "freelancer";
	const projectsQuery = useQuery({
		queryKey: ["dashboard", "projects", "widgets"],
		queryFn: () => projectService.listDashboardProjects(),
		staleTime: 0,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		retry: 1,
	});
	const timelineQuery = useQuery({
		queryKey: ["dashboard", "timeline-roadmaps"],
		queryFn: async () => {
			const roadmaps = await getRoadmaps();
			const roadmapDetails = await Promise.all(
				roadmaps.map(async (roadmap) => {
					try {
						return await getRoadmapFull(roadmap.id);
					} catch {
						return null;
					}
				}),
			);
			return roadmapDetails.filter(
				(roadmap): roadmap is NonNullable<typeof roadmap> => Boolean(roadmap),
			);
		},
		staleTime: 0,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		retry: 1,
	});
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];
	const isProjectsLoading = projectsQuery.isPending;
	const isMilestonesLoading = timelineQuery.isPending;

	const {
		upcomingMilestones,
		upcomingDeadlines,
		hoursLoggedByProject,
		hoursLoggedByFreelancerAssignee,
	} = useMemo(() => {
		const validRoadmaps = timelineQuery.data ?? [];
		const today = startOfToday().getTime();

		const milestones = validRoadmaps
			.flatMap((roadmap: any) =>
				(roadmap.milestones || []).map((milestone: any) => ({
					id: milestone.id,
					title: milestone.title,
					roadmapName: roadmap.name,
					targetDate: milestone.target_date,
					projectId: roadmap.project_id || null,
				})),
			)
			.filter((item: TimelineItem) => {
				if (!item.targetDate) return false;
				const parsed = new Date(item.targetDate).getTime();
				return Number.isFinite(parsed) && parsed >= today;
			})
			.sort(
				(a: TimelineItem, b: TimelineItem) =>
					new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime(),
			)
			.slice(0, 6);

		const deadlines = validRoadmaps
			.flatMap((roadmap: any) =>
				(roadmap.epics || []).flatMap((epic: any) =>
					(epic.features || []).flatMap((feature: any) =>
						(feature.tasks || []).map((task: any) => ({
							id: task.id,
							title: task.title || "Task",
							roadmapName: roadmap.name,
							targetDate: task.due_date,
							assigneeId: task.assignee_id,
							actualHours: Number(task.actual_hours || 0),
							status: String(task.status || "").toLowerCase(),
							projectId: roadmap.project_id || null,
						})),
					),
				),
			)
			.filter((item: TimelineItem) => {
				if (!item.targetDate) return false;
				const parsed = new Date(item.targetDate).getTime();
				return Number.isFinite(parsed) && parsed >= today;
			})
			.sort(
				(a: TimelineItem, b: TimelineItem) =>
					new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime(),
			)
			.slice(0, 6);

		const freelancerDeadlines = deadlines.filter((item: TimelineItem) =>
			user?.id ? item.assigneeId === user.id : true,
		);

		const totalHours = deadlines.reduce(
			(sum, task) => sum + Number(task.actualHours || 0),
			0,
		);

		const totalFreelancerTaskHours = deadlines.reduce((sum, task) => {
			if (user?.id && task.assigneeId !== user.id) return sum;
			return sum + Number(task.actualHours || 0);
		}, 0);

		return {
			upcomingMilestones: milestones,
			upcomingDeadlines: freelancerDeadlines,
			hoursLoggedByProject: totalHours,
			hoursLoggedByFreelancerAssignee: totalFreelancerTaskHours,
		};
	}, [timelineQuery.data, user?.id]);

	const personaProjects = useMemo(() => {
		if (!user?.id) return [] as Project[];
		return projects.filter(
			(project) => resolveProjectRole(project, user.id, persona) === persona,
		);
	}, [persona, projects, user?.id]);

	const consultantProjects = useMemo(() => {
		if (!user?.id) return [] as Project[];
		return projects.filter(
			(project) =>
				resolveProjectRole(project, user.id, persona) === "consultant",
		);
	}, [persona, projects, user?.id]);

	const projectActiveCount = useMemo(() => projects.length, [projects]);

	const clientPendingProjectsCount = useMemo(
		() =>
			projects.filter(
				(project) => String(project.status || "").toLowerCase() === "bidding",
			).length,
		[projects],
	);

	const consultantPendingApprovalQueries = useQueries({
		queries:
			persona === "consultant"
				? consultantProjects.map((project) => ({
						queryKey: [
							"dashboard",
							"consultant",
							"pending-approvals",
							project.id,
							user?.id ?? "anonymous",
						] as const,
						queryFn: async () => {
							try {
								const result = await projectTimeService.listApprovals(
									project.id,
									{
										status: "pending",
										page: 1,
										limit: 1,
									},
								);
								return Number(result.total || 0);
							} catch (error) {
								console.warn(
									"[DashboardWidgets] Failed to fetch pending approvals",
									project.id,
									error,
								);
								return 0;
							}
						},
						enabled: Boolean(project.id),
						staleTime: 0,
						refetchOnMount: true,
						refetchOnWindowFocus: true,
						refetchOnReconnect: true,
						retry: 1,
					}))
				: [],
	});

	const consultantPendingApprovalsCount = useMemo(
		() =>
			consultantPendingApprovalQueries.reduce(
				(sum, query) => sum + Number(query.data || 0),
				0,
			),
		[consultantPendingApprovalQueries],
	);

	const consultantPendingApprovalsLoading =
		persona === "consultant" &&
		(consultantPendingApprovalQueries.length > 0
			? consultantPendingApprovalQueries.some((query) => query.isPending)
			: false);

	const freelancerActionItems = useMemo(() => {
		if (upcomingDeadlines.length > 0) {
			return upcomingDeadlines.slice(0, 5).map((item) => ({
				id: `deadline-${item.id}`,
				title: `Deliver "${item.title}"`,
				subtitle: `${item.roadmapName} - due ${formatDateLabel(item.targetDate)}`,
				status: "Due",
			}));
		}

		return personaProjects.slice(0, 5).map((project) => ({
			id: `project-${project.id}`,
			title: `Stay ready for "${project.title}"`,
			subtitle:
				"No assigned deadlines yet. Keep your profile and availability updated.",
			status: "Standby",
		}));
	}, [personaProjects, upcomingDeadlines]);

	const projectActionItems = useMemo(
		() =>
			personaProjects
				.map(toProjectActionItem)
				.filter((item): item is ActionItem => item !== null)
				.slice(0, 5),
		[personaProjects],
	);

	const actionItems = isFreelancer ? freelancerActionItems : projectActionItems;
	const primaryMetricValue = isFreelancer
		? upcomingDeadlines.length
		: projectActiveCount;
	const secondaryMetricValue = isFreelancer
		? Math.round(hoursLoggedByFreelancerAssignee || hoursLoggedByProject)
		: persona === "client"
			? clientPendingProjectsCount
			: consultantPendingApprovalsCount;
	const secondaryMetricLoading = isFreelancer
		? isMilestonesLoading
		: persona === "consultant"
			? consultantPendingApprovalsLoading
			: isProjectsLoading;

	const greetingName =
		profile?.display_name ||
		profile?.first_name ||
		(profile?.email ? profile.email.split("@")[0] : "User");

	const scrollToProjects = () => {
		const projectsSection =
			document.querySelector('[data-tutorial="projects-grid"]') ??
			document.getElementById("my-project-visions") ??
			document.querySelector('[data-roadmaps-section="my-roadmaps-section"]') ??
			document.getElementById("my-roadmaps-section") ??
			document.querySelector('[data-tutorial="projects-grid"]');
		if (projectsSection instanceof HTMLElement) {
			projectsSection.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	};

	const scrollToAttention = () => {
		const attentionSection = document.querySelector(
			'[data-dashboard-section="needs-your-attention"]',
		);
		if (attentionSection instanceof HTMLElement) {
			attentionSection.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	};

	const timelineItems = isFreelancer ? upcomingDeadlines : upcomingMilestones;

	return (
		<div className="space-y-6" data-theme={persona}>
			{leadContent}

			<section className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-6">
				<div className="space-y-6 min-w-0">
					<div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
						<div className="mb-6">
							<div className="flex items-center justify-between gap-2">
								<h2 className="text-[20px] font-semibold text-[#333438]">
									Welcome back, {greetingName}
								</h2>
								<span
									className={`text-[11px] font-semibold px-2 py-1 rounded-full ${ui.badgeClass}`}
								>
									{ui.badgeLabel}
								</span>
							</div>
							<p className="text-xs text-[#61636c] mt-1">
								{ui.workloadSubtext}
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<button
								type="button"
								onClick={scrollToProjects}
								className="group relative overflow-hidden rounded-lg p-6 bg-white shadow-sm text-left cursor-pointer transition-all duration-200 hover:shadow-md"
							>
								<span
									className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl opacity-25"
									style={{ backgroundColor: "var(--secondary)" }}
								/>
								<span
									className="pointer-events-none absolute -bottom-12 -left-12 w-32 h-32 rounded-full blur-3xl opacity-12"
									style={{ backgroundColor: "var(--secondary)" }}
								/>
								<span className="absolute top-4 right-4 text-slate-500 transition-colors duration-200 group-hover:text-[var(--secondary)]">
									{"->"}
								</span>
								<p className="relative z-10 text-xs font-semibold tracking-wider text-[#61636c] uppercase mb-3 flex items-center gap-2">
									{isFreelancer ? (
										<ClipboardCheck className="w-4 h-4 text-slate-400" />
									) : (
										<FolderOpen className="w-4 h-4 text-slate-400" />
									)}
									{ui.primaryMetricLabel}
								</p>
								<p className="relative z-10 text-4xl font-bold text-slate-900">
									{isProjectsLoading ? "..." : primaryMetricValue}
								</p>
							</button>
							<button
								type="button"
								onClick={scrollToAttention}
								className="group relative overflow-hidden rounded-lg p-6 bg-white shadow-sm text-left cursor-pointer transition-all duration-200 hover:shadow-md"
							>
								<span
									className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl opacity-25"
									style={{ backgroundColor: "var(--secondary)" }}
								/>
								<span
									className="pointer-events-none absolute -bottom-12 -left-12 w-32 h-32 rounded-full blur-3xl opacity-12"
									style={{ backgroundColor: "var(--secondary)" }}
								/>
								<span className="absolute top-4 right-4 text-slate-500 transition-colors duration-200 group-hover:text-[var(--secondary)]">
									{"->"}
								</span>
								<p className="relative z-10 text-xs font-semibold tracking-wider text-[#61636c] uppercase mb-3 flex items-center gap-2">
									{isFreelancer ? (
										<Clock3 className="w-4 h-4 text-slate-400" />
									) : persona === "client" ? (
										<ShieldCheck className="w-4 h-4 text-slate-400" />
									) : (
										<Clock3 className="w-4 h-4 text-slate-400" />
									)}
									{ui.secondaryMetricLabel}
								</p>
								<p className="relative z-10 text-4xl font-bold text-slate-900">
									{secondaryMetricLoading ? "..." : secondaryMetricValue}
								</p>
							</button>
						</div>
					</div>

					{children ? <div className="space-y-8">{children}</div> : null}
				</div>

				<div className="xl:sticky xl:top-6 self-start space-y-4 min-w-0">
					<div className="bg-slate-50 border border-slate-200 rounded-xl shadow-sm p-6">
						<div className="mb-3">
							<h3 className="text-[20px] font-semibold text-[#333438]">
								{ui.timelineTitle}
							</h3>
							<p className="text-xs text-[#61636c] mt-1">
								{ui.timelineSubtitle}
							</p>
						</div>

						{isMilestonesLoading ? (
							<p className="text-sm text-[#61636c]">
								Loading milestone timeline...
							</p>
						) : timelineItems.length === 0 ? (
							<div className="bg-[#f6f7f8] rounded-lg p-4">
								<p className="text-sm font-semibold text-[#333438] mb-1">
									{ui.timelineEmptyTitle}
								</p>
								<p className="text-xs text-[#61636c]">
									{ui.timelineEmptySubtitle}
								</p>
							</div>
						) : (
							<div className="space-y-5">
								{timelineItems.map((item, index, arr) => {
									const isLast = index === arr.length - 1;
									const isCurrent = index === 0;
									const isNext = index === 1;
									const isUpcoming = index > 1;
									const circleBaseClass = "w-3 h-3 rounded-full shrink-0";
									const connectorColor =
										index === 0 ? "var(--secondary)" : "rgb(226 232 240)";

									return (
										<div key={item.id} className="flex items-start gap-3">
											<div className="flex flex-col items-center pt-1 shrink-0 w-4">
												<span
													className={circleBaseClass}
													style={
														isCurrent
															? { backgroundColor: "var(--secondary)" }
															: isNext
																? {
																		backgroundColor: "white",
																		border: "2px solid var(--secondary)",
																	}
																: {
																		backgroundColor: "white",
																		border: "2px solid rgb(203 213 225)",
																	}
													}
												/>
												{!isLast ? (
													<span
														className="w-px flex-1 mt-1 min-h-8"
														style={{ backgroundColor: connectorColor }}
													/>
												) : null}
											</div>

											<div className="flex-1 min-w-0 pb-1">
												<p
													className={`text-xs ${
														isCurrent || isNext
															? "text-[#61636c]"
															: "text-[#92969f]"
													}`}
												>
													{formatDateLabel(item.targetDate)}
												</p>
												<p
													className={`mt-1 text-[14px] font-semibold ${isUpcoming ? "text-[#61636c]" : "text-[#333438]"}`}
												>
													{item.title}
												</p>
												<p className="text-xs text-[#61636c] mt-0.5">
													{item.roadmapName}
												</p>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>

					<div
						data-dashboard-section="needs-your-attention"
						className="bg-slate-50 border border-slate-200 rounded-xl shadow-sm p-6 scroll-mt-6"
					>
						<div className="mb-3">
							<h3 className="text-[20px] font-semibold text-[#333438]">
								{ui.attentionTitle}
							</h3>
							<p className="text-xs text-[#61636c] mt-1">
								{ui.attentionSubtitle}
							</p>
						</div>

						{isProjectsLoading ? (
							<p className="text-sm text-[#61636c]">Loading pending items...</p>
						) : actionItems.length === 0 ? (
							<div className="bg-white rounded-lg p-4 border border-slate-200">
								<p className="text-sm font-semibold text-[#333438] mb-1">
									{ui.attentionEmptyTitle}
								</p>
								<p className="text-xs text-[#61636c]">
									{ui.attentionEmptySubtitle}
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{actionItems.map((item) => (
									<div
										key={item.id}
										className="bg-white rounded-lg p-4 flex items-start justify-between gap-3 border border-slate-200 transition-shadow hover:shadow-sm"
									>
										<div className="min-w-0 flex items-start gap-3">
											<span className="w-2 h-2 rounded-full bg-orange-400 mt-1.5 shrink-0" />
											<div>
												<p className="text-[14px] font-semibold text-[#333438]">
													{item.title}
												</p>
												<p className="text-xs text-[#61636c] mt-1">
													{item.subtitle}
												</p>
											</div>
										</div>
										<span className="text-[11px] text-[#92969f] whitespace-nowrap">
											{item.status}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}

export { DashboardWidgets as ConsultantDashboardWidgets };
