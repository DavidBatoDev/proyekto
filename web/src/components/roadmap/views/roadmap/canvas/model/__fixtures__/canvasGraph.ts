/**
 * Fixtures for the roadmap-canvas characterization tests.
 *
 * These exist to pin the behaviour of the canvas geometry functions
 * (`getLayoutedElements`, `computeReorderedEpics`, `computeDragPreview`) before
 * the renderer is swapped off React Flow. They are deliberately minimal: only
 * the fields those functions actually read are meaningful, everything else is
 * filler so the objects satisfy the domain types.
 */
import type { RoadmapEpic, RoadmapFeature, RoadmapTask } from "@/types/roadmap";
import type { CanvasEdge, CanvasNode, StructuralNodeData } from "../types";

const TS = "2026-01-01T00:00:00.000Z";

export function makeTask(
	id: string,
	featureId: string,
	position: number,
	overrides: Partial<RoadmapTask> = {},
): RoadmapTask {
	return {
		id,
		feature_id: featureId,
		title: `Task ${id}`,
		status: "todo",
		priority: "medium",
		position,
		created_at: TS,
		updated_at: TS,
		...overrides,
	} as RoadmapTask;
}

export function makeFeature(
	id: string,
	epicId: string,
	position: number,
	overrides: Partial<RoadmapFeature> = {},
): RoadmapFeature {
	return {
		id,
		roadmap_id: "roadmap-1",
		epic_id: epicId,
		title: `Feature ${id}`,
		description: "",
		position,
		is_deliverable: false,
		status: "not_started",
		created_at: TS,
		updated_at: TS,
		tasks: [],
		...overrides,
	};
}

export function makeEpic(
	id: string,
	position: number,
	overrides: Partial<RoadmapEpic> = {},
): RoadmapEpic {
	return {
		id,
		roadmap_id: "roadmap-1",
		title: `Epic ${id}`,
		description: "",
		priority: "medium",
		status: "planned",
		position,
		created_at: TS,
		updated_at: TS,
		features: [],
		...overrides,
	};
}

/**
 * Builds the unpositioned node array the way the component's graph memo does:
 * one `epicWidget` per epic, one `featureWidget` per feature, all at origin.
 * `getLayoutedElements` is what assigns real coordinates.
 */
export function makeNodes(
	epics: RoadmapEpic[],
	extraFeatures: RoadmapFeature[] = [],
): CanvasNode<StructuralNodeData>[] {
	const epicNodes: CanvasNode<StructuralNodeData>[] = epics.map((epic) => ({
		id: epic.id,
		type: "epicWidget",
		data: { kind: "epic", epic },
		position: { x: 0, y: 0 },
	}));

	const featureNodes: CanvasNode<StructuralNodeData>[] = [
		...epics.flatMap((epic) =>
			(epic.features ?? []).map((feature) => ({
				...feature,
				epic_id: epic.id,
			})),
		),
		...extraFeatures,
	].map((feature) => ({
		id: feature.id,
		type: "featureWidget",
		data: {
			kind: "feature" as const,
			feature: feature as RoadmapFeature & { epic_id: string },
		},
		position: { x: 0, y: 0 },
	}));

	return [...epicNodes, ...featureNodes];
}

/** Mirrors the component's edge construction closely enough for preview tests. */
export function makeEdges(epics: RoadmapEpic[]): CanvasEdge[] {
	const featureEdges: CanvasEdge[] = epics.flatMap((epic) =>
		(epic.features ?? []).map((feature) => ({
			id: `epic-feature-${epic.id}-${feature.id}`,
			source: epic.id,
			target: feature.id,
			sourceHandle: "epic-right",
			type: "simplebezier",
			animated: false,
			style: { stroke: "var(--canvas-edge)", strokeWidth: 1.75 },
		})),
	);

	const chainEdges: CanvasEdge[] = [];
	const ordered = [...epics].sort((a, b) => a.position - b.position);
	for (let i = 0; i < ordered.length - 1; i++) {
		chainEdges.push({
			id: `epic-chain-${ordered[i].id}-${ordered[i + 1].id}`,
			source: ordered[i].id,
			target: ordered[i + 1].id,
			sourceHandle: "epic-bottom",
			targetHandle: "epic-top",
			type: "simplebezier",
			animated: false,
			style: { stroke: "var(--canvas-edge)", strokeWidth: 4 },
		});
	}

	return [...featureEdges, ...chainEdges];
}

/** Positioned nodes keyed by id — the shape most assertions want. */
export function byId<T extends { id: string }>(items: T[]): Map<string, T> {
	return new Map(items.map((item) => [item.id, item]));
}
