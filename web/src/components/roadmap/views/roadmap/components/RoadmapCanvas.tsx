import { Plus } from "lucide-react";
import { EpicTab } from "./EpicTab";
import { ArtifactTabView } from "./ArtifactTabView";
import { MilestonesView } from "../../milestones/MilestonesView";
import type { RoadmapCanvasProps } from "../models/types";
import { RoadmapCanvasOverlays } from "./RoadmapCanvasOverlays";
import { RoadmapView } from "../RoadmapView";
import { useRoadmapCanvasController } from "../hooks/useRoadmapCanvasController";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useToast } from "@/hooks/useToast";

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
}: RoadmapCanvasProps) => {
  const toast = useToast();
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
  });

  const {
    roadmap,
    milestones,
    epics,
    viewMode,
    openEpicTabs,
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
    handleOpenEditEpicModal,
    handleOpenAddFeatureModal,
    handleAddEpicBelow,
    handleConfirmDelete,
    handleTaskCreate,
    handleTaskUpdate,
    handleTaskDelete,
  } = controller;
  const selectedArtifactId = useRoadmapStore(
    (state) => state.canvasSelectedArtifactId,
  );
  const artifactsById = useRoadmapStore((state) => state.artifactsById);
  const applyArtifactSnapshot = useRoadmapStore(
    (state) => state.applyArtifactSnapshot,
  );
  const discardArtifact = useRoadmapStore((state) => state.discardArtifact);
  const selectedArtifact = selectedArtifactId
    ? artifactsById[selectedArtifactId]
    : null;

  if (!roadmap) {
    return null;
  }

  const handleNavigateToEpicTab = (epicId: string) => {
    setSelectedEpic(epicId);
    setViewMode("epic");
    if (!openEpicTabs.includes(epicId)) {
      setOpenEpicTabs([...openEpicTabs, epicId]);
    }
  };

  return (
    <div className="relative h-full bg-white flex flex-col">
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
              <button
                onClick={() => setIsAddEpicModalOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                <Plus className="w-5 h-5" />
                Add Epic
              </button>
            </div>
          </div>
        ) : viewMode === "roadmap" ? (
          <RoadmapView
            roadmap={roadmap}
            epics={epics}
            showMiniMap={!hideMiniMap}
            onUpdateEpic={onUpdateEpic}
            onDeleteEpic={handleDeleteEpic}
            onUpdateFeature={onUpdateFeature}
            onDeleteFeature={handleDeleteFeature}
            onSelectFeature={(feature) => {
              handleOpenEditFeatureModal(feature.epic_id, feature.id);
            }}
            onSelectEpic={(epicId) => {
              handleOpenEditEpicModal(epicId);
            }}
            onSelectTask={(task) => {
              setSelectedTaskId(task.id);
              setTargetFeatureForTask(null);
              setSidePanelOpen(true);
            }}
            onAddEpicBelow={handleAddEpicBelow}
            onAddFeature={handleOpenAddFeatureModal}
            onAddTask={(featureId) => {
              setTargetFeatureForTask(featureId);
              setSelectedTaskId(null);
              setSidePanelOpen(true);
            }}
            onEditFeature={handleOpenEditFeatureModal}
            onNavigateToEpic={handleNavigateToEpicTab}
            onUpdateTask={onUpdateTask}
            focusNodeId={focusNodeId}
            focusNodeOffsetX={focusNodeOffsetX}
            focusTaskId={focusTaskId}
            onFocusComplete={onFocusComplete}
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

        {viewMode === "artifact" && selectedArtifact && (
          <ArtifactTabView
            artifact={selectedArtifact}
            onApply={(artifactId) => {
              const currentStatus = artifactsById[artifactId]?.status;
              applyArtifactSnapshot(artifactId);
              if (currentStatus === "discarded") {
                toast.success("Artifact change reapplied");
              } else {
                toast.success("Artifact preview applied to roadmap");
              }
            }}
            onDiscard={(artifactId) => {
              discardArtifact(artifactId);
              toast.success("Artifact change discarded");
            }}
          />
        )}

        {viewMode === "artifact" && !selectedArtifact && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-500 mb-4">No artifact selected</p>
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
            onUpdateFeature={onUpdateFeature}
            onAddFeature={handleOpenAddFeatureModal}
            onOpenFeatureEditor={handleOpenEditFeatureModal}
            canEditTimelineDates={canEditTimelineDates}
            onNavigateToEpic={handleNavigateToEpicTab}
          />
        )}

        {viewMode !== "artifact" && (
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
        )}
      </div>
    </div>
  );
};

export { RoadmapCanvas };
