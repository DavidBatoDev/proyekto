/**
 * Canvas domain types.
 *
 * `CanvasNode`/`CanvasEdge` describe only the fields this canvas actually
 * reads, and are owned here rather than by any renderer. They are structurally
 * identical to `lib/flow`'s `FlowNode`/`FlowEdge`, which is what lets the
 * renderer adapter pass them straight through with a cast instead of
 * translating between two shapes on every render.
 */
import type { CSSProperties } from "react";
import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";

export interface CanvasXYPosition {
	x: number;
	y: number;
}

export interface CanvasNode<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string;
	/** Selects the widget that draws this node (`epicWidget` / `featureWidget`). */
	type?: string;
	position: CanvasXYPosition;
	data: TData;
	/**
	 * Authoritative dimensions. The layout pass always assigns both, and edge
	 * anchoring is computed from them analytically — see the invariant test in
	 * layout.test.ts.
	 */
	width?: number;
	height?: number;
	zIndex?: number;
	className?: string;
	style?: CSSProperties;
	hidden?: boolean;
}

export interface CanvasEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
	/** Path shape. Currently always `simplebezier`. */
	type?: string;
	animated?: boolean;
	className?: string;
	style?: CSSProperties;
	hidden?: boolean;
	zIndex?: number;
}

export type StructuralEpicNodeData = {
	kind: "epic";
	epic: RoadmapEpic;
};

export type StructuralFeatureNodeData = {
	kind: "feature";
	feature: RoadmapFeature & { epic_id: string };
};

export type StructuralNodeData =
	| StructuralEpicNodeData
	| StructuralFeatureNodeData;

/** Drag state shared by the local drag machine and the remote-collaborator mirror. */
export type CanvasDragSubject = {
	nodeId: string;
	type: "epic" | "feature";
	sourceEpicId?: string;
};

/** A drag awaiting user confirmation before it is persisted. */
export type PendingCanvasDrag =
	| {
			kind: "epicReorder";
			epicId: string;
			epicTitle: string;
			newEpicOrder: string[];
	  }
	| {
			kind: "featureReorder";
			featureId: string;
			featureTitle: string;
			epicId: string;
			newFeatureOrder: string[];
	  }
	| {
			kind: "featureMove";
			featureId: string;
			featureTitle: string;
			sourceEpicId: string;
			targetEpicId: string;
			targetEpicTitle: string;
			newTargetFeatureOrder: string[];
	  };
