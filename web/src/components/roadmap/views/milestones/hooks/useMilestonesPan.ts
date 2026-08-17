import { type RefObject, useEffect, useRef } from "react";
import { isInteractivePanTarget } from "../model/utils";

interface UseMilestonesPanParams {
	timelineScrollRef: RefObject<HTMLDivElement | null>;
	verticalScrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * Drag-to-pan for the timeline. Deliberately render-free: the drag writes
 * scrollLeft/scrollTop and the grabbing cursor straight to the DOM, coalesced
 * into one rAF tick, so a pan never re-renders the (large) milestones subtree.
 */
export function useMilestonesPan({
	timelineScrollRef,
	verticalScrollRef,
}: UseMilestonesPanParams) {
	const panStateRef = useRef<{
		startX: number;
		startY: number;
		startScrollLeft: number;
		startScrollTop: number;
	} | null>(null);

	useEffect(() => {
		const timelineElement = timelineScrollRef.current;
		if (!timelineElement) return;

		let frame = 0;
		let pendingX = 0;
		let pendingY = 0;

		const applyPan = () => {
			frame = 0;
			const panState = panStateRef.current;
			const verticalEl = verticalScrollRef.current;
			if (!panState || !verticalEl) return;

			timelineElement.scrollLeft =
				panState.startScrollLeft - (pendingX - panState.startX);
			verticalEl.scrollTop =
				panState.startScrollTop - (pendingY - panState.startY);
		};

		const handleMouseMove = (event: MouseEvent) => {
			// Coalesce: high-polling-rate mice fire several moves per frame, and
			// each scroll write forces layout + paint of the whole timeline.
			pendingX = event.clientX;
			pendingY = event.clientY;
			if (!frame) frame = requestAnimationFrame(applyPan);
		};

		const stopPanning = () => {
			if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
			panStateRef.current = null;
			timelineElement.style.pointerEvents = "";
			timelineElement.style.userSelect = "";
			document.body.style.cursor = "";
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", stopPanning);
		};

		const handleMouseDown = (event: MouseEvent) => {
			if (event.button !== 0) return;
			if (isInteractivePanTarget(event.target)) return;

			const verticalEl = verticalScrollRef.current;
			if (!verticalEl) return;

			panStateRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				startScrollLeft: timelineElement.scrollLeft,
				startScrollTop: verticalEl.scrollTop,
			};
			pendingX = event.clientX;
			pendingY = event.clientY;
			// Muting pointer events for the duration of the drag is the single
			// biggest win here: without it the pointer sweeps across the rows on
			// every move, so the browser re-runs hit-testing over the whole
			// timeline and continuously toggles :hover styles and the
			// group-hover tooltips (display:none -> block = layout + paint each
			// frame). Wheel scrolling never moves the pointer, which is why only
			// drag-panning felt slow. Cursor moves to <body> since a
			// pointer-events:none element no longer supplies one.
			timelineElement.style.pointerEvents = "none";
			timelineElement.style.userSelect = "none";
			document.body.style.cursor = "grabbing";
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", stopPanning);
			event.preventDefault();
		};

		timelineElement.addEventListener("mousedown", handleMouseDown);
		return () => {
			timelineElement.removeEventListener("mousedown", handleMouseDown);
			stopPanning();
		};
	}, [timelineScrollRef, verticalScrollRef]);
}
