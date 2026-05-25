import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AlertCircle, ListChecks, Loader2, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { WorkItemsBrowserModal } from "@/components/roadmap/modals/WorkItemsBrowserModal";
import { SidePanel } from "@/components/roadmap/panels/SidePanel";
import { GlobalKanbanView } from "@/components/roadmap/views/kanban/GlobalKanbanView";
import type { KanbanTaskContext } from "@/components/roadmap/views/kanban/types";
import { useAllRoadmapsFullQuery } from "@/hooks/useProjectQueries";
import { projectKeys } from "@/queries/project";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import { taskService } from "@/services/roadmap.service";
import { useAuthStore } from "@/stores/authStore";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { RoadmapTask } from "@/types/roadmap";

export const Route = createFileRoute("/work-items")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: WorkItemsPage,
});

function WorkItemsPage() {
	const query = useAllRoadmapsFullQuery();
	const queryClient = useQueryClient();
	const [activeRoadmap, setActiveRoadmap] =
		useState<FullRoadmapWithProject | null>(null);
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);

	// Task detail side panel
	const [selectedTask, setSelectedTask] = useState<RoadmapTask | null>(null);
	const [selectedProjectId, setSelectedProjectId] = useState<string>("");
	const [sidePanelOpen, setSidePanelOpen] = useState(false);
	const [isTaskLoading, setIsTaskLoading] = useState(false);

	const { applyRoadmapSnapshot } = useRoadmapStore(
		useShallow((s) => ({ applyRoadmapSnapshot: s.applyRoadmapSnapshot })),
	);

	const handleActiveRoadmapChange = useCallback(
		(roadmap: FullRoadmapWithProject | null) => setActiveRoadmap(roadmap),
		[],
	);

	const multiRoadmap = (query.data?.length ?? 0) > 1;

	const handleOpenBrowser = () => {
		if (!multiRoadmap && activeRoadmap) {
			applyRoadmapSnapshot(activeRoadmap);
		}
		setIsBrowserOpen(true);
	};

	const handleCloseBrowser = () => {
		setIsBrowserOpen(false);
		void queryClient.invalidateQueries({
			queryKey: projectKeys.allRoadmapsFull,
		});
	};

	const handleTaskClick = useCallback((row: KanbanTaskContext) => {
		setSelectedTask(row.task);
		setSelectedProjectId(row.project?.id ?? "");
		setSidePanelOpen(true);
	}, []);

	const handleClosePanel = useCallback(() => {
		setSidePanelOpen(false);
		setSelectedTask(null);
	}, []);

	const handleUpdateTask = useCallback(
		async (updatedTask: RoadmapTask) => {
			setIsTaskLoading(true);
			try {
				const saved = await taskService.update(updatedTask.id, {
					title: updatedTask.title,
					status: updatedTask.status,
					priority: updatedTask.priority,
					assignee_id: updatedTask.assignee_id,
					due_date: updatedTask.due_date,
				});
				setSelectedTask(saved);
				void queryClient.invalidateQueries({
					queryKey: projectKeys.allRoadmapsFull,
				});
			} finally {
				setIsTaskLoading(false);
			}
		},
		[queryClient],
	);

	const handleDeleteTask = useCallback(
		async (taskId: string) => {
			setIsTaskLoading(true);
			try {
				await taskService.delete(taskId);
				setSidePanelOpen(false);
				setSelectedTask(null);
				void queryClient.invalidateQueries({
					queryKey: projectKeys.allRoadmapsFull,
				});
			} finally {
				setIsTaskLoading(false);
			}
		},
		[queryClient],
	);

	return (
		<DashboardShell>
			<div className="relative flex flex-col h-full min-h-0 bg-slate-50/30">
				{/* Header */}
				<div className="px-6 py-2.5 bg-white border-b border-slate-100 shrink-0">
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-2.5">
							<div className="w-8 h-8 rounded-lg bg-[#0f172a]/10 flex items-center justify-center shrink-0">
								<ListChecks className="w-4 h-4 text-[#0f172a]" />
							</div>
							<div className="leading-tight">
								<h1 className="text-sm font-semibold text-slate-900">
									Work Items
								</h1>
								<p className="text-[11px] text-slate-400">
									Board view of every task across all projects
								</p>
							</div>
						</div>

						<div className="shrink-0">
							<button
								type="button"
								onClick={handleOpenBrowser}
								disabled={query.isPending || (query.data?.length ?? 0) === 0}
								className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							>
								<Plus className="w-3.5 h-3.5" />
								Add work items
							</button>
						</div>
					</div>
				</div>

				{/* Body */}
				<div className="flex-1 min-h-0 flex flex-col">
					{query.isPending ? (
						<div className="flex-1 flex items-center justify-center text-slate-500">
							<Loader2 className="w-6 h-6 animate-spin" />
						</div>
					) : query.error ? (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
							<AlertCircle className="w-8 h-8 text-red-400" />
							<p className="text-sm font-medium text-slate-700">
								Couldn't load work items
							</p>
							<p className="text-xs text-slate-500">
								{query.error instanceof Error
									? query.error.message
									: "Unknown error"}
							</p>
						</div>
					) : (
						<GlobalKanbanView
							roadmaps={query.data ?? []}
							onActiveRoadmapChange={handleActiveRoadmapChange}
							onTaskClick={handleTaskClick}
						/>
					)}
				</div>
			</div>

			<WorkItemsBrowserModal
				projectId={activeRoadmap?.project?.id ?? ""}
				roadmapId={activeRoadmap?.id ?? ""}
				isOpen={isBrowserOpen}
				onClose={handleCloseBrowser}
				roadmaps={query.data ?? []}
			/>

			<SidePanel
				task={selectedTask}
				isOpen={sidePanelOpen}
				projectId={selectedProjectId}
				onClose={handleClosePanel}
				onUpdateTask={handleUpdateTask}
				onDeleteTask={handleDeleteTask}
				isLoading={isTaskLoading}
			/>
		</DashboardShell>
	);
}
