import { useQuery } from "@tanstack/react-query";
import { FolderOpen, ShieldCheck } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { getRoadmapsPreview, type RoadmapPreview } from "@/api/endpoints/roadmap";
import { type Project, projectService } from "@/services/project.service";
import { useAuthStore, useUser } from "@/stores/authStore";

type ActivityItem = {
	id: string;
	taskId: string;
	taskTitle: string;
	taskStatus: string;
	assigneeId?: string | null;
	assigneeName: string;
	assigneeAvatarUrl?: string | null;
	projectId?: string | null;
	projectTitle: string;
	roadmapName: string;
	dueDate?: string | null;
	updatedAt?: string | null;
	isAssignedToCurrentUser: boolean;
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

function formatTaskStatus(status: string): string {
	switch (status) {
		case "todo":
			return "To Do";
		case "in_progress":
			return "In Progress";
		case "in_review":
			return "In Review";
		case "blocked":
			return "Blocked";
		default:
			return "Open";
	}
}

function getInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
	if (parts.length === 0) return "?";
	return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function getActivityStatusPriority(status: string): number {
	if (status === "in_review") return 3;
	return 0;
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
	const projectsQueryKey = ["dashboard", "projects", user?.id ?? "anonymous"] as const;
	const projectsQuery = useQuery({
		queryKey: projectsQueryKey,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(user?.id),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	const timelineQuery = useQuery({
		queryKey: ["dashboard", "roadmaps-preview"],
		queryFn: () => getRoadmapsPreview(),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];
	const isProjectsLoading = projectsQuery.isPending;
	const isMilestonesLoading = timelineQuery.isPending;

	const upcomingMilestones = useMemo(() => {
		const validRoadmaps = (timelineQuery.data ?? []) as RoadmapPreview[];
		const today = startOfToday().getTime();

		return validRoadmaps
			.flatMap((roadmap) =>
				(roadmap.milestones || []).map((milestone) => ({
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
	}, [timelineQuery.data]);

	const projectActiveCount = useMemo(() => projects.length, [projects]);

	const clientPendingProjectsCount = useMemo(
		() =>
			projects.filter(
				(project) => String(project.status || "").toLowerCase() === "bidding",
			).length,
		[projects],
	);

	const projectTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const project of projects) {
			map.set(project.id, project.title);
		}
		return map;
	}, [projects]);

	const activityItems = useMemo(() => {
		const validRoadmaps = (timelineQuery.data ?? []) as RoadmapPreview[];
		const currentUserId = user?.id ?? null;

		const flattened = validRoadmaps.flatMap(
			(roadmap, roadmapIndex: number) =>
				(roadmap.epics || []).flatMap((epic, epicIndex: number) =>
					(epic.features || []).flatMap((feature, featureIndex: number) =>
						(feature.tasks || [])
							.filter(
								(task) =>
									String(task.status || "").toLowerCase() !== "done",
							)
							.map((task, taskIndex: number) => {
								const taskStatus = String(task.status || "").toLowerCase();
								const assigneeName =
									task.assignee?.display_name ||
									`${task.assignee?.first_name || ""} ${task.assignee?.last_name || ""}`.trim() ||
									task.assignee?.email ||
									(task.assignee_id ? "Assigned user" : "Unassigned");
								const projectId = roadmap.project_id || null;
								const projectTitle =
									roadmap.project?.title ||
									(projectId ? projectTitleById.get(projectId) : undefined) ||
									roadmap.name ||
									"Unlinked project";

								return {
									id: `activity-${roadmap.id || roadmapIndex}-${feature.id || featureIndex}-${task.id || taskIndex}`,
									taskId: String(
										task.id ||
											`${roadmapIndex}-${epicIndex}-${featureIndex}-${taskIndex}`,
									),
									taskTitle: task.title || "Task",
									taskStatus,
									assigneeId: task.assignee_id || null,
									assigneeName,
									assigneeAvatarUrl: task.assignee?.avatar_url || null,
									projectId,
									projectTitle,
									roadmapName: roadmap.name || "Roadmap",
									dueDate: task.due_date || null,
									updatedAt: task.updated_at || roadmap.updated_at || null,
									isAssignedToCurrentUser: Boolean(
										currentUserId && task.assignee_id === currentUserId,
									),
								} satisfies ActivityItem;
							}),
					),
				),
		);

		return flattened
			.sort((a, b) => {
				const assignedDiff =
					Number(b.isAssignedToCurrentUser) - Number(a.isAssignedToCurrentUser);
				if (assignedDiff !== 0) return assignedDiff;

				const statusDiff =
					getActivityStatusPriority(b.taskStatus) -
					getActivityStatusPriority(a.taskStatus);
				if (statusDiff !== 0) return statusDiff;

				const aDue = a.dueDate
					? new Date(a.dueDate).getTime()
					: Number.POSITIVE_INFINITY;
				const bDue = b.dueDate
					? new Date(b.dueDate).getTime()
					: Number.POSITIVE_INFINITY;
				if (aDue !== bDue) return aDue - bDue;

				const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
				const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
				if (aUpdated !== bUpdated) return bUpdated - aUpdated;

				return a.id.localeCompare(b.id);
			})
			.slice(0, 5);
	}, [timelineQuery.data, user?.id, projectTitleById]);

	const primaryMetricValue = projectActiveCount;
	const secondaryMetricValue = clientPendingProjectsCount;
	const secondaryMetricLoading = isProjectsLoading;
	const activityLoading = isMilestonesLoading;

	const greetingName =
		profile?.display_name ||
		profile?.first_name ||
		(profile?.email ? profile.email.split("@")[0] : "User");

	const scrollToProjects = () => {
		const projectsSection =
			document.querySelector('[data-tutorial="projects-grid"]') ??
			document.getElementById("my-projects") ??
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

	return (
		<div className="space-y-6 app-slide-up">
			{leadContent}

			<section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
				<div className="space-y-6 min-w-0">
					<div className="app-surface-card-strong p-8">
						<div className="mb-6">
							<h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
								Welcome back, {greetingName}
							</h2>
							<p className="mt-1 text-sm text-slate-600">
								Here is a quick view of your project portfolio and delivery milestones.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<button
								type="button"
								onClick={scrollToProjects}
								className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
							>
								<span
									className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl opacity-25"
									style={{ backgroundColor: "#0f172a" }}
								/>
								<span
									className="pointer-events-none absolute -bottom-12 -left-12 w-32 h-32 rounded-full blur-3xl opacity-12"
									style={{ backgroundColor: "#0f172a" }}
								/>
								<span className="absolute top-4 right-4 text-slate-500 transition-colors duration-200 group-hover:text-slate-900">
									{"->"}
								</span>
								<p className="relative z-10 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
									<FolderOpen className="w-4 h-4 text-slate-400" />
									ACTIVE PROJECTS
								</p>
								<p className="relative z-10 text-4xl font-semibold text-slate-900">
									{isProjectsLoading ? "..." : primaryMetricValue}
								</p>
							</button>
							<button
								type="button"
								onClick={scrollToAttention}
								className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
							>
								<span
									className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl opacity-25"
									style={{ backgroundColor: "#0f172a" }}
								/>
								<span
									className="pointer-events-none absolute -bottom-12 -left-12 w-32 h-32 rounded-full blur-3xl opacity-12"
									style={{ backgroundColor: "#0f172a" }}
								/>
								<span className="absolute top-4 right-4 text-slate-500 transition-colors duration-200 group-hover:text-slate-900">
									{"->"}
								</span>
								<p className="relative z-10 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
									<ShieldCheck className="w-4 h-4 text-slate-400" />
									PENDING PROJECTS
								</p>
								<p className="relative z-10 text-4xl font-semibold text-slate-900">
									{secondaryMetricLoading ? "..." : secondaryMetricValue}
								</p>
							</button>
						</div>
					</div>

					{children ? <div className="space-y-8">{children}</div> : null}
				</div>

				<div className="xl:sticky xl:top-24 self-start space-y-4 min-w-0">
					<div className="app-surface-card p-6">
						<div className="mb-3">
							<h3 className="text-[20px] font-semibold tracking-tight text-slate-900">
								Upcoming Milestones
							</h3>
							<p className="mt-1 text-xs text-slate-600">
								Track upcoming roadmap deadlines and delivery checkpoints.
							</p>
						</div>

						{isMilestonesLoading ? (
							<p className="text-sm text-slate-600">
								Loading milestone timeline...
							</p>
						) : upcomingMilestones.length === 0 ? (
							<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
								<p className="mb-1 text-sm font-semibold text-slate-900">
									No upcoming milestones
								</p>
								<p className="text-xs text-slate-600">
									Milestones with future target dates will appear here.
								</p>
							</div>
						) : (
							<div className="space-y-5">
								{upcomingMilestones.map((item, index, arr) => {
									const isLast = index === arr.length - 1;
									const isCurrent = index === 0;
									const isNext = index === 1;
									const isUpcoming = index > 1;
									const circleBaseClass = "w-3 h-3 rounded-full shrink-0";
									const connectorColor =
										index === 0 ? "#0f172a" : "rgb(226 232 240)";

									return (
										<div key={item.id} className="flex items-start gap-3">
											<div className="flex flex-col items-center pt-1 shrink-0 w-4">
												<span
													className={circleBaseClass}
													style={
														isCurrent
															? { backgroundColor: "#0f172a" }
															: isNext
																? {
																		backgroundColor: "white",
																		border: "2px solid #334155",
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
															? "text-slate-600"
															: "text-slate-400"
													}`}
												>
													{formatDateLabel(item.targetDate)}
												</p>
												<p
													className={`mt-1 text-[14px] font-semibold ${isUpcoming ? "text-slate-700" : "text-slate-900"}`}
												>
													{item.title}
												</p>
												<p className="mt-0.5 text-xs text-slate-600">
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
						className="app-surface-card p-6 scroll-mt-6"
					>
						<div className="mb-3">
							<h3 className="text-[20px] font-semibold tracking-tight text-slate-900">
								Activity
							</h3>
							<p className="mt-1 text-xs text-slate-600">
								Track open roadmap tasks that need review and coordination.
							</p>
						</div>

						{activityLoading ? (
							<p className="text-sm text-slate-600">Loading activity...</p>
						) : activityItems.length === 0 ? (
							<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
								<p className="mb-1 text-sm font-semibold text-slate-900">
									No activity right now
								</p>
								<p className="text-xs text-slate-600">
									Open tasks will appear here when roadmap execution starts.
								</p>
							</div>
						) : (
							<div className="space-y-2">
								{activityItems.map((item) => (
									<div
										key={item.id}
										className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-shadow hover:shadow-sm"
									>
										<div className="flex items-start gap-2.5 min-w-0">
											<div className="shrink-0 mt-0.5">
												{item.assigneeAvatarUrl ? (
													<img
														src={item.assigneeAvatarUrl}
														alt={item.assigneeName}
														className="h-6 w-6 rounded-full object-cover"
													/>
												) : (
													<span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">
														{getInitials(item.assigneeName)}
													</span>
												)}
											</div>

											<div className="min-w-0 flex-1">
												<div className="flex items-center justify-between gap-2">
													<p className="truncate text-[13px] font-semibold text-slate-900">
														{item.taskTitle}
													</p>
													<span className="whitespace-nowrap text-[10px] text-slate-500">
														{formatTaskStatus(item.taskStatus)}
													</span>
												</div>
												<p className="truncate text-[11px] text-slate-600">
													{item.projectTitle} · {item.assigneeName}
												</p>
											</div>

											<div className="shrink-0 whitespace-nowrap pl-1 text-[10px] text-slate-500">
												{item.dueDate
													? formatDateLabel(item.dueDate)
													: item.roadmapName}
											</div>
										</div>
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
