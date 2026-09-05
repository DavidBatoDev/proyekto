import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import { DashboardCreateActions } from "@/components/home/DashboardCreateActions";
import { TourDemoBanner } from "@/components/tour/TourDemoBanner";
import { roadmapsPreviewQueryOptions } from "@/hooks/useRoadmapsPreviewQuery";
import { useTourDemo } from "@/lib/tours/demo/TourDemoContext";
import { type Meeting, meetingsService } from "@/services/meetings.service";
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

type UpcomingMeeting = Meeting & { projectTitle: string | null };

function formatMeetingTime(value: string): string {
	return new Date(value).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
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
	const projectsQueryKey = [
		"dashboard",
		"projects",
		user?.id ?? "anonymous",
	] as const;
	const projectsQuery = useQuery({
		queryKey: projectsQueryKey,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(user?.id),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	const timelineQuery = useQuery(roadmapsPreviewQueryOptions(user?.id));
	const meetingsQuery = useQuery({
		queryKey: [
			"dashboard",
			"meetings-preview",
			user?.id ?? "anonymous",
		] as const,
		queryFn: () =>
			meetingsService.list({
				status: "scheduled",
				from: new Date().toISOString(),
			}),
		enabled: Boolean(user?.id),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	// Same demo swap as the grids: fixtures stand in for the real rows during a
	// tour replay, so the meeting and activity panels have something to show.
	const projects = useTourDemo<Project[]>(
		"projects",
		(projectsQuery.data as Project[] | undefined) ?? [],
	);

	const projectTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const project of projects) {
			map.set(project.id, project.title);
		}
		return map;
	}, [projects]);

	const upcomingMeetings = useMemo((): UpcomingMeeting[] => {
		const meetings = meetingsQuery.data ?? [];
		const nowMs = Date.now();

		return meetings
			.filter((meeting) => {
				const parsed = new Date(meeting.scheduled_at).getTime();
				return Number.isFinite(parsed) && parsed >= nowMs;
			})
			.sort(
				(a, b) =>
					new Date(a.scheduled_at).getTime() -
					new Date(b.scheduled_at).getTime(),
			)
			.slice(0, 5)
			.map((meeting) => ({
				...meeting,
				projectTitle: meeting.project_id
					? (projectTitleById.get(meeting.project_id) ?? null)
					: null,
			}));
	}, [meetingsQuery.data, projectTitleById]);

	const activityItems = useMemo(() => {
		const validRoadmaps = (timelineQuery.data ?? []) as RoadmapPreview[];
		const currentUserId = user?.id ?? null;

		const flattened = validRoadmaps.flatMap((roadmap, roadmapIndex: number) =>
			(roadmap.epics || []).flatMap((epic, epicIndex: number) =>
				(epic.features || []).flatMap((feature, featureIndex: number) =>
					(feature.tasks || [])
						.filter(
							(task) => String(task.status || "").toLowerCase() !== "done",
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

		return flattened.sort((a, b) => {
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
		});
	}, [timelineQuery.data, user?.id, projectTitleById]);

	const assignedToMeCount = activityItems.filter(
		(item) => item.isAssignedToCurrentUser,
	).length;
	const nextMeeting = upcomingMeetings[0] ?? null;

	const greetingName =
		profile?.display_name ||
		profile?.first_name ||
		(profile?.email ? profile.email.split("@")[0] : "User");

	return (
		<div data-tour-demo-root className="space-y-4 app-slide-up sm:space-y-6">
			<TourDemoBanner />
			{leadContent}

			<div
				data-tour="dashboard-welcome"
				className="app-surface-card-strong p-5 sm:p-8"
			>
				<div className="mb-4 flex flex-col items-start gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-[22px]">
							Welcome back, {greetingName}
						</h2>
						<p className="mt-1 text-sm text-slate-600">
							Here is a quick view of your project portfolio and upcoming
							activity.
						</p>
					</div>
					<DashboardCreateActions />
				</div>

				{/*
				 * What the three stat tiles used to be.
				 *
				 * They were ACTIVE PROJECTS, PENDING PROJECTS and INVOICES. The
				 * first two only scrolled the page to a section already visible
				 * below, and the counts now sit in those sections' own headers,
				 * next to the things they count. Invoices lived in
				 * /marketplace/finance and read $0 for nearly everyone, and
				 * "pending" meant status='bidding' — both marketplace states on an
				 * execution page. What is left is the only question the top of a
				 * dashboard should answer: what should I do now.
				 */}
				<p className="text-sm text-slate-600">
					{assignedToMeCount > 0 ? (
						<Link
							to="/work-items"
							className="font-semibold text-foreground hover:underline"
						>
							{assignedToMeCount} task{assignedToMeCount === 1 ? "" : "s"}{" "}
							assigned to you
						</Link>
					) : (
						<span>Nothing assigned to you right now</span>
					)}
					{nextMeeting ? (
						<>
							{" · "}
							Next: {nextMeeting.title} at{" "}
							{formatMeetingTime(nextMeeting.scheduled_at)}
						</>
					) : null}
				</p>
			</div>

			{children ? (
				<div className="space-y-6 sm:space-y-8">{children}</div>
			) : null}
		</div>
	);
}

export { DashboardWidgets as ConsultantDashboardWidgets };
