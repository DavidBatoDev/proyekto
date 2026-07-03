/**
 * Roadmap Store - Zustand
 * Centralized state management for roadmap data and UI state
 */

import { create } from "zustand";
import {
  epicService,
  featureService,
  milestoneService,
  roadmapService,
  taskService,
  type FullRoadmap,
} from "@/services/roadmap.service";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapMilestone,
  RoadmapTask,
} from "@/types/roadmap";
import type {
  AgentCommitImpactedItem,
  AgentOperation,
} from "@/services/roadmap-agent.service";
export type CanvasViewMode = "roadmap" | "epic" | "milestones";

export interface KanbanBoardFilters {
  epicIds: string[];
  featureIds: string[];
  milestoneIds: string[];
  assigneeIds: string[];
}

const EMPTY_BOARD_FILTERS: KanbanBoardFilters = {
  epicIds: [],
  featureIds: [],
  milestoneIds: [],
  assigneeIds: [],
};

interface RoadmapState {
  // Data
  roadmap: Roadmap | null;
  epics: RoadmapEpic[];
  milestones: RoadmapMilestone[];
  tempToRealNodeId: Record<string, string>;
  pendingEpicById: Record<string, boolean>;
  pendingFeatureById: Record<string, boolean>;
  pendingTaskById: Record<string, boolean>;
  queuedTaskStatusIntentById: Record<string, TaskStatusIntent>;
  activeTaskStatusSyncById: Record<string, boolean>;
  taskStatusRollbackById: Partial<Record<string, RoadmapTask>>;

  // UI State - Canvas Navigation
  focusNodeId: string | null;
  focusNodeOffsetX: number;
  focusTaskId: string | null;
  navigateToEpicId: string | null;
  navigateToFeature: { epicId: string; featureId: string } | null;
  openEpicEditorId: string | null;
  openFeatureEditor: { epicId: string; featureId: string } | null;
  openTaskDetailId: string | null;
  pendingCommentId: string | null;
  activeEpicId: string | null;

  // UI State - Canvas View Mode (shared so RoadmapViewContent can react)
  canvasViewMode: CanvasViewMode;
  canvasSelectedEpicId: string | null;
  canvasOpenEpicTabs: string[];

  // UI State - Kanban Board
  boardFilters: KanbanBoardFilters;

  // UI State - Modal Triggers
  addFeatureEpicId: string | null;
  addTaskFeatureId: string | null;

  // Loading States
  isLoadingRoadmap: boolean;
  isLoadingEpic: boolean;
  isLoadingFeature: boolean;
  isLoadingTask: boolean;
}

interface FeatureData {
  title: string;
  description: string;
  position?: number;
  is_deliverable: boolean;
  start_date?: string;
  end_date?: string;
}

interface RoadmapActions {
  // Initialize & Reset
  loadRoadmap: (
    roadmapId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  applyRoadmapSnapshot: (fullRoadmap: FullRoadmap) => void;
  // Optimistically apply a just-committed AI edit to the local roadmap from the
  // agent's response (created/deleted nodes), so the canvas reflects the change
  // instantly instead of waiting on the slow full-roadmap reload.
  applyAiCommitImpactedItems: (
    operations: AgentOperation[],
    impactedItems: AgentCommitImpactedItem[],
  ) => void;
  resetRoadmap: () => void;
  updateRoadmapMetadata: (roadmap: Partial<Roadmap>) => Promise<void>;

  // Epic CRUD
  addEpic: (
    milestoneId?: string,
    epicInput?: Partial<RoadmapEpic>,
  ) => Promise<void>;
  updateEpic: (epic: RoadmapEpic) => Promise<void>;
  reorderEpicsInRoadmap: (orderedEpicIds: string[]) => Promise<void>;
  previewEpicOrderInRoadmap: (orderedEpicIds: string[]) => void;
  deleteEpic: (epicId: string) => Promise<void>;

  // Feature CRUD
  addFeature: (epicId: string, data: FeatureData) => Promise<void>;
  updateFeature: (feature: RoadmapFeature) => Promise<void>;
  reorderFeaturesInEpic: (
    epicId: string,
    orderedFeatureIds: string[],
  ) => Promise<void>;
  previewFeatureOrderInEpic: (
    epicId: string,
    orderedFeatureIds: string[],
  ) => void;
  deleteFeature: (featureId: string) => Promise<void>;
  moveFeatureBetweenEpics: (
    featureId: string,
    targetEpicId: string,
    orderedTargetFeatureIds: string[],
  ) => Promise<void>;

  // Task CRUD
  addTask: (featureId: string, data: Partial<RoadmapTask>) => Promise<void>;
  updateTask: (task: RoadmapTask) => Promise<void>;
  updateTaskStatusIntent: (
    taskId: string,
    nextStatus: RoadmapTask["status"],
  ) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  reorderTasksInFeature: (featureId: string, orderedTaskIds: string[]) => Promise<void>;

  // Kanban board
  setBoardFilters: (
    update:
      | Partial<KanbanBoardFilters>
      | ((prev: KanbanBoardFilters) => KanbanBoardFilters),
  ) => void;
  resetBoardFilters: () => void;
  reassignFeatureToMilestone: (
    featureId: string,
    fromMilestoneId: string | null,
    toMilestoneId: string | null,
  ) => Promise<void>;

  // Milestone CRUD
  addMilestone: (data: {
    title: string;
    target_date: string;
    description?: string;
    status?: RoadmapMilestone["status"];
    color?: string;
  }) => Promise<void>;
  updateMilestone: (milestone: RoadmapMilestone) => Promise<void>;
  deleteMilestone: (id: string) => Promise<void>;

  // UI Actions
  openAddFeatureModal: (epicId: string) => void;
  closeAddFeatureModal: () => void;
  openAddTaskPanel: (featureId: string) => void;
  closeAddTaskPanel: () => void;
  navigateToNode: (
    nodeId: string,
    options?: { offsetX?: number; taskId?: string },
  ) => void;
  clearNodeFocus: () => void;
  navigateToEpicTab: (epicId: string) => void;
  clearNavigateToEpicTab: () => void;
  navigateToFeatureNode: (epicId: string, featureId: string) => void;
  clearNavigateToFeatureNode: () => void;
  openEpicEditor: (epicId: string) => void;
  clearOpenEpicEditor: () => void;
  openFeatureEditorModal: (epicId: string, featureId: string) => void;
  clearOpenFeatureEditorModal: () => void;
  openTaskDetail: (taskId: string) => void;
  clearOpenTaskDetail: () => void;
  setPendingCommentId: (id: string | null) => void;
  setActiveEpicId: (epicId: string | null) => void;

  // Canvas view-mode actions
  setCanvasViewMode: (mode: CanvasViewMode) => void;
  setCanvasSelectedEpicId: (epicId: string | null) => void;
  setCanvasOpenEpicTabs: (
    tabs: string[] | ((prev: string[]) => string[]),
  ) => void;
  closeCanvasEpicTab: (epicId: string) => void;

  // Optimistic ID helpers
  isOptimisticNodeId: (id: string | null | undefined) => boolean;
  resolveCanonicalNodeId: (id: string | null | undefined) => string | null;
}

type RoadmapStore = RoadmapState & RoadmapActions;
type TaskStatusIntent = {
  status: RoadmapTask["status"];
};

const clearPendingKey = <T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

const patchEpicById = (
  epics: RoadmapEpic[],
  epicId: string,
  patcher: (epic: RoadmapEpic) => RoadmapEpic,
): RoadmapEpic[] =>
  epics.map((epic) => (epic.id === epicId ? patcher(epic) : epic));

const patchFeatureById = (
  epics: RoadmapEpic[],
  featureId: string,
  patcher: (feature: RoadmapFeature) => RoadmapFeature,
): RoadmapEpic[] =>
  epics.map((epic) => ({
    ...epic,
    features: (epic.features || []).map((feature) =>
      feature.id === featureId ? patcher(feature) : feature,
    ),
  }));

const moveFeatureAcrossEpics = (
  epics: RoadmapEpic[],
  featureId: string,
  targetEpicId: string,
  orderedTargetFeatureIds: string[],
): RoadmapEpic[] => {
  let movedFeature: RoadmapFeature | undefined;
  const withoutFeature = epics.map((epic) => ({
    ...epic,
    features: (epic.features || []).filter((f) => {
      if (f.id === featureId) {
        movedFeature = f;
        return false;
      }
      return true;
    }),
  }));
  if (!movedFeature) return epics;
  const updatedFeature: RoadmapFeature = { ...movedFeature, epic_id: targetEpicId };
  return withoutFeature.map((epic) => {
    if (epic.id !== targetEpicId) return epic;
    const existingFeatures = (epic.features || []).filter((f) => f.id !== featureId);
    const reordered = orderedTargetFeatureIds
      .map((id) => (id === featureId ? updatedFeature : existingFeatures.find((f) => f.id === id)))
      .filter((f): f is RoadmapFeature => f !== undefined);
    return { ...epic, features: reordered };
  });
};

const patchTaskById = (
  epics: RoadmapEpic[],
  taskId: string,
  patcher: (task: RoadmapTask) => RoadmapTask,
): RoadmapEpic[] =>
  epics.map((epic) => ({
    ...epic,
    features: (epic.features || []).map((feature) => ({
      ...feature,
      tasks: (feature.tasks || []).map((task) =>
        task.id === taskId ? patcher(task) : task,
      ),
    })),
  }));

const findTaskById = (
  epics: RoadmapEpic[],
  taskId: string,
): RoadmapTask | undefined =>
  epics
    .flatMap((epic) => epic.features || [])
    .flatMap((feature) => feature.tasks || [])
    .find((task) => task.id === taskId);

const clearTaskRollbackKey = (
  record: Partial<Record<string, RoadmapTask>>,
  key: string,
): Partial<Record<string, RoadmapTask>> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

const OPTIMISTIC_NODE_ID_PREFIX = "temp-";

const isOptimisticNodeIdInternal = (
  id: string | null | undefined,
): id is string =>
  typeof id === "string" && id.startsWith(OPTIMISTIC_NODE_ID_PREFIX);

const resolveCanonicalNodeIdInternal = (
  id: string | null | undefined,
  tempToRealNodeId: Record<string, string>,
): string | null => {
  if (!id) return null;

  let resolvedId = id;
  const visited = new Set<string>([resolvedId]);

  while (tempToRealNodeId[resolvedId]) {
    const nextId = tempToRealNodeId[resolvedId];
    if (!nextId || visited.has(nextId)) break;
    resolvedId = nextId;
    visited.add(resolvedId);
  }

  return resolvedId;
};

const clearNodeMappingsForIds = (
  record: Record<string, string>,
  removedNodeIds: Set<string>,
): Record<string, string> => {
  let changed = false;
  const next = { ...record };

  for (const [tempId, realId] of Object.entries(record)) {
    if (removedNodeIds.has(tempId) || removedNodeIds.has(realId)) {
      delete next[tempId];
      changed = true;
    }
  }

  return changed ? next : record;
};

export const useRoadmapStore = create<RoadmapStore>((set, get) => ({
  // Initial State
  roadmap: null,
  epics: [],
  milestones: [],
  tempToRealNodeId: {},
  pendingEpicById: {},
  pendingFeatureById: {},
  pendingTaskById: {},
  queuedTaskStatusIntentById: {},
  activeTaskStatusSyncById: {},
  taskStatusRollbackById: {},
  focusNodeId: null,
  focusNodeOffsetX: 0,
  focusTaskId: null,
  navigateToEpicId: null,
  navigateToFeature: null,
  openEpicEditorId: null,
  openFeatureEditor: null,
  openTaskDetailId: null,
  pendingCommentId: null,
  activeEpicId: null,
  addFeatureEpicId: null,
  addTaskFeatureId: null,
  isLoadingRoadmap: false,
  isLoadingEpic: false,
  isLoadingFeature: false,
  isLoadingTask: false,
  canvasViewMode: "roadmap",
  canvasSelectedEpicId: null,
  canvasOpenEpicTabs: [],
  boardFilters: EMPTY_BOARD_FILTERS,

  // Initialize - Load full roadmap data
  loadRoadmap: async (roadmapId: string, options?: { force?: boolean }) => {
    const currentRoadmap = get().roadmap;
    const shouldUseCache = !options?.force && currentRoadmap?.id === roadmapId;
    if (shouldUseCache) return;

    try {
      set({ isLoadingRoadmap: true });
      const fullRoadmap = await roadmapService.getFull(roadmapId);
      set({
        roadmap: fullRoadmap,
        epics: fullRoadmap.epics || [],
        milestones: fullRoadmap.milestones || [],
        tempToRealNodeId: {},
        pendingEpicById: {},
        pendingFeatureById: {},
        pendingTaskById: {},
        queuedTaskStatusIntentById: {},
        activeTaskStatusSyncById: {},
        taskStatusRollbackById: {},
        isLoadingRoadmap: false,
      });
    } catch (error) {
      console.error("Failed to load roadmap:", error);
      set({ isLoadingRoadmap: false });
      throw error;
    }
  },

  // Update server data without disturbing in-flight optimistic state.
  // Clearing pendingEpicById / queuedTaskStatusIntentById etc. here caused
  // visible "flashes" when a background refetch (triggered by a collaborator's
  // change) wiped the current user's in-progress Kanban drags or edits.
  // Those flags are cleared by the individual operation handlers when they
  // complete or fail — not here.
  applyRoadmapSnapshot: (fullRoadmap: FullRoadmap) => {
    set({
      roadmap: fullRoadmap,
      epics: fullRoadmap.epics || [],
      milestones: fullRoadmap.milestones || [],
    });
  },

  applyAiCommitImpactedItems: (operations, impactedItems) => {
    set((state) => {
      if (!state.roadmap || impactedItems.length === 0) return {};
      const roadmapId = state.roadmap.id;
      const now = new Date().toISOString();

      const createdTypeForOp = (op?: string) =>
        op === "add_epic"
          ? "epic"
          : op === "add_feature"
            ? "feature"
            : op === "add_task"
              ? "task"
              : op === "add_milestone"
                ? "milestone"
                : undefined;
      const opTitle = (op: AgentOperation) =>
        String(
          (op.patch?.title as string | undefined) ??
            (op.data?.title as string | undefined) ??
            "",
        ).trim();

      // Link each created node to the operation that created it (same type +
      // title) so we can resolve parents — including a parent created in the
      // same turn (temp_id → real id).
      const created = impactedItems.filter((i) => i.impact === "created");
      const opForItem = (item: AgentCommitImpactedItem) =>
        operations.find(
          (op) =>
            createdTypeForOp(op.op) === item.node_type &&
            opTitle(op) === (item.title ?? "").trim(),
        );
      const tempToReal = new Map<string, string>();
      for (const item of created) {
        const op = opForItem(item);
        if (op?.temp_id) tempToReal.set(op.temp_id, item.node_id);
      }
      const resolveParentId = (op?: AgentOperation): string | null => {
        if (!op) return null;
        if (op.parent_ref && tempToReal.has(op.parent_ref))
          return tempToReal.get(op.parent_ref) ?? null;
        return op.parent_id ?? null;
      };

      let epics = state.epics;
      let milestones = state.milestones;

      // Deletions (any node type).
      for (const item of impactedItems) {
        if (item.impact !== "deleted") continue;
        if (item.node_type === "milestone") {
          milestones = milestones.filter((m) => m.id !== item.node_id);
        } else if (item.node_type === "epic") {
          epics = epics.filter((e) => e.id !== item.node_id);
        } else if (item.node_type === "feature") {
          epics = epics.map((e) => ({
            ...e,
            features: (e.features ?? []).filter((f) => f.id !== item.node_id),
          }));
        } else if (item.node_type === "task") {
          epics = epics.map((e) => ({
            ...e,
            features: (e.features ?? []).map((f) => ({
              ...f,
              tasks: (f.tasks ?? []).filter((t) => t.id !== item.node_id),
            })),
          }));
        }
      }

      const epicExists = (id: string) => epics.some((e) => e.id === id);
      const featureExists = (id: string) =>
        epics.some((e) => (e.features ?? []).some((f) => f.id === id));
      const taskExists = (id: string) =>
        epics.some((e) =>
          (e.features ?? []).some((f) =>
            (f.tasks ?? []).some((t) => t.id === id),
          ),
        );

      // Creations — epics first, then features, then tasks, so parents exist.
      const typeRank: Record<string, number> = { epic: 0, feature: 1, task: 2 };
      const sortedCreated = [...created].sort(
        (a, b) => (typeRank[a.node_type] ?? 9) - (typeRank[b.node_type] ?? 9),
      );
      for (const item of sortedCreated) {
        const title = item.title ?? "Untitled";
        if (item.node_type === "milestone") {
          if (milestones.some((m) => m.id === item.node_id)) continue;
          const op = opForItem(item);
          const targetDate =
            (op?.data?.target_date as string | undefined) ?? now;
          const newMilestone: RoadmapMilestone = {
            id: item.node_id,
            roadmap_id: roadmapId,
            title,
            description: (op?.data?.description as string | undefined) ?? "",
            target_date: targetDate,
            status:
              ((op?.data?.status as string | undefined) ??
                "not_started") as RoadmapMilestone["status"],
            position: milestones.length,
            color: op?.data?.color as string | undefined,
            created_at: now,
            updated_at: now,
          };
          milestones = [...milestones, newMilestone];
          continue;
        }
        if (item.node_type === "epic") {
          if (epicExists(item.node_id)) continue;
          const newEpic: RoadmapEpic = {
            id: item.node_id,
            roadmap_id: roadmapId,
            title,
            description: "",
            priority: "medium",
            status: "backlog",
            position: epics.length,
            created_at: now,
            updated_at: now,
            features: [],
          };
          epics = [...epics, newEpic];
        } else if (item.node_type === "feature") {
          if (featureExists(item.node_id)) continue;
          const epicId = resolveParentId(opForItem(item));
          if (!epicId || !epicExists(epicId)) continue; // reconcile will catch it
          const newFeature: RoadmapFeature = {
            id: item.node_id,
            roadmap_id: roadmapId,
            epic_id: epicId,
            title,
            position: 0,
            is_deliverable: false,
            created_at: now,
            updated_at: now,
            tasks: [],
          };
          epics = epics.map((e) =>
            e.id === epicId
              ? { ...e, features: [...(e.features ?? []), newFeature] }
              : e,
          );
        } else if (item.node_type === "task") {
          if (taskExists(item.node_id)) continue;
          const featureId = resolveParentId(opForItem(item));
          if (!featureId || !featureExists(featureId)) continue;
          const newTask: RoadmapTask = {
            id: item.node_id,
            feature_id: featureId,
            title,
            status: "todo",
            priority: "medium",
            position: 0,
            created_at: now,
            updated_at: now,
          };
          epics = epics.map((e) => ({
            ...e,
            features: (e.features ?? []).map((f) =>
              f.id === featureId
                ? { ...f, tasks: [...(f.tasks ?? []), newTask] }
                : f,
            ),
          }));
        }
      }

      // Modifications — renames, status, descriptions, dates, and moves render
      // instantly too. The impacted item locates the node (node_id) and carries
      // the post-commit title; the staged operations supply the rest.
      const modified = impactedItems.filter((i) => i.impact === "modified");
      const EPIC_KEYS = [
        "title",
        "description",
        "priority",
        "status",
        "color",
        "start_date",
        "end_date",
        "estimated_hours",
        "actual_hours",
      ];
      const FEATURE_KEYS = [
        "title",
        "description",
        "is_deliverable",
        "start_date",
        "end_date",
        "estimated_hours",
        "actual_hours",
      ];
      const TASK_KEYS = [
        "title",
        "description",
        "status",
        "priority",
        "assignee_id",
        "due_date",
        "work_type",
      ];

      const shiftDate = (value: unknown, days: number): unknown => {
        if (typeof value !== "string" || !value) return value;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        date.setDate(date.getDate() + days);
        return value.length <= 10
          ? date.toISOString().slice(0, 10)
          : date.toISOString();
      };

      const patchForItem = (
        item: AgentCommitImpactedItem,
        node: Record<string, unknown>,
        keys: string[],
      ): Record<string, unknown> => {
        const ops = operations.filter((op) => op.node_id === item.node_id);
        let next: Record<string, unknown> = { ...node };
        for (const op of ops) {
          if (op.op === "update_node" && op.patch) {
            for (const key of keys) {
              if (key in op.patch && op.patch[key] !== undefined) {
                next[key] = op.patch[key];
              }
            }
          } else if (op.op === "mark_status" && typeof op.status === "string") {
            if (keys.includes("status")) next.status = op.status;
          } else if (
            op.op === "shift_dates" &&
            typeof op.delta_days === "number"
          ) {
            for (const key of [
              "start_date",
              "end_date",
              "due_date",
              "target_date",
            ]) {
              if (keys.includes(key)) {
                next[key] = shiftDate(next[key], op.delta_days);
              }
            }
          }
        }
        // The semantic diff's title is authoritative (covers renames staged via
        // node_ref where the op didn't carry the resolved node_id).
        const newTitle = (item.title ?? "").trim();
        if (newTitle) next.title = newTitle;
        next.updated_at = now;
        return next;
      };

      const moveTargetFor = (item: AgentCommitImpactedItem): string | null => {
        const moveOp = operations.find(
          (op) => op.op === "move_node" && op.node_id === item.node_id,
        );
        if (!moveOp) return null;
        if (moveOp.new_parent_ref && tempToReal.has(moveOp.new_parent_ref)) {
          return tempToReal.get(moveOp.new_parent_ref) ?? null;
        }
        return moveOp.new_parent_id ?? null;
      };

      const MILESTONE_KEYS = [
        "title",
        "description",
        "status",
        "target_date",
        "completed_date",
        "color",
      ];

      for (const item of modified) {
        if (item.node_type === "milestone") {
          milestones = milestones.map((m) =>
            m.id === item.node_id
              ? (patchForItem(
                  item,
                  m as unknown as Record<string, unknown>,
                  MILESTONE_KEYS,
                ) as unknown as RoadmapMilestone)
              : m,
          );
          continue;
        }
        if (item.node_type === "epic") {
          epics = epics.map((e) =>
            e.id === item.node_id
              ? (patchForItem(
                  item,
                  e as unknown as Record<string, unknown>,
                  EPIC_KEYS,
                ) as unknown as RoadmapEpic)
              : e,
          );
        } else if (item.node_type === "feature") {
          let moving: RoadmapFeature | null = null;
          epics = epics.map((e) => ({
            ...e,
            features: (e.features ?? []).map((f) => {
              if (f.id !== item.node_id) return f;
              const patched = patchForItem(
                item,
                f as unknown as Record<string, unknown>,
                FEATURE_KEYS,
              ) as unknown as RoadmapFeature;
              moving = patched;
              return patched;
            }),
          }));
          const targetEpicId = moveTargetFor(item);
          if (moving && targetEpicId && epicExists(targetEpicId)) {
            const feature: RoadmapFeature = {
              ...(moving as RoadmapFeature),
              epic_id: targetEpicId,
            };
            epics = epics.map((e) => ({
              ...e,
              features:
                e.id === targetEpicId
                  ? [
                      ...(e.features ?? []).filter((f) => f.id !== feature.id),
                      feature,
                    ]
                  : (e.features ?? []).filter((f) => f.id !== feature.id),
            }));
          }
        } else if (item.node_type === "task") {
          let moving: RoadmapTask | null = null;
          epics = epics.map((e) => ({
            ...e,
            features: (e.features ?? []).map((f) => ({
              ...f,
              tasks: (f.tasks ?? []).map((t) => {
                if (t.id !== item.node_id) return t;
                const patched = patchForItem(
                  item,
                  t as unknown as Record<string, unknown>,
                  TASK_KEYS,
                ) as unknown as RoadmapTask;
                moving = patched;
                return patched;
              }),
            })),
          }));
          const targetFeatureId = moveTargetFor(item);
          if (moving && targetFeatureId && featureExists(targetFeatureId)) {
            const task: RoadmapTask = {
              ...(moving as RoadmapTask),
              feature_id: targetFeatureId,
            };
            epics = epics.map((e) => ({
              ...e,
              features: (e.features ?? []).map((f) => ({
                ...f,
                tasks:
                  f.id === targetFeatureId
                    ? [
                        ...(f.tasks ?? []).filter((t) => t.id !== task.id),
                        task,
                      ]
                    : (f.tasks ?? []).filter((t) => t.id !== task.id),
              })),
            }));
          }
        }
      }

      if (epics === state.epics && milestones === state.milestones) return {};
      return { epics, milestones };
    });
  },

  // Reset - Clear all roadmap data
  resetRoadmap: () => {
    set({
      roadmap: null,
      epics: [],
      milestones: [],
      tempToRealNodeId: {},
      pendingEpicById: {},
      pendingFeatureById: {},
      pendingTaskById: {},
      queuedTaskStatusIntentById: {},
      activeTaskStatusSyncById: {},
      taskStatusRollbackById: {},
      focusNodeId: null,
      focusNodeOffsetX: 0,
      focusTaskId: null,
      navigateToEpicId: null,
      navigateToFeature: null,
      openEpicEditorId: null,
      openFeatureEditor: null,
      openTaskDetailId: null,
      pendingCommentId: null,
      activeEpicId: null,
      addFeatureEpicId: null,
      addTaskFeatureId: null,
      canvasViewMode: "roadmap",
      canvasSelectedEpicId: null,
      canvasOpenEpicTabs: [],
    });
  },

  // Update roadmap metadata
  updateRoadmapMetadata: async (updates: Partial<Roadmap>) => {
    const { roadmap } = get();
    if (!roadmap) return;

    try {
      await roadmapService.update(roadmap.id, updates);
      set({ roadmap: { ...roadmap, ...updates } });
    } catch (error) {
      console.error("Failed to update roadmap:", error);
      throw error;
    }
  },

  // Epic CRUD
  addEpic: async (_milestoneId?: string, epicInput?: Partial<RoadmapEpic>) => {
    const { roadmap } = get();
    if (!roadmap) return;

    const createdAt = new Date().toISOString();
    const tempEpicId = `temp-epic-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const requestedPositionRaw =
      typeof epicInput?.position === "number"
        ? epicInput.position
        : Number(epicInput?.position);
    const requestedPosition = Number.isFinite(requestedPositionRaw)
      ? Math.max(0, Math.floor(requestedPositionRaw))
      : null;
    const title = epicInput?.title?.trim() || "New Epic";
    const description = epicInput?.description || "";
    const priority = epicInput?.priority || "medium";
    const status = epicInput?.status || "backlog";
    let optimisticPosition = 0;

    try {
      set((state) => {
        const maxPosition = state.epics.reduce((max, epic) => {
          const position =
            typeof epic.position === "number"
              ? epic.position
              : Number(epic.position);
          if (!Number.isFinite(position) || position < 0) return max;
          return Math.max(max, Math.floor(position));
        }, -1);
        const appendPosition = maxPosition + 1;
        optimisticPosition =
          requestedPosition === null
            ? appendPosition
            : Math.min(requestedPosition, appendPosition);

        const shiftedEpics = state.epics.map((epic) => {
          const position =
            typeof epic.position === "number"
              ? epic.position
              : Number(epic.position);
          if (!Number.isFinite(position) || position < optimisticPosition) {
            return epic;
          }
          return { ...epic, position: Math.floor(position) + 1 };
        });

        const optimisticEpic: RoadmapEpic = {
          id: tempEpicId,
          roadmap_id: roadmap.id,
          title,
          description,
          priority,
          status,
          position: optimisticPosition,
          color: epicInput?.color,
          estimated_hours: epicInput?.estimated_hours,
          actual_hours: epicInput?.actual_hours,
          start_date: epicInput?.start_date,
          end_date: epicInput?.end_date,
          completed_date: epicInput?.completed_date,
          tags: epicInput?.tags,
          labels: epicInput?.labels,
          created_at: createdAt,
          updated_at: createdAt,
          progress: epicInput?.progress,
          features: [],
        };

        return {
          isLoadingEpic: true,
          epics: [...shiftedEpics, optimisticEpic],
        };
      });

      const newEpic = await epicService.create({
        roadmap_id: roadmap.id,
        title,
        description,
        priority,
        status,
        position: optimisticPosition,
        color: epicInput?.color,
        estimated_hours: epicInput?.estimated_hours,
        start_date: epicInput?.start_date,
        end_date: epicInput?.end_date,
        tags: epicInput?.tags,
        labels: epicInput?.labels,
      });

      set((state) => ({
        tempToRealNodeId: {
          ...state.tempToRealNodeId,
          [tempEpicId]: newEpic.id,
        },
        epics: state.epics.map((epic) =>
          epic.id === tempEpicId
            ? { ...newEpic, features: epic.features || [] }
            : epic,
        ),
        isLoadingEpic: false,
      }));
    } catch (error) {
      console.error("Failed to create epic:", error);
      set((state) => ({
        tempToRealNodeId: clearPendingKey(state.tempToRealNodeId, tempEpicId),
        epics: state.epics
          .filter((epic) => epic.id !== tempEpicId)
          .map((epic) => {
            const position =
              typeof epic.position === "number"
                ? epic.position
                : Number(epic.position);
            if (!Number.isFinite(position) || position <= optimisticPosition) {
              return epic;
            }
            return { ...epic, position: Math.max(0, Math.floor(position) - 1) };
          }),
        isLoadingEpic: false,
      }));
      throw error;
    }
  },

  updateEpic: async (updatedEpic: RoadmapEpic) => {
    const currentEpic = get().epics.find((epic) => epic.id === updatedEpic.id);
    if (!currentEpic) return;

    const epicId = updatedEpic.id;
    const rollbackSnapshot = { ...currentEpic };
    const optimisticEpic: RoadmapEpic = {
      ...currentEpic,
      ...updatedEpic,
      features: currentEpic.features,
    };

    set((state) => ({
      isLoadingEpic: true,
      pendingEpicById: {
        ...state.pendingEpicById,
        [epicId]: true,
      },
      epics: patchEpicById(state.epics, epicId, () => optimisticEpic),
    }));

    try {
      const updated = await epicService.update(epicId, {
        title: updatedEpic.title,
        description: updatedEpic.description,
        priority: updatedEpic.priority,
        status: updatedEpic.status,
        position: updatedEpic.position,
        color: updatedEpic.color,
        estimated_hours: updatedEpic.estimated_hours,
        actual_hours: updatedEpic.actual_hours,
        start_date: updatedEpic.start_date ?? null,
        end_date: updatedEpic.end_date ?? null,
        completed_date: updatedEpic.completed_date,
        tags: updatedEpic.tags,
        labels: updatedEpic.labels,
      });

      set((state) => ({
        epics: patchEpicById(state.epics, epicId, (epic) => ({
          ...updated,
          features: epic.features || [],
        })),
      }));
    } catch (error) {
      console.error("Failed to update epic:", error);
      set((state) => ({
        epics: patchEpicById(state.epics, epicId, () => rollbackSnapshot),
      }));
      throw error;
    } finally {
      set((state) => ({
        isLoadingEpic: false,
        pendingEpicById: clearPendingKey(state.pendingEpicById, epicId),
      }));
    }
  },

  reorderEpicsInRoadmap: async (orderedEpicIds: string[]) => {
    const { epics, roadmap } = get();
    if (!roadmap) return;
    if ((epics?.length ?? 0) === 0) return;

    const allEpicIds = epics.map((epic) => epic.id);
    const epicIdSet = new Set(allEpicIds);
    const seen = new Set<string>();
    const normalizedOrderIds: string[] = [];
    for (const epicId of orderedEpicIds) {
      if (!epicId || !epicIdSet.has(epicId) || seen.has(epicId)) {
        continue;
      }
      seen.add(epicId);
      normalizedOrderIds.push(epicId);
    }
    for (const epicId of allEpicIds) {
      if (seen.has(epicId)) continue;
      seen.add(epicId);
      normalizedOrderIds.push(epicId);
    }

    const epicIndexById = new Map(epics.map((epic) => [epic.id, epic]));
    try {
      set({ isLoadingEpic: true });
      const changedEpics = normalizedOrderIds
        .map((epicId, index) => {
          const epic = epicIndexById.get(epicId);
          if (!epic) return null;
          return { epic, nextPosition: index };
        })
        .filter(
          (
            item,
          ): item is {
            epic: RoadmapEpic;
            nextPosition: number;
          } => item !== null,
        );

      const reorderPatch = normalizedOrderIds.map((epicId, index) => ({
        epic_id: epicId,
        new_order_index: index,
      }));

      const hasInvalidExistingPositions = epics.some((epic) => {
        const position =
          typeof epic.position === "number"
            ? epic.position
            : Number(epic.position);
        return !Number.isFinite(position) || position < 0;
      });

      let patchSucceeded = false;
      try {
        await epicService.reorder(roadmap.id, reorderPatch);
        patchSucceeded = true;
      } catch (patchError) {
        const message =
          patchError instanceof Error ? patchError.message.toLowerCase() : "";
        const shouldFallbackToSequential =
          hasInvalidExistingPositions ||
          message.includes("position must not be less than 0") ||
          message.includes("duplicate key value violates unique constraint") ||
          message.includes("invalid input syntax");
        if (!shouldFallbackToSequential) {
          throw patchError;
        }
      }

      if (!patchSucceeded) {
        const currentMaxPosition = epics.reduce((max, epic) => {
          const position =
            typeof epic.position === "number"
              ? epic.position
              : Number(epic.position);
          if (!Number.isFinite(position) || position < 0) return max;
          return Math.max(max, position);
        }, 0);
        const tempBase = currentMaxPosition + epics.length + 1000;
        for (const [index, item] of changedEpics.entries()) {
          await epicService.update(item.epic.id, {
            position: tempBase + index,
          });
        }

        for (const item of changedEpics) {
          await epicService.update(item.epic.id, {
            position: Math.max(0, item.nextPosition),
          });
        }
      }

      set({
        epics: normalizedOrderIds
          .map((epicId, index) => {
            const epic = epicIndexById.get(epicId);
            if (!epic) return null;
            return {
              ...epic,
              position: index,
              updated_at: new Date().toISOString(),
            };
          })
          .filter((epic): epic is RoadmapEpic => epic !== null),
        isLoadingEpic: false,
      });
    } catch (error) {
      console.error("Failed to reorder epics:", error);
      set({ isLoadingEpic: false });
      throw error;
    }
  },

  previewEpicOrderInRoadmap: (orderedEpicIds: string[]) => {
    const { epics } = get();
    if ((epics?.length ?? 0) === 0) return;

    const epicIndexById = new Map(epics.map((epic) => [epic.id, epic]));
    set({
      epics: orderedEpicIds
        .map((epicId, index) => {
          const epic = epicIndexById.get(epicId);
          if (!epic) return null;
          return {
            ...epic,
            position: index,
            updated_at: new Date().toISOString(),
          };
        })
        .filter((epic): epic is RoadmapEpic => epic !== null),
    });
  },

  deleteEpic: async (epicId: string) => {
    const { epics, tempToRealNodeId } = get();
    const epicToDelete = epics.find((epic) => epic.id === epicId);
    if (!epicToDelete) return;

    const rollbackEpics = epics;
    const rollbackTempToRealNodeId = tempToRealNodeId;
    const epicPosition =
      typeof epicToDelete.position === "number"
        ? Math.floor(epicToDelete.position)
        : Number(epicToDelete.position);
    const removedNodeIds = new Set<string>([epicId]);
    for (const feature of epicToDelete.features || []) {
      removedNodeIds.add(feature.id);
      for (const task of feature.tasks || []) {
        removedNodeIds.add(task.id);
      }
    }

    try {
      set((state) => ({
        isLoadingEpic: true,
        tempToRealNodeId: clearNodeMappingsForIds(
          state.tempToRealNodeId,
          removedNodeIds,
        ),
        epics: state.epics
          .filter((epic) => epic.id !== epicId)
          .map((epic) => {
            const position =
              typeof epic.position === "number"
                ? Math.floor(epic.position)
                : Number(epic.position);
            if (!Number.isFinite(epicPosition) || !Number.isFinite(position)) {
              return epic;
            }
            if (position <= epicPosition) return epic;
            return { ...epic, position: Math.max(0, position - 1) };
          }),
      }));

      await epicService.delete(epicId);
      set({ isLoadingEpic: false });
    } catch (error) {
      console.error("Failed to delete epic:", error);
      set({
        epics: rollbackEpics,
        tempToRealNodeId: rollbackTempToRealNodeId,
        isLoadingEpic: false,
      });
      throw error;
    }
  },

  // Feature CRUD
  addFeature: async (epicId: string, data: FeatureData) => {
    const { roadmap, epics } = get();
    if (!roadmap) return;

    const epic = epics.find((e) => e.id === epicId);
    if (!epic) return;

    const createdAt = new Date().toISOString();
    const tempFeatureId = `temp-feature-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const requestedPositionRaw =
      typeof data.position === "number" ? data.position : Number(data.position);
    const requestedPosition = Number.isFinite(requestedPositionRaw)
      ? Math.max(0, Math.floor(requestedPositionRaw))
      : null;
    const title = data.title.trim();
    let optimisticPosition = 0;
    let hasOptimisticInsert = false;

    try {
      set((state) => {
        const targetEpic = state.epics.find((item) => item.id === epicId);
        if (!targetEpic) {
          return { isLoadingFeature: false };
        }

        const existingFeatures = targetEpic.features || [];
        const maxPosition = existingFeatures.reduce((max, feature) => {
          const position =
            typeof feature.position === "number"
              ? feature.position
              : Number(feature.position);
          if (!Number.isFinite(position) || position < 0) return max;
          return Math.max(max, Math.floor(position));
        }, -1);
        const appendPosition = maxPosition + 1;
        optimisticPosition =
          requestedPosition === null
            ? appendPosition
            : Math.min(requestedPosition, appendPosition);

        const shiftedFeatures = existingFeatures.map((feature) => {
          const position =
            typeof feature.position === "number"
              ? feature.position
              : Number(feature.position);
          if (!Number.isFinite(position) || position < optimisticPosition) {
            return feature;
          }
          return { ...feature, position: Math.floor(position) + 1 };
        });

        const optimisticFeature: RoadmapFeature = {
          id: tempFeatureId,
          roadmap_id: roadmap.id,
          epic_id: epicId,
          title,
          description: data.description,
          position: optimisticPosition,
          is_deliverable: data.is_deliverable,
          estimated_hours: undefined,
          actual_hours: undefined,
          start_date: data.start_date,
          end_date: data.end_date,
          created_at: createdAt,
          updated_at: createdAt,
          progress: undefined,
          comments: undefined,
          tasks: [],
        };

        hasOptimisticInsert = true;

        return {
          isLoadingFeature: true,
          epics: state.epics.map((item) =>
            item.id === epicId
              ? {
                  ...item,
                  features: [...shiftedFeatures, optimisticFeature],
                  updated_at: createdAt,
                }
              : item,
          ),
        };
      });
      if (!hasOptimisticInsert) return;

      const newFeature = await featureService.create({
        roadmap_id: roadmap.id,
        epic_id: epicId,
        title,
        description: data.description,
        position: optimisticPosition,
        is_deliverable: data.is_deliverable,
        start_date: data.start_date,
        end_date: data.end_date,
      });

      set((state) => ({
        tempToRealNodeId: {
          ...state.tempToRealNodeId,
          [tempFeatureId]: newFeature.id,
        },
        epics: state.epics.map((item) =>
          item.id === epicId
            ? {
                ...item,
                features: (item.features || []).map((feature) =>
                  feature.id === tempFeatureId
                    ? { ...newFeature, tasks: feature.tasks || [] }
                    : feature,
                ),
              }
            : item,
        ),
        isLoadingFeature: false,
      }));
    } catch (error) {
      console.error("Failed to create feature:", error);
      set((state) => ({
        tempToRealNodeId: clearPendingKey(
          state.tempToRealNodeId,
          tempFeatureId,
        ),
        epics: state.epics.map((item) => {
          if (item.id !== epicId) return item;
          return {
            ...item,
            features: (item.features || [])
              .filter((feature) => feature.id !== tempFeatureId)
              .map((feature) => {
                const position =
                  typeof feature.position === "number"
                    ? feature.position
                    : Number(feature.position);
                if (
                  !Number.isFinite(position) ||
                  position <= optimisticPosition
                ) {
                  return feature;
                }
                return {
                  ...feature,
                  position: Math.max(0, Math.floor(position) - 1),
                };
              }),
          };
        }),
        isLoadingFeature: false,
      }));
      throw error;
    }
  },

  updateFeature: async (feature: RoadmapFeature) => {
    const currentFeature = get()
      .epics.flatMap((epic) => epic.features || [])
      .find((item) => item.id === feature.id);
    if (!currentFeature) return;

    const featureId = feature.id;
    const rollbackSnapshot = { ...currentFeature };
    const optimisticFeature: RoadmapFeature = {
      ...currentFeature,
      ...feature,
      tasks: currentFeature.tasks,
    };

    set((state) => ({
      isLoadingFeature: true,
      pendingFeatureById: {
        ...state.pendingFeatureById,
        [featureId]: true,
      },
      epics: patchFeatureById(state.epics, featureId, () => optimisticFeature),
    }));

    try {
      const updated = await featureService.update(featureId, {
        title: feature.title,
        description: feature.description,
        position: feature.position,
        is_deliverable: feature.is_deliverable,
        estimated_hours: feature.estimated_hours,
        actual_hours: feature.actual_hours,
        start_date: feature.start_date ?? null,
        end_date: feature.end_date ?? null,
      });

      set((state) => ({
        epics: patchFeatureById(state.epics, featureId, (current) => ({
          ...updated,
          tasks: current.tasks || [],
        })),
      }));

      if (feature.start_date && feature.end_date) {
        const parentEpic = get().epics.find((e) => e.id === feature.epic_id);
        if (parentEpic?.start_date && parentEpic?.end_date) {
          const featureStart = new Date(feature.start_date).getTime();
          const featureEnd = new Date(feature.end_date).getTime();
          const epicStart = new Date(parentEpic.start_date).getTime();
          const epicEnd = new Date(parentEpic.end_date).getTime();
          if (featureStart < epicStart || featureEnd > epicEnd) {
            const toISO = (d: Date) => d.toISOString().slice(0, 10);
            void get().updateEpic({
              ...parentEpic,
              start_date: toISO(new Date(Math.min(epicStart, featureStart))),
              end_date: toISO(new Date(Math.max(epicEnd, featureEnd))),
            });
          }
        }
      }
    } catch (error) {
      console.error("Failed to update feature:", error);
      set((state) => ({
        epics: patchFeatureById(state.epics, featureId, () => rollbackSnapshot),
      }));
      throw error;
    } finally {
      set((state) => ({
        isLoadingFeature: false,
        pendingFeatureById: clearPendingKey(
          state.pendingFeatureById,
          featureId,
        ),
      }));
    }
  },

  reorderFeaturesInEpic: async (
    epicId: string,
    orderedFeatureIds: string[],
  ) => {
    const { epics } = get();
    const epic = epics.find((item) => item.id === epicId);
    if (!epic) return;
    if ((epic.features?.length ?? 0) === 0) return;

    const epicFeatureIds = (epic.features ?? []).map((feature) => feature.id);
    const epicFeatureIdSet = new Set(epicFeatureIds);
    const seen = new Set<string>();
    const normalizedOrderIds: string[] = [];
    for (const featureId of orderedFeatureIds) {
      if (
        !featureId ||
        !epicFeatureIdSet.has(featureId) ||
        seen.has(featureId)
      ) {
        continue;
      }
      seen.add(featureId);
      normalizedOrderIds.push(featureId);
    }
    for (const featureId of epicFeatureIds) {
      if (seen.has(featureId)) continue;
      seen.add(featureId);
      normalizedOrderIds.push(featureId);
    }

    const featureIndexById = new Map(
      (epic.features ?? []).map((feature) => [feature.id, feature]),
    );
    try {
      set({ isLoadingFeature: true });
      const changedFeatures = normalizedOrderIds
        .map((featureId, index) => {
          const feature = featureIndexById.get(featureId);
          if (!feature) return null;
          return { feature, nextPosition: index };
        })
        .filter(
          (
            item,
          ): item is {
            feature: RoadmapFeature;
            nextPosition: number;
          } => item !== null,
        );

      const reorderPatch = normalizedOrderIds.map((featureId, index) => ({
        feature_id: featureId,
        new_order_index: index,
      }));

      const hasInvalidExistingPositions = (epic.features ?? []).some(
        (feature) => {
          const position =
            typeof feature.position === "number"
              ? feature.position
              : Number(feature.position);
          return !Number.isFinite(position) || position < 0;
        },
      );

      let patchSucceeded = false;
      try {
        // Keep the reorder patch endpoint as the primary path.
        await featureService.reorder(epicId, reorderPatch);
        patchSucceeded = true;
      } catch (patchError) {
        const message =
          patchError instanceof Error ? patchError.message.toLowerCase() : "";
        const shouldFallbackToSequential =
          hasInvalidExistingPositions ||
          message.includes("position must not be less than 0") ||
          message.includes("duplicate key value violates unique constraint") ||
          message.includes("invalid input syntax");
        if (!shouldFallbackToSequential) {
          throw patchError;
        }
      }

      if (!patchSucceeded) {
        // Fallback: move to temporary high positive positions first, then finals.
        const currentMaxPosition = (epic.features ?? []).reduce(
          (max, feature) => {
            const position =
              typeof feature.position === "number"
                ? feature.position
                : Number(feature.position);
            if (!Number.isFinite(position) || position < 0) return max;
            return Math.max(max, position);
          },
          0,
        );
        const tempBase =
          currentMaxPosition + (epic.features?.length ?? 0) + 1000;
        for (const [index, item] of changedFeatures.entries()) {
          await featureService.update(item.feature.id, {
            position: tempBase + index,
          });
        }

        for (const item of changedFeatures) {
          await featureService.update(item.feature.id, {
            position: Math.max(0, item.nextPosition),
          });
        }
      }

      set({
        epics: epics.map((item) => {
          if (item.id !== epicId) return item;
          const reorderedFeatures = normalizedOrderIds
            .map((featureId, index) => {
              const feature = featureIndexById.get(featureId);
              if (!feature) return null;
              return { ...feature, position: index };
            })
            .filter((feature): feature is RoadmapFeature => feature !== null);
          return {
            ...item,
            features: reorderedFeatures,
            updated_at: new Date().toISOString(),
          };
        }),
        isLoadingFeature: false,
      });
    } catch (error) {
      console.error(`Failed to reorder features in epic ${epicId}:`, error);
      set({ isLoadingFeature: false });
      throw error;
    }
  },

  previewFeatureOrderInEpic: (epicId: string, orderedFeatureIds: string[]) => {
    const { epics } = get();
    const epic = epics.find((item) => item.id === epicId);
    if (!epic) return;
    if ((epic.features?.length ?? 0) === 0) return;

    const featureIndexById = new Map(
      (epic.features ?? []).map((feature) => [feature.id, feature]),
    );

    set({
      epics: epics.map((item) => {
        if (item.id !== epicId) return item;
        const reorderedFeatures = orderedFeatureIds
          .map((featureId, index) => {
            const feature = featureIndexById.get(featureId);
            if (!feature) return null;
            return { ...feature, position: index };
          })
          .filter((feature): feature is RoadmapFeature => feature !== null);
        return {
          ...item,
          features: reorderedFeatures,
          updated_at: new Date().toISOString(),
        };
      }),
    });
  },

  deleteFeature: async (featureId: string) => {
    const { epics, tempToRealNodeId } = get();
    const epic = epics.find((e) => e.features?.some((f) => f.id === featureId));
    const featureToDelete = epic?.features?.find(
      (feature) => feature.id === featureId,
    );
    if (!epic || !featureToDelete) return;

    const rollbackEpics = epics;
    const rollbackTempToRealNodeId = tempToRealNodeId;
    const featurePosition =
      typeof featureToDelete.position === "number"
        ? Math.floor(featureToDelete.position)
        : Number(featureToDelete.position);
    const removedNodeIds = new Set<string>([featureId]);
    for (const task of featureToDelete.tasks || []) {
      removedNodeIds.add(task.id);
    }

    try {
      set((state) => ({
        isLoadingFeature: true,
        tempToRealNodeId: clearNodeMappingsForIds(
          state.tempToRealNodeId,
          removedNodeIds,
        ),
        epics: state.epics.map((currentEpic) => {
          if (currentEpic.id !== epic.id) return currentEpic;

          return {
            ...currentEpic,
            features: (currentEpic.features || [])
              .filter((feature) => feature.id !== featureId)
              .map((feature) => {
                const position =
                  typeof feature.position === "number"
                    ? Math.floor(feature.position)
                    : Number(feature.position);
                if (
                  !Number.isFinite(featurePosition) ||
                  !Number.isFinite(position) ||
                  position <= featurePosition
                ) {
                  return feature;
                }
                return { ...feature, position: Math.max(0, position - 1) };
              }),
            updated_at: new Date().toISOString(),
          };
        }),
      }));

      await featureService.delete(featureId);
      set({ isLoadingFeature: false });
    } catch (error) {
      console.error("Failed to delete feature:", error);
      set({
        epics: rollbackEpics,
        tempToRealNodeId: rollbackTempToRealNodeId,
        isLoadingFeature: false,
      });
      throw error;
    }
  },

  moveFeatureBetweenEpics: async (
    featureId: string,
    targetEpicId: string,
    orderedTargetFeatureIds: string[],
  ) => {
    const { epics } = get();
    const sourceEpic = epics.find((e) => e.features?.some((f) => f.id === featureId));
    if (!sourceEpic || sourceEpic.id === targetEpicId) return;

    const rollbackEpics = epics;

    set((state) => ({
      pendingFeatureById: { ...state.pendingFeatureById, [featureId]: true },
      epics: moveFeatureAcrossEpics(
        state.epics,
        featureId,
        targetEpicId,
        orderedTargetFeatureIds,
      ),
    }));

    try {
      // Step 1: move the feature to the target epic with a safe temp position that
      // won't collide with any existing feature in the target epic.
      const safePosition = orderedTargetFeatureIds.length * 1000 + 5000;
      await featureService.update(featureId, { epic_id: targetEpicId, position: safePosition });

      // Step 2: reorder all features in the target epic so every position is correct.
      const reorderItems = orderedTargetFeatureIds.map((fid, index) => ({
        feature_id: fid,
        new_order_index: index,
      }));
      await featureService.reorder(targetEpicId, reorderItems);
    } catch (error) {
      console.error("Failed to move feature between epics:", error);
      set({ epics: rollbackEpics });
      throw error;
    } finally {
      set((state) => ({
        pendingFeatureById: { ...state.pendingFeatureById, [featureId]: false },
      }));
    }
  },

  // Task CRUD
  addTask: async (featureId: string, data: Partial<RoadmapTask>) => {
    const title = data.title?.trim();
    if (!title) {
      console.warn("Task title is required");
      return;
    }

    const createdAt = new Date().toISOString();
    const tempTaskId = `temp-task-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const requestedPositionRaw =
      typeof data.position === "number" ? data.position : Number(data.position);
    const requestedPosition = Number.isFinite(requestedPositionRaw)
      ? Math.max(0, Math.floor(requestedPositionRaw))
      : null;
    let optimisticPosition = 0;
    let hasOptimisticInsert = false;

    try {
      set((state) => {
        let foundFeature = false;
        const nextEpics = state.epics.map((epic) => ({
          ...epic,
          features: (epic.features || []).map((feature) => {
            if (feature.id !== featureId) {
              return feature;
            }
            foundFeature = true;
            const existingTasks = feature.tasks || [];
            const maxPosition = existingTasks.reduce((max, task) => {
              const position =
                typeof task.position === "number"
                  ? task.position
                  : Number(task.position);
              if (!Number.isFinite(position) || position < 0) return max;
              return Math.max(max, Math.floor(position));
            }, -1);
            const appendPosition = maxPosition + 1;
            optimisticPosition =
              requestedPosition === null
                ? appendPosition
                : Math.min(requestedPosition, appendPosition);

            const shiftedTasks = existingTasks.map((task) => {
              const position =
                typeof task.position === "number"
                  ? task.position
                  : Number(task.position);
              if (!Number.isFinite(position) || position < optimisticPosition) {
                return task;
              }
              return { ...task, position: Math.floor(position) + 1 };
            });

            const optimisticTask: RoadmapTask = {
              id: tempTaskId,
              feature_id: featureId,
              title,
              assignee_id: data.assignee_id,
              status: data.status || "todo",
              priority: data.priority || "medium",
              work_type: data.work_type || "real_work",
              position: optimisticPosition,
              due_date: data.due_date,
              completed_at: data.completed_at,
              created_at: createdAt,
              updated_at: createdAt,
              description: data.description,
              checklist: data.checklist,
              assignee: data.assignee,
              labels: data.labels,
            };

            return {
              ...feature,
              tasks: [...shiftedTasks, optimisticTask],
              updated_at: createdAt,
            };
          }),
        }));

        if (!foundFeature) {
          return { isLoadingTask: false };
        }
        hasOptimisticInsert = true;

        return {
          epics: nextEpics,
          isLoadingTask: true,
        };
      });
      if (!hasOptimisticInsert) return;

      const newTask = await taskService.create({
        feature_id: featureId,
        title,
        description: data.description,
        status: data.status || "todo",
        priority: data.priority || "medium",
        work_type: data.work_type || "real_work",
        assignee_id: data.assignee_id,
        position: optimisticPosition,
        due_date: data.due_date,
        checklist: data.checklist ?? [],
      });

      set((state) => ({
        tempToRealNodeId: {
          ...state.tempToRealNodeId,
          [tempTaskId]: newTask.id,
        },
        epics: state.epics.map((epic) => ({
          ...epic,
          features: (epic.features || []).map((feature) =>
            feature.id === featureId
              ? {
                  ...feature,
                  tasks: (feature.tasks || []).map((task) =>
                    task.id === tempTaskId ? newTask : task,
                  ),
                }
              : feature,
          ),
        })),
        isLoadingTask: false,
      }));
    } catch (error) {
      console.error("Failed to create task:", error);
      set((state) => ({
        tempToRealNodeId: clearPendingKey(state.tempToRealNodeId, tempTaskId),
        epics: state.epics.map((epic) => ({
          ...epic,
          features: (epic.features || []).map((feature) => {
            if (feature.id !== featureId) return feature;
            return {
              ...feature,
              tasks: (feature.tasks || [])
                .filter((task) => task.id !== tempTaskId)
                .map((task) => {
                  const position =
                    typeof task.position === "number"
                      ? task.position
                      : Number(task.position);
                  if (
                    !Number.isFinite(position) ||
                    position <= optimisticPosition
                  ) {
                    return task;
                  }
                  return {
                    ...task,
                    position: Math.max(0, Math.floor(position) - 1),
                  };
                }),
            };
          }),
        })),
        isLoadingTask: false,
      }));
      throw error;
    }
  },

  updateTask: async (task: RoadmapTask) => {
    const { epics, pendingTaskById } = get();
    const taskId = task.id;
    if (pendingTaskById[taskId]) return;

    const currentTask = findTaskById(epics, taskId);
    if (!currentTask) return;

    const rollbackSnapshot = { ...currentTask };
    const optimisticTask: RoadmapTask = {
      ...currentTask,
      ...task,
    };

    set((state) => ({
      isLoadingTask: true,
      pendingTaskById: {
        ...state.pendingTaskById,
        [taskId]: true,
      },
      epics: patchTaskById(state.epics, taskId, () => optimisticTask),
    }));

    try {
      const updated = await taskService.update(taskId, {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        work_type: task.work_type,
        position: task.position ?? undefined,
        assignee_id: task.assignee_id ?? undefined,
        due_date: task.due_date ?? undefined,
        completed_at: task.completed_at ?? undefined,
        checklist: task.checklist,
      });

      set((state) => ({
        epics: patchTaskById(state.epics, taskId, () => updated),
      }));
    } catch (error) {
      console.error("Failed to update task:", error);
      set((state) => ({
        epics: patchTaskById(state.epics, taskId, () => rollbackSnapshot),
      }));
      throw error;
    } finally {
      set((state) => ({
        isLoadingTask: false,
        pendingTaskById: clearPendingKey(state.pendingTaskById, taskId),
      }));
    }
  },

  updateTaskStatusIntent: async (
    taskId: string,
    nextStatus: RoadmapTask["status"],
  ) => {
    const taskBeforeIntent = findTaskById(get().epics, taskId);
    if (!taskBeforeIntent) return;

    const shouldStartSync = !Boolean(get().activeTaskStatusSyncById[taskId]);

    set((state) => ({
      epics: patchTaskById(state.epics, taskId, (task) => ({
        ...task,
        status: nextStatus,
      })),
      queuedTaskStatusIntentById: {
        ...state.queuedTaskStatusIntentById,
        [taskId]: {
          status: nextStatus,
        },
      },
      taskStatusRollbackById: {
        ...state.taskStatusRollbackById,
        [taskId]: { ...taskBeforeIntent },
      },
      activeTaskStatusSyncById: shouldStartSync
        ? {
            ...state.activeTaskStatusSyncById,
            [taskId]: true,
          }
        : state.activeTaskStatusSyncById,
    }));

    if (!shouldStartSync) return;

    try {
      while (true) {
        const intentStatus = get().queuedTaskStatusIntentById[taskId];
        if (!intentStatus) break;

        set((state) => ({
          queuedTaskStatusIntentById: clearPendingKey(
            state.queuedTaskStatusIntentById,
            taskId,
          ),
        }));

        const taskForRequest = findTaskById(get().epics, taskId);
        if (!taskForRequest) break;

        try {
          const updated = await taskService.update(taskId, {
            title: taskForRequest.title,
            status: intentStatus.status,
            priority: taskForRequest.priority,
            position: taskForRequest.position,
            assignee_id: taskForRequest.assignee_id,
            due_date: taskForRequest.due_date,
            completed_at: taskForRequest.completed_at,
          });

          set((state) => ({
            epics: patchTaskById(state.epics, taskId, (task) => {
              const merged = { ...task, ...updated };
              const hasQueuedNewerIntent = Boolean(
                state.queuedTaskStatusIntentById[taskId],
              );
              return hasQueuedNewerIntent
                ? { ...merged, status: task.status }
                : merged;
            }),
          }));
        } catch (error) {
          const hasQueuedNewerIntent = Boolean(
            get().queuedTaskStatusIntentById[taskId],
          );
          if (hasQueuedNewerIntent) {
            continue;
          }

          const rollbackTask = get().taskStatusRollbackById[taskId];
          if (rollbackTask) {
            set((state) => ({
              epics: patchTaskById(state.epics, taskId, () => rollbackTask),
            }));
          }
          throw error;
        }
      }
    } finally {
      set((state) => ({
        queuedTaskStatusIntentById: clearPendingKey(
          state.queuedTaskStatusIntentById,
          taskId,
        ),
        activeTaskStatusSyncById: clearPendingKey(
          state.activeTaskStatusSyncById,
          taskId,
        ),
        taskStatusRollbackById: clearTaskRollbackKey(
          state.taskStatusRollbackById,
          taskId,
        ),
      }));
    }
  },

  deleteTask: async (taskId: string) => {
    const { epics, tempToRealNodeId } = get();
    let taskPosition: number | null = null;
    let featureIdForTask: string | null = null;
    const removedNodeIds = new Set<string>([taskId]);

    for (const epic of epics) {
      for (const feature of epic.features || []) {
        const task = (feature.tasks || []).find(
          (candidate) => candidate.id === taskId,
        );
        if (!task) continue;
        featureIdForTask = feature.id;
        taskPosition =
          typeof task.position === "number"
            ? Math.floor(task.position)
            : Number(task.position);
      }
    }

    if (!featureIdForTask) return;

    const rollbackEpics = epics;
    const rollbackTempToRealNodeId = tempToRealNodeId;

    try {
      set((state) => ({
        isLoadingTask: true,
        tempToRealNodeId: clearNodeMappingsForIds(
          state.tempToRealNodeId,
          removedNodeIds,
        ),
        epics: state.epics.map((epic) => ({
          ...epic,
          features: (epic.features || []).map((feature) => {
            if (feature.id !== featureIdForTask) return feature;

            return {
              ...feature,
              tasks: (feature.tasks || [])
                .filter((task) => task.id !== taskId)
                .map((task) => {
                  const position =
                    typeof task.position === "number"
                      ? Math.floor(task.position)
                      : Number(task.position);
                  if (
                    taskPosition === null ||
                    !Number.isFinite(taskPosition) ||
                    !Number.isFinite(position) ||
                    position <= taskPosition
                  ) {
                    return task;
                  }

                  return { ...task, position: Math.max(0, position - 1) };
                }),
              updated_at: new Date().toISOString(),
            };
          }),
        })),
      }));

      await taskService.delete(taskId);
      set({ isLoadingTask: false });
    } catch (error) {
      console.error("Failed to delete task:", error);
      set({
        epics: rollbackEpics,
        tempToRealNodeId: rollbackTempToRealNodeId,
        isLoadingTask: false,
      });
      throw error;
    }
  },

  reorderTasksInFeature: async (featureId: string, orderedTaskIds: string[]) => {
    const { epics } = get();

    const feature = epics
      .flatMap((e) => e.features ?? [])
      .find((f) => f.id === featureId);
    if (!feature || !feature.tasks?.length) return;

    const currentTaskIds = (feature.tasks ?? []).map((t) => t.id);
    const currentTaskIdSet = new Set(currentTaskIds);
    const seen = new Set<string>();
    const normalizedIds: string[] = [];
    for (const id of orderedTaskIds) {
      if (!id || !currentTaskIdSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      normalizedIds.push(id);
    }
    for (const id of currentTaskIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      normalizedIds.push(id);
    }

    const taskById = new Map((feature.tasks ?? []).map((t) => [t.id, t]));

    const optimisticEpics = epics.map((epic) => ({
      ...epic,
      features: (epic.features ?? []).map((f) => {
        if (f.id !== featureId) return f;
        return {
          ...f,
          tasks: normalizedIds
            .map((id, index) => {
              const task = taskById.get(id);
              if (!task) return null;
              return { ...task, position: index };
            })
            .filter((t): t is RoadmapTask => t !== null),
        };
      }),
    }));

    set({ epics: optimisticEpics });

    try {
      const reorderPatch = normalizedIds.map((taskId, index) => ({
        task_id: taskId,
        new_order_index: index,
      }));
      await taskService.reorder(featureId, reorderPatch);
    } catch (error) {
      console.error(`Failed to reorder tasks in feature ${featureId}:`, error);
      set({ epics });
      throw error;
    }
  },

  // Milestone CRUD
  addMilestone: async (data) => {
    const { roadmap, milestones } = get();
    if (!roadmap) return;
    const nextPosition =
      milestones.reduce(
        (maxPosition, milestone) =>
          Math.max(maxPosition, milestone.position ?? -1),
        -1,
      ) + 1;

    const now = new Date().toISOString();
    const tempMilestoneId = `temp-milestone-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const optimisticMilestone: RoadmapMilestone = {
      id: tempMilestoneId,
      roadmap_id: roadmap.id,
      title: data.title,
      description: data.description,
      target_date: data.target_date,
      status: data.status ?? "not_started",
      color: data.color,
      position: nextPosition,
      created_at: now,
      updated_at: now,
      linked_features: [],
    };

    set((state) => ({
      milestones: [...state.milestones, optimisticMilestone].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      ),
    }));

    try {
      const created = await milestoneService.create(roadmap.id, {
        title: data.title,
        target_date: data.target_date,
        description: data.description,
        status: data.status ?? "not_started",
        color: data.color,
        position: nextPosition,
      });
      set((state) => ({
        milestones: state.milestones
          .map((m) => (m.id === tempMilestoneId ? created : m))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      }));
    } catch (error) {
      set((state) => ({
        milestones: state.milestones.filter((m) => m.id !== tempMilestoneId),
      }));
      throw error;
    }
  },

  updateMilestone: async (updated: RoadmapMilestone) => {
    const current = get().milestones.find((m) => m.id === updated.id);
    if (!current) return;
    const rollbackSnapshot = { ...current };

    set((state) => ({
      milestones: state.milestones.map((m) =>
        m.id === updated.id ? { ...m, ...updated } : m,
      ),
    }));

    try {
      const saved = await milestoneService.update(updated.id, {
        title: updated.title,
        description: updated.description,
        target_date: updated.target_date,
        status: updated.status,
        color: updated.color,
      });
      set((state) => ({
        milestones: state.milestones.map((m) =>
          m.id === saved.id ? { ...m, ...saved } : m,
        ),
      }));
    } catch (error) {
      set((state) => ({
        milestones: state.milestones.map((m) =>
          m.id === rollbackSnapshot.id ? rollbackSnapshot : m,
        ),
      }));
      throw error;
    }
  },

  deleteMilestone: async (id: string) => {
    const rollbackMilestones = get().milestones;
    set((state) => ({
      milestones: state.milestones.filter((m) => m.id !== id),
    }));
    try {
      await milestoneService.delete(id);
    } catch (error) {
      set({ milestones: rollbackMilestones });
      throw error;
    }
  },

  // Kanban board filters
  setBoardFilters: (update) => {
    set((state) => ({
      boardFilters:
        typeof update === "function"
          ? update(state.boardFilters)
          : { ...state.boardFilters, ...update },
    }));
  },

  resetBoardFilters: () => {
    set({ boardFilters: EMPTY_BOARD_FILTERS });
  },

  // Soft phases: move a feature between milestones (or to/from unassigned).
  // Either id may be null. Optimistically move the feature's reference between
  // each milestone's linked_features, then commit; roll back on failure. The
  // realtime sync reconciles any computed fields without a blocking refetch.
  reassignFeatureToMilestone: async (
    featureId: string,
    fromMilestoneId: string | null,
    toMilestoneId: string | null,
  ) => {
    if (fromMilestoneId === toMilestoneId) return;
    const { epics } = get();
    const rollbackMilestones = get().milestones;

    // Locate the feature in the epic tree so it can be attached to the target.
    const feature = epics
      .flatMap((epic) => epic.features ?? [])
      .find((candidate) => candidate.id === featureId);

    set((state) => ({
      milestones: state.milestones.map((milestone) => {
        if (fromMilestoneId && milestone.id === fromMilestoneId) {
          return {
            ...milestone,
            linked_features: (milestone.linked_features ?? []).filter(
              (linked) => linked.id !== featureId,
            ),
          };
        }
        if (toMilestoneId && milestone.id === toMilestoneId) {
          const existing = milestone.linked_features ?? [];
          if (!feature || existing.some((linked) => linked.id === featureId)) {
            return milestone;
          }
          return { ...milestone, linked_features: [...existing, feature] };
        }
        return milestone;
      }),
    }));

    try {
      if (fromMilestoneId) {
        await featureService.unlinkFromMilestone(featureId, fromMilestoneId);
      }
      if (toMilestoneId) {
        await featureService.linkToMilestone({
          feature_id: featureId,
          milestone_id: toMilestoneId,
        });
      }
    } catch (error) {
      set({ milestones: rollbackMilestones });
      throw error;
    }
  },

  // UI Actions - Modal Triggers
  openAddFeatureModal: (epicId: string) => {
    set({ addFeatureEpicId: epicId });
  },

  closeAddFeatureModal: () => {
    set({ addFeatureEpicId: null });
  },

  openAddTaskPanel: (featureId: string) => {
    set({ addTaskFeatureId: featureId });
  },

  closeAddTaskPanel: () => {
    set({ addTaskFeatureId: null });
  },

  navigateToNode: (
    nodeId: string,
    options?: { offsetX?: number; taskId?: string },
  ) => {
    set({
      focusNodeId: nodeId,
      focusNodeOffsetX: options?.offsetX ?? 0,
      focusTaskId: options?.taskId ?? null,
    });
  },

  clearNodeFocus: () => {
    set({
      focusNodeId: null,
      focusNodeOffsetX: 0,
      focusTaskId: null,
    });
  },

  navigateToEpicTab: (epicId: string) => {
    set({ navigateToEpicId: epicId });
  },

  clearNavigateToEpicTab: () => {
    set({ navigateToEpicId: null });
  },

  navigateToFeatureNode: (epicId: string, featureId: string) => {
    set({ navigateToFeature: { epicId, featureId } });
  },

  clearNavigateToFeatureNode: () => {
    set({ navigateToFeature: null });
  },

  openEpicEditor: (epicId: string) => {
    set({ openEpicEditorId: epicId });
  },

  clearOpenEpicEditor: () => {
    set({ openEpicEditorId: null });
  },

  openFeatureEditorModal: (epicId: string, featureId: string) => {
    set({ openFeatureEditor: { epicId, featureId } });
  },

  clearOpenFeatureEditorModal: () => {
    set({ openFeatureEditor: null });
  },

  openTaskDetail: (taskId: string) => {
    set({ openTaskDetailId: taskId });
  },

  clearOpenTaskDetail: () => {
    set({ openTaskDetailId: null });
  },

  setPendingCommentId: (id: string | null) => {
    set({ pendingCommentId: id });
  },

  isOptimisticNodeId: (id: string | null | undefined) =>
    isOptimisticNodeIdInternal(id),

  resolveCanonicalNodeId: (id: string | null | undefined) =>
    resolveCanonicalNodeIdInternal(id, get().tempToRealNodeId),

  setActiveEpicId: (epicId: string | null) => {
    set({ activeEpicId: epicId });
  },

  setCanvasViewMode: (mode: CanvasViewMode) => {
    set({ canvasViewMode: mode });
  },

  setCanvasSelectedEpicId: (epicId: string | null) => {
    set({ canvasSelectedEpicId: epicId });
  },

  setCanvasOpenEpicTabs: (tabs: string[] | ((prev: string[]) => string[])) => {
    if (typeof tabs === "function") {
      set((state) => ({ canvasOpenEpicTabs: tabs(state.canvasOpenEpicTabs) }));
    } else {
      set({ canvasOpenEpicTabs: tabs });
    }
  },

  closeCanvasEpicTab: (epicId: string) => {
    const { canvasOpenEpicTabs, canvasSelectedEpicId } = get();
    const newTabs = canvasOpenEpicTabs.filter((id) => id !== epicId);
    const updates: Partial<RoadmapStore> = { canvasOpenEpicTabs: newTabs };
    if (canvasSelectedEpicId === epicId) {
      if (newTabs.length > 0) {
        updates.canvasSelectedEpicId = newTabs[newTabs.length - 1];
      } else {
        updates.canvasViewMode = "roadmap";
        updates.canvasSelectedEpicId = null;
      }
    }
    set(updates);
  },

}));

// Selectors for fine-grained subscriptions
export const useRoadmap = () => useRoadmapStore((state) => state.roadmap);
export const useEpics = () => useRoadmapStore((state) => state.epics);
export const useMilestones = () => useRoadmapStore((state) => state.milestones);
export const useRoadmapLoading = () =>
  useRoadmapStore((state) => state.isLoadingRoadmap);
export const useTempToRealNodeIdMap = () =>
  useRoadmapStore((state) => state.tempToRealNodeId);
export const useIsOptimisticNodeId = () =>
  useRoadmapStore((state) => state.isOptimisticNodeId);
export const useResolveCanonicalNodeId = () =>
  useRoadmapStore((state) => state.resolveCanonicalNodeId);
