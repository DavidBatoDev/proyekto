import { Plus, CalendarClock } from "lucide-react";
import { dateFromTimelinePx } from "./model/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EpicReorderConfirmModal } from "../../panels/EpicReorderConfirmModal";
import { FeatureReorderConfirmModal } from "../../panels/FeatureReorderConfirmModal";
import { useToast } from "@/hooks/useToast";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapMilestone,
} from "@/types/roadmap";
import {
  type ExplorerSearchResult,
  getSortedEpics,
  ROADMAP_STRUCTURE_EXPLORER_CONFIG,
} from "../../panels/explorer/RoadmapStructureHeader";
import {
  DATE_HEADER_HEIGHT,
  DEFAULT_EXPLORER_HEADER_HEIGHT,
  type DateChangeConfirmPayload,
  type EpicDateDraftCommit,
  FeatureDateChangeConfirmModal,
  type FeatureDateDraftCommit,
  type FeatureDateVisualDraft,
  type Granularity,
  type MilestoneDateDraftCommit,
  MilestoneEditorModal,
  MilestonesLeftPanel,
  MilestonesTimelineHeader,
  MilestonesTimelineRows,
  MilestonesToolbar,
  RIGHT_HEADER_HEIGHT,
  useMilestoneEditor,
  useMilestonesPan,
  useMilestonesTimeline,
} from ".";

export interface MilestonesViewProps {
  roadmap: Roadmap;
  milestones: RoadmapMilestone[];
  epics: RoadmapEpic[];
  onAddMilestone: (data: {
    title: string;
    target_date: string;
    description?: string;
    status?: RoadmapMilestone["status"];
    color?: string;
  }) => Promise<void> | void;
  onUpdateMilestone: (milestone: RoadmapMilestone) => Promise<void> | void;
  onDeleteMilestone: (id: string) => Promise<void> | void;
  onUpdateFeature: (feature: RoadmapFeature) => Promise<void> | void;
  onUpdateEpic?: (epic: RoadmapEpic) => Promise<void> | void;
  onAddFeature?: (epicId: string) => void;
  onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
  canEditTimelineDates?: boolean;
  onNavigateToEpic?: (epicId: string) => void;
}

const FEATURE_DATE_CONFIRM_SKIP_KEY = "roadmap.timeline.skipDragDateConfirm";
const FEATURE_REORDER_CONFIRM_SKIP_KEY =
  "roadmap.milestones.skipFeatureReorderConfirm";
const EPIC_REORDER_CONFIRM_SKIP_KEY =
  "roadmap.milestones.skipEpicReorderConfirm";
const FEATURE_DATE_PERSIST_DEBOUNCE_MS = 250;
const MILESTONE_DATE_PERSIST_DEBOUNCE_MS = 250;

type PendingDateChange =
  | {
      kind: "feature";
      change: FeatureDateDraftCommit;
      payload: DateChangeConfirmPayload;
    }
  | {
      kind: "milestone";
      change: MilestoneDateDraftCommit;
      payload: DateChangeConfirmPayload;
    }
  | {
      kind: "epic";
      change: EpicDateDraftCommit;
      payload: DateChangeConfirmPayload;
    };

type PendingFeatureReorder = {
  epicId: string;
  featureId: string;
  featureTitle: string;
  oldIndex: number;
  newIndex: number;
  previousOrderIds: string[];
  nextOrderIds: string[];
};

type PendingEpicReorder = {
  epicId: string;
  epicTitle: string;
  oldIndex: number;
  newIndex: number;
  previousOrderIds: string[];
  nextOrderIds: string[];
};

export const MilestonesView = ({
  roadmap: _roadmap,
  milestones,
  epics,
  onAddMilestone,
  onUpdateMilestone,
  onDeleteMilestone: _onDeleteMilestone,
  onUpdateFeature,
  onUpdateEpic,
  onAddFeature,
  onOpenFeatureEditor,
  canEditTimelineDates = true,
  onNavigateToEpic,
}: MilestonesViewProps) => {
  const toast = useToast();
  const reorderFeaturesInEpic = useRoadmapStore(
    (state) => state.reorderFeaturesInEpic,
  );
  const previewFeatureOrderInEpic = useRoadmapStore(
    (state) => state.previewFeatureOrderInEpic,
  );
  const reorderEpicsInRoadmap = useRoadmapStore(
    (state) => state.reorderEpicsInRoadmap,
  );
  const previewEpicOrderInRoadmap = useRoadmapStore(
    (state) => state.previewEpicOrderInRoadmap,
  );
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [isDateDrawMode, setIsDateDrawMode] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [leftHeaderHeight, setLeftHeaderHeight] = useState(
    DEFAULT_EXPLORER_HEADER_HEIGHT,
  );
  const [pendingDateChange, setPendingDateChange] =
    useState<PendingDateChange | null>(null);
  const [pendingFeatureReorder, setPendingFeatureReorder] =
    useState<PendingFeatureReorder | null>(null);
  const [pendingEpicReorder, setPendingEpicReorder] =
    useState<PendingEpicReorder | null>(null);
  const [featureDateVisualDrafts, setFeatureDateVisualDrafts] = useState<
    Record<string, FeatureDateVisualDraft>
  >({});
  const [epicDateVisualDrafts, setEpicDateVisualDrafts] = useState<
    Record<string, { startDate: string; endDate: string }>
  >({});
  const [milestoneDateVisualDrafts, setMilestoneDateVisualDrafts] = useState<
    Record<string, string>
  >({});
  const [dontAskDateAgainInSession, setDontAskDateAgainInSession] =
    useState(false);
  const [dontAskReorderAgainInSession, setDontAskReorderAgainInSession] =
    useState(false);
  const [dontAskEpicReorderAgainInSession, setDontAskEpicReorderAgainInSession] =
    useState(false);
  const [isPersistingFeatureReorder, setIsPersistingFeatureReorder] =
    useState(false);
  const [isPersistingEpicReorder, setIsPersistingEpicReorder] = useState(false);
  const featureDatePersistTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const milestoneDatePersistTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const verticalScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const leftHeaderRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const timelineExplorerConfig = ROADMAP_STRUCTURE_EXPLORER_CONFIG.timeline;

  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [milestones],
  );
  const effectiveSortedMilestones = useMemo(
    () =>
      sortedMilestones.map((milestone) => {
        const draftTargetDate = milestoneDateVisualDrafts[milestone.id];
        if (!draftTargetDate) return milestone;
        return {
          ...milestone,
          target_date: new Date(`${draftTargetDate}T00:00:00.000Z`).toISOString(),
        };
      }),
    [sortedMilestones, milestoneDateVisualDrafts],
  );
  const sortedEpics = useMemo(() => getSortedEpics(epics), [epics]);
  const featureDatesById = useMemo(() => {
    const map = new Map<string, { startDate: string; endDate: string }>();
    for (const epic of sortedEpics) {
      for (const feature of epic.features ?? []) {
        if (feature.start_date && feature.end_date) {
          map.set(feature.id, {
            startDate: feature.start_date,
            endDate: feature.end_date,
          });
        }
      }
    }
    return map;
  }, [sortedEpics]);
  const milestoneDatesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const milestone of sortedMilestones) {
      map.set(
        milestone.id,
        new Date(milestone.target_date).toISOString().slice(0, 10),
      );
    }
    return map;
  }, [sortedMilestones]);

  const toggleEpic = useCallback((id: string) => {
    setCollapsed((state) => {
      const next = new Set(state);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const collapsableEpicIds = useMemo(
    () =>
      sortedEpics
        .filter((epic) => (epic.features?.length ?? 0) > 0)
        .map((epic) => epic.id),
    [sortedEpics],
  );
  const hasAnyExpanded = useMemo(
    () => collapsableEpicIds.some((id) => !collapsed.has(id)),
    [collapsableEpicIds, collapsed],
  );

  const stickyHeaderHeight = Math.max(leftHeaderHeight, RIGHT_HEADER_HEIGHT);
  const rightHeaderTopHeight = Math.max(
    0,
    leftHeaderHeight - DATE_HEADER_HEIGHT,
  );

  const getEpicRowKey = useCallback((epicId: string) => `epic:${epicId}`, []);
  const getFeatureRowKey = useCallback(
    (featureId: string) => `feature:${featureId}`,
    [],
  );

  const setRowRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(key, node);
      return;
    }
    rowRefs.current.delete(key);
  }, []);

  const setEpicRowRef = useCallback(
    (epicId: string) => (node: HTMLDivElement | null) => {
      setRowRef(getEpicRowKey(epicId), node);
    },
    [setRowRef, getEpicRowKey],
  );
  const setFeatureRowRef = useCallback(
    (featureId: string) => (node: HTMLDivElement | null) => {
      setRowRef(getFeatureRowKey(featureId), node);
    },
    [setRowRef, getFeatureRowKey],
  );

  const scrollToRow = useCallback(
    (rowKey: string) => {
      const scrollContainer = verticalScrollRef.current;
      const rowNode = rowRefs.current.get(rowKey);
      if (!scrollContainer || !rowNode) return;

      const targetTop = Math.max(0, rowNode.offsetTop - stickyHeaderHeight - 8);
      scrollContainer.scrollTo({ top: targetTop, behavior: "smooth" });
    },
    [stickyHeaderHeight],
  );

  const scrollToRowAfterLayout = useCallback(
    (rowKey: string) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToRow(rowKey);
        });
      });
    },
    [scrollToRow],
  );

  const handleToggleCollapseAll = useCallback(() => {
    if (hasAnyExpanded) {
      setCollapsed(new Set(collapsableEpicIds));
      return;
    }
    setCollapsed(new Set());
  }, [hasAnyExpanded, collapsableEpicIds]);

  const handleTimelineSearchResultSelect = useCallback(
    (result: ExplorerSearchResult) => {
      if (result.type === "epic") {
        setCollapsed((prev) => {
          if (!prev.has(result.id)) return prev;
          const next = new Set(prev);
          next.delete(result.id);
          return next;
        });
        scrollToRowAfterLayout(getEpicRowKey(result.id));
        return;
      }

      const targetEpicId = result.epicId;
      const targetFeatureId =
        result.type === "feature" ? result.id : (result.featureId ?? null);

      if (targetEpicId) {
        setCollapsed((prev) => {
          if (!prev.has(targetEpicId)) return prev;
          const next = new Set(prev);
          next.delete(targetEpicId);
          return next;
        });
      }

      if (targetFeatureId) {
        scrollToRowAfterLayout(getFeatureRowKey(targetFeatureId));
        return;
      }

      if (targetEpicId) {
        scrollToRowAfterLayout(getEpicRowKey(targetEpicId));
      }
    },
    [scrollToRowAfterLayout, getEpicRowKey, getFeatureRowKey],
  );

  const {
    rangeStart,
    columns,
    superGroups,
    cw,
    totalWidth,
    todayPx,
    todayColIndex,
    todayColLeft,
    todayColInRange,
    milestoneMarkers,
    gridBg,
  } = useMilestonesTimeline({
    sortedEpics,
    sortedMilestones: effectiveSortedMilestones,
    granularity,
  });

  const {
    milestoneModalMode,
    isMilestoneModalOpen,
    isSavingMilestone,
    draftTitle,
    draftDate,
    draftStatus,
    draftColor,
    setDraftTitle,
    setDraftDate,
    setDraftStatus,
    setDraftColor,
    startCreateMilestone,
    startEditMilestone,
    cancelMilestoneEditor,
    submitMilestone,
  } = useMilestoneEditor({
    sortedMilestones: effectiveSortedMilestones,
    onAddMilestone,
    onUpdateMilestone,
  });

  const { isPanningTimeline } = useMilestonesPan({
    timelineScrollRef,
    verticalScrollRef,
  });

  useEffect(() => {
    const node = leftHeaderRef.current;
    if (!node) return;

    const updateHeight = () => {
      const nextHeight = Math.max(
        RIGHT_HEADER_HEIGHT,
        Math.ceil(node.getBoundingClientRect().height),
      );
      setLeftHeaderHeight(nextHeight);
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let raf: number;
    const run = () => {
      const timelineElement = timelineScrollRef.current;
      if (!timelineElement) return;
      const visibleWidth = timelineElement.clientWidth;
      const target = todayPx - visibleWidth / 2;
      timelineElement.scrollLeft = Math.max(0, target);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [todayPx]);

  const shouldSkipDateConfirm = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(FEATURE_DATE_CONFIRM_SKIP_KEY) === "1"
    );
  }, []);

  const shouldSkipFeatureReorderConfirm = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(FEATURE_REORDER_CONFIRM_SKIP_KEY) === "1"
    );
  }, []);

  const shouldSkipEpicReorderConfirm = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(EPIC_REORDER_CONFIRM_SKIP_KEY) === "1"
    );
  }, []);

  const toFeatureConfirmPayload = useCallback(
    (change: FeatureDateDraftCommit): DateChangeConfirmPayload => ({
      entityLabel: change.feature.title,
      oldStartDate: change.oldStartDate,
      oldEndDate: change.oldEndDate,
      newStartDate: change.newStartDate,
      newEndDate: change.newEndDate,
    }),
    [],
  );

  const toMilestoneConfirmPayload = useCallback(
    (change: MilestoneDateDraftCommit): DateChangeConfirmPayload => ({
      entityLabel: change.milestone.title,
      oldStartDate: change.oldTargetDate,
      oldEndDate: change.oldTargetDate,
      newStartDate: change.newTargetDate,
      newEndDate: change.newTargetDate,
    }),
    [],
  );

  const persistFeatureDateChange = useCallback(
    async (change: FeatureDateDraftCommit) => {
      try {
        await onUpdateFeature({
          ...change.feature,
          start_date: change.newStartDate,
          end_date: change.newEndDate,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Failed to update feature date range", error);
        setFeatureDateVisualDrafts((prev) => {
          const next = { ...prev };
          delete next[change.feature.id];
          return next;
        });
      }
    },
    [onUpdateFeature],
  );

  const persistMilestoneDateChange = useCallback(
    async (change: MilestoneDateDraftCommit) => {
      try {
        await onUpdateMilestone({
          ...change.milestone,
          target_date: new Date(
            `${change.newTargetDate}T00:00:00.000Z`,
          ).toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Failed to update milestone target date", error);
        setMilestoneDateVisualDrafts((prev) => {
          const next = { ...prev };
          delete next[change.milestone.id];
          return next;
        });
      }
    },
    [onUpdateMilestone],
  );

  const queueFeatureDatePersist = useCallback(
    (change: FeatureDateDraftCommit) => {
      const featureId = change.feature.id;
      const previousTimeout = featureDatePersistTimeoutsRef.current.get(featureId);
      if (previousTimeout) {
        clearTimeout(previousTimeout);
      }

      const timeout = setTimeout(() => {
        featureDatePersistTimeoutsRef.current.delete(featureId);
        void persistFeatureDateChange(change);
      }, FEATURE_DATE_PERSIST_DEBOUNCE_MS);
      featureDatePersistTimeoutsRef.current.set(featureId, timeout);
    },
    [persistFeatureDateChange],
  );

  const queueMilestoneDatePersist = useCallback(
    (change: MilestoneDateDraftCommit) => {
      const milestoneId = change.milestone.id;
      const previousTimeout =
        milestoneDatePersistTimeoutsRef.current.get(milestoneId);
      if (previousTimeout) {
        clearTimeout(previousTimeout);
      }

      const timeout = setTimeout(() => {
        milestoneDatePersistTimeoutsRef.current.delete(milestoneId);
        void persistMilestoneDateChange(change);
      }, MILESTONE_DATE_PERSIST_DEBOUNCE_MS);
      milestoneDatePersistTimeoutsRef.current.set(milestoneId, timeout);
    },
    [persistMilestoneDateChange],
  );

  useEffect(() => {
    return () => {
      for (const timeout of featureDatePersistTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      featureDatePersistTimeoutsRef.current.clear();
      for (const timeout of milestoneDatePersistTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      milestoneDatePersistTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setFeatureDateVisualDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [featureId, draft] of Object.entries(prev)) {
        const serverDates = featureDatesById.get(featureId);
        if (
          !serverDates ||
          (serverDates.startDate === draft.startDate &&
            serverDates.endDate === draft.endDate)
        ) {
          delete next[featureId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [featureDatesById]);

  useEffect(() => {
    setMilestoneDateVisualDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [milestoneId, draftDate] of Object.entries(prev)) {
        const serverDate = milestoneDatesById.get(milestoneId);
        if (serverDate && serverDate === draftDate) {
          delete next[milestoneId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [milestoneDatesById]);

  useEffect(() => {
    setEpicDateVisualDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [epicId, draft] of Object.entries(prev)) {
        const epic = sortedEpics.find((e) => e.id === epicId);
        if (!epic?.start_date || !epic?.end_date) {
          delete next[epicId];
          changed = true;
        } else if (epic.start_date === draft.startDate && epic.end_date === draft.endDate) {
          delete next[epicId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sortedEpics]);

  const handleFeatureDateDraftCommit = useCallback(
    (change: FeatureDateDraftCommit) => {
      if (!canEditTimelineDates) return;
      setFeatureDateVisualDrafts((prev) => ({
        ...prev,
        [change.feature.id]: {
          startDate: change.newStartDate,
          endDate: change.newEndDate,
        },
      }));

      if (shouldSkipDateConfirm()) {
        queueFeatureDatePersist(change);
        return;
      }

      setDontAskDateAgainInSession(false);
      setPendingDateChange({
        kind: "feature",
        change,
        payload: toFeatureConfirmPayload(change),
      });
    },
    [
      canEditTimelineDates,
      queueFeatureDatePersist,
      shouldSkipDateConfirm,
      toFeatureConfirmPayload,
    ],
  );

  const handleMilestoneDateDraftCommit = useCallback(
    (change: MilestoneDateDraftCommit) => {
      if (!canEditTimelineDates) return;
      setMilestoneDateVisualDrafts((prev) => ({
        ...prev,
        [change.milestone.id]: change.newTargetDate,
      }));

      if (shouldSkipDateConfirm()) {
        queueMilestoneDatePersist(change);
        return;
      }

      setDontAskDateAgainInSession(false);
      setPendingDateChange({
        kind: "milestone",
        change,
        payload: toMilestoneConfirmPayload(change),
      });
    },
    [
      canEditTimelineDates,
      queueMilestoneDatePersist,
      shouldSkipDateConfirm,
      toMilestoneConfirmPayload,
    ],
  );

  const epicDatePersistTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const persistEpicDateChange = useCallback(
    async (change: EpicDateDraftCommit) => {
      if (!onUpdateEpic) return;
      try {
        await onUpdateEpic({
          ...change.epic,
          start_date: change.newStartDate,
          end_date: change.newEndDate,
        });
      } catch (error) {
        console.error("Failed to update epic date range", error);
        setEpicDateVisualDrafts((prev) => {
          const next = { ...prev };
          delete next[change.epic.id];
          return next;
        });
      }
    },
    [onUpdateEpic],
  );

  const queueEpicDatePersist = useCallback(
    (change: EpicDateDraftCommit) => {
      const epicId = change.epic.id;
      const prev = epicDatePersistTimeoutsRef.current.get(epicId);
      if (prev) clearTimeout(prev);
      const timeout = setTimeout(() => {
        epicDatePersistTimeoutsRef.current.delete(epicId);
        void persistEpicDateChange(change);
      }, FEATURE_DATE_PERSIST_DEBOUNCE_MS);
      epicDatePersistTimeoutsRef.current.set(epicId, timeout);
    },
    [persistEpicDateChange],
  );

  const toEpicConfirmPayload = useCallback(
    (change: EpicDateDraftCommit): DateChangeConfirmPayload => ({
      entityLabel: change.epic.title,
      oldStartDate: change.oldStartDate,
      oldEndDate: change.oldEndDate,
      newStartDate: change.newStartDate,
      newEndDate: change.newEndDate,
    }),
    [],
  );

  const handleEpicDateDraftCommit = useCallback(
    (change: EpicDateDraftCommit) => {
      if (!canEditTimelineDates) return;
      setEpicDateVisualDrafts((prev) => ({
        ...prev,
        [change.epic.id]: { startDate: change.newStartDate, endDate: change.newEndDate },
      }));
      if (shouldSkipDateConfirm()) {
        queueEpicDatePersist(change);
        return;
      }
      setDontAskDateAgainInSession(false);
      setPendingDateChange({ kind: "epic", change, payload: toEpicConfirmPayload(change) });
    },
    [canEditTimelineDates, queueEpicDatePersist, shouldSkipDateConfirm, toEpicConfirmPayload],
  );

  const handleConfirmDateChange = useCallback(() => {
    if (!pendingDateChange) return;
    if (dontAskDateAgainInSession && typeof window !== "undefined") {
      window.sessionStorage.setItem(FEATURE_DATE_CONFIRM_SKIP_KEY, "1");
    }
    if (pendingDateChange.kind === "feature") {
      queueFeatureDatePersist(pendingDateChange.change);
    } else if (pendingDateChange.kind === "epic") {
      queueEpicDatePersist(pendingDateChange.change);
    } else {
      queueMilestoneDatePersist(pendingDateChange.change);
    }
    setPendingDateChange(null);
    setDontAskDateAgainInSession(false);
  }, [
    dontAskDateAgainInSession,
    pendingDateChange,
    queueFeatureDatePersist,
    queueEpicDatePersist,
    queueMilestoneDatePersist,
  ]);

  const handleCancelDateChange = useCallback(() => {
    if (pendingDateChange?.kind === "feature") {
      setFeatureDateVisualDrafts((prev) => {
        const next = { ...prev };
        delete next[pendingDateChange.change.feature.id];
        return next;
      });
    }
    if (pendingDateChange?.kind === "milestone") {
      setMilestoneDateVisualDrafts((prev) => {
        const next = { ...prev };
        delete next[pendingDateChange.change.milestone.id];
        return next;
      });
    }
    if (pendingDateChange?.kind === "epic") {
      setEpicDateVisualDrafts((prev) => {
        const next = { ...prev };
        delete next[pendingDateChange.change.epic.id];
        return next;
      });
    }
    setPendingDateChange(null);
    setDontAskDateAgainInSession(false);
  }, [pendingDateChange]);

  const persistFeatureReorder = useCallback(
    async (change: PendingFeatureReorder) => {
      setIsPersistingFeatureReorder(true);
      try {
        await reorderFeaturesInEpic(change.epicId, change.nextOrderIds);
        toast.success(`Reordered "${change.featureTitle}"`);
      } catch (error) {
        console.error("Failed to reorder features in milestone view", error);
        previewFeatureOrderInEpic(change.epicId, change.previousOrderIds);
      } finally {
        setIsPersistingFeatureReorder(false);
      }
    },
    [previewFeatureOrderInEpic, reorderFeaturesInEpic, toast],
  );

  const handleFeatureReorderDraft = useCallback(
    (change: PendingFeatureReorder) => {
      previewFeatureOrderInEpic(change.epicId, change.nextOrderIds);
      if (shouldSkipFeatureReorderConfirm()) {
        void persistFeatureReorder(change);
        return;
      }
      setDontAskReorderAgainInSession(false);
      setPendingFeatureReorder(change);
    },
    [
      persistFeatureReorder,
      previewFeatureOrderInEpic,
      shouldSkipFeatureReorderConfirm,
    ],
  );

  const handleCancelFeatureReorder = useCallback(() => {
    if (pendingFeatureReorder) {
      previewFeatureOrderInEpic(
        pendingFeatureReorder.epicId,
        pendingFeatureReorder.previousOrderIds,
      );
    }
    setPendingFeatureReorder(null);
    setDontAskReorderAgainInSession(false);
  }, [pendingFeatureReorder, previewFeatureOrderInEpic]);

  const handleConfirmFeatureReorder = useCallback(async () => {
    if (!pendingFeatureReorder) return;
    if (dontAskReorderAgainInSession && typeof window !== "undefined") {
      window.sessionStorage.setItem(FEATURE_REORDER_CONFIRM_SKIP_KEY, "1");
    }
    const change = pendingFeatureReorder;
    setPendingFeatureReorder(null);
    setDontAskReorderAgainInSession(false);
    await persistFeatureReorder(change);
  }, [
    dontAskReorderAgainInSession,
    pendingFeatureReorder,
    persistFeatureReorder,
  ]);

  const persistEpicReorder = useCallback(
    async (change: PendingEpicReorder) => {
      setIsPersistingEpicReorder(true);
      try {
        await reorderEpicsInRoadmap(change.nextOrderIds);
        toast.success(`Reordered epic "${change.epicTitle}"`);
      } catch (error) {
        console.error("Failed to reorder epics in milestone view", error);
        previewEpicOrderInRoadmap(change.previousOrderIds);
      } finally {
        setIsPersistingEpicReorder(false);
      }
    },
    [previewEpicOrderInRoadmap, reorderEpicsInRoadmap, toast],
  );

  const handleEpicReorderDraft = useCallback(
    (change: PendingEpicReorder) => {
      previewEpicOrderInRoadmap(change.nextOrderIds);
      if (shouldSkipEpicReorderConfirm()) {
        void persistEpicReorder(change);
        return;
      }
      setDontAskEpicReorderAgainInSession(false);
      setPendingEpicReorder(change);
    },
    [
      persistEpicReorder,
      previewEpicOrderInRoadmap,
      shouldSkipEpicReorderConfirm,
    ],
  );

  const handleCancelEpicReorder = useCallback(() => {
    if (pendingEpicReorder) {
      previewEpicOrderInRoadmap(pendingEpicReorder.previousOrderIds);
    }
    setPendingEpicReorder(null);
    setDontAskEpicReorderAgainInSession(false);
  }, [pendingEpicReorder, previewEpicOrderInRoadmap]);

  const handleConfirmEpicReorder = useCallback(async () => {
    if (!pendingEpicReorder) return;
    if (dontAskEpicReorderAgainInSession && typeof window !== "undefined") {
      window.sessionStorage.setItem(EPIC_REORDER_CONFIRM_SKIP_KEY, "1");
    }
    const change = pendingEpicReorder;
    setPendingEpicReorder(null);
    setDontAskEpicReorderAgainInSession(false);
    await persistEpicReorder(change);
  }, [
    dontAskEpicReorderAgainInSession,
    pendingEpicReorder,
    persistEpicReorder,
  ]);

  const handleFeatureSelect = useCallback(
    (feature: RoadmapFeature) => {
      if (!onOpenFeatureEditor) return;
      const epicId =
        feature.epic_id ??
        sortedEpics.find((epic) =>
          (epic.features ?? []).some((item) => item.id === feature.id),
        )?.id;
      if (!epicId) return;
      onOpenFeatureEditor(epicId, feature.id);
    },
    [onOpenFeatureEditor, sortedEpics],
  );

  const clientXToDate = useCallback(
    (clientX: number): Date => {
      const el = timelineScrollRef.current;
      if (!el) return new Date();
      const px = clientX - el.getBoundingClientRect().left + el.scrollLeft;
      return dateFromTimelinePx(px, rangeStart, granularity, cw);
    },
    [rangeStart, granularity, cw],
  );

  const handleEpicDateCreate = useCallback(
    (epic: RoadmapEpic, startDate: string, endDate: string) => {
      if (!canEditTimelineDates || !onUpdateEpic) return;
      void onUpdateEpic({
        ...epic,
        start_date: startDate,
        end_date: endDate,
      });
    },
    [canEditTimelineDates, onUpdateEpic],
  );

  const handleFeatureDateCreate = useCallback(
    (feature: RoadmapFeature, startDate: string, endDate: string) => {
      if (!canEditTimelineDates) return;
      queueFeatureDatePersist({
        feature,
        oldStartDate: "",
        oldEndDate: "",
        newStartDate: startDate,
        newEndDate: endDate,
      });
    },
    [canEditTimelineDates, queueFeatureDatePersist],
  );

  const overdueMilestones = useMemo(() => {
    const now = Date.now();
    return sortedMilestones.filter((milestone) => {
      if (milestone.status === "completed") return false;
      const target = new Date(milestone.target_date).getTime();
      return Number.isFinite(target) && target < now;
    });
  }, [sortedMilestones]);

  return (
    <div className="absolute inset-0 bg-white">
      <MilestonesToolbar
        granularity={granularity}
        onGranularityChange={setGranularity}
        isDateDrawMode={isDateDrawMode}
        onToggleDateDrawMode={canEditTimelineDates ? () => setIsDateDrawMode((v) => !v) : undefined}
      />

      {overdueMilestones.length > 0 && canEditTimelineDates && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap text-xs text-amber-900">
            <CalendarClock className="w-4 h-4" />
            <span className="font-medium">Past target date:</span>
            {overdueMilestones.map((milestone) => (
              <button
                key={milestone.id}
                type="button"
                onClick={() => startEditMilestone(milestone)}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-300 px-2 py-0.5 text-amber-800 hover:bg-amber-100"
              >
                {milestone.title}
                <span className="text-amber-600">· Reschedule</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        ref={verticalScrollRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-white hide-scrollbar"
      >
        <div className="flex min-w-0">
          <MilestonesLeftPanel
            leftHeaderRef={leftHeaderRef}
            sortedEpics={sortedEpics}
            collapsed={collapsed}
            hasAnyExpanded={hasAnyExpanded}
            showCollapseToggle={
              timelineExplorerConfig.allowFeatureCollapse === false
            }
            onToggleEpic={toggleEpic}
            onToggleCollapseAll={handleToggleCollapseAll}
            onSearchResultSelect={handleTimelineSearchResultSelect}
            setEpicRowRef={setEpicRowRef}
            setFeatureRowRef={setFeatureRowRef}
            onNavigateToEpic={onNavigateToEpic}
            onAddFeature={onAddFeature}
            canReorderFeatures={canEditTimelineDates}
            onFeatureReorderDraft={handleFeatureReorderDraft}
            canReorderEpics={canEditTimelineDates}
            onEpicReorderDraft={handleEpicReorderDraft}
          />

          <div
            ref={timelineScrollRef}
            className={`min-w-0 flex-1 overflow-x-auto overflow-y-visible hide-scrollbar ${
              isPanningTimeline ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
          >
            <div className="relative" style={{ width: totalWidth }}>
              <MilestonesTimelineHeader
                totalWidth={totalWidth}
                rightHeaderTopHeight={rightHeaderTopHeight}
                cw={cw}
                columns={columns}
                superGroups={superGroups}
                todayColIndex={todayColIndex}
                granularity={granularity}
                gridBg={gridBg}
                milestoneMarkers={milestoneMarkers}
                rangeStart={rangeStart}
                canEditDateRanges={canEditTimelineDates}
                onMilestoneSelect={(marker) =>
                  startEditMilestone(marker.milestone)
                }
                onMilestoneDateDraftCommit={handleMilestoneDateDraftCommit}
              />


              <MilestonesTimelineRows
                sortedEpics={sortedEpics}
                collapsed={collapsed}
                totalWidth={totalWidth}
                gridBg={gridBg}
                todayColInRange={todayColInRange}
                todayColLeft={todayColLeft}
                cw={cw}
                rangeStart={rangeStart}
                granularity={granularity}
                canEditDateRanges={canEditTimelineDates}
                featureDateVisualDrafts={featureDateVisualDrafts}
                onFeatureSelect={handleFeatureSelect}
                onFeatureDateDraftCommit={handleFeatureDateDraftCommit}
                isDateDrawMode={isDateDrawMode}
                clientXToDate={clientXToDate}
                onEpicDateCreate={handleEpicDateCreate}
                onFeatureDateCreate={handleFeatureDateCreate}
                epicDateVisualDrafts={epicDateVisualDrafts}
                onEpicDateDraftCommit={handleEpicDateDraftCommit}
              />
            </div>
          </div>
        </div>

        {sortedMilestones.length > 0 && (
          <button
            type="button"
            onClick={startCreateMilestone}
            className="fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-orange-500 px-6 py-3 text-base font-semibold text-white shadow-lg transition-colors hover:bg-orange-600"
          >
            <Plus size={18} />
            Add Milestone
          </button>
        )}

        <MilestoneEditorModal
          isOpen={isMilestoneModalOpen}
          mode={milestoneModalMode}
          isSaving={isSavingMilestone}
          draftTitle={draftTitle}
          draftDate={draftDate}
          draftStatus={draftStatus}
          draftColor={draftColor}
          onDraftTitleChange={setDraftTitle}
          onDraftDateChange={setDraftDate}
          onDraftStatusChange={setDraftStatus}
          onDraftColorChange={setDraftColor}
          onCancel={cancelMilestoneEditor}
          onSubmit={submitMilestone}
        />

        <FeatureDateChangeConfirmModal
          isOpen={pendingDateChange !== null}
          change={pendingDateChange?.payload ?? null}
          isSaving={false}
          dontAskAgain={dontAskDateAgainInSession}
          onDontAskAgainChange={setDontAskDateAgainInSession}
          onCancel={handleCancelDateChange}
          onConfirm={handleConfirmDateChange}
        />

        <FeatureReorderConfirmModal
          isOpen={pendingFeatureReorder !== null}
          isSaving={isPersistingFeatureReorder}
          featureTitle={pendingFeatureReorder?.featureTitle ?? null}
          dontAskAgain={dontAskReorderAgainInSession}
          onDontAskAgainChange={setDontAskReorderAgainInSession}
          onCancel={handleCancelFeatureReorder}
          onConfirm={handleConfirmFeatureReorder}
        />

        <EpicReorderConfirmModal
          isOpen={pendingEpicReorder !== null}
          isSaving={isPersistingEpicReorder}
          epicTitle={pendingEpicReorder?.epicTitle ?? null}
          dontAskAgain={dontAskEpicReorderAgainInSession}
          onDontAskAgainChange={setDontAskEpicReorderAgainInSession}
          onCancel={handleCancelEpicReorder}
          onConfirm={handleConfirmEpicReorder}
        />
      </div>
    </div>
  );
};
