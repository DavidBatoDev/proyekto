import { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import {
  RoadmapLeftSidePanel,
  JSONRoadmapSidePanel,
  RoadmapCanvas,
  ShareRoadmapModal,
  RoadmapMetadataModal,
  type RoadmapMetadataFormData,
} from "@/components/roadmap";
import { RoadmapTopBar } from "../../RoadmapTopBar";
import { RoadmapPageSkeleton } from "../../RoadmapPageSkeleton";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import {
  roadmapService,
  type UpsertFullRoadmapDto,
} from "@/services/roadmap.service";
import type { Roadmap } from "@/types/roadmap";
import { useToast } from "@/contexts/ToastContext";
import { useRoadmapFullLiveQuery } from "@/hooks/useProjectQueries";

interface RoadmapViewContentProps {
  roadmapId: string;
}

const buildRoadmapJsonDocument = (roadmap: Roadmap): UpsertFullRoadmapDto => ({
  id: roadmap.id,
  name: roadmap.name,
  description: roadmap.description,
  project_id: roadmap.project_id ?? undefined,
  status: roadmap.status,
  start_date: roadmap.start_date,
  end_date: roadmap.end_date,
  settings: roadmap.settings,
  roadmap_epics: (roadmap.epics ?? []).map((epic) => ({
    id: epic.id,
    title: epic.title,
    description: epic.description,
    status: epic.status,
    priority: epic.priority,
    position: epic.position,
    color: epic.color,
    start_date: epic.start_date,
    end_date: epic.end_date,
    tags: epic.tags,
    roadmap_features: (epic.features ?? []).map((feature) => ({
      id: feature.id,
      title: feature.title,
      description: feature.description,
      status: feature.status,
      position: feature.position,
      is_deliverable: feature.is_deliverable,
      start_date: feature.start_date,
      end_date: feature.end_date,
      roadmap_tasks: (feature.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee_id: task.assignee_id ?? undefined,
        due_date: task.due_date,
        position: task.position,
      })),
    })),
  })),
});

export function RoadmapViewContent({ roadmapId }: RoadmapViewContentProps) {
  const toast = useToast();
  // Roadmap data and actions from store
  const roadmap = useRoadmapStore((state) => state.roadmap);
  const isLoadingRoadmap = useRoadmapStore((state) => state.isLoadingRoadmap);
  const activeEpicId = useRoadmapStore((state) => state.activeEpicId);
  const applyRoadmapSnapshot = useRoadmapStore(
    (state) => state.applyRoadmapSnapshot,
  );
  const updateRoadmapMetadata = useRoadmapStore(
    (state) => state.updateRoadmapMetadata,
  );
  const navigateToNode = useRoadmapStore((state) => state.navigateToNode);
  const navigateToEpicTab = useRoadmapStore((state) => state.navigateToEpicTab);
  const navigateToFeatureNode = useRoadmapStore(
    (state) => state.navigateToFeatureNode,
  );
  const openEpicEditor = useRoadmapStore((state) => state.openEpicEditor);
  const openFeatureEditor = useRoadmapStore(
    (state) => state.openFeatureEditorModal,
  );
  const openTaskDetail = useRoadmapStore((state) => state.openTaskDetail);
  const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [isJsonPanelOpen, setIsJsonPanelOpen] = useState(false);
  const [isSavingRoadmapJson, setIsSavingRoadmapJson] = useState(false);
  const roadmapLiveQuery = useRoadmapFullLiveQuery(roadmapId);

  const setSidebarExpanded = useProjectSettingsStore(
    (state) => state.setSidebarExpanded,
  );

  // Auto-close project sidebar when entering roadmap canvas
  useEffect(() => {
    setSidebarExpanded(false);
  }, [setSidebarExpanded]);

  // Fetch roadmap data with stale-while-revalidate behavior.
  useEffect(() => {
    if (!roadmapLiveQuery.data) return;
    const fullRoadmap = roadmapLiveQuery.data;

    setRoadmapError(null);
    applyRoadmapSnapshot(fullRoadmap);

    setFormData({
      title: fullRoadmap.name || "",
      category: fullRoadmap.category || "",
      description: fullRoadmap.description || "",
    });
  }, [applyRoadmapSnapshot, roadmapLiveQuery.data]);

  useEffect(() => {
    if (!roadmapLiveQuery.error) return;
    const error = roadmapLiveQuery.error as any;
    setRoadmapError(
      error?.response?.data?.error?.message || "Failed to load roadmap",
    );
  }, [roadmapLiveQuery.error]);

  // Edit Roadmap modal state
  const [isBriefOpen, setIsBriefOpen] = useState(false);
  const [isUpdatingRoadmap, setIsUpdatingRoadmap] = useState(false);
  const [formData, setFormData] = useState<RoadmapMetadataFormData>({
    title: "",
    category: "",
    description: "",
  });

  // Share Modal state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const roadmapJsonValue = useMemo(() => {
    if (!roadmap) return "{}";
    return JSON.stringify(buildRoadmapJsonDocument(roadmap), null, 2);
  }, [roadmap]);

  const currentUserRole = roadmap?.currentUserRole;
  const canEditRoadmap =
    currentUserRole === "owner" || currentUserRole === "editor";
  const canCommentRoadmap = canEditRoadmap || currentUserRole === "commenter";
  const showReadOnlyPermissionNote =
    Boolean(currentUserRole) && !canEditRoadmap && !canCommentRoadmap;

  const handleModalUpdateFormData = (
    updates: Partial<RoadmapMetadataFormData>,
  ) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleModalSubmit = async () => {
    await handleUpdateRoadmap();
  };

  const handleSaveRoadmapJson = async (parsedJson: unknown) => {
    if (!roadmap) {
      throw new Error("Roadmap is not loaded");
    }

    if (!parsedJson || typeof parsedJson !== "object") {
      throw new Error("Roadmap JSON must be an object");
    }

    const payload = parsedJson as UpsertFullRoadmapDto;

    if (!payload.name || typeof payload.name !== "string") {
      throw new Error("Roadmap JSON must include a valid 'name'");
    }

    if (payload.id && payload.id !== roadmapId) {
      throw new Error("Roadmap JSON id must match the current roadmap page");
    }

    setIsSavingRoadmapJson(true);

    try {
      await roadmapService.upsertFull({
        ...payload,
        id: roadmapId,
      });
      await roadmapLiveQuery.refetch();
      setIsJsonPanelOpen(false);
      toast.success("Roadmap JSON saved successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save roadmap JSON";
      toast.error(message);
      throw new Error(message);
    } finally {
      setIsSavingRoadmapJson(false);
    }
  };

  const handleUpdateRoadmap = async () => {
    if (!roadmapId) return;

    setIsUpdatingRoadmap(true);
    try {
      await updateRoadmapMetadata({
        name: formData.title || "Untitled Roadmap",
        description: formData.description,
        category: formData.category,
      });

      setIsBriefOpen(false);
    } catch (error) {
      console.error("Failed to update roadmap:", error);
    } finally {
      setIsUpdatingRoadmap(false);
    }
  };

  // Loading roadmap data
  if (
    (isLoadingRoadmap || roadmapLiveQuery.isPending) &&
    (!roadmap || roadmap.id !== roadmapId)
  ) {
    return <RoadmapPageSkeleton />;
  }

  // Error state
  if (roadmapError || !roadmap || roadmap.id !== roadmapId) {
    return (
      <div className="flex-1 min-h-full bg-[#f6f7f8] flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Roadmap Not Found
          </h2>
          <p className="text-gray-600 mb-6">
            {roadmapError ||
              "The roadmap you're looking for doesn't exist or you don't have access to it."}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#f6f7f8] overflow-hidden">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Top navigation bar: view tabs + share/export */}
      <RoadmapTopBar
        onEditBrief={() => setIsBriefOpen(true)}
        onShare={() => setIsShareModalOpen(true)}
        onOpenJsonPanel={() => setIsJsonPanelOpen(true)}
        onExport={() => {
          /* TODO: Export functionality */
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sidebar — hidden in milestones view */}
        {canvasViewMode !== "milestones" && (
          <motion.div
            id="roadmap-left-panel"
            className="relative h-full border-r border-gray-200 bg-white"
            initial={false}
            animate={{
              width: 320,
            }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            style={{ minWidth: 320 }}
          >
            <RoadmapLeftSidePanel
              messages={[]}
              onSendMessage={() => {}}
              isGenerating={false}
              isCollapsed={false}
              onSelectFeature={(epicId, featureId) => {
                if (activeEpicId) {
                  navigateToFeatureNode(epicId, featureId);
                  return;
                }
                navigateToNode(featureId);
              }}
              onOpenEpicEditor={openEpicEditor}
              onOpenFeatureEditor={openFeatureEditor}
              onOpenTaskDetail={openTaskDetail}
              onNavigateToNode={navigateToNode}
              onNavigateToEpicTab={navigateToEpicTab}
              highlightedEpicId={activeEpicId}
            />
          </motion.div>
        )}

        {/* Right: Roadmap Canvas */}
        <div className="flex-1 relative">
          <RoadmapCanvas roadmap={roadmap} />
        </div>
      </div>

      {/* Edit Roadmap Modal */}
      <RoadmapMetadataModal
        isOpen={isBriefOpen}
        onClose={() => setIsBriefOpen(false)}
        formData={formData}
        onUpdateFormData={handleModalUpdateFormData}
        onSubmit={handleModalSubmit}
        isSubmitting={isUpdatingRoadmap}
      />

      {/* Share Roadmap Modal */}
      {roadmap && (
        <ShareRoadmapModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          roadmapId={roadmap.id}
          roadmapName={roadmap.name}
        />
      )}

      <JSONRoadmapSidePanel
        isOpen={isJsonPanelOpen}
        initialJson={roadmapJsonValue}
        isSaving={isSavingRoadmapJson}
        onClose={() => setIsJsonPanelOpen(false)}
        onSave={handleSaveRoadmapJson}
      />

      {showReadOnlyPermissionNote && (
        <div className="fixed right-5 bottom-5 z-40 max-w-sm rounded-lg border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="text-sm font-medium text-amber-900">
              You have view-only access to this roadmap. Editing and commenting
              are disabled.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
