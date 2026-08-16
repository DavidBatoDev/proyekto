import type {
	FlowNode,
	Point,
	Rect,
	Size,
	TranslateExtent,
	Viewport,
} from "./types";

/**
 * Viewport maths.
 *
 * Everything here is a port of the behaviour the roadmap canvas has today —
 * React Flow's fitView framing and d3-zoom's translate constraint — rather than
 * a fresh derivation. Both were transcribed from the installed sources and are
 * cross-checked in transform.test.ts, because "the canvas frames slightly
 * differently now" is a regression nobody files but everybody feels.
 */

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function clampZoom(
	zoom: number,
	minZoom: number,
	maxZoom: number,
): number {
	return clamp(zoom, minZoom, maxZoom);
}

/**
 * Client (page) coordinates -> flow coordinates.
 *
 * `rect` is the canvas container's bounding box; subtracting it is what makes
 * this correct when the canvas is not at the page origin — which it never is,
 * given the app header and sidebars.
 */
export function screenToFlow(
	point: Point,
	rect: { left: number; top: number },
	viewport: Viewport,
): Point {
	return {
		x: (point.x - rect.left - viewport.x) / viewport.zoom,
		y: (point.y - rect.top - viewport.y) / viewport.zoom,
	};
}

/** Flow coordinates -> client (page) coordinates. Exact inverse of the above. */
export function flowToScreen(
	point: Point,
	rect: { left: number; top: number },
	viewport: Viewport,
): Point {
	return {
		x: point.x * viewport.zoom + viewport.x + rect.left,
		y: point.y * viewport.zoom + viewport.y + rect.top,
	};
}

/**
 * Zoom about a pivot expressed in CONTAINER coordinates, keeping whatever sits
 * under the pivot fixed on screen.
 */
export function scaleBy(
	viewport: Viewport,
	factor: number,
	pivot: Point,
	minZoom: number,
	maxZoom: number,
): Viewport {
	const zoom = clampZoom(viewport.zoom * factor, minZoom, maxZoom);
	if (zoom === viewport.zoom) return viewport;
	const ratio = zoom / viewport.zoom;
	return {
		x: pivot.x - (pivot.x - viewport.x) * ratio,
		y: pivot.y - (pivot.y - viewport.y) * ratio,
		zoom,
	};
}

/**
 * d3-zoom's default `constrain`, which is what React Flow uses to honour
 * `translateExtent`.
 *
 * The subtle half is the ternary: when the extent is NARROWER than the viewport
 * the two deltas invert, and d3 centres the content (`(dx0 + dx1) / 2`) instead
 * of clamping to an edge. A naive clamp instead makes small roadmaps jam against
 * the left edge, which is exactly the bug this shape prevents.
 */
export function constrainTransform(
	viewport: Viewport,
	size: Size,
	translateExtent: TranslateExtent,
): Viewport {
	const { x, y, zoom } = viewport;
	// d3's invertX/invertY for the current transform.
	const invertX = (v: number) => (v - x) / zoom;
	const invertY = (v: number) => (v - y) / zoom;

	const dx0 = invertX(0) - translateExtent[0][0];
	const dx1 = invertX(size.width) - translateExtent[1][0];
	const dy0 = invertY(0) - translateExtent[0][1];
	const dy1 = invertY(size.height) - translateExtent[1][1];

	const tx = dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1);
	const ty = dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1);

	// d3's transform.translate(tx, ty) — the translation is in flow units and so
	// is scaled by the current zoom.
	return { x: x + tx * zoom, y: y + ty * zoom, zoom };
}

/** Bounding rect of the given nodes, from DECLARED dimensions (never measured). */
export function getNodesBounds(nodes: FlowNode[]): Rect {
	if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

	let x1 = Number.POSITIVE_INFINITY;
	let y1 = Number.POSITIVE_INFINITY;
	let x2 = Number.NEGATIVE_INFINITY;
	let y2 = Number.NEGATIVE_INFINITY;

	for (const node of nodes) {
		const width = node.width ?? 0;
		const height = node.height ?? 0;
		x1 = Math.min(x1, node.position.x);
		y1 = Math.min(y1, node.position.y);
		x2 = Math.max(x2, node.position.x + width);
		y2 = Math.max(y2, node.position.y + height);
	}

	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * React Flow's `parsePadding` for a fractional padding.
 *
 * Deliberately NOT `padding * viewport`: the real formula converts a fraction
 * into the pixel inset that yields that fraction of extra space, and it floors.
 * Getting this wrong shifts every fitView by a few pixels.
 */
function parsePadding(padding: number, viewport: number): number {
	return Math.floor((viewport - viewport / (1 + padding)) * 0.5);
}

/**
 * The viewport that frames `bounds` — a port of `getViewportForBounds`,
 * including its second pass that corrects for asymmetric applied padding.
 */
export function getViewportForBounds(
	bounds: Rect,
	width: number,
	height: number,
	minZoom: number,
	maxZoom: number,
	padding: number,
): Viewport {
	const paddingY = parsePadding(padding, height);
	const paddingX = parsePadding(padding, width);
	const p = {
		top: paddingY,
		right: paddingX,
		bottom: paddingY,
		left: paddingX,
		x: paddingX * 2,
		y: paddingY * 2,
	};

	const xZoom = (width - p.x) / bounds.width;
	const yZoom = (height - p.y) / bounds.height;
	const clampedZoom = clamp(Math.min(xZoom, yZoom), minZoom, maxZoom);

	const boundsCenterX = bounds.x + bounds.width / 2;
	const boundsCenterY = bounds.y + bounds.height / 2;
	const x = width / 2 - boundsCenterX * clampedZoom;
	const y = height / 2 - boundsCenterY * clampedZoom;

	// Applied paddings after the centred placement.
	const left = Math.floor(bounds.x * clampedZoom + x);
	const top = Math.floor(bounds.y * clampedZoom + y);
	const right = Math.floor(
		width - ((bounds.x + bounds.width) * clampedZoom + x),
	);
	const bottom = Math.floor(
		height - ((bounds.y + bounds.height) * clampedZoom + y),
	);

	const offset = {
		left: Math.min(left - p.left, 0),
		top: Math.min(top - p.top, 0),
		right: Math.min(right - p.right, 0),
		bottom: Math.min(bottom - p.bottom, 0),
	};

	return {
		x: x - offset.left + offset.right,
		y: y - offset.top + offset.bottom,
		zoom: clampedZoom,
	};
}

/** Viewport that centres a flow-space point, matching React Flow's `setCenter`. */
export function viewportForCenter(
	center: Point,
	size: Size,
	zoom: number,
): Viewport {
	return {
		x: size.width / 2 - center.x * zoom,
		y: size.height / 2 - center.y * zoom,
		zoom,
	};
}

/** The flow-space rect currently visible, optionally grown by a margin. */
export function visibleRect(viewport: Viewport, size: Size, margin = 0): Rect {
	const width = size.width / viewport.zoom;
	const height = size.height / viewport.zoom;
	return {
		x: -viewport.x / viewport.zoom - margin,
		y: -viewport.y / viewport.zoom - margin,
		width: width + margin * 2,
		height: height + margin * 2,
	};
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

/** `t` in [0,1] -> eased progress. Matches the feel of React Flow's transitions. */
export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
