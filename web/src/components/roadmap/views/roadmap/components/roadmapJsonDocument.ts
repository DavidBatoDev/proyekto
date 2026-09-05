import { getTaskAssigneeIds } from "@/lib/taskAssignees";
import type { UpsertFullRoadmapDto } from "@/services/roadmap.service";
import type { Roadmap } from "@/types/roadmap";

/**
 * The document the JSON side panel shows for a roadmap: the shape
 * `POST /api/roadmaps/full` accepts, so a hand-edited copy saves straight back.
 *
 * Task assignees are emitted ONLY as `assignee_ids` (the full set, first =
 * primary) so a save passes co-assignees through unchanged. `assignee_id` is
 * deliberately left out: the backend ignores it whenever `assignee_ids` is
 * present, so emitting both would only invite an edit that never applies. The
 * set is omitted when empty so a hand-written `assignee_id` still applies on
 * save (the RPC accepts the scalar whenever `assignee_ids` is absent).
 */
export const buildRoadmapJsonDocument = (
	roadmap: Roadmap,
): UpsertFullRoadmapDto => ({
	id: roadmap.id,
	name: roadmap.name,
	description: roadmap.description,
	project_id: roadmap.project_id ?? undefined,
	status: roadmap.status,
	start_date: roadmap.start_date,
	end_date: roadmap.end_date,
	settings: roadmap.settings,
	roadmap_epics: (roadmap.epics ?? []).map((epic) => ({
		id: epic.id,
		title: epic.title,
		description: epic.description,
		status: epic.status,
		priority: epic.priority,
		position: epic.position,
		color: epic.color,
		start_date: epic.start_date,
		end_date: epic.end_date,
		tags: epic.tags,
		roadmap_features: (epic.features ?? []).map((feature) => ({
			id: feature.id,
			title: feature.title,
			description: feature.description,
			position: feature.position,
			is_deliverable: feature.is_deliverable,
			start_date: feature.start_date,
			end_date: feature.end_date,
			roadmap_tasks: (feature.tasks ?? []).map((task) => {
				const assigneeIds = getTaskAssigneeIds(task);
				return {
					id: task.id,
					title: task.title,
					description: task.description ?? undefined,
					status: task.status,
					priority: task.priority,
					assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
					due_date: task.due_date,
					position: task.position,
				};
			}),
		})),
	})),
});
