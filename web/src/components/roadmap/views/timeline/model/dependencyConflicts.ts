import type { FeatureDependency, FeatureDependencyType } from "@/types/roadmap";
import {
	addDays,
	daysBetween,
	toISODateString,
} from "../../milestones/model/utils";

export interface ScheduledFeature {
	id: string;
	title: string;
	start_date?: string;
	end_date?: string;
}

export interface DependencyConflict {
	dependencyId: string;
	blockingFeatureId: string;
	blockedFeatureId: string;
	type: FeatureDependencyType;
	/** Earliest date the successor may legally start (ISO yyyy-mm-dd). */
	earliestStart: string;
	currentStart: string;
	slipDays: number;
}

/**
 * Earliest legal start for the successor.
 *
 * End dates are inclusive throughout the timeline (a bar's right edge is
 * `dateToPx(end + 1)`), so for Finish->Start the successor may start the day
 * AFTER the predecessor ends. All date maths routes through the same
 * milestones/model/utils helpers the bars use — a local reimplementation is
 * exactly what would make a conflict drift a day from what is drawn.
 */
export function earliestStartFor(
	type: FeatureDependencyType,
	predecessor: ScheduledFeature,
	lagDays: number,
): string | null {
	switch (type) {
		case "FS": {
			if (!predecessor.end_date) return null;
			return toISODateString(
				addDays(new Date(predecessor.end_date), 1 + lagDays),
			);
		}
		case "SS": {
			if (!predecessor.start_date) return null;
			return toISODateString(
				addDays(new Date(predecessor.start_date), lagDays),
			);
		}
		case "FF": {
			// Constrains the successor's END, not its start; handled by the caller
			// comparing end dates. No start constraint to report.
			return null;
		}
	}
}

/**
 * Conflicts across the whole roadmap. A dependency with either end unscheduled
 * is skipped rather than reported — you cannot violate a date that is not set.
 */
export function detectConflicts(
	dependencies: FeatureDependency[],
	featureById: Map<string, ScheduledFeature>,
): DependencyConflict[] {
	const conflicts: DependencyConflict[] = [];

	for (const edge of dependencies) {
		const predecessor = featureById.get(edge.blocking_feature_id);
		const successor = featureById.get(edge.blocked_feature_id);
		if (!predecessor || !successor) continue;

		const type = edge.dependency_type ?? "FS";

		if (type === "FF") {
			if (!predecessor.end_date || !successor.end_date) continue;
			const earliestEnd = addDays(
				new Date(predecessor.end_date),
				edge.lag_days ?? 0,
			);
			if (new Date(successor.end_date) >= earliestEnd) continue;
			conflicts.push({
				dependencyId: edge.id,
				blockingFeatureId: edge.blocking_feature_id,
				blockedFeatureId: edge.blocked_feature_id,
				type,
				earliestStart: toISODateString(earliestEnd),
				currentStart: successor.end_date,
				slipDays: Math.round(
					daysBetween(new Date(successor.end_date), earliestEnd),
				),
			});
			continue;
		}

		if (!successor.start_date) continue;
		const earliest = earliestStartFor(type, predecessor, edge.lag_days ?? 0);
		if (!earliest) continue;

		// Starting exactly on `earliest` is fine; only earlier is a conflict.
		if (new Date(successor.start_date) >= new Date(earliest)) continue;

		conflicts.push({
			dependencyId: edge.id,
			blockingFeatureId: edge.blocking_feature_id,
			blockedFeatureId: edge.blocked_feature_id,
			type,
			earliestStart: earliest,
			currentStart: successor.start_date,
			slipDays: Math.round(
				daysBetween(new Date(successor.start_date), new Date(earliest)),
			),
		});
	}

	return conflicts;
}

/**
 * Where the successor should move to. Shifts both ends by the same slip so the
 * feature keeps its duration — moving only the start would silently shorten it.
 */
export function proposeReschedule(
	conflict: DependencyConflict,
	successor: ScheduledFeature,
): { start_date: string; end_date: string } | null {
	if (!successor.start_date || !successor.end_date) return null;

	const slip = conflict.slipDays;
	return {
		start_date: toISODateString(addDays(new Date(successor.start_date), slip)),
		end_date: toISODateString(addDays(new Date(successor.end_date), slip)),
	};
}

export function indexConflicts(conflicts: DependencyConflict[]) {
	const byDependencyId = new Map<string, DependencyConflict>();
	const bySuccessorId = new Map<string, DependencyConflict>();
	for (const conflict of conflicts) {
		byDependencyId.set(conflict.dependencyId, conflict);
		// Keep the worst slip when a feature violates several predecessors —
		// fixing that one satisfies the others.
		const existing = bySuccessorId.get(conflict.blockedFeatureId);
		if (!existing || conflict.slipDays > existing.slipDays) {
			bySuccessorId.set(conflict.blockedFeatureId, conflict);
		}
	}
	return { byDependencyId, bySuccessorId };
}
