/**
 * The node-authoring port.
 *
 * Widgets (`EpicWidget`, `FeatureWidget`) are written against this module rather
 * than against a renderer, so the same widget draws under any engine. It exports
 * exactly the surface the widgets actually use — nothing more, because every
 * extra export is another thing a second engine has to reimplement.
 *
 * `Position` is a plain const object, not a re-export: its values are React
 * Flow's exact strings, so a future engine can consume the same handle
 * descriptors without importing anything from `@xyflow/react`.
 */
import {
	Handle as ReactFlowHandle,
	Position as ReactFlowPosition,
} from "@xyflow/react";
import { FlowHandle, useFlowNode } from "@/lib/flow/FlowNodeContext";

export const Position = {
	Left: "left",
	Top: "top",
	Right: "right",
	Bottom: "bottom",
} as const;

export type CanvasHandlePosition = (typeof Position)[keyof typeof Position];

export interface CanvasHandleProps {
	type: "source" | "target";
	position: CanvasHandlePosition;
	/**
	 * Optional. Edges that omit a handle id resolve to the first registered
	 * handle of the matching type — which is what today's feature edges rely on
	 * (they name only `sourceHandle: "epic-right"`).
	 */
	id?: string;
	className?: string;
}

/**
 * An anchor point for edges.
 *
 * Under React Flow this is its `<Handle>`; under the DOM/SVG engine it becomes a
 * registration plus a marker div. Handle geometry is computed analytically from
 * the node box and side there, which is valid because the layout pass assigns
 * every node an explicit `width`/`height` (see the invariant test in
 * `layout.test.ts`).
 */
export function Handle({ position, ...props }: CanvasHandleProps) {
	// Which engine is mounted is decided by whether a node context is present —
	// only the DOM/SVG engine provides one. Dispatching here means no widget has
	// to know, and the React Flow path below is exactly what it was before.
	const flowNode = useFlowNode();
	if (flowNode) return <FlowHandle {...props} position={position} />;

	// React Flow's `Position` is a TS enum, so the literal union above is not
	// assignable to it even though the runtime values are identical. The map
	// below is the whole of that impedance mismatch, and it lives here — at the
	// adapter boundary — rather than in every widget.
	return (
		<ReactFlowHandle {...props} position={REACT_FLOW_POSITION[position]} />
	);
}

const REACT_FLOW_POSITION: Record<CanvasHandlePosition, ReactFlowPosition> = {
	left: ReactFlowPosition.Left,
	top: ReactFlowPosition.Top,
	right: ReactFlowPosition.Right,
	bottom: ReactFlowPosition.Bottom,
};

/**
 * The props a node widget receives.
 *
 * Deliberately narrower than React Flow's `NodeProps` — these three fields are
 * the complete set the widgets read, so this is the whole contract a second
 * engine has to satisfy.
 */
export interface CanvasNodeProps<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string;
	data: TData;
	selected?: boolean;
}
