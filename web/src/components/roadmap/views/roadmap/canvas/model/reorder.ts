import type { RoadmapEpic } from "@/types/roadmap";
import type { CanvasDragSubject, CanvasNode } from "./types";

export const computeReorderedEpics = (
	currentNodes: CanvasNode[],
	ds: CanvasDragSubject,
	sourceEpics: RoadmapEpic[],
): RoadmapEpic[] => {
	const epicNodes = currentNodes.filter((n) => n.type === "epicWidget");
	const featureNodes = currentNodes.filter((n) => n.type === "featureWidget");
	const epicById = new Map(sourceEpics.map((epic) => [epic.id, epic]));
	const featureById = new Map(
		sourceEpics
			.flatMap((epic) => epic.features ?? [])
			.map((feature) => [feature.id, feature]),
	);
	const featureNodeById = new Map(featureNodes.map((node) => [node.id, node]));

	if (!ds) return sourceEpics;

	if (ds.type === "epic") {
		// Sort epics by their current Y position to determine new order
		const sortedEpicIds = [...epicNodes]
			.sort((a, b) => a.position.y - b.position.y)
			.map((n) => n.id);
		const reorderedEpics: RoadmapEpic[] = [];
		for (let index = 0; index < sortedEpicIds.length; index++) {
			const epic = epicById.get(sortedEpicIds[index]);
			if (epic) reorderedEpics.push({ ...epic, position: index * 1000 });
		}
		return reorderedEpics;
	}

	// Feature drag:
	// - Non-dragged features stay anchored to their original epics.
	//   Reassigning them by Y proximity causes misassignment when they
	//   happen to be slightly closer to an adjacent epic's midpoint.
	// - Only the dragged feature is assigned to the closest epic.
	// - Insertion point within the target epic uses center-Y comparison
	//   (top-left Y is inaccurate for nodes that are 150–300 px tall).

	const draggedNode = featureNodeById.get(ds.nodeId);
	if (!draggedNode) return sourceEpics;

	const draggedH = (draggedNode.height as number) ?? 150;
	const draggedCenterY = draggedNode.position.y + draggedH / 2;

	// Find target epic for the dragged feature (closest center distance)
	let targetEpicId: string | null = null;
	let minDist = Infinity;
	for (const epicNode of epicNodes) {
		const epicMid =
			epicNode.position.y + ((epicNode.height as number) ?? 220) / 2;
		const dist = Math.abs(draggedCenterY - epicMid);
		if (dist < minDist) {
			minDist = dist;
			targetEpicId = epicNode.id;
		}
	}
	if (!targetEpicId) return sourceEpics;

	const draggedFeature = featureById.get(ds.nodeId);

	// Epic order is derived from epic Y positions (handles epic reorder during the same session)
	const epicOrder = [...epicNodes]
		.sort((a, b) => a.position.y - b.position.y)
		.map((n) => n.id);

	const result: RoadmapEpic[] = [];
	for (let index = 0; index < epicOrder.length; index++) {
		const epicId = epicOrder[index];
		if (!epicId) continue;
		const epic = epicById.get(epicId);
		if (!epic) continue;

		// Original features for this epic, excluding the dragged one, in original position order
		const originalFeatures = (epic.features ?? [])
			.filter((f) => f.id !== ds.nodeId)
			.sort((a, b) => a.position - b.position);

		if (epicId !== targetEpicId) {
			// Features stay as-is (non-target epic just loses the dragged feature if it was here)
			result.push({
				...epic,
				position: index * 1000,
				features: originalFeatures.map((f, i) => ({
					...f,
					position: i * 1000,
				})),
			});
			continue;
		}

		// Target epic: insert dragged feature at the right position using center-Y comparison
		let insertIndex = originalFeatures.length; // default: append at end
		for (let i = 0; i < originalFeatures.length; i++) {
			const featureNode = featureNodeById.get(originalFeatures[i].id);
			const featureCenterY = featureNode
				? featureNode.position.y + ((featureNode.height as number) ?? 150) / 2
				: Infinity;
			if (draggedCenterY < featureCenterY) {
				insertIndex = i;
				break;
			}
		}

		const orderedFeatures = [...originalFeatures];
		if (draggedFeature) {
			orderedFeatures.splice(insertIndex, 0, draggedFeature);
		}
		result.push({
			...epic,
			position: index * 1000,
			features: orderedFeatures.map((f, i) => ({
				...f,
				epic_id: epicId,
				position: i * 1000,
			})),
		});
	}
	return result;
};
