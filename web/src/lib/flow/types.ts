/**
 * Core types for the flow engine.
 *
 * This library may import ONLY `react`/`react-dom` — no app modules, no UI
 * framework, no `@xyflow/react`. That boundary is enforced mechanically by
 * importBoundary.test.ts, and it exists so the engine can be lifted out into a
 * standalone package later without untangling anything.
 */
import type { CSSProperties } from "react";

export interface Point {
	x: number;
	y: number;
}

export interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

/** `[[minX, minY], [maxX, maxY]]` — the pannable area in flow coordinates. */
export type TranslateExtent = [[number, number], [number, number]];

/** Which side of a node a handle sits on. */
export type HandlePosition = "left" | "top" | "right" | "bottom";

export type HandleType = "source" | "target";

export interface FlowNode<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string;
	type?: string;
	position: Point;
	data: TData;
	/**
	 * Declared dimensions. This engine runs in `measurement: "declared"` mode —
	 * it never reads layout from the DOM — so edge anchoring is analytic and
	 * works identically in jsdom. The consumer's layout pass is expected to
	 * assign both.
	 */
	width?: number;
	height?: number;
	zIndex?: number;
	className?: string;
	style?: CSSProperties;
	hidden?: boolean;
}

export interface FlowEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
	type?: string;
	animated?: boolean;
	className?: string;
	style?: CSSProperties;
	hidden?: boolean;
	zIndex?: number;
}

/** A handle registered by a node's `<FlowHandle>` during layout. */
export interface HandleRegistration {
	id?: string;
	type: HandleType;
	position: HandlePosition;
	/**
	 * Registration index within the node. Layout effects run in DOM order, so
	 * this is what makes "first registered handle of matching type" — the
	 * fallback for edges that omit a handle id — well defined and stable.
	 */
	order: number;
}
