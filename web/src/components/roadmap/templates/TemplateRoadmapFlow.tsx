import { ArrowLeft } from "lucide-react";
import {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
	EpicPriority,
	Roadmap,
	RoadmapEpic,
	TaskPriority,
} from "@/types/roadmap";
import type { RoadmapTemplateVersionContent } from "@/types/roadmap-template";
import { RoadmapLeftSidePanel } from "../panels/RoadmapLeftSidePanel";
import {
	PANEL_FOCUS_TRANSITION,
	RoadmapView,
} from "../views/roadmap/RoadmapView";

const CREATED_AT = "1970-01-01T00:00:00.000Z";
const EPIC_PRIORITIES = new Set<EpicPriority>([
	"critical",
	"high",
	"medium",
	"low",
	"nice_to_have",
]);
const TASK_PRIORITIES = new Set<TaskPriority>([
	"urgent",
	"high",
	"medium",
	"low",
]);

const addDays = (startDate: string, offset: number) => {
	const [year, month, day] = startDate.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + offset));
	return date.toISOString().slice(0, 10);
};

const toEpicPriority = (priority: string): EpicPriority =>
	EPIC_PRIORITIES.has(priority as EpicPriority)
		? (priority as EpicPriority)
		: "medium";

const toTaskPriority = (priority: string): TaskPriority =>
	TASK_PRIORITIES.has(priority as TaskPriority)
		? (priority as TaskPriority)
		: "medium";

export function buildTemplateRoadmapPreview(
	templateId: string,
	content: RoadmapTemplateVersionContent,
	startDate: string,
): { roadmap: Roadmap; epics: RoadmapEpic[] } {
	const roadmapId = `template-${templateId}`;
	const roadmap: Roadmap = {
		id: roadmapId,
		project_id: null,
		name: content.roadmap.name,
		description: content.roadmap.description,
		owner_id: "template-marketplace",
		status: "draft",
		start_date: addDays(startDate, content.roadmap.start_day_offset),
		end_date: addDays(startDate, content.roadmap.end_day_offset),
		created_at: CREATED_AT,
		updated_at: CREATED_AT,
		currentUserRole: "viewer",
	};

	const epics: RoadmapEpic[] = content.epics.map((epic, epicIndex) => {
		const epicId = `${roadmapId}-epic-${epic.key}`;
		return {
			id: epicId,
			roadmap_id: roadmapId,
			title: `${epic.time_label} ${epic.title}`,
			description: epic.description,
			priority: toEpicPriority(epic.priority),
			status: "backlog",
			position: (epicIndex + 1) * 1000,
			start_date: addDays(startDate, epic.start_day_offset),
			end_date: addDays(startDate, epic.end_day_offset),
			tags: epic.tags,
			progress: 0,
			created_at: CREATED_AT,
			updated_at: CREATED_AT,
			features: epic.features.map((feature, featureIndex) => {
				const featureId = `${roadmapId}-feature-${feature.key}`;
				return {
					id: featureId,
					roadmap_id: roadmapId,
					epic_id: epicId,
					title: `${feature.time_label} ${feature.title}`,
					description: feature.description,
					position: (featureIndex + 1) * 1000,
					is_deliverable: feature.is_deliverable,
					start_date: addDays(startDate, feature.start_day_offset),
					end_date: addDays(startDate, feature.end_day_offset),
					progress: 0,
					created_at: CREATED_AT,
					updated_at: CREATED_AT,
					// Template tasks are always seeded as "todo" — the cascade
					// always derives "not_started" here regardless of task count.
					status: "not_started" as const,
					tasks: feature.tasks.map((task, taskIndex) => ({
						id: `${roadmapId}-task-${task.key}`,
						feature_id: featureId,
						title: task.title,
						description: task.description,
						status: "todo" as const,
						priority: toTaskPriority(task.priority),
						position: (taskIndex + 1) * 1000,
						board_order: taskIndex,
						due_date:
							task.due_day_offset === undefined
								? undefined
								: addDays(startDate, task.due_day_offset),
						work_type: task.work_type,
						checklist: task.checklist,
						created_at: CREATED_AT,
						updated_at: CREATED_AT,
					})),
				};
			}),
		};
	});

	return { roadmap, epics };
}

type TemplateRoadmapFlowProps = {
	templateId: string;
	content: RoadmapTemplateVersionContent;
	startDate: string;
};

const ignoreUpdate = () => undefined;

// Scroll distance (px) consumed by the card → fullscreen expansion once the
// preview pins beneath the fixed marketing header.
const EXPAND_SCROLL_DISTANCE = 480;
// Height of the fixed marketing Header (the route layout's pt-20) that the
// pinned preview sits under so navigation stays reachable while expanded.
const HEADER_OFFSET_PX = 80;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

// Same constants and storage key as the project roadmap view, so the panel
// width the user settles on carries across both surfaces.
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 600;
const PANEL_STORAGE_KEY = "roadmap.leftPanel.width";

const clampPanelWidth = (value: number) =>
	Math.min(Math.max(value, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH);

export function TemplateRoadmapFlow({
	templateId,
	content,
	startDate,
}: TemplateRoadmapFlowProps) {
	const preview = useMemo(
		() => buildTemplateRoadmapPreview(templateId, content, startDate),
		[content, startDate, templateId],
	);
	const outerRef = useRef<HTMLDivElement>(null);

	// The structure side panel subscribes to the global roadmapStore (same
	// pattern as the shared-roadmap route), so mirror the preview into it.
	// currentUserRole is "viewer", which disables every edit affordance.
	useEffect(() => {
		useRoadmapStore.setState({
			roadmap: preview.roadmap,
			epics: preview.epics,
			milestones: [],
		});
		return () => {
			useRoadmapStore.getState().resetRoadmap();
		};
	}, [preview]);

	// Clicking an epic/feature/task in the panel pans the canvas to it — the
	// panel writes the focus target into the store via navigateToNode and the
	// canvas consumes it through the focus props, as on the project page.
	const navigateToNode = useRoadmapStore((state) => state.navigateToNode);
	const clearNodeFocus = useRoadmapStore((state) => state.clearNodeFocus);
	const focusNodeId = useRoadmapStore((state) => state.focusNodeId);
	const focusNodeOffsetX = useRoadmapStore((state) => state.focusNodeOffsetX);
	const focusTaskId = useRoadmapStore((state) => state.focusTaskId);

	const [panelWidth, setPanelWidth] = useState(() => {
		try {
			const stored = window.localStorage.getItem(PANEL_STORAGE_KEY);
			return stored ? clampPanelWidth(Number(stored)) : PANEL_DEFAULT_WIDTH;
		} catch {
			return PANEL_DEFAULT_WIDTH;
		}
	});
	const panelRef = useRef<HTMLDivElement | null>(null);
	const panelWidthRef = useRef(panelWidth);
	const [isResizingPanel, setIsResizingPanel] = useState(false);

	// Same rAF-batched direct-DOM resize as the project roadmap view: the CSS
	// variable drives both the container and the panel content, and React
	// state only commits (and persists) on mouseup.
	const handlePanelResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = panelWidthRef.current;

			setIsResizingPanel(true);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";

			let latestWidth = startWidth;
			let pendingWidth = startWidth;
			let rafId: number | null = null;

			const flushWidth = () => {
				rafId = null;
				latestWidth = pendingWidth;
				panelWidthRef.current = pendingWidth;
				panelRef.current?.style.setProperty(
					"--tpl-panel-w",
					`${pendingWidth}px`,
				);
			};
			const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
				pendingWidth = clampPanelWidth(startWidth + moveEvent.clientX - startX);
				if (rafId === null) rafId = window.requestAnimationFrame(flushWidth);
			};
			const handleMouseUp = () => {
				if (rafId !== null) {
					window.cancelAnimationFrame(rafId);
					flushWidth();
				}
				setIsResizingPanel(false);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				setPanelWidth(latestWidth);
				try {
					window.localStorage.setItem(PANEL_STORAGE_KEY, String(latestWidth));
				} catch {
					// Best-effort persistence only.
				}
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[],
	);

	const [isFullscreen, setIsFullscreen] = useState(false);
	const isFullscreenRef = useRef(false);
	// Becomes true only once the expansion lerp has finished, so the swap from
	// scroll-coupled sticky sizing to viewport-exact fixed sizing is seamless
	// instead of cutting the animation short.
	const [isPinned, setIsPinned] = useState(false);
	const isPinnedRef = useRef(false);
	// True from "Back to template" until the exit scroll leaves the latch zone,
	// so the frame loop doesn't immediately re-enter fullscreen.
	const isExitingRef = useRef(false);
	const scheduleRef = useRef<() => void>(() => undefined);

	// Scroll-scrubbed expansion: the sticky card's size is driven by CSS custom
	// properties written straight to the DOM (no React state) so every frame
	// only costs a style recalculation. Wheel scrolling lands in coarse steps,
	// so the displayed progress eases toward the scroll-derived target with a
	// per-frame lerp instead of mirroring it exactly. Once the scrub reaches 1
	// the preview latches into fullscreen: page scroll locks so scrolling up no
	// longer shrinks it, and the overlay header's back button is the exit.
	useEffect(() => {
		const outer = outerRef.current;
		if (!outer) return;
		let raf = 0;
		let displayed = -1;
		let lastRawTarget = Number.NaN;
		const reduceMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		const setViewportVars = () => {
			const doc = document.documentElement;
			// clientWidth/Height exclude scrollbars — 100vw would overhang the
			// vertical scrollbar and create horizontal overflow when expanded.
			outer.style.setProperty("--rf-vw", `${doc.clientWidth}px`);
			outer.style.setProperty("--rf-vh", `${doc.clientHeight}px`);
		};

		const frame = () => {
			raf = 0;
			const top = outer.getBoundingClientRect().top;
			const rawTarget = (HEADER_OFFSET_PX - top) / EXPAND_SCROLL_DISTANCE;
			const target = Math.min(1, Math.max(0, rawTarget));
			// The exit guard clears once the exit scroll leaves the latch zone —
			// or when the user scrolls DEEPER again (raw progress increasing),
			// which cancels the exit and must be allowed to re-latch. Without the
			// second clause an interrupted exit left the card permanently sticky:
			// overscroll pushed it under the site header with a gap at the bottom
			// and no way back into fullscreen.
			if (
				isExitingRef.current &&
				(target < 1 || rawTarget > lastRawTarget + 0.0001)
			) {
				isExitingRef.current = false;
			}
			lastRawTarget = rawTarget;
			if (target >= 1 && !isFullscreenRef.current && !isExitingRef.current) {
				isFullscreenRef.current = true;
				setIsFullscreen(true);
				// Momentum can overshoot into the page's tail padding, which would
				// freeze the card pinned slightly under the marketing header — snap
				// to the exact fullscreen offset before locking the scroll.
				const overshoot = HEADER_OFFSET_PX - EXPAND_SCROLL_DISTANCE - top;
				if (Math.abs(overshoot) > 1) window.scrollBy(0, -overshoot);
				document.documentElement.style.overflow = "hidden";
				// The scrollbar just disappeared, so the usable viewport widened.
				setViewportVars();
			}
			const next =
				displayed < 0 || reduceMotion
					? target
					: displayed + (target - displayed) * 0.16;
			displayed = Math.abs(target - next) < 0.001 ? target : next;
			outer.style.setProperty("--rf-p", smoothstep(displayed).toFixed(4));
			if (
				isFullscreenRef.current &&
				!isPinnedRef.current &&
				displayed >= 0.999
			) {
				isPinnedRef.current = true;
				setIsPinned(true);
			}
			if (displayed !== target) schedule();
		};
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(frame);
		};
		const onResize = () => {
			setViewportVars();
			schedule();
		};

		scheduleRef.current = schedule;
		setViewportVars();
		schedule();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", onResize);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", onResize);
			if (isFullscreenRef.current) {
				document.documentElement.style.overflow = "";
			}
		};
	}, []);

	const exitFullscreen = useCallback(() => {
		const outer = outerRef.current;
		if (!outer || !isFullscreenRef.current) return;
		isFullscreenRef.current = false;
		isExitingRef.current = true;
		isPinnedRef.current = false;
		setIsFullscreen(false);
		setIsPinned(false);
		document.documentElement.style.overflow = "";
		// Scroll all the way back to the top of the template page; on the way
		// the scrub zone plays in reverse, folding the roadmap back into the
		// card before the hero content scrolls into view.
		window.scrollTo({ top: 0, behavior: "smooth" });
		scheduleRef.current();
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") exitFullscreen();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isFullscreen, exitFullscreen]);

	return (
		<div
			ref={outerRef}
			className="[--rf-h:680px] sm:[--rf-h:760px] lg:[--rf-h:820px]"
			style={
				{
					"--rf-full": `calc(var(--rf-vh, 100vh) - ${HEADER_OFFSET_PX}px)`,
					// The wrapper reserves the fully-expanded height plus the scrub
					// distance; the sticky card stays pinned while that extra scroll
					// room is what drives --rf-p from 0 to 1.
					height: `calc(var(--rf-full) + ${EXPAND_SCROLL_DISTANCE}px)`,
				} as CSSProperties
			}
		>
			<section
				aria-label="Interactive roadmap template preview"
				className="flex flex-col overflow-hidden border border-border bg-card shadow-(--app-shadow-sm)"
				data-testid="template-roadmap-flow"
				style={
					isPinned
						? // Latched: hard-pin below the site header with fixed positioning.
							// Sticky alignment depends on exactly where the locked scroll
							// landed — momentum overshoot would tuck the top (and the back
							// bar) under the header; fixed is immune to that.
							({
								position: "fixed",
								top: `${HEADER_OFFSET_PX}px`,
								left: 0,
								width: "var(--rf-vw, 100vw)",
								height: "var(--rf-full)",
								zIndex: 40,
							} as CSSProperties)
						: ({
								position: "sticky",
								top: `${HEADER_OFFSET_PX}px`,
								height:
									"calc(var(--rf-h) + (var(--rf-full) - var(--rf-h)) * var(--rf-p, 0))",
								// 100% is the page container's inner width, so these two
								// lines interpolate from "card in the container" to
								// full-bleed.
								width:
									"calc(100% + (var(--rf-vw, 100vw) - 100%) * var(--rf-p, 0))",
								marginLeft:
									"calc((var(--rf-vw, 100vw) - 100%) / -2 * var(--rf-p, 0))",
								borderRadius: "calc(1rem * (1 - var(--rf-p, 0)))",
							} as CSSProperties)
				}
			>
				{/* Fullscreen-only header: while page scroll is locked this bar is
				    the way back to the card view (its button, or Escape). */}
				<div
					className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${
						isFullscreen
							? "max-h-16 opacity-100"
							: "pointer-events-none max-h-0 opacity-0"
					}`}
				>
					<div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
						<button
							type="button"
							onClick={exitFullscreen}
							className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
						>
							<ArrowLeft className="h-4 w-4" />
							Back to template
						</button>
						<p className="min-w-0 truncate text-sm font-semibold text-muted-foreground">
							{preview.roadmap.name}
						</p>
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					{/* Roadmap Structure panel — slides in alongside the canvas once
					    fullscreen latches, matching the project roadmap view. */}
					<div
						ref={panelRef}
						className={`relative shrink-0 overflow-hidden bg-card max-md:hidden ${
							isResizingPanel ? "" : "transition-[width] duration-300 ease-out"
						} ${isFullscreen ? "border-r border-border" : ""}`}
						style={
							{
								"--tpl-panel-w": `${panelWidth}px`,
								width: isFullscreen ? "var(--tpl-panel-w)" : 0,
							} as CSSProperties
						}
					>
						{isFullscreen && (
							<>
								<div className="h-full" style={{ width: "var(--tpl-panel-w)" }}>
									<RoadmapLeftSidePanel
										messages={[]}
										onSendMessage={ignoreUpdate}
										isGenerating={false}
										isCollapsed={false}
										onNavigateToNode={navigateToNode}
									/>
								</div>
								{/* Resize handle — same affordance as the project view. */}
								<div
									className="group/resizer absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize"
									onMouseDown={handlePanelResizeStart}
								>
									<div
										className={`absolute right-0 top-0 h-full w-[3px] rounded-full transition-colors ${
											isResizingPanel
												? "bg-orange-400"
												: "bg-transparent group-hover/resizer:bg-orange-300"
										}`}
									/>
								</div>
							</>
						)}
					</div>
					{/* The canvas only becomes interactive once fullscreen latches —
					    until then wheel/drag belongs to the page scroll driving the
					    expansion, not to canvas zoom/pan. */}
					<div
						className={`relative min-h-0 flex-1 ${
							isFullscreen ? "" : "pointer-events-none select-none"
						}`}
						data-testid="template-roadmap-canvas"
					>
						<RoadmapView
							roadmap={preview.roadmap}
							epics={preview.epics}
							minZoom={0.2}
							readOnly
							fitView
							performanceMode="reducedMotion"
							focusNodeId={focusNodeId}
							focusNodeOffsetX={focusNodeOffsetX}
							focusTaskId={focusTaskId}
							focusTransition={PANEL_FOCUS_TRANSITION}
							onFocusComplete={clearNodeFocus}
							onUpdateEpic={ignoreUpdate}
							onDeleteEpic={ignoreUpdate}
							onUpdateFeature={ignoreUpdate}
							onDeleteFeature={ignoreUpdate}
							onUpdateTask={ignoreUpdate}
						/>
					</div>
				</div>
			</section>
		</div>
	);
}
