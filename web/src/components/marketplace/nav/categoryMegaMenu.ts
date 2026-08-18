/**
 * Geometry and keyboard helpers for the category mega-menu, kept free of React
 * so they can be unit-tested without a DOM.
 */

/**
 * Grace period between the pointer leaving a trigger and the panel closing.
 * Matches POPUP_CLOSE_DELAY_MS in ProjectSidebarLink, the repo's other hover
 * menu, so the two feel the same. It exists to survive diagonal travel from the
 * trigger into the panel.
 */
export const MEGA_CLOSE_DELAY_MS = 120;
export const MEGA_PANEL_MAX_WIDTH = 760;
export const MEGA_VIEWPORT_MARGIN = 8;

/** Horizontal nudge so the panel's first column lines up with its trigger. */
export const MEGA_PANEL_INSET = 16;

export function resolvePanelWidth(viewportWidth: number): number {
	return Math.min(
		MEGA_PANEL_MAX_WIDTH,
		Math.max(0, viewportWidth - MEGA_VIEWPORT_MARGIN * 2),
	);
}

/**
 * Keeps the panel inside the viewport. When the panel is wider than the space
 * available the left margin wins, so it overflows to the right rather than
 * being pushed off-screen to the left where its first column would be lost.
 */
export function clampPanelLeft(
	triggerLeft: number,
	panelWidth: number,
	viewportWidth: number,
): number {
	const maxLeft = viewportWidth - panelWidth - MEGA_VIEWPORT_MARGIN;
	return Math.max(MEGA_VIEWPORT_MARGIN, Math.min(triggerLeft, maxLeft));
}

/**
 * Splits items into `columns` balanced columns, filling column-major so reading
 * down a column follows the taxonomy's own order.
 */
export function columnize<T>(items: T[], columns: number): T[][] {
	if (columns < 1) return [items];
	const perColumn = Math.ceil(items.length / columns);
	if (perColumn === 0) return [];

	const result: T[][] = [];
	for (let start = 0; start < items.length; start += perColumn) {
		result.push(items.slice(start, start + perColumn));
	}
	return result;
}

/** Wrapping index step for roving focus along the category strip. */
export function nextTriggerIndex(
	current: number,
	step: 1 | -1,
	count: number,
): number {
	if (count <= 0) return 0;
	return (current + step + count) % count;
}
