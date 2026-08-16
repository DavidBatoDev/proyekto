/**
 * The node-authoring port.
 *
 * Widgets (`EpicWidget`, `FeatureWidget`) are written against this module rather
 * than against the canvas engine directly, so a widget never imports from
 * `@/lib/flow`. That keeps the engine swappable and, just as importantly, keeps
 * the engine free of any knowledge of roadmap widgets.
 *
 * It exports exactly the surface the widgets use — nothing more, because every
 * extra export is another thing a future engine has to reimplement.
 */
import { FlowHandle } from "@/lib/flow/FlowNodeContext";

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
	 * handle of the matching type — which is what the feature edges rely on
	 * (they name only `sourceHandle: "epic-right"`).
	 */
	id?: string;
	className?: string;
}

/**
 * An anchor point for edges.
 *
 * Registers itself with the enclosing node so edges can resolve which side to
 * attach to, and renders a marker element. Geometry is computed from the node's
 * rendered card rather than measured per handle — see `lib/flow/handles.ts`.
 */
export function Handle(props: CanvasHandleProps) {
	return <FlowHandle {...props} />;
}

/**
 * The props a node widget receives.
 *
 * Deliberately narrow — these three fields are the complete set the widgets
 * read, so this is the whole contract an engine has to satisfy.
 */
export interface CanvasNodeProps<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string;
	data: TData;
	selected?: boolean;
}
