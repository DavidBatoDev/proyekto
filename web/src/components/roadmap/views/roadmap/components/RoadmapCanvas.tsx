import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { EpicTab } from "./EpicTab";
import { MilestonesView } from "../../milestones/MilestonesView";
import type { RoadmapCanvasProps } from "../models/types";
import { RoadmapCanvasOverlays } from "./RoadmapCanvasOverlays";
import { RoadmapView } from "../RoadmapView";
import { useRoadmapCanvasController } from "../hooks/useRoadmapCanvasController";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore, useUser } from "@/stores/authStore";
import { useRoadmapCollaboration } from "@/hooks/useRoadmapCollaboration";
import { CollaborationPresenceBar } from "@/components/roadmap/collaboration/CollaborationPresenceBar";

const RoadmapCanvas = ({
  projectTitle: _projectTitle,
  roadmap: roadmapProp,
  milestones: milestonesProp,
  epics: epicsProp,
  onUpdateRoadmap: _onUpdateRoadmap,
  onAddMilestone: onAddMilestoneProp,
  onUpdateMilestone: onUpdateMilestoneProp,
  onDeleteMilestone: onDeleteMilestoneProp,
  onAddEpic: onAddEpicProp,
  onUpdateEpic: onUpdateEpicProp,
  onDeleteEpic: onDeleteEpicProp,
  onAddFeature: onAddFeatureProp,
  onUpdateFeature: onUpdateFeatureProp,
  onDeleteFeature: onDeleteFeatureProp,
  onAddTask: onAddTaskProp,
  onUpdateTask: onUpdateTaskProp,
  onDeleteTask: onDeleteTaskProp,
  onShare: _onShare,
  onExport: _onExport,
  canEditTimelineDates = true,
  hideMiniMap = false,
  focusNodeId: focusNodeIdProp,
  focusNodeOffsetX: focusNodeOffsetXProp,
  focusTaskId: focusTaskIdProp,
  onFocusComplete: onFocusCompleteProp,
  navigateToEpicId: navigateToEpicIdProp,
  onNavigateToEpicHandled: onNavigateToEpicHandledProp,
  navigateToFeature: navigateToFeatureProp,
  onNavigateToFeatureHandled: onNavigateToFeatureHandledProp,
  openEpicEditorId: openEpicEditorIdProp,
  onOpenEpicEditorHandled: onOpenEpicEditorHandledProp,
  openFeatureEditor: openFeatureEditorProp,
  onOpenFeatureEditorHandled: onOpenFeatureEditorHandledProp,
  openTaskDetailId: openTaskDetailIdProp,
  onOpenTaskDetailHandled: onOpenTaskDetailHandledProp,
  onActiveEpicChange,
  onNodeOpen,
  onNodeClose,
  performanceMode = "normal",
}: RoadmapCanvasProps) => {
  const user = useUser();
  const profile = useAuthStore((s) => s.profile);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);

  const { collaborators, remoteCursors, trackCursor, broadcastDataChanged } =
    useRoadmapCollaboration({
      roadmapId: roadmapProp?.id ?? "",
      userId: user?.id,
      profile,
      isPanningCanvas,
    });

  // Broadcast a data_changed event whenever a local mutation settles so
  // collaborators get an immediate notification without relying solely on
  // postgres_changes (which requires publication + RLS to be correctly set up).
  //
  // addEpic/addFeature/addTask use isLoadingEpic/Feature/Task (booleans).
  // updateEpic/Feature/Task use pendingEpicById/FeatureById/TaskById (maps).
  // Task-status drags use queuedTaskStatusIntentById.
  // We sum all of them into a single activity count and broadcast when it drops.
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
    // Only broadcast when activity drops (mutation completed, not started)
    if (prev > mutationActivityCount) {
      broadcastDataChanged();
    }
  }, [mutationActivityCount, broadcastDataChanged]);

  const controller = useRoadmapCanvasController({
    roadmap: roadmapProp,
    milestones: milestonesProp,
    epics: epicsProp,
    onAddMilestone: onAddMilestoneProp,
    onUpdateMilestone: onUpdateMilestoneProp,
    onDeleteMilestone: onDeleteMilestoneProp,
    onAddEpic: onAddEpicProp,
    onUpdateEpic: onUpdateEpicProp,
    onDeleteEpic: onDeleteEpicProp,
    onAddFeature: onAddFeatureProp,
    onUpdateFeature: onUpdateFeatureProp,
    onDeleteFeature: onDeleteFeatureProp,
    onAddTask: onAddTaskProp,
    onUpdateTask: onUpdateTaskProp,
    onDeleteTask: onDeleteTaskProp,
    focusNodeId: focusNodeIdProp,
    focusNodeOffsetX: focusNodeOffsetXProp,
    focusTaskId: focusTaskIdProp,
    onFocusComplete: onFocusCompleteProp,
    navigateToEpicId: navigateToEpicIdProp,
    onNavigateToEpicHandled: onNavigateToEpicHandledProp,
    navigateToFeature: navigateToFeatureProp,
    onNavigateToFeatureHandled: onNavigateToFeatureHandledProp,
    openEpicEditorId: openEpicEditorIdProp,
    onOpenEpicEditorHandled: onOpenEpicEditorHandledProp,
    openFeatureEditor: openFeatureEditorProp,
    onOpenFeatureEditorHandled: onOpenFeatureEditorHandledProp,
    openTaskDetailId: openTaskDetailIdProp,
    onOpenTaskDetailHandled: onOpenTaskDetailHandledProp,
    onActiveEpicChange,
    onNodeOpen,
    onNodeClose,
  });

  const {
    roadmap,
    milestones,
    epics,
    viewMode,
    selectedTaskId,
    sidePanelOpen,
    targetFeatureForTask,
    isAddEpicModalOpen,
    isEditEpicModalOpen,
    editingEpicId,
    isAddFeatureModalOpen,
    targetEpicForFeature,
    isEditFeatureModalOpen,
    editingFeatureId,
    editingFeatureEpicId,
    deleteConfirm,
    scrollToFeatureId,
    isTaskLoading,
    isEpicLoading,
    isFeatureLoading,
    isEditingEpicPending,
    isEditingFeaturePending,
    isSelectedTaskPending,
    currentEpic,
    selectedTask,
    focusNodeId,
    focusNodeOffsetX,
    focusTaskId,
    onAddMilestone,
    onUpdateMilestone,
    onDeleteMilestone,
    onUpdateEpic,
    onUpdateFeature,
    onDeleteTask,
    onUpdateTask,
    onFocusComplete,
    onNavigateToFeatureHandled,
    closeAddTaskPanel,
    setViewMode,
    setSelectedEpic,
    setOpenEpicTabs,
    setTargetFeatureForTask,
    setSidePanelOpen,
    setSelectedTaskId,
    setIsAddEpicModalOpen,
    setIsEditEpicModalOpen,
    setEditingEpicId,
    setIsAddFeatureModalOpen,
    setTargetEpicForFeature,
    setIsEditFeatureModalOpen,
    setEditingFeatureId,
    setEditingFeatureEpicId,
    setDeleteConfirm,
    setScrollToFeatureId,
    handleDeleteEpic,
    handleDeleteFeature,
    handleCreateEpic,
    handleUpdateEpicFromModal,
    handleCreateFeature,
    handleUpdateFeatureFromModal,
    handleOpenEditFeatureModal,
    handleOpenAddFeatureModal,
    handleAddEpicBelow,
    handleConfirmDelete,
    handleTaskCreate,
    handleTaskUpdate,
    handleTaskDelete,
  } = controller;

  const [isLinkRoadmapModalOpen, setIsLinkRoadmapModalOpen] = useState(false);
  const navigate = useNavigate();

  if (!roadmap) {
    return null;
  }

  const canLinkExisting =
    Boolean(roadmap.project_id) &&
    epics.length === 0 &&
    milestones.length === 0;

  const handleNavigateToEpicTab = useCallback(
    (epicId: string) => {
      setSelectedEpic(epicId);
      setViewMode("epic");
      setOpenEpicTabs((prevTabs) =>
        prevTabs.includes(epicId) ? prevTabs : [...prevTabs, epicId],
      );
    },
    [setOpenEpicTabs, setSelectedEpic, setViewMode],
  );

  const handleSelectFeature = useCallback(
    (feature: { epic_id: string; id: string }) => {
      setEditingFeatureEpicId(feature.epic_id);
      setEditingFeatureId(feature.id);
      setIsEditFeatureModalOpen(true);
    },
    [setEditingFeatureEpicId, setEditingFeatureId, setIsEditFeatureModalOpen],
  );

  const handleSelectEpic = useCallback(
    (epicId: string) => {
      setEditingEpicId(epicId);
      setIsEditEpicModalOpen(true);
    },
    [setEditingEpicId, setIsEditEpicModalOpen],
  );

  const handleSelectTask = useCallback(
    (task: { id: string }) => {
      setSelectedTaskId(task.id);
      setTargetFeatureForTask(null);
      setSidePanelOpen(true);
    },
    [setSelectedTaskId, setSidePanelOpen, setTargetFeatureForTask],
  );

  const handleCreateTaskFromFeature = useCallback(
    (featureId: string) => {
      setTargetFeatureForTask(featureId);
      setSelectedTaskId(null);
      setSidePanelOpen(true);
    },
    [setSelectedTaskId, setSidePanelOpen, setTargetFeatureForTask],
  );

  return (
    <div className="relative h-full bg-white flex flex-col">
      {/* Presence bar — rendered here (outside overflow-hidden) so it and its
          tooltip are never clipped by the canvas container */}
      {collaborators.length > 0 && (
        <div className="absolute top-3 right-14 z-30">
          <CollaborationPresenceBar collaborators={collaborators} />
        </div>
      )}

      {/* View Content */}
      <div className="flex-1 relative overflow-hidden">
        {viewMode === "roadmap" && epics.length === 0 ? (
          // Empty state - no epics
          <div className="flex flex-col bg-[#F9F9F9] items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="mb-4">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                  <Plus className="w-8 h-8 text-gray-400" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No Epics Yet
              </h3>
              <p className="text-gray-600 mb-6">
                Get started by creating your first epic. Epics help you organize
                large bodies of work into manageable pieces.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setIsAddEpicModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-md hover:bg-gray-700 transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Epic
                </button>
                {canLinkExisting && (
                  <button
                    onClick={() => setIsLinkRoadmapModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors text-sm font-medium"
                  >
                    <Link2 className="w-4 h-4" />
                    Link Existing Roadmap
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : viewMode === "roadmap" ? (
          <RoadmapView
            roadmap={roadmap}
            epics={epics}
            showMiniMap={!hideMiniMap}
            performanceMode={performanceMode}
            remoteCursors={remoteCursors}
            onTrackCursor={trackCursor}
            onUpdateEpic={onUpdateEpic}
            onDeleteEpic={handleDeleteEpic}
            onUpdateFeature={onUpdateFeature}
            onDeleteFeature={handleDeleteFeature}
            onSelectFeature={handleSelectFeature}
            onSelectEpic={handleSelectEpic}
            onSelectTask={handleSelectTask}
            onAddEpicBelow={handleAddEpicBelow}
            onAddFeature={handleOpenAddFeatureModal}
            onAddTask={handleCreateTaskFromFeature}
            onEditFeature={handleOpenEditFeatureModal}
            onNavigateToEpic={handleNavigateToEpicTab}
            onUpdateTask={onUpdateTask}
            focusNodeId={focusNodeId}
            focusNodeOffsetX={focusNodeOffsetX}
            focusTaskId={focusTaskId}
            onFocusComplete={onFocusComplete}
            onPanStart={() => setIsPanningCanvas(true)}
            onPanEnd={() => setIsPanningCanvas(false)}
          />
        ) : null}

        {viewMode === "epic" && currentEpic && (
          <EpicTab
            epic={currentEpic}
            onUpdateEpic={onUpdateEpic}
            onUpdateFeature={onUpdateFeature}
            onDeleteFeature={handleDeleteFeature}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onSelectTask={(task) => {
              setSelectedTaskId(task.id);
              setTargetFeatureForTask(null);
              setSidePanelOpen(true);
            }}
            onAddTask={(featureId) => {
              setTargetFeatureForTask(featureId);
              setSelectedTaskId(null);
              setSidePanelOpen(true);
            }}
            scrollToFeatureId={scrollToFeatureId}
            onScrollToFeatureHandled={() => {
              setScrollToFeatureId(null);
              onNavigateToFeatureHandled?.();
            }}
          />
        )}

        {viewMode === "epic" && !currentEpic && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-500 mb-4">No epic selected</p>
              <button
                onClick={() => setViewMode("roadmap")}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
              >
                Go to Roadmap View
              </button>
            </div>
          </div>
        )}

        {viewMode === "milestones" && (
          <MilestonesView
            roadmap={roadmap}
            milestones={milestones}
            epics={epics}
            onAddMilestone={onAddMilestone}
            onUpdateMilestone={onUpdateMilestone}
            onDeleteMilestone={onDeleteMilestone}
            onUpdateEpic={onUpdateEpic}
            onUpdateFeature={onUpdateFeature}
            onAddFeature={handleOpenAddFeatureModal}
            onOpenFeatureEditor={handleOpenEditFeatureModal}
            canEditTimelineDates={canEditTimelineDates}
            onNavigateToEpic={handleNavigateToEpicTab}
            onAddEpic={() => setIsAddEpicModalOpen(true)}
            onLinkRoadmap={canLinkExisting ? () => setIsLinkRoadmapModalOpen(true) : undefined}
          />
        )}

        <RoadmapCanvasOverlays
            projectId={roadmap.project_id ?? undefined}
            epics={epics}
            selectedTask={selectedTask}
            sidePanelOpen={sidePanelOpen}
            selectedTaskId={selectedTaskId}
            targetFeatureForTask={targetFeatureForTask}
            closeAddTaskPanel={closeAddTaskPanel}
            setSidePanelOpen={setSidePanelOpen}
            setSelectedTaskId={setSelectedTaskId}
            setTargetFeatureForTask={setTargetFeatureForTask}
            setIsAddFeatureModalOpen={setIsAddFeatureModalOpen}
            setTargetEpicForFeature={setTargetEpicForFeature}
            setIsEditFeatureModalOpen={setIsEditFeatureModalOpen}
            setEditingFeatureId={setEditingFeatureId}
            setEditingFeatureEpicId={setEditingFeatureEpicId}
            isTaskLoading={isTaskLoading}
            isEpicLoading={isEpicLoading}
            isFeatureLoading={isFeatureLoading}
            isEditingEpicPending={isEditingEpicPending}
            isEditingFeaturePending={isEditingFeaturePending}
            isSelectedTaskPending={isSelectedTaskPending}
            isAddEpicModalOpen={isAddEpicModalOpen}
            isEditEpicModalOpen={isEditEpicModalOpen}
            isAddFeatureModalOpen={isAddFeatureModalOpen}
            isEditFeatureModalOpen={isEditFeatureModalOpen}
            editingEpicId={editingEpicId}
            editingFeatureId={editingFeatureId}
            editingFeatureEpicId={editingFeatureEpicId}
            targetEpicForFeature={targetEpicForFeature}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            setIsAddEpicModalOpen={setIsAddEpicModalOpen}
            setIsEditEpicModalOpen={setIsEditEpicModalOpen}
            setEditingEpicId={setEditingEpicId}
            handleTaskUpdate={handleTaskUpdate}
            handleTaskDelete={handleTaskDelete}
            handleTaskCreate={handleTaskCreate}
            handleCreateEpic={handleCreateEpic}
            handleUpdateEpicFromModal={handleUpdateEpicFromModal}
            handleCreateFeature={handleCreateFeature}
            handleUpdateFeatureFromModal={handleUpdateFeatureFromModal}
            handleOpenEditFeatureModal={handleOpenEditFeatureModal}
            handleConfirmDelete={handleConfirmDelete}
          />
      </div>
      {roadmap.project_id && (
        <LinkRoadmapModal
          isOpen={isLinkRoadmapModalOpen}
          onClose={() => setIsLinkRoadmapModalOpen(false)}
          projectId={roadmap.project_id}
          currentRoadmapId={roadmap.id}
          onLinked={(newRoadmapId) => {
            setIsLinkRoadmapModalOpen(false);
            void navigate({
              to: "/project/$projectId/roadmap/$roadmapId",
              params: {
                projectId: roadmap.project_id as string,
                roadmapId: newRoadmapId,
              },
              replace: true,
            });
          }}
        />
      )}
    </div>
  );
};

export { RoadmapCanvas };
