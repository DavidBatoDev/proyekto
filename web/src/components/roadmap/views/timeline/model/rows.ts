import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";

/** Uniform row height. Uniform is load-bearing: it makes the virtual window a
 *  division rather than a measured layout pass. */
export const ROW_H = 48;
export const TASK_COL_WIDTH = 320;
export const SUPER_ROW_H = 32;
export const SUB_ROW_H = 32;
export const HEADER_H = SUPER_ROW_H + SUB_ROW_H;
export const BAR_H = 26;
/** Rows rendered beyond the viewport on each side, so a fast drag never
 *  exposes blank space before the next frame lands. */
export const OVERSCAN = 6;

export type TimelineRow =
	| {
			kind: "epic";
			id: string;
			rowKey: string;
			depth: 0;
			epic: RoadmapEpic;
			hasChildren: boolean;
			isExpanded: boolean;
	  }
	| {
			kind: "feature";
			id: string;
			rowKey: string;
			depth: 1;
			epic: RoadmapEpic;
			feature: RoadmapFeature;
			hasChildren: false;
			isExpanded: false;
	  };

/**
 * Flatten the epic/feature tree into the single ordered list the virtualizer
 * walks. Collapsed epics contribute one row, so the list length is exactly the
 * number of visible rows and `index * ROW_H` is a row's y offset.
 */
export function buildTimelineRows(
	epics: RoadmapEpic[],
	collapsed: ReadonlySet<string>,
): TimelineRow[] {
	const rows: TimelineRow[] = [];

	for (const epic of epics) {
		const features = epic.features ?? [];
		const isExpanded = !collapsed.has(epic.id);

		rows.push({
			kind: "epic",
			id: epic.id,
			rowKey: `epic:${epic.id}`,
			depth: 0,
			epic,
			hasChildren: features.length > 0,
			isExpanded,
		});

		if (!isExpanded) continue;

		for (const feature of features) {
			rows.push({
				kind: "feature",
				id: feature.id,
				rowKey: `feature:${feature.id}`,
				depth: 1,
				epic,
				feature,
				hasChildren: false,
				isExpanded: false,
			});
		}
	}

	return rows;
}

/** Short, stable display key for a row — the mock's issue key slot. Proyekto
 *  has no issue keys, so we derive a readable one from the id. */
export function rowDisplayKey(row: TimelineRow): string {
	const prefix = row.kind === "epic" ? "EPC" : "FEA";
	return `${prefix}-${row.id
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(-4)
		.toUpperCase()}`;
}

export function getRowDates(
	row: TimelineRow,
): { startDate: string; endDate: string } | null {
	const entity = row.kind === "epic" ? row.epic : row.feature;
	if (!entity.start_date || !entity.end_date) return null;
	return { startDate: entity.start_date, endDate: entity.end_date };
}
