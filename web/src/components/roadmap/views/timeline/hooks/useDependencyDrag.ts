import { useCallback, useEffect, useRef, useState } from "react";
import type { BarGeometry } from "../model/barGeometry";
import { rowBarCenterY } from "../model/dependencyGeometry";
import {
	type Adjacency,
	type DropRejection,
	rejectDrop,
} from "../model/dependencyGraph";
import { routeDependencyPath } from "../model/edgeRoute";
import { ROW_H, type TimelineRow } from "../model/rows";

export type DependencyHandleSide = "start" | "end";

export interface DependencyDragDraft {
	sourceFeatureId: string;
	sourceSide: DependencyHandleSide;
	pointerX: number;
	pointerY: number;
	targetRowIndex: number | null;
	targetFeatureId: string | null;
	rejection: DropRejection;
	hasMoved: boolean;
}

interface UseDependencyDragParams {
	rows: TimelineRow[];
	adjacency: Adjacency;
	geometryByRowKey: Map<string, BarGeometry>;
	clientXToTimelinePx: (clientX: number) => number;
	clientYToTimelinePx: (clientY: number) => number;
	onCreate: (blockingFeatureId: string, blockedFeatureId: string) => void;
	enabled: boolean;
}

/**
 * Drag from a bar's connection handle to another bar to link them.
 *
 * Structured exactly like useTimelineBarDrag: an imperative gestureRef that
 * never triggers a render, one piece of draft state, and window-level pointer
 * listeners installed only while a drag is live. Because the draft is a single
 * object owned here, a pointermove re-renders the arrow layer alone — the bars
 * and the task column are untouched.
 *
 * Hit-testing is analytic (clientY -> row index), never elementFromPoint: rows
 * outside the virtual window have no DOM node to hit.
 */
export function useDependencyDrag({
	rows,
	adjacency,
	geometryByRowKey,
	clientXToTimelinePx,
	clientYToTimelinePx,
	onCreate,
	enabled,
}: UseDependencyDragParams) {
	const [draft, setDraft] = useState<DependencyDragDraft | null>(null);
	const gestureRef = useRef<{
		sourceFeatureId: string;
		sourceSide: DependencyHandleSide;
	} | null>(null);
	const draftRef = useRef<DependencyDragDraft | null>(null);
	draftRef.current = draft;

	const beginGesture = useCallback(
		(
			event: React.PointerEvent,
			row: TimelineRow,
			side: DependencyHandleSide,
		) => {
			if (!enabled || row.kind !== "feature") return;
			if (event.button !== 0) return;
			// The bar itself owns onPointerDown for the move gesture; stop here or
			// the drag would start moving the bar instead of drawing a link.
			event.preventDefault();
			event.stopPropagation();

			gestureRef.current = {
				sourceFeatureId: row.feature.id,
				sourceSide: side,
			};
			setDraft({
				sourceFeatureId: row.feature.id,
				sourceSide: side,
				pointerX: event.clientX,
				pointerY: event.clientY,
				targetRowIndex: null,
				targetFeatureId: null,
				rejection: "not-a-feature",
				hasMoved: false,
			});
		},
		[enabled],
	);

	useEffect(() => {
		if (!draft) return;

		const onPointerMove = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (!gesture) return;

			const y = clientYToTimelinePx(event.clientY);
			const rowIndex = Math.floor(y / ROW_H);
			const row = rowIndex >= 0 ? rows[rowIndex] : undefined;
			const targetFeatureId =
				row && row.kind === "feature" ? row.feature.id : null;

			// Direction: dragging from the END handle means source runs first.
			const [blocking, blocked] =
				gesture.sourceSide === "end"
					? [gesture.sourceFeatureId, targetFeatureId]
					: [targetFeatureId, gesture.sourceFeatureId];

			setDraft((previous) =>
				previous
					? {
							...previous,
							pointerX: event.clientX,
							pointerY: event.clientY,
							targetRowIndex: targetFeatureId !== null ? rowIndex : null,
							targetFeatureId,
							rejection: rejectDrop(adjacency, blocking, blocked),
							hasMoved: true,
						}
					: previous,
			);
		};

		const finish = () => {
			const gesture = gestureRef.current;
			const current = draftRef.current;
			gestureRef.current = null;
			setDraft(null);

			if (!gesture || !current?.hasMoved) return;
			if (current.rejection !== null || !current.targetFeatureId) return;

			const [blocking, blocked] =
				gesture.sourceSide === "end"
					? [gesture.sourceFeatureId, current.targetFeatureId]
					: [current.targetFeatureId, gesture.sourceFeatureId];
			if (!blocking || !blocked) return;

			onCreate(blocking, blocked);
		};

		document.body.style.cursor = "crosshair";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", finish);
		window.addEventListener("pointercancel", finish);
		return () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", finish);
			window.removeEventListener("pointercancel", finish);
		};
	}, [draft, rows, adjacency, clientYToTimelinePx, onCreate]);

	/**
	 * The preview path, in grid coordinates. Anchored to the source bar's real
	 * edge so the line starts exactly where the arrow will.
	 */
	const draftPath = (() => {
		if (!draft?.hasMoved) return null;
		const sourceRowKey = `feature:${draft.sourceFeatureId}`;
		const sourceGeometry = geometryByRowKey.get(sourceRowKey);
		if (!sourceGeometry) return null;

		const sourceRowIndex = rows.findIndex((row) => row.rowKey === sourceRowKey);
		if (sourceRowIndex < 0) return null;

		const sourceX =
			draft.sourceSide === "end" ? sourceGeometry.right : sourceGeometry.left;
		const targetX = clientXToTimelinePx(draft.pointerX);
		const targetY =
			draft.targetRowIndex !== null
				? rowBarCenterY(draft.targetRowIndex)
				: clientYToTimelinePx(draft.pointerY);

		// Same router as the committed edge, so the preview is an honest picture
		// of what releasing will draw.
		const { path } = routeDependencyPath({
			sourceX,
			sourceY: rowBarCenterY(sourceRowIndex),
			sourceDir: draft.sourceSide === "end" ? 1 : -1,
			targetX,
			targetY,
			targetDir: draft.sourceSide === "end" ? 1 : -1,
		});
		return path;
	})();

	return {
		draft,
		draftPath,
		isDragging: draft !== null,
		beginGesture,
		draftTargetRowTop:
			draft?.targetRowIndex !== null && draft?.targetRowIndex !== undefined
				? draft.targetRowIndex * ROW_H
				: null,
		draftIsValid: draft?.rejection === null,
	};
}
