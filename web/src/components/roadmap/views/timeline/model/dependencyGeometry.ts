import type { FeatureDependency, FeatureDependencyType } from "@/types/roadmap";
import type { BarGeometry } from "./barGeometry";
import { routeDependencyPath } from "./edgeRoute";
import { ROW_H, type TimelineRow } from "./rows";

export interface DependencyEdgeGeometry {
	dependencyId: string;
	path: string;
	labelX: number;
	labelY: number;
	/** Successor starts before the predecessor allows. */
	isConflict: boolean;
	/** One endpoint resolved to a collapsed epic rather than its own row. */
	isRollup: boolean;
}

/**
 * Which end of each bar an edge attaches to. All four combinations are here so
 * SS/FF need no geometry change, even though the UI only emits FS today.
 */
const ENDPOINT_EDGE: Record<
	FeatureDependencyType,
	{ source: "start" | "end"; target: "start" | "end" }
> = {
	FS: { source: "end", target: "start" },
	SS: { source: "start", target: "start" },
	FF: { source: "end", target: "end" },
};

/**
 * Vertical centre of a row's bar.
 *
 * Epics and features have different bar heights, but both are centred in the
 * row, so the height cancels and there is no `kind` branch:
 *   top = rowIndex * ROW_H + (ROW_H - H) / 2, centre = top + H / 2
 */
export function rowBarCenterY(rowIndex: number): number {
	return rowIndex * ROW_H + ROW_H / 2;
}

function anchorX(geometry: BarGeometry, edge: "start" | "end"): number {
	return edge === "start" ? geometry.left : geometry.right;
}

export interface EdgeResolution {
	rowIndex: number;
	geometry: BarGeometry;
	isRollup: boolean;
}

/**
 * Resolve one endpoint to a drawable anchor.
 *
 * Ladder, in order:
 *   1. the feature's own row is visible -> anchor to it
 *   2. its epic is visible but collapsed -> roll up to the epic bar (what Jira
 *      and MS Project do with collapsed summary bars), flagged isRollup
 *   3. neither is present (filtered out) -> null; the endpoint does not exist
 *      in the layout at all, so there is nothing to point at
 *   4. anchor row has no dates -> null
 */
export function resolveEndpoint(
	featureId: string,
	rowIndexByRowKey: Map<string, number>,
	epicIdByFeatureId: Map<string, string>,
	geometryByRowKey: Map<string, BarGeometry>,
): EdgeResolution | null {
	const featureRowKey = `feature:${featureId}`;
	const featureRowIndex = rowIndexByRowKey.get(featureRowKey);
	if (featureRowIndex !== undefined) {
		const geometry = geometryByRowKey.get(featureRowKey);
		return geometry
			? { rowIndex: featureRowIndex, geometry, isRollup: false }
			: null;
	}

	const epicId = epicIdByFeatureId.get(featureId);
	if (!epicId) return null;
	const epicRowKey = `epic:${epicId}`;
	const epicRowIndex = rowIndexByRowKey.get(epicRowKey);
	if (epicRowIndex === undefined) return null;

	const geometry = geometryByRowKey.get(epicRowKey);
	return geometry ? { rowIndex: epicRowIndex, geometry, isRollup: true } : null;
}

export interface BuildEdgesParams {
	dependencies: FeatureDependency[];
	rows: TimelineRow[];
	rowIndexByRowKey: Map<string, number>;
	epicIdByFeatureId: Map<string, string>;
	geometryByRowKey: Map<string, BarGeometry>;
	conflictDependencyIds: ReadonlySet<string>;
}

export interface BuildEdgesResult {
	edges: DependencyEdgeGeometry[];
	/** Edges that exist but cannot be drawn (endpoint filtered out or undated). */
	hiddenCount: number;
}

/**
 * Build every drawable edge.
 *
 * There is deliberately NO viewport culling. lib/flow/FlowEdges documents the
 * lesson: hiding edges as bounding boxes shift is what produces edge-flicker.
 * It would be worse here, because drag-to-pan writes scrollLeft/scrollTop
 * straight to the DOM with zero re-renders, so a scroll-driven cull could not
 * even re-render in time. Roadmaps top out around 30 features, so drawing all
 * edges costs two static paths each.
 */
export function buildDependencyEdges({
	dependencies,
	rowIndexByRowKey,
	epicIdByFeatureId,
	geometryByRowKey,
	conflictDependencyIds,
}: BuildEdgesParams): BuildEdgesResult {
	const edges: DependencyEdgeGeometry[] = [];
	let hiddenCount = 0;

	for (const dependency of dependencies) {
		const source = resolveEndpoint(
			dependency.blocking_feature_id,
			rowIndexByRowKey,
			epicIdByFeatureId,
			geometryByRowKey,
		);
		const target = resolveEndpoint(
			dependency.blocked_feature_id,
			rowIndexByRowKey,
			epicIdByFeatureId,
			geometryByRowKey,
		);

		if (!source || !target) {
			hiddenCount += 1;
			continue;
		}
		// A rolled-up pair inside one collapsed epic would be a self-loop.
		if (source.rowIndex === target.rowIndex) {
			hiddenCount += 1;
			continue;
		}

		const ends = ENDPOINT_EDGE[dependency.dependency_type ?? "FS"];
		const { path, labelX, labelY } = routeDependencyPath({
			sourceX: anchorX(source.geometry, ends.source),
			sourceY: rowBarCenterY(source.rowIndex),
			// Leaving the finish edge heads right; leaving the start edge heads left.
			sourceDir: ends.source === "end" ? 1 : -1,
			targetX: anchorX(target.geometry, ends.target),
			targetY: rowBarCenterY(target.rowIndex),
			// Arriving at a start edge travels right; at a finish edge, left.
			targetDir: ends.target === "start" ? 1 : -1,
		});

		edges.push({
			dependencyId: dependency.id,
			path,
			labelX,
			labelY,
			isConflict: conflictDependencyIds.has(dependency.id),
			isRollup: source.isRollup || target.isRollup,
		});
	}

	return { edges, hiddenCount };
}
