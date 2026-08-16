import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";

/**
 * A stable change key for "who is editing what".
 *
 * The `editors` array identity churns on every presence heartbeat even when the
 * editing picture is unchanged, which would re-render every node on the canvas.
 * Sorting the (userId, nodeId) pairs into a string gives a value that only
 * changes when the editing state actually does.
 */
export function editingSignature(
	editors: CollaboratorInfo[] | undefined,
): string {
	return (editors ?? [])
		.filter((e) => e.editingNodeId)
		.map((e) => `${e.userId}:${e.editingNodeId}`)
		.sort()
		.join("|");
}

/** Groups collaborators by the node they currently have open. */
export function buildEditorsByNodeId(
	editors: CollaboratorInfo[] | undefined,
): Map<string, CollaboratorInfo[]> {
	const map = new Map<string, CollaboratorInfo[]>();
	for (const e of editors ?? []) {
		if (!e.editingNodeId) continue;
		const list = map.get(e.editingNodeId);
		if (list) list.push(e);
		else map.set(e.editingNodeId, [e]);
	}
	return map;
}
