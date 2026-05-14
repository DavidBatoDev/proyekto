import type { FeatureStatus, RoadmapTask } from "@/types/roadmap";

export function deriveFeatureStatus(
	tasks: ReadonlyArray<RoadmapTask> | undefined,
): FeatureStatus {
	const list = tasks ?? [];
	if (list.length === 0) return "not_started";
	if (list.some((t) => t.status === "blocked")) return "blocked";
	if (list.every((t) => t.status === "done")) return "completed";
	if (list.every((t) => t.status === "todo")) return "not_started";
	if (
		list.every((t) => t.status === "in_review" || t.status === "done") &&
		list.some((t) => t.status === "in_review")
	) {
		return "in_review";
	}
	return "in_progress";
}
