import {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  RoadmapLeftSidePanel,
  JSONRoadmapSidePanel,
  RoadmapCanvas,
  ShareRoadmapModal,
  RoadmapMetadataModal,
  RoadmapAiAssistantPanel,
  type RoadmapMetadataFormData,
} from "@/components/roadmap";
import { ConfirmAssigneeOverwriteDialog } from "@/components/roadmap/widgets/ConfirmAssigneeOverwriteDialog";
import { RoadmapTopBar } from "../../RoadmapTopBar";
import { MobileRoadmapView } from "./MobileRoadmapView";
import { RoadmapPageSkeleton } from "../../RoadmapPageSkeleton";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import {
  roadmapService,
  type UpsertFullRoadmapDto,
} from "@/services/roadmap.service";
import type { Roadmap, RoadmapTask } from "@/types/roadmap";
import { useToast } from "@/contexts/ToastContext";
import { useRoadmapFullLiveQuery } from "@/hooks/useProjectQueries";
import {
  useRecentAssignees,
  type DockAvatar,
} from "@/hooks/useRecentAssignees";
import { useRoadmapStore, type CanvasViewMode } from "@/stores/roadmapStore";
import { useShallow } from "zustand/react/shallow";
import { findTaskById } from "@/routes/project/$projectId/work-items/workItemsOptimistic";
import type { RoadmapPerformanceMode } from "../models/types";

interface PendingAssignment {
  taskId: string;
  newAvatar: DockAvatar;
  currentAssigneeName: string;
}

interface RoadmapViewContentProps {
  roadmapId: string;
  projectId: string;
  deepLinkNodeId?: string | null;
  urlView?: RoadmapUrlView | null;
  onDeepLinkNodeConsumed?: (view: RoadmapUrlView) => void;
  onViewChange?: (view: RoadmapUrlView) => void;
  onNodeOpened?: (nodeId: string, view: RoadmapUrlView) => void;
  onNodeClosed?: (view: RoadmapUrlView) => void;
}

const CHAT_PANEL_DEFAULT_WIDTH = 380;
const CHAT_PANEL_MIN_WIDTH = 320;
const CHAT_PANEL_MAX_WIDTH = 820;
const CHAT_PANEL_CLOSE_THRESHOLD = 260;
const LEFT_PANEL_DEFAULT_WIDTH = 320;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 600;
const LEFT_PANEL_STORAGE_KEY = "roadmap.leftPanel.width";
const CANVAS_MIN_WIDTH = 560;
const TASK_NAVIGATE_OFFSET_X = 620;

const clampPanelWidth = (value: number, maxAllowed: number) =>
  Math.min(Math.max(value, CHAT_PANEL_MIN_WIDTH), maxAllowed);

const clampLeftPanelWidth = (value: number) =>
  Math.min(Math.max(value, LEFT_PANEL_MIN_WIDTH), LEFT_PANEL_MAX_WIDTH);

type RoadmapUrlView = "roadmapView" | "timelineView";

const toRoadmapUrlView = (mode: CanvasViewMode): RoadmapUrlView =>
  mode === "milestones" ? "timelineView" : "roadmapView";

const toCanvasViewMode = (view: RoadmapUrlView): CanvasViewMode =>
  view === "timelineView" ? "milestones" : "roadmap";

type DeepLinkTarget =
  | { kind: "epic"; epicId: string }
  | { kind: "feature"; epicId: string; featureId: string }
  | { kind: "task"; epicId: string; featureId: string; taskId: string }
  | null;

const resolveDeepLinkTarget = (
  roadmap: Roadmap,
  nodeId: string,
): DeepLinkTarget => {
  const epics = roadmap.epics ?? [];
  for (const epic of epics) {
    if (epic.id === nodeId) {
      return { kind: "epic", epicId: epic.id };
    }

    for (const feature of epic.features ?? []) {
      if (feature.id === nodeId) {
        return { kind: "feature", epicId: epic.id, featureId: feature.id };
      }

      for (const task of feature.tasks ?? []) {
        if (task.id === nodeId) {
          return {
            kind: "task",
            epicId: epic.id,
            featureId: feature.id,
            taskId: task.id,
          };
        }
      }
    }
  }
  return null;
};

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
      position: feature.position,
      is_deliverable: feature.is_deliverable,
      start_date: feature.start_date,
      end_date: feature.end_date,
      roadmap_tasks: (feature.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description ?? undefined,
        status: task.status,
        priority: task.priority,
        assignee_id: task.assignee_id ?? undefined,
        due_date: task.due_date,
        position: task.position,
      })),
    })),
  })),
});

export function RoadmapViewContent({
  roadmapId,
  projectId,
  deepLinkNodeId,
  urlView,
  onDeepLinkNodeConsumed,
  onViewChange,
  onNodeOpened,
  onNodeClosed,
}: RoadmapViewContentProps) {
  const toast = useToast();
  // Roadmap data and actions from store
  const {
    roadmap,
    isLoadingRoadmap,
    activeEpicId,
    applyRoadmapSnapshot,
    updateRoadmapMetadata,
    navigateToNode,
    navigateToEpicTab,
    navigateToFeatureNode,
    openEpicEditor,
    openFeatureEditor,
    openTaskDetail,
    canvasViewMode,
    setCanvasViewMode,
    updateTask,
  } = useRoadmapStore(
    useShallow((state) => ({
      roadmap: state.roadmap,
      isLoadingRoadmap: state.isLoadingRoadmap,
      activeEpicId: state.activeEpicId,
      applyRoadmapSnapshot: state.applyRoadmapSnapshot,
      updateRoadmapMetadata: state.updateRoadmapMetadata,
      navigateToNode: state.navigateToNode,
      navigateToEpicTab: state.navigateToEpicTab,
      navigateToFeatureNode: state.navigateToFeatureNode,
      openEpicEditor: state.openEpicEditor,
      openFeatureEditor: state.openFeatureEditorModal,
      openTaskDetail: state.openTaskDetail,
      canvasViewMode: state.canvasViewMode,
      setCanvasViewMode: state.setCanvasViewMode,
      updateTask: state.updateTask,
    })),
  );
  const resolveCanonicalNodeId = useRoadmapStore(
    (state) => state.resolveCanonicalNodeId,
  );
  const isOptimisticNodeId = useRoadmapStore(
    (state) => state.isOptimisticNodeId,
  );
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [isJsonPanelOpen, setIsJsonPanelOpen] = useState(false);
  const [isSavingRoadmapJson, setIsSavingRoadmapJson] = useState(false);
  const isMobile = useIsMobile();
  const [isAiChatPanelOpen, setIsAiChatPanelOpen] = useState(false);
  const [isResizingChatPanel, setIsResizingChatPanel] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(
    CHAT_PANEL_DEFAULT_WIDTH,
  );
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const chatPanelWidthRef = useRef(chatPanelWidth);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    try {
      const stored = window.localStorage.getItem(LEFT_PANEL_STORAGE_KEY);
      return stored ? Number(stored) : LEFT_PANEL_DEFAULT_WIDTH;
    } catch {
      return LEFT_PANEL_DEFAULT_WIDTH;
    }
  });
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);
  const consumedNodeIdRef = useRef<string | null>(null);
  const isApplyingUrlViewRef = useRef(false);
  const lastAppliedUrlViewRef = useRef<RoadmapUrlView | null>(null);
  const roadmapLiveQuery = useRoadmapFullLiveQuery(roadmapId);

  useEffect(() => {
    if (!urlView) {
      lastAppliedUrlViewRef.current = null;
      return;
    }

    if (lastAppliedUrlViewRef.current === urlView) {
      return;
    }
    lastAppliedUrlViewRef.current = urlView;

    const nextMode = toCanvasViewMode(urlView);
    if (canvasViewMode === nextMode) return;

    isApplyingUrlViewRef.current = true;
    setCanvasViewMode(nextMode);
  }, [canvasViewMode, setCanvasViewMode, urlView]);

  useEffect(() => {
    const nextUrlView = toRoadmapUrlView(canvasViewMode);
    if (isApplyingUrlViewRef.current) {
      const resolvedIncomingMode = urlView ? toCanvasViewMode(urlView) : null;
      if (resolvedIncomingMode === canvasViewMode) {
        isApplyingUrlViewRef.current = false;
      }
      return;
    }

    onViewChange?.(nextUrlView);
  }, [canvasViewMode, onViewChange, urlView]);

  useEffect(() => {
    const normalizedNodeId =
      typeof deepLinkNodeId === "string" ? deepLinkNodeId.trim() : "";
    if (!normalizedNodeId) {
      consumedNodeIdRef.current = null;
      return;
    }

    if (!roadmap || roadmap.id !== roadmapId) {
      return;
    }

    if (consumedNodeIdRef.current === normalizedNodeId) {
      return;
    }
    consumedNodeIdRef.current = normalizedNodeId;

    const target = resolveDeepLinkTarget(roadmap, normalizedNodeId);
    if (!target) {
      navigateToNode(normalizedNodeId);
    } else if (target.kind === "epic") {
      navigateToNode(target.epicId);
      openEpicEditor(target.epicId);
    } else if (target.kind === "feature") {
      navigateToNode(target.featureId);
      openFeatureEditor(target.epicId, target.featureId);
    } else {
      navigateToNode(target.featureId, {
        offsetX: TASK_NAVIGATE_OFFSET_X,
        taskId: target.taskId,
      });
      openTaskDetail(target.taskId);
    }

    onDeepLinkNodeConsumed?.(urlView ?? toRoadmapUrlView(canvasViewMode));
  }, [
    canvasViewMode,
    deepLinkNodeId,
    navigateToNode,
    onDeepLinkNodeConsumed,
    openEpicEditor,
    openFeatureEditor,
    openTaskDetail,
    roadmap,
    roadmapId,
    urlView,
  ]);

  const handleNodeOpen = useCallback(
    (nodeId: string) => {
      const normalizedNodeId = nodeId.trim();
      if (!normalizedNodeId) return;
      const canonicalNodeId = resolveCanonicalNodeId(normalizedNodeId);
      if (!canonicalNodeId || isOptimisticNodeId(canonicalNodeId)) {
        return;
      }
      onNodeOpened?.(canonicalNodeId, toRoadmapUrlView(canvasViewMode));
    },
    [canvasViewMode, isOptimisticNodeId, onNodeOpened, resolveCanonicalNodeId],
  );

  const handleNodeClose = useCallback(() => {
    onNodeClosed?.(toRoadmapUrlView(canvasViewMode));
  }, [canvasViewMode, onNodeClosed]);

  const setSidebarExpanded = useProjectSettingsStore(
    (state) => state.setSidebarExpanded,
  );

  // Auto-close project sidebar when entering roadmap canvas
  useEffect(() => {
    setSidebarExpanded(false);
  }, [setSidebarExpanded]);

  useEffect(() => {
    chatPanelWidthRef.current = chatPanelWidth;
    if (chatPanelRef.current) {
      chatPanelRef.current.style.width = `${chatPanelWidth}px`;
    }
  }, [chatPanelWidth]);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
    if (leftPanelRef.current) {
      leftPanelRef.current.style.width = `${leftPanelWidth}px`;
    }
  }, [leftPanelWidth]);

  useEffect(() => {
    const handleViewportResize = () => {
      const leftPanelWidth =
        canvasViewMode !== "milestones" ? leftPanelWidthRef.current : 0;
      const maxAllowed = Math.max(
        CHAT_PANEL_MIN_WIDTH,
        Math.min(
          CHAT_PANEL_MAX_WIDTH,
          window.innerWidth - leftPanelWidth - CANVAS_MIN_WIDTH,
        ),
      );
      setChatPanelWidth((prev) => clampPanelWidth(prev, maxAllowed));
    };

    handleViewportResize();
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [canvasViewMode]);

  const handleChatPanelResizeStart = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = chatPanelWidthRef.current;
    const leftPanelWidth =
      canvasViewMode !== "milestones" ? leftPanelWidthRef.current : 0;
    const maxAllowed = Math.max(
      CHAT_PANEL_MIN_WIDTH,
      Math.min(
        CHAT_PANEL_MAX_WIDTH,
        window.innerWidth - leftPanelWidth - CANVAS_MIN_WIDTH,
      ),
    );

    setIsResizingChatPanel(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let latestWidth = startWidth;
    let shouldCloseOnRelease = false;
    let pendingWidth = startWidth;
    let rafId: number | null = null;

    const flushWidth = () => {
      rafId = null;
      latestWidth = pendingWidth;
      chatPanelWidthRef.current = pendingWidth;
      if (chatPanelRef.current) {
        chatPanelRef.current.style.width = `${pendingWidth}px`;
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const rawWidth = startWidth + delta;
      shouldCloseOnRelease = rawWidth <= CHAT_PANEL_CLOSE_THRESHOLD;
      pendingWidth = clampPanelWidth(rawWidth, maxAllowed);
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushWidth);
      }
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        flushWidth();
      }
      setIsResizingChatPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (shouldCloseOnRelease) {
        setIsAiChatPanelOpen(false);
        setChatPanelWidth(CHAT_PANEL_DEFAULT_WIDTH);
      } else {
        setChatPanelWidth(latestWidth);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleLeftPanelResizeStart = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidthRef.current;

    setIsResizingLeftPanel(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let latestWidth = startWidth;
    let pendingWidth = startWidth;
    let rafId: number | null = null;

    const flushWidth = () => {
      rafId = null;
      latestWidth = pendingWidth;
      leftPanelWidthRef.current = pendingWidth;
      if (leftPanelRef.current) {
        leftPanelRef.current.style.width = `${pendingWidth}px`;
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingWidth = clampLeftPanelWidth(startWidth + moveEvent.clientX - startX);
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushWidth);
      }
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        flushWidth();
      }
      setIsResizingLeftPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLeftPanelWidth(latestWidth);
      try {
        window.localStorage.setItem(LEFT_PANEL_STORAGE_KEY, String(latestWidth));
      } catch {}
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

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
      preview_url: fullRoadmap.preview_url || "",
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
    preview_url: "",
  });

  // Share Modal state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const roadmapJsonValue = useMemo(() => {
    if (!isJsonPanelOpen || !roadmap) return "{}";
    return JSON.stringify(buildRoadmapJsonDocument(roadmap), null, 2);
  }, [isJsonPanelOpen, roadmap]);

  const performanceMode = useMemo<RoadmapPerformanceMode>(() => {
    if (!roadmap) {
      return "normal";
    }

    let nodeCount = 0;
    let taskCount = 0;
    for (const epic of roadmap.epics ?? []) {
      nodeCount += 1;
      for (const feature of epic.features ?? []) {
        nodeCount += 1;
        taskCount += feature.tasks?.length ?? 0;
      }
    }

    return nodeCount >= 80 || taskCount >= 300 ? "reducedMotion" : "normal";
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
        ...(formData.preview_url
          ? { preview_url: formData.preview_url }
          : {}),
      });

      setIsBriefOpen(false);
    } catch (error) {
      console.error("Failed to update roadmap:", error);
    } finally {
      setIsUpdatingRoadmap(false);
    }
  };

  // Quick-assign dock state
  const { recordAssignment } = useRecentAssignees(projectId);
  const [pendingAssignment, setPendingAssignment] =
    useState<PendingAssignment | null>(null);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [activeDragAvatar, setActiveDragAvatar] =
    useState<DockAvatar | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const applyAssignment = useCallback(
    async (taskId: string, avatar: DockAvatar) => {
      const latestEpics = useRoadmapStore.getState().epics;
      const currentTask = findTaskById(latestEpics, taskId);
      if (!currentTask) return;

      const nextTask: RoadmapTask = {
        ...currentTask,
        assignee_id: avatar.userId,
        assignee: {
          id: avatar.userId,
          display_name: avatar.displayName,
          avatar_url: avatar.avatarUrl ?? undefined,
        },
      };

      try {
        await updateTask(nextTask);
        recordAssignment(avatar.userId);
        toast.success(
          `Assigned ${avatar.displayName} to "${currentTask.title}"`,
        );
      } catch {
        toast.error("Failed to update task assignee");
      }
    },
    [recordAssignment, toast, updateTask],
  );

  const handleDockDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type !== "assignee") return;
    setActiveDragAvatar({
      userId: (data.userId as string) ?? "",
      displayName: (data.displayName as string) ?? "",
      avatarUrl: (data.avatarUrl as string | null | undefined) ?? null,
      isSelf: false,
    });
  }, []);

  const handleDockDragCancel = useCallback(() => {
    setActiveDragAvatar(null);
  }, []);

  const handleDockDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragAvatar(null);
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;
      if (activeData?.type !== "assignee") return;
      if (overData?.type !== "task-assignee") return;

      const userId = activeData.userId as string | undefined;
      const displayName = activeData.displayName as string | undefined;
      const avatarUrl = (activeData.avatarUrl as string | null | undefined) ?? null;
      const taskId = overData.taskId as string | undefined;
      const currentAssigneeId = overData.currentAssigneeId as
        | string
        | null
        | undefined;
      const currentAssigneeName =
        (overData.currentAssigneeName as string | null | undefined) ?? null;

      if (!userId || !displayName || !taskId) return;
      if (currentAssigneeId === userId) return;

      const avatar: DockAvatar = {
        userId,
        displayName,
        avatarUrl,
        isSelf: false,
      };

      if (!currentAssigneeId) {
        void applyAssignment(taskId, avatar);
        return;
      }

      setPendingAssignment({
        taskId,
        newAvatar: avatar,
        currentAssigneeName: currentAssigneeName ?? "the current assignee",
      });
    },
    [applyAssignment],
  );

  const handleConfirmAssignment = useCallback(async () => {
    if (!pendingAssignment) return;
    setIsSavingAssignment(true);
    try {
      await applyAssignment(
        pendingAssignment.taskId,
        pendingAssignment.newAvatar,
      );
      setPendingAssignment(null);
    } finally {
      setIsSavingAssignment(false);
    }
  }, [applyAssignment, pendingAssignment]);

  const handleCancelAssignment = useCallback(() => {
    if (isSavingAssignment) return;
    setPendingAssignment(null);
  }, [isSavingAssignment]);

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
      <div className="app-shell-bg flex min-h-full flex-1 items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">
            Roadmap Not Found
          </h2>
          <p className="mb-6 text-slate-600">
            {roadmapError ||
              "The roadmap you're looking for doesn't exist or you don't have access to it."}
          </p>
          <Link
            to="/"
            className="app-cta inline-flex items-center gap-2 rounded-lg px-6 py-3 text-white transition-colors"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={dndSensors}
      onDragStart={handleDockDragStart}
      onDragEnd={handleDockDragEnd}
      onDragCancel={handleDockDragCancel}
    >
    <div
      className={`app-shell-bg flex h-full flex-col overflow-hidden ${
        activeDragAvatar ? "select-none" : ""
      }`}
    >
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {isMobile ? (
        <MobileRoadmapView
          projectId={projectId}
          roadmap={roadmap}
          performanceMode={performanceMode}
          isAiChatPanelOpen={isAiChatPanelOpen}
          onToggleAiPanel={() => {
            setIsAiChatPanelOpen((prev) => {
              if (prev) return false;
              setChatPanelWidth(CHAT_PANEL_DEFAULT_WIDTH);
              return true;
            });
          }}
          onEditBrief={() => setIsBriefOpen(true)}
          onShare={() => setIsShareModalOpen(true)}
          onNodeOpen={handleNodeOpen}
          onNodeClose={handleNodeClose}
        />
      ) : (
        <>
      {/* Top navigation bar: view tabs + share/export */}
      <RoadmapTopBar
        onEditBrief={() => setIsBriefOpen(true)}
        onShare={() => setIsShareModalOpen(true)}
        onOpenChatPanel={() => {
          setIsAiChatPanelOpen((prev) => {
            if (prev) return false;
            setChatPanelWidth(CHAT_PANEL_DEFAULT_WIDTH);
            return true;
          });
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sidebar — hidden in milestones view */}
        {canvasViewMode !== "milestones" && (
          <div
            ref={leftPanelRef}
            id="roadmap-left-panel"
            className="relative h-full border-r border-slate-200 bg-white/95 backdrop-blur flex-shrink-0"
            style={{ width: leftPanelWidth, minWidth: LEFT_PANEL_MIN_WIDTH }}
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
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-10 group/resizer"
              onMouseDown={handleLeftPanelResizeStart}
            >
              <div
                className={`absolute right-0 top-0 w-[3px] h-full rounded-full transition-colors ${
                  isResizingLeftPanel ? "bg-orange-400" : "bg-transparent group-hover/resizer:bg-orange-300"
                }`}
              />
            </div>
          </div>
        )}

        {/* Right: Roadmap Canvas */}
        <div className="flex-1 relative">
          <RoadmapCanvas
            roadmap={roadmap}
            hideMiniMap={isAiChatPanelOpen}
            onNodeOpen={handleNodeOpen}
            onNodeClose={handleNodeClose}
            performanceMode={performanceMode}
          />
        </div>

        {isAiChatPanelOpen && (
          <div
            ref={chatPanelRef}
            id="roadmap-right-ai-chat-panel"
            className="relative h-full border-l border-gray-200 bg-white"
            style={{ minWidth: CHAT_PANEL_MIN_WIDTH, width: chatPanelWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize assistant panel"
              onMouseDown={handleChatPanelResizeStart}
              className="absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize"
            >
              <div
                className={`mx-auto h-full w-[3px] rounded-full transition-colors ${
                  isResizingChatPanel ? "bg-orange-400" : "bg-transparent"
                } hover:bg-orange-300`}
              />
            </div>

            <RoadmapAiAssistantPanel
              projectId={projectId}
              roadmapId={roadmap.id}
              roadmapSnapshot={roadmap}
              isVisible={isAiChatPanelOpen}
            />
          </div>
        )}
      </div>
        </>
      )}

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
          projectId={projectId}
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
        <div className="fixed bottom-5 right-5 z-40 max-w-sm rounded-lg border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="text-sm font-medium text-amber-900">
              You have view-only access to this roadmap. Editing and commenting
              are disabled.
            </p>
          </div>
        </div>
      )}

      <ConfirmAssigneeOverwriteDialog
        isOpen={pendingAssignment !== null}
        isSaving={isSavingAssignment}
        currentAssigneeName={pendingAssignment?.currentAssigneeName ?? null}
        newAssigneeName={pendingAssignment?.newAvatar.displayName ?? null}
        onCancel={handleCancelAssignment}
        onConfirm={handleConfirmAssignment}
      />
    </div>
      <DragOverlay dropAnimation={null}>
        {activeDragAvatar ? (
          activeDragAvatar.avatarUrl ? (
            <img
              src={activeDragAvatar.avatarUrl}
              alt=""
              draggable={false}
              className="pointer-events-none w-8 h-8 rounded-full object-cover ring-2 ring-orange-300 shadow-lg"
            />
          ) : (
            <div className="pointer-events-none w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-linear-to-br from-slate-200 to-slate-300 text-slate-700 ring-2 ring-orange-300 shadow-lg">
              {activeDragAvatar.displayName
                .split(/\s+/)
                .map((part) => part[0] ?? "")
                .join("")
                .slice(0, 2)
                .toUpperCase() || "?"}
            </div>
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
