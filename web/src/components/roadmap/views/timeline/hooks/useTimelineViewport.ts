import { useCallback, useEffect, useRef, useState } from "react";
import { OVERSCAN, ROW_H } from "../model/rows";

interface UseTimelineViewportParams {
	rowCount: number;
	columnCount: number;
	colWidth: number;
	/** Drag-to-pan is suppressed while a bar drag / draw gesture owns the pointer. */
	panEnabled: boolean;
}

export interface TimelineWindow {
	rowStart: number;
	rowEnd: number;
	colStart: number;
	colEnd: number;
}

const isInteractiveTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element)) return false;
	return Boolean(
		target.closest(
			'button, a, input, textarea, select, label, [role="button"], [data-no-pan="true"]',
		),
	);
};

/**
 * Owns the single two-axis scroll container: which rows and columns are worth
 * rendering, and drag-to-pan.
 *
 * Two deliberate choices, both aimed at drag performance. Wheel scrolling is
 * composited and stays smooth regardless, but a drag runs on the main thread,
 * so every frame of a drag pays for whatever the main thread is holding:
 *  - only the visible row/column window is mounted, so that cost is bounded by
 *    the viewport rather than by the size of the roadmap;
 *  - the drag itself writes scroll offsets straight to the DOM (rAF-coalesced)
 *    and never re-renders, and it mutes pointer events for the duration so the
 *    browser is not re-running hit-testing and :hover matching every frame.
 */
export function useTimelineViewport({
	rowCount,
	columnCount,
	colWidth,
	panEnabled,
}: UseTimelineViewportParams) {
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [isPanning, setIsPanning] = useState(false);

	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	const [window_, setWindow] = useState<TimelineWindow>({
		rowStart: 0,
		rowEnd: 0,
		colStart: 0,
		colEnd: 0,
	});

	const computeWindow = useCallback(() => {
		const el = viewportRef.current;
		if (!el) return;

		const rowStart = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN);
		const rowEnd = Math.min(
			rowCount,
			Math.ceil((el.scrollTop + el.clientHeight) / ROW_H) + OVERSCAN,
		);
		const colStart = Math.max(0, Math.floor(el.scrollLeft / colWidth) - 2);
		const colEnd = Math.min(
			columnCount,
			Math.ceil((el.scrollLeft + el.clientWidth) / colWidth) + 2,
		);

		// Only re-render when the window actually moves — a scroll within the
		// current row/column band is free.
		setWindow((prev) =>
			prev.rowStart === rowStart &&
			prev.rowEnd === rowEnd &&
			prev.colStart === colStart &&
			prev.colEnd === colEnd
				? prev
				: { rowStart, rowEnd, colStart, colEnd },
		);
	}, [rowCount, columnCount, colWidth]);

	// Recompute when the inputs change (row count, granularity, first mount).
	useEffect(() => {
		computeWindow();
	}, [computeWindow]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;

		let frame = 0;
		const onScroll = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				computeWindow();
			});
		};

		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			if (frame) cancelAnimationFrame(frame);
			el.removeEventListener("scroll", onScroll);
		};
	}, [computeWindow]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(() => {
			setViewportSize({ width: el.clientWidth, height: el.clientHeight });
			computeWindow();
		});
		observer.observe(el);
		setViewportSize({ width: el.clientWidth, height: el.clientHeight });
		return () => observer.disconnect();
	}, [computeWindow]);

	// Drag-to-pan.
	useEffect(() => {
		const el = viewportRef.current;
		const content = contentRef.current;
		if (!el || !content || !panEnabled) return;

		let frame = 0;
		let pointerX = 0;
		let pointerY = 0;
		let origin: {
			x: number;
			y: number;
			scrollLeft: number;
			scrollTop: number;
		} | null = null;

		const apply = () => {
			frame = 0;
			if (!origin) return;
			el.scrollLeft = origin.scrollLeft - (pointerX - origin.x);
			el.scrollTop = origin.scrollTop - (pointerY - origin.y);
		};

		const onPointerMove = (event: PointerEvent) => {
			pointerX = event.clientX;
			pointerY = event.clientY;
			if (!frame) frame = requestAnimationFrame(apply);
		};

		const stop = () => {
			if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
			origin = null;
			content.style.pointerEvents = "";
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			setIsPanning(false);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			if (isInteractiveTarget(event.target)) return;

			origin = {
				x: event.clientX,
				y: event.clientY,
				scrollLeft: el.scrollLeft,
				scrollTop: el.scrollTop,
			};
			pointerX = event.clientX;
			pointerY = event.clientY;
			content.style.pointerEvents = "none";
			document.body.style.cursor = "grabbing";
			document.body.style.userSelect = "none";
			setIsPanning(true);
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", stop);
			window.addEventListener("pointercancel", stop);
			event.preventDefault();
		};

		el.addEventListener("pointerdown", onPointerDown);
		return () => {
			el.removeEventListener("pointerdown", onPointerDown);
			stop();
		};
	}, [panEnabled]);

	const scrollToPx = useCallback((left: number, smooth = true) => {
		const el = viewportRef.current;
		if (!el) return;
		el.scrollTo({
			left: Math.max(0, left),
			behavior: smooth ? "smooth" : "auto",
		});
	}, []);

	return {
		viewportRef,
		contentRef,
		window: window_,
		viewportSize,
		isPanning,
		scrollToPx,
	};
}
