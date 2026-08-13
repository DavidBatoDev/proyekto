export type RoadmapPreviewNodeType = "epic" | "feature" | "task";

export function buildRoadmapPreviewUrl(
	origin: string,
	roadmapId: string,
	nodeId: string,
): string {
	return `${origin.replace(/\/$/, "")}/roadmap/preview/${encodeURIComponent(roadmapId)}/${encodeURIComponent(nodeId)}`;
}

export function buildRoadmapNodeUrl(
	origin: string,
	projectId: string,
	roadmapId: string,
	nodeId: string,
): string {
	const params = new URLSearchParams({ nodeId, view: "roadmapView" });
	return `${origin.replace(/\/$/, "")}/project/${encodeURIComponent(projectId)}/roadmap/${encodeURIComponent(roadmapId)}?${params.toString()}`;
}
