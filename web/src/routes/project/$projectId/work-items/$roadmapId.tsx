import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	ListChecks,
	AlertCircle,
	Loader2,
	Plus,
	ReceiptText,
	Sparkles,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapFullQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import { taskService } from "@/services/roadmap.service";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { TaskStatus } from "@/types/roadmap";
import { KanbanView } from "@/components/roadmap/views/kanban/KanbanView";
import { WorkItemsBrowserModal } from "@/components/roadmap/modals/WorkItemsBrowserModal";
import { useRoadmapCanvasController } from "@/components/roadmap/views/roadmap/hooks/useRoadmapCanvasController";
import { RoadmapCanvasOverlays } from "@/components/roadmap/views/roadmap/components/RoadmapCanvasOverlays";

export const Route = createFileRoute(
  "/project/$projectId/work-items/$roadmapId",
)({
  component: WorkItemsBoardPage,
});

function WorkItemsBoardPage() {
	const { projectId, roadmapId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);
	const [templateKey, setTemplateKey] = useState<
		"discovery_call" | "proposal" | "onboarding"
	>("discovery_call");
	const [columnName, setColumnName] = useState("");
	const [columnBucket, setColumnBucket] = useState<TaskStatus>("todo");
	const roadmapFullQuery = useRoadmapFullQuery(roadmapId);
	const { applyRoadmapSnapshot } = useRoadmapStore(
		useShallow((s) => ({
			applyRoadmapSnapshot: s.applyRoadmapSnapshot,
		})),
	);
	const applyTemplateMutation = useMutation({
		mutationFn: (key: "discovery_call" | "proposal" | "onboarding") =>
			taskService.applyWorkflowTemplate(roadmapId, key),
		onSuccess: async (result) => {
			await roadmapFullQuery.refetch();
			toast.success(
				`Template applied: ${result.created_columns} column(s), ${result.created_tasks} task(s)`,
			);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to apply template",
			);
		},
	});
	const createColumnMutation = useMutation({
		mutationFn: () =>
			taskService.createWorkflowColumn(roadmapId, {
				name: columnName.trim(),
				bucket_status: columnBucket,
			}),
		onSuccess: async () => {
			setColumnName("");
			await roadmapFullQuery.refetch();
			toast.success("Workflow column added");
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to create column",
			);
		},
	});

	useEffect(() => {
		if (roadmapFullQuery.data) {
			applyRoadmapSnapshot(roadmapFullQuery.data);
		}
  }, [roadmapFullQuery.data, applyRoadmapSnapshot]);

  const controller = useRoadmapCanvasController({
    roadmap: roadmapFullQuery.data ?? null,
    milestones: roadmapFullQuery.data?.milestones ?? [],
    epics: roadmapFullQuery.data?.epics ?? [],
  });

  const isLoading = roadmapFullQuery.isPending;
  const error = roadmapFullQuery.error;

  return (
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
				Board view of every task in this roadmap
				</p>
			</div>
		</div>

					<div className="flex items-center gap-2 shrink-0">
						<div className="hidden items-center gap-1.5 xl:flex">
							<select
								value={templateKey}
								onChange={(event) =>
									setTemplateKey(
										event.target.value as
											| "discovery_call"
											| "proposal"
											| "onboarding",
									)
								}
								className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
							>
								<option value="discovery_call">Discovery Template</option>
								<option value="proposal">Proposal Template</option>
								<option value="onboarding">Onboarding Template</option>
							</select>
							<button
								type="button"
								onClick={() => applyTemplateMutation.mutate(templateKey)}
								disabled={applyTemplateMutation.isPending || isLoading}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<Sparkles className="w-3.5 h-3.5" />
								{applyTemplateMutation.isPending ? "Applying..." : "Apply template"}
							</button>
						</div>
						<div className="hidden items-center gap-1.5 xl:flex">
							<input
								value={columnName}
								onChange={(event) => setColumnName(event.target.value)}
								placeholder="New column"
								className="h-8 w-28 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
							/>
							<select
								value={columnBucket}
								onChange={(event) =>
									setColumnBucket(event.target.value as TaskStatus)
								}
								className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
							>
								<option value="todo">To do</option>
								<option value="in_progress">In progress</option>
								<option value="in_review">In review</option>
								<option value="done">Done</option>
								<option value="blocked">Blocked</option>
							</select>
							<button
								type="button"
								onClick={() => createColumnMutation.mutate()}
								disabled={
									createColumnMutation.isPending || isLoading || !columnName.trim()
								}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<Plus className="w-3.5 h-3.5" />
								{createColumnMutation.isPending ? "Adding..." : "Add column"}
							</button>
						</div>
						<button
							type="button"
							onClick={() =>
								navigate({
									to: "/project/$projectId/payments",
                  params: { projectId },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ReceiptText className="w-3.5 h-3.5" />
              Invoices
            </button>
            <button
              type="button"
              onClick={() => setIsBrowserOpen(true)}
              disabled={isLoading}
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
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-slate-700">
              Couldn't load the roadmap
            </p>
            <p className="text-xs text-slate-500">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : (
          <KanbanView />
        )}
      </div>

      <WorkItemsBrowserModal
        projectId={projectId}
        roadmapId={roadmapId}
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
      />

      <RoadmapCanvasOverlays
        projectId={roadmapFullQuery.data?.project_id ?? undefined}
        epics={controller.epics}
        selectedTask={controller.selectedTask}
        sidePanelOpen={controller.sidePanelOpen}
        selectedTaskId={controller.selectedTaskId}
        targetFeatureForTask={controller.targetFeatureForTask}
        closeAddTaskPanel={controller.closeAddTaskPanel}
        setSidePanelOpen={controller.setSidePanelOpen}
        setSelectedTaskId={controller.setSelectedTaskId}
        setTargetFeatureForTask={controller.setTargetFeatureForTask}
        setIsAddFeatureModalOpen={controller.setIsAddFeatureModalOpen}
        setTargetEpicForFeature={controller.setTargetEpicForFeature}
        setIsEditFeatureModalOpen={controller.setIsEditFeatureModalOpen}
        setEditingFeatureId={controller.setEditingFeatureId}
        setEditingFeatureEpicId={controller.setEditingFeatureEpicId}
        isTaskLoading={controller.isTaskLoading}
        isEpicLoading={controller.isEpicLoading}
        isFeatureLoading={controller.isFeatureLoading}
        isEditingEpicPending={controller.isEditingEpicPending}
        isEditingFeaturePending={controller.isEditingFeaturePending}
        isSelectedTaskPending={controller.isSelectedTaskPending}
        isAddEpicModalOpen={controller.isAddEpicModalOpen}
        isEditEpicModalOpen={controller.isEditEpicModalOpen}
        isAddFeatureModalOpen={controller.isAddFeatureModalOpen}
        isEditFeatureModalOpen={controller.isEditFeatureModalOpen}
        editingEpicId={controller.editingEpicId}
        editingFeatureId={controller.editingFeatureId}
        editingFeatureEpicId={controller.editingFeatureEpicId}
        targetEpicForFeature={controller.targetEpicForFeature}
        deleteConfirm={controller.deleteConfirm}
        setDeleteConfirm={controller.setDeleteConfirm}
        setIsAddEpicModalOpen={controller.setIsAddEpicModalOpen}
        setIsEditEpicModalOpen={controller.setIsEditEpicModalOpen}
        setEditingEpicId={controller.setEditingEpicId}
        handleTaskUpdate={controller.handleTaskUpdate}
        handleTaskDelete={controller.handleTaskDelete}
        handleTaskCreate={controller.handleTaskCreate}
        handleCreateEpic={controller.handleCreateEpic}
        handleUpdateEpicFromModal={controller.handleUpdateEpicFromModal}
        handleCreateFeature={controller.handleCreateFeature}
        handleUpdateFeatureFromModal={controller.handleUpdateFeatureFromModal}
        handleOpenEditFeatureModal={controller.handleOpenEditFeatureModal}
        handleConfirmDelete={controller.handleConfirmDelete}
      />
    </div>
  );
}
