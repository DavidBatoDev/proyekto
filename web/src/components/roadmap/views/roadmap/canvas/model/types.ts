/**
 * Canvas domain types.
 *
 * `CanvasNode`/`CanvasEdge` are currently aliases of React Flow's types. They exist
 * so the rest of the canvas can stop naming `@xyflow/react` directly: when the
 * renderer is replaced these two aliases become locally-declared structural
 * interfaces and nothing downstream has to change.
 */
import type { Edge, Node } from "@xyflow/react";
import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";

export type CanvasNode<
	TData extends Record<string, unknown> = Record<string, unknown>,
> = Node<TData>;
export type CanvasEdge = Edge;

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
