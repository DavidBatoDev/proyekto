import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
	ListChecks,
	AlertCircle,
	Loader2,
	Plus,
	ReceiptText,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapFullQuery } from "@/hooks/useProjectQueries";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useRoadmapDataSync } from "@/hooks/useRoadmapDataSync";
import { useUser } from "@/stores/authStore";
import { KanbanView } from "@/components/roadmap/views/kanban/KanbanView";
import { WorkItemsBrowserModal } from "@/components/roadmap/modals/WorkItemsBrowserModal";
import { useRoadmapCanvasController } from "@/components/roadmap/views/roadmap/hooks/useRoadmapCanvasController";
import { RoadmapCanvasOverlays } from "@/components/roadmap/views/roadmap/components/RoadmapCanvasOverlays";
import { useState } from "react";

export const Route = createFileRoute(
  "/project/$projectId/work-items/$roadmapId",
)({
  component: WorkItemsBoardPage,
});

function WorkItemsBoardPage() {
	const { projectId, roadmapId } = Route.useParams();
	const navigate = useNavigate();
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);
	const user = useUser();
	const { broadcastDataChanged } = useRoadmapDataSync(roadmapId, user?.id);

	// Broadcast when any local mutation settles (same logic as RoadmapCanvas).
	const mutationActivityCount = useRoadmapStore(
		useShallow(
			(s) =>
				(s.isLoadingEpic ? 1 : 0) +
				(s.isLoadingFeature ? 1 : 0) +
				(s.isLoadingTask ? 1 : 0) +
				Object.keys(s.pendingEpicById).length +
				Object.keys(s.pendingFeatureById).length +
				Object.keys(s.pendingTaskById).length +
				// queuedTaskStatusIntentById is cleared BEFORE the API call; use
				// activeTaskStatusSyncById which stays set until the API completes.
				Object.keys(s.activeTaskStatusSyncById).length,
		),
	);
	const prevActivityRef = useRef(0);
	useEffect(() => {
		const prev = prevActivityRef.current;
		prevActivityRef.current = mutationActivityCount;
		if (prev > mutationActivityCount) {
			broadcastDataChanged();
		}
	}, [mutationActivityCount, broadcastDataChanged]);

	const roadmapFullQuery = useRoadmapFullQuery(roadmapId);
	const { applyRoadmapSnapshot } = useRoadmapStore(
		useShallow((s) => ({
			applyRoadmapSnapshot: s.applyRoadmapSnapshot,
		})),
	);

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
    <div className="relative flex flex-col h-full min-h-0 bg-background text-foreground">
      {/* Header */}
      <div className="px-3 py-2 bg-card text-card-foreground border-b border-border shrink-0 md:px-6 md:py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0f172a]/10 flex items-center justify-center shrink-0 md:w-8 md:h-8">
              <ListChecks className="w-4 h-4 text-[#0f172a]" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-slate-900">
                Work Items
              </h1>
              <p className="hidden text-[11px] text-slate-400 md:block">
				Board view of every task in this roadmap
				</p>
			</div>
		</div>

		<div className="flex items-center gap-2 shrink-0">
			<button
				type="button"
				onClick={() =>
					navigate({
						to: "/project/$projectId/payments",
					  params: { projectId },
					})
				}
				className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
			>
				<ReceiptText className="w-3.5 h-3.5" />
				Invoices
			</button>
			<button
				type="button"
				onClick={() => setIsBrowserOpen(true)}
				disabled={isLoading}
				className="inline-flex items-center gap-1.5 rounded-md bg-primary text-white px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
