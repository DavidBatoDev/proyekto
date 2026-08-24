import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	Eraser,
	Highlighter,
	LogOut,
	Rocket,
	X,
} from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import {
	JSONRoadmapSidePanel,
	RoadmapAiAssistantPanel,
	RoadmapCanvas,
	RoadmapLeftSidePanel,
	type RoadmapMetadataFormData,
	RoadmapMetadataModal,
	ShareRoadmapModal,
} from "@/components/roadmap";
import { ConfirmAssigneeOverwriteDialog } from "@/components/roadmap/widgets/ConfirmAssigneeOverwriteDialog";
import { useToast } from "@/contexts/ToastContext";
import { invalidateDashboardRoadmaps } from "@/hooks/dashboardInvalidation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useRoadmapFullLiveQuery } from "@/hooks/useProjectQueries";
import {
	type DockAvatar,
	useRecentAssignees,
} from "@/hooks/useRecentAssignees";
import {
	dismissGuestRoadmapCta,
	isGuestRoadmapCtaDismissed,
	rememberGuestRoadmap,
	restoreGuestRoadmapCta,
	setPendingProjectFromRoadmap,
} from "@/lib/guestRoadmapConversion";
import {
	consumePendingRoadmapAiPrompt,
	consumePendingRoadmapMetadataModal,
} from "@/lib/roadmapPageHandoff";
import { findTaskById } from "@/routes/_execution/project/$projectId/work-items/workItemsOptimistic";
import {
	roadmapService,
	type UpsertFullRoadmapDto,
} from "@/services/roadmap.service";
import { useUser } from "@/stores/authStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { type CanvasViewMode, useRoadmapStore } from "@/stores/roadmapStore";
import type { Roadmap, RoadmapTask } from "@/types/roadmap";
import { RoadmapPageIdentity } from "../../RoadmapPageIdentity";
import { RoadmapPageSkeleton } from "../../RoadmapPageSkeleton";
import { RoadmapTopBar } from "../../RoadmapTopBar";
import { TimelinePageIdentity } from "../../TimelinePageIdentity";
import type { RoadmapPerformanceMode } from "../models/types";
import { MobileRoadmapView } from "./MobileRoadmapView";
import { PresentationHighlighter } from "./PresentationHighlighter";

interface PendingAssignment {
	taskId: string;
	newAvatar: DockAvatar;
	currentAssigneeName: string;
}

interface RoadmapViewContentProps {
	roadmapId: string;
	projectId: string;
	deepLinkNodeId?: string | null;
	deepLinkCommentId?: string | null;
	urlView?: RoadmapUrlView | null;
	/**
	 * Pins the canvas to a single view mode for routes that *are* the view (the
	 * Timeline page). When set, the URL `?view=` sync is bypassed entirely.
	 */
	forcedViewMode?: CanvasViewMode;
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
	deepLinkCommentId,
	urlView,
	forcedViewMode,
	onDeepLinkNodeConsumed,
	onViewChange,
	onNodeOpened,
	onNodeClosed,
}: RoadmapViewContentProps) {
	const toast = useToast();
	const queryClient = useQueryClient();
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
		setPendingCommentId,
		canvasViewMode,
		setCanvasViewMode,
		updateTask,
		presentationMode,
		setPresentationMode,
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
			setPendingCommentId: state.setPendingCommentId,
			canvasViewMode: state.canvasViewMode,
			setCanvasViewMode: state.setCanvasViewMode,
			updateTask: state.updateTask,
			presentationMode: state.presentationMode,
			setPresentationMode: state.setPresentationMode,
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
	const [isGuestProjectCtaDismissed, setIsGuestProjectCtaDismissed] =
		useState(false);
	const [isAiChatPanelOpen, setIsAiChatPanelOpen] = useState(false);
	const [initialAiMessage, setInitialAiMessage] = useState<string | null>(null);
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

	// Consume the homepage hero handoff exactly once per mount: if a pending
	// AI prompt exists for this roadmap, open the assistant panel and hand the
	// message down so it auto-sends as the first agent turn.
	useEffect(() => {
		const pendingPrompt = consumePendingRoadmapAiPrompt(roadmapId);
		if (!pendingPrompt) return;
		setInitialAiMessage(pendingPrompt);
		setIsAiChatPanelOpen(true);
	}, [roadmapId]);

	const handleInitialAiMessageConsumed = useCallback(() => {
		setInitialAiMessage(null);
	}, []);

	// Routes that pin the view (Timeline) own the mode outright: force it on
	// mount and whenever the canvas drifts (e.g. closing the last epic tab resets
	// the store to "roadmap").
	useEffect(() => {
		if (!forcedViewMode) {
			// "milestones" now belongs exclusively to the Timeline route; a stale mode
			// carried over from it must not hijack the roadmap canvas.
			if (canvasViewMode === "milestones") setCanvasViewMode("roadmap");
			return;
		}
		if (canvasViewMode === forcedViewMode) return;
		setCanvasViewMode(forcedViewMode);
	}, [canvasViewMode, forcedViewMode, setCanvasViewMode]);

	useEffect(() => {
		if (forcedViewMode) return;
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
	}, [canvasViewMode, forcedViewMode, setCanvasViewMode, urlView]);

	useEffect(() => {
		if (forcedViewMode) return;
		const nextUrlView = toRoadmapUrlView(canvasViewMode);
		if (isApplyingUrlViewRef.current) {
			const resolvedIncomingMode = urlView ? toCanvasViewMode(urlView) : null;
			if (resolvedIncomingMode === canvasViewMode) {
				isApplyingUrlViewRef.current = false;
			}
			return;
		}

		onViewChange?.(nextUrlView);
	}, [canvasViewMode, forcedViewMode, onViewChange, urlView]);

	// Presentation mode: land on a presentable view (never the Epic detail tab),
	// and let Escape exit — mirroring AppDialog's own Escape-to-close handling.
	useEffect(() => {
		if (!presentationMode) return;
		if (canvasViewMode === "epic") setCanvasViewMode("roadmap");
	}, [presentationMode, canvasViewMode, setCanvasViewMode]);

	useEffect(() => {
		if (!presentationMode) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPresentationMode(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [presentationMode, setPresentationMode]);

	// Request/exit real browser fullscreen alongside the CSS overlay — without
	// this, the tab/address bar stay on screen, which defeats "presenting to a
	// client" as much as leaving the sidebar up would.
	useEffect(() => {
		if (presentationMode) {
			document.documentElement.requestFullscreen?.().catch(() => {
				// Denied or unsupported (e.g. embedded in an iframe) — the CSS
				// overlay still hides the in-app chrome on its own.
			});
		} else if (document.fullscreenElement) {
			document.exitFullscreen?.().catch(() => {});
		}
	}, [presentationMode]);

	// The browser's own fullscreen exit (native Esc handling, F11, or the
	// "Exit full screen" button some browsers show) bypasses our state — sync
	// back so a stale presentation overlay never survives it.
	useEffect(() => {
		const onFullscreenChange = () => {
			if (!document.fullscreenElement && presentationMode) {
				setPresentationMode(false);
			}
		};
		document.addEventListener("fullscreenchange", onFullscreenChange);
		return () =>
			document.removeEventListener("fullscreenchange", onFullscreenChange);
	}, [presentationMode, setPresentationMode]);

	useEffect(() => {
		if (!presentationMode) setHighlightActive(false);
	}, [presentationMode]);

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

		// Keyed on node AND comment, not node alone. A second mention on a task
		// you are already viewing arrives as the same nodeId with a different
		// commentId; keying on the node alone made that a silent no-op — no
		// scroll, no flash — which is the normal shape of a real discussion.
		const consumeKey = `${normalizedNodeId}|${deepLinkCommentId ?? ""}`;
		if (consumedNodeIdRef.current === consumeKey) {
			return;
		}
		consumedNodeIdRef.current = consumeKey;

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

		if (deepLinkCommentId) {
			setPendingCommentId(deepLinkCommentId);
		}

		onDeepLinkNodeConsumed?.(urlView ?? toRoadmapUrlView(canvasViewMode));
	}, [
		canvasViewMode,
		deepLinkCommentId,
		deepLinkNodeId,
		navigateToNode,
		onDeepLinkNodeConsumed,
		openEpicEditor,
		openFeatureEditor,
		openTaskDetail,
		setPendingCommentId,
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
			pendingWidth = clampLeftPanelWidth(
				startWidth + moveEvent.clientX - startX,
			);
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
				window.localStorage.setItem(
					LEFT_PANEL_STORAGE_KEY,
					String(latestWidth),
				);
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

	// Presentation-mode highlighter (laser-pointer-style annotation, never persisted)
	const [highlightActive, setHighlightActive] = useState(false);
	const [highlightClearToken, setHighlightClearToken] = useState(0);

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

	useEffect(() => {
		if (!roadmap || !canEditRoadmap) return;
		if (!consumePendingRoadmapMetadataModal(roadmapId)) return;
		setIsBriefOpen(true);
	}, [canEditRoadmap, roadmap, roadmapId]);

	// Guest working on an unlinked roadmap (`projectId === "n"` with no signed
	// in user): show the persistent sign-up CTA so the roadmap isn't lost when
	// the guest session expires.
	const user = useUser();
	const showGuestSignupNote = projectId === "n" && !user;
	const guestRoadmapTitle = roadmap?.name ?? "Untitled roadmap";

	useEffect(() => {
		setIsGuestProjectCtaDismissed(isGuestRoadmapCtaDismissed(roadmapId));
	}, [roadmapId]);

	const handleGuestProjectIntent = () => {
		const title = guestRoadmapTitle;
		rememberGuestRoadmap({ roadmapId, title });
		setPendingProjectFromRoadmap({
			roadmapId,
			title,
			source: "roadmap_cta",
		});
	};

	const handleDismissGuestProjectCta = () => {
		dismissGuestRoadmapCta(roadmapId);
		setIsGuestProjectCtaDismissed(true);
	};

	const handleRestoreGuestProjectCta = () => {
		restoreGuestRoadmapCta(roadmapId);
		setIsGuestProjectCtaDismissed(false);
	};

	const guestSignupSearch = {
		redirect: "/welcome",
		intent: "client",
		lane: "client_freelancer",
	} as const;
	const guestLoginSearch = {
		redirect: `/project/roadmap/convert/${roadmapId}`,
	} as const;
	const guestTopBarProjectCta = showGuestSignupNote ? (
		<Link
			to="/auth/signup"
			search={guestSignupSearch}
			onClick={handleGuestProjectIntent}
			className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-3.5 py-1.5 text-sm font-bold text-white shadow-sm shadow-emerald-500/20 transition hover:bg-emerald-600"
		>
			<Rocket className="h-4 w-4" />
			Turn into project
		</Link>
	) : null;

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
				...(formData.preview_url ? { preview_url: formData.preview_url } : {}),
			});

			// Name/description/cover feed the dashboard ROADMAPS preview.
			void invalidateDashboardRoadmaps(queryClient);
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
	const [activeDragAvatar, setActiveDragAvatar] = useState<DockAvatar | null>(
		null,
	);

	const dndSensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const applyAssignment = useCallback(
		async (taskId: string, avatar: DockAvatar) => {
			const latestEpics = useRoadmapStore.getState().epics;
			const currentTask = findTaskById(latestEpics, taskId);
			if (!currentTask) return;

			const profile = {
				id: avatar.userId,
				display_name: avatar.displayName,
				avatar_url: avatar.avatarUrl ?? undefined,
			};
			const nextTask: RoadmapTask = {
				...currentTask,
				assignee_id: avatar.userId,
				assignee: profile,
				assignee_ids: [avatar.userId],
				assignees: [profile],
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
			const avatarUrl =
				(activeData.avatarUrl as string | null | undefined) ?? null;
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
						initialAiMessage={initialAiMessage}
						onInitialAiMessageConsumed={handleInitialAiMessageConsumed}
					/>
				) : presentationMode ? (
					createPortal(
						// z-55: above the global Header (z-50) so it fully replaces it, but
						// below RoadmapModalLayout's epic/feature/task modals (z-60) so those
						// can still open on top — AppDialog (1200+), AnchoredPopover (1100),
						// toasts (9999), and the roadmap SidePanel (10000) all clear it too.
						<div className="fixed inset-0 z-55 flex flex-col bg-background">
							<div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-2">
								<span className="truncate text-sm font-semibold text-card-foreground">
									{roadmap.name}
								</span>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setHighlightActive((prev) => !prev)}
										aria-pressed={highlightActive}
										className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
											highlightActive
												? "border-primary bg-primary/10 text-primary"
												: "border-border bg-card text-card-foreground hover:bg-muted"
										}`}
									>
										<Highlighter className="h-4 w-4" />
										Highlight
									</button>
									{highlightActive && (
										<button
											type="button"
											onClick={() =>
												setHighlightClearToken((token) => token + 1)
											}
											className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
										>
											<Eraser className="h-4 w-4" />
											Clear
										</button>
									)}
									<button
										type="button"
										onClick={() => setPresentationMode(false)}
										className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
									>
										<LogOut className="h-4 w-4" />
										Exit presentation
									</button>
								</div>
							</div>
							<div className="flex flex-1 overflow-hidden">
								{/* Roadmap Structure sidebar — same as the normal view, hidden in
								    Timeline (which never had it either). Read-only per useCanvasNodeData's
								    canEditRoadmap gate; opening an item still shows its modal for reference. */}
								{canvasViewMode !== "milestones" && (
									<div
										id="roadmap-left-panel-presentation"
										className="relative h-full flex-shrink-0 border-r border-border bg-card/95 backdrop-blur"
										style={{
											width: leftPanelWidth,
											minWidth: LEFT_PANEL_MIN_WIDTH,
										}}
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
									</div>
								)}
								{/* min-w-0 is load-bearing, same as the normal view's canvas wrapper:
								    without it this flex item's automatic minimum size is its content's
								    min-content width, and the Timeline grid is far wider than the
								    viewport — the column would stretch past the screen and clip
								    everything right-aligned (toolbar controls, the bars themselves)
								    against the overflow-hidden ancestor. */}
								<div className="relative min-h-0 min-w-0 flex-1">
									<RoadmapCanvas
										roadmap={roadmap}
										onNodeOpen={handleNodeOpen}
										onNodeClose={handleNodeClose}
										performanceMode={performanceMode}
									/>
									<PresentationHighlighter
										active={highlightActive}
										clearToken={highlightClearToken}
									/>
								</div>
							</div>
						</div>,
						document.body,
					)
				) : (
					<>
						{/* Top navigation bar: view tabs + share/export */}
						<RoadmapTopBar
							identity={
								canvasViewMode === "milestones" ? (
									<TimelinePageIdentity />
								) : (
									<RoadmapPageIdentity />
								)
							}
							onEditBrief={() => setIsBriefOpen(true)}
							onShare={() => setIsShareModalOpen(true)}
							onOpenChatPanel={() => {
								setIsAiChatPanelOpen((prev) => {
									if (prev) return false;
									setChatPanelWidth(CHAT_PANEL_DEFAULT_WIDTH);
									return true;
								});
							}}
							projectCta={guestTopBarProjectCta}
						/>

						<div className="flex-1 flex overflow-hidden">
							{/* Left: Sidebar — hidden in milestones view */}
							{canvasViewMode !== "milestones" && (
								<div
									ref={leftPanelRef}
									id="roadmap-left-panel"
									className="relative h-full flex-shrink-0 border-r border-border bg-card/95 backdrop-blur"
									style={{
										width: leftPanelWidth,
										minWidth: LEFT_PANEL_MIN_WIDTH,
									}}
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
												isResizingLeftPanel
													? "bg-orange-400"
													: "bg-transparent group-hover/resizer:bg-orange-300"
											}`}
										/>
									</div>
								</div>
							)}

							{/* Right: Roadmap Canvas.
							    min-w-0 is load-bearing: without it this flex item's automatic
							    minimum size is its content's min-content width, and the Timeline
							    grid is far wider than the viewport — the column would stretch
							    past the screen and be clipped by the overflow-hidden ancestor,
							    hiding anything right-aligned. */}
							<div className="flex-1 relative min-w-0">
								<RoadmapCanvas
									roadmap={roadmap}
									onNodeOpen={handleNodeOpen}
									onNodeClose={handleNodeClose}
									performanceMode={performanceMode}
								/>
								{showGuestSignupNote && !isAiChatPanelOpen && (
									<div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-end">
										{isGuestProjectCtaDismissed ? (
											<button
												type="button"
												onClick={handleRestoreGuestProjectCta}
												className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-sm font-bold text-emerald-700 shadow-lg shadow-slate-900/10 backdrop-blur transition hover:border-emerald-300 hover:bg-emerald-50"
											>
												<Rocket className="h-4 w-4" />
												Turn into project
											</button>
										) : (
											<div className="pointer-events-auto w-[min(34rem,100%)] rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)] backdrop-blur">
												<div className="flex items-start gap-3">
													<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
														<Rocket className="h-5 w-5" />
													</div>
													<div className="min-w-0 flex-1">
														<div className="flex items-start gap-3">
															<div className="min-w-0 flex-1">
																<p className="text-sm font-black leading-tight text-slate-950">
																	Turn this roadmap into a project
																</p>
																<p className="mt-1 text-sm text-slate-600">
																	Collaborate, assign owners, and track
																	progress.
																</p>
															</div>
															<button
																type="button"
																onClick={handleDismissGuestProjectCta}
																aria-label="Dismiss project conversion prompt"
																className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
															>
																<X className="h-4 w-4" />
															</button>
														</div>
														<div className="mt-3 flex flex-col gap-2 sm:flex-row">
															<Link
																to="/auth/signup"
																search={guestSignupSearch}
																onClick={handleGuestProjectIntent}
																className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
															>
																Create account
															</Link>
															<Link
																to="/auth/login"
																search={guestLoginSearch}
																onClick={handleGuestProjectIntent}
																className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-slate-300 px-5 py-2 text-sm font-bold text-slate-800 transition hover:border-slate-500 hover:bg-slate-50"
															>
																Log in
															</Link>
															<button
																type="button"
																onClick={handleDismissGuestProjectCta}
																className="inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
															>
																Not now
															</button>
														</div>
													</div>
												</div>
											</div>
										)}
									</div>
								)}
							</div>

							{isAiChatPanelOpen && (
								<div
									ref={chatPanelRef}
									id="roadmap-right-ai-chat-panel"
									className="relative h-full border-l border-border bg-card"
									style={{
										minWidth: CHAT_PANEL_MIN_WIDTH,
										width: chatPanelWidth,
									}}
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
										initialMessage={initialAiMessage}
										onInitialMessageConsumed={handleInitialAiMessageConsumed}
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
								You have view-only access to this roadmap. Editing and
								commenting are disabled.
							</p>
						</div>
					</div>
				)}

				{isMobile && showGuestSignupNote && !isAiChatPanelOpen && (
					<div className="fixed inset-x-3 bottom-3 z-40">
						{isGuestProjectCtaDismissed ? (
							<button
								type="button"
								onClick={handleRestoreGuestProjectCta}
								className="mx-auto flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-sm font-bold text-emerald-700 shadow-lg shadow-slate-900/10 backdrop-blur"
							>
								<Rocket className="h-4 w-4" />
								Turn into project
							</button>
						) : (
							<div className="rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.22)] backdrop-blur">
								<div className="flex items-start gap-3">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
										<Rocket className="h-4 w-4" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-start gap-2">
											<div className="min-w-0 flex-1">
												<p className="text-sm font-black leading-tight text-slate-950">
													Turn this roadmap into a project
												</p>
												<p className="mt-0.5 text-xs text-slate-600">
													Collaborate and track work after signing in.
												</p>
											</div>
											<button
												type="button"
												onClick={handleDismissGuestProjectCta}
												aria-label="Dismiss project conversion prompt"
												className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400"
											>
												<X className="h-4 w-4" />
											</button>
										</div>
										<div className="mt-3 grid grid-cols-2 gap-2">
											<Link
												to="/auth/signup"
												search={guestSignupSearch}
												onClick={handleGuestProjectIntent}
												className="inline-flex items-center justify-center rounded-full bg-slate-950 px-3 py-2 text-sm font-bold text-white"
											>
												Create account
											</Link>
											<Link
												to="/auth/login"
												search={guestLoginSearch}
												onClick={handleGuestProjectIntent}
												className="inline-flex items-center justify-center rounded-full border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
											>
												Log in
											</Link>
										</div>
									</div>
								</div>
							</div>
						)}
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
