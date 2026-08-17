import { useCallback, useEffect, useRef, useState } from "react";
import {
	addDays,
	daysBetween,
	floorToUnit,
	toISODateString,
} from "../../milestones/model/utils";
import type { TimelineRow } from "../model/rows";

export type BarGestureMode = "move" | "resize-start" | "resize-end" | "draw";

export interface BarDraft {
	rowKey: string;
	startDate: string;
	endDate: string;
	hasMoved: boolean;
}

export interface BarCommit {
	row: TimelineRow;
	mode: BarGestureMode;
	oldStartDate: string | null;
	oldEndDate: string | null;
	newStartDate: string;
	newEndDate: string;
}

interface UseTimelineBarDragParams {
	pxToDate: (px: number) => Date;
	dateToPx: (date: Date | string) => number;
	/** Viewport-relative clientX -> timeline px, accounting for scroll. */
	clientXToTimelinePx: (clientX: number) => number;
	onCommit: (commit: BarCommit) => void;
	enabled: boolean;
}

/**
 * One pointer gesture for every bar interaction. The in-flight geometry lives
 * in a single piece of state keyed by row, so a drag re-renders the dragged bar
 * and nothing else.
 */
export function useTimelineBarDrag({
	pxToDate,
	dateToPx,
	clientXToTimelinePx,
	onCommit,
	enabled,
}: UseTimelineBarDragParams) {
	const [draft, setDraft] = useState<BarDraft | null>(null);
	const gestureRef = useRef<{
		row: TimelineRow;
		mode: BarGestureMode;
		anchorDate: Date;
		originStart: Date;
		originEnd: Date;
		oldStartDate: string | null;
		oldEndDate: string | null;
		durationDays: number;
	} | null>(null);
	const draftRef = useRef<BarDraft | null>(null);
	draftRef.current = draft;

	const beginGesture = useCallback(
		(event: React.PointerEvent, row: TimelineRow, mode: BarGestureMode) => {
			if (!enabled) return;
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();

			const entity = row.kind === "epic" ? row.epic : row.feature;
			const anchorDate = floorToUnit(
				pxToDate(clientXToTimelinePx(event.clientX)),
				"day",
			);
			const hasDates = Boolean(entity.start_date && entity.end_date);
			const originStart = hasDates
				? floorToUnit(new Date(entity.start_date ?? ""), "day")
				: anchorDate;
			const originEnd = hasDates
				? floorToUnit(new Date(entity.end_date ?? ""), "day")
				: anchorDate;

			gestureRef.current = {
				row,
				mode,
				anchorDate,
				originStart,
				originEnd,
				oldStartDate: entity.start_date ?? null,
				oldEndDate: entity.end_date ?? null,
				durationDays: Math.round(daysBetween(originStart, originEnd)),
			};

			setDraft({
				rowKey: row.rowKey,
				startDate: toISODateString(originStart),
				endDate: toISODateString(originEnd),
				hasMoved: false,
			});
		},
		[enabled, pxToDate, clientXToTimelinePx],
	);

	useEffect(() => {
		if (!draft) return;

		const onPointerMove = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (!gesture) return;

			const pointerDate = floorToUnit(
				pxToDate(clientXToTimelinePx(event.clientX)),
				"day",
			);
			const deltaDays = Math.round(
				daysBetween(gesture.anchorDate, pointerDate),
			);

			let nextStart = gesture.originStart;
			let nextEnd = gesture.originEnd;

			if (gesture.mode === "move") {
				nextStart = addDays(gesture.originStart, deltaDays);
				nextEnd = addDays(nextStart, gesture.durationDays);
			} else if (gesture.mode === "resize-start") {
				nextStart = addDays(gesture.originStart, deltaDays);
				if (nextStart > gesture.originEnd) nextStart = gesture.originEnd;
			} else if (gesture.mode === "resize-end") {
				nextEnd = addDays(gesture.originEnd, deltaDays);
				if (nextEnd < gesture.originStart) nextEnd = gesture.originStart;
			} else {
				// draw: the anchor is one edge, the pointer is the other
				nextStart =
					pointerDate < gesture.anchorDate ? pointerDate : gesture.anchorDate;
				nextEnd =
					pointerDate < gesture.anchorDate ? gesture.anchorDate : pointerDate;
			}

			const startDate = toISODateString(nextStart);
			const endDate = toISODateString(nextEnd);

			setDraft((prev) =>
				prev && prev.startDate === startDate && prev.endDate === endDate
					? prev
					: prev
						? { ...prev, startDate, endDate, hasMoved: true }
						: prev,
			);
		};

		const onPointerUp = () => {
			const gesture = gestureRef.current;
			const current = draftRef.current;
			gestureRef.current = null;
			setDraft(null);
			if (!gesture || !current?.hasMoved) return;
			if (
				gesture.oldStartDate === current.startDate &&
				gesture.oldEndDate === current.endDate
			) {
				return;
			}

			onCommit({
				row: gesture.row,
				mode: gesture.mode,
				oldStartDate: gesture.oldStartDate,
				oldEndDate: gesture.oldEndDate,
				newStartDate: current.startDate,
				newEndDate: current.endDate,
			});
		};

		// Hold the cursor for the whole gesture: the pointer regularly leaves the
		// bar (or the grid) mid-drag, and without this it flickers back to the
		// default as it crosses other elements.
		// The draw case uses the same pencil as the armed state; a class beats an
		// inline style here so the data-URI lives once, in styles.css.
		const isDrawing = gestureRef.current?.mode === "draw";
		if (isDrawing) {
			document.body.classList.add("cursor-pencil");
		} else {
			document.body.style.cursor =
				gestureRef.current?.mode === "move" ? "grabbing" : "ew-resize";
		}
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		return () => {
			document.body.classList.remove("cursor-pencil");
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};
	}, [draft, pxToDate, clientXToTimelinePx, onCommit]);

	const getDraftGeometry = useCallback(
		(rowKey: string) => {
			if (!draft || draft.rowKey !== rowKey) return null;
			const left = dateToPx(draft.startDate);
			const right = dateToPx(addDays(new Date(draft.endDate), 1));
			return { left, width: Math.max(4, right - left), draft };
		},
		[draft, dateToPx],
	);

	return {
		draft,
		isDragging: draft !== null,
		beginGesture,
		getDraftGeometry,
	};
}
