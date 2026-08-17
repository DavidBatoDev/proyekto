import type { FeatureDependency } from "@/types/roadmap";

export type Adjacency = Map<string, Set<string>>;

/** predecessor -> successors. */
export function buildAdjacency(dependencies: FeatureDependency[]): Adjacency {
	const adjacency: Adjacency = new Map();
	for (const edge of dependencies) {
		const successors = adjacency.get(edge.blocking_feature_id) ?? new Set();
		successors.add(edge.blocked_feature_id);
		adjacency.set(edge.blocking_feature_id, successors);
	}
	return adjacency;
}

export function hasEdge(
	adjacency: Adjacency,
	blockingFeatureId: string,
	blockedFeatureId: string,
): boolean {
	return Boolean(adjacency.get(blockingFeatureId)?.has(blockedFeatureId));
}

/**
 * Would adding predecessor -> successor close a loop?
 *
 * Walk forward from the proposed successor; reaching the proposed predecessor
 * means the edge completes a cycle. Iterative with a visited set, so it
 * terminates even if the data already contains one.
 *
 * This mirrors the database trigger, which remains the authority — the backend
 * writes as service_role and bypasses RLS, and the AI/MCP paths write through
 * other services. This copy exists purely so an invalid drop can be refused
 * before the round trip.
 */
export function wouldCreateCycle(
	adjacency: Adjacency,
	blockingFeatureId: string,
	blockedFeatureId: string,
): boolean {
	if (blockingFeatureId === blockedFeatureId) return true;

	const visited = new Set<string>();
	const stack = [blockedFeatureId];

	while (stack.length > 0) {
		const current = stack.pop() as string;
		if (current === blockingFeatureId) return true;
		if (visited.has(current)) continue;
		visited.add(current);

		const successors = adjacency.get(current);
		if (!successors) continue;
		for (const next of successors) {
			if (!visited.has(next)) stack.push(next);
		}
	}

	return false;
}

export type DropRejection =
	| "self"
	| "duplicate"
	| "cycle"
	| "not-a-feature"
	| null;

/** Why a drop is invalid, or null when it is fine. Drives the drag affordance. */
export function rejectDrop(
	adjacency: Adjacency,
	blockingFeatureId: string | null,
	blockedFeatureId: string | null,
): DropRejection {
	if (!blockingFeatureId || !blockedFeatureId) return "not-a-feature";
	if (blockingFeatureId === blockedFeatureId) return "self";
	if (hasEdge(adjacency, blockingFeatureId, blockedFeatureId)) {
		return "duplicate";
	}
	if (wouldCreateCycle(adjacency, blockingFeatureId, blockedFeatureId)) {
		return "cycle";
	}
	return null;
}
