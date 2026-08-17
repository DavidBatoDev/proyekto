import { addDays } from "../../milestones/model/utils";
import type { TimelineRow } from "./rows";

export interface BarGeometry {
	left: number;
	right: number;
}

/**
 * Where a row's bar actually sits, resolved from the same three sources, in the
 * same priority order, that TimelineGrid uses to draw it:
 *
 *   1. an in-flight drag draft   (highest — the bar is moving right now)
 *   2. a pending date override   (a committed change not yet confirmed by the server)
 *   3. the entity's stored dates
 *
 * Shared on purpose. If the dependency layer re-derived this independently,
 * arrows would detach from their bars during every drag and every pending save.
 *
 * Returns null when the row has no bar (no dates) — callers must handle it
 * rather than drawing to the origin.
 */
export function resolveBarGeometry(
	row: TimelineRow,
	pendingDates: Record<string, { startDate: string; endDate: string }>,
	getDraftGeometry: (rowKey: string) => { left: number; width: number } | null,
	dateToPx: (date: Date | string) => number,
): BarGeometry | null {
	const draft = getDraftGeometry(row.rowKey);
	if (draft) {
		return { left: draft.left, right: draft.left + draft.width };
	}

	const entity = row.kind === "epic" ? row.epic : row.feature;
	const pending = pendingDates[row.rowKey];
	const startDate = pending?.startDate ?? entity.start_date;
	const endDate = pending?.endDate ?? entity.end_date;
	if (!startDate || !endDate) return null;

	const left = dateToPx(startDate);
	// End date is inclusive, so the bar runs to the start of the following day.
	const right = dateToPx(addDays(new Date(endDate), 1));
	return { left, right };
}

/** Width as TimelineGrid renders it, with the same 4px floor. */
export function barWidth(geometry: BarGeometry): number {
	return Math.max(4, geometry.right - geometry.left);
}
