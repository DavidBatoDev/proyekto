import type { AssigneeProfile, RoadmapTask } from "@/types/roadmap";

/**
 * Multi-assignee helpers shared by the Kanban filters, the quick-assign dock
 * and the AI optimistic apply.
 *
 * Canonical shape (mirrors the backend's `resolveAssigneeIds`):
 * - `assignee_ids` is the FULL, ordered set of user ids (first = primary);
 * - `assignee_id` always mirrors `assignee_ids[0] ?? null`;
 * - `assignees` / `assignee` carry the matching profiles when known.
 */

type TaskAssignmentFields = Pick<
	RoadmapTask,
	"assignee_id" | "assignee_ids" | "assignee" | "assignees"
>;

/** Strings only, trimmed, de-duplicated, order preserved. */
export const normalizeAssigneeIds = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const id = entry.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
};

/**
 * The ids a task is assigned to, read from whichever layer is populated:
 * the explicit `assignee_ids` set, then the embedded `assignees` join rows,
 * then the legacy primary column. Non-empty layers win so a legacy row whose
 * join table was never populated still reports its primary assignee (the
 * same precedence the assignee pickers use).
 */
export const getTaskAssigneeIds = (task: TaskAssignmentFields): string[] => {
	if (task.assignee_ids?.length) return normalizeAssigneeIds(task.assignee_ids);
	const embedded = normalizeAssigneeIds(
		(task.assignees ?? []).map((assignee) => assignee.id),
	);
	if (embedded.length) return embedded;
	const primary = task.assignee_id ?? task.assignee?.id;
	return primary ? [primary] : [];
};

/** The assignee profiles a task carries (join rows, else the primary). */
export const getTaskAssigneeProfiles = (
	task: TaskAssignmentFields,
): AssigneeProfile[] => {
	if (task.assignees?.length) return task.assignees;
	return task.assignee ? [task.assignee] : [];
};

/**
 * Resolve the assignment an AI patch (or `add_task` data) expresses, with the
 * canonical precedence: `assignee_ids` wins when present; else
 * `assignee_id: X` means `[X]` and `assignee_id: null` means `[]`.
 * `undefined` = the patch does not touch assignment.
 */
export const assigneeIdsFromPatch = (
	patch: Record<string, unknown> | null | undefined,
): string[] | undefined => {
	if (!patch) return undefined;
	if (Array.isArray(patch.assignee_ids)) {
		return normalizeAssigneeIds(patch.assignee_ids);
	}
	if (!("assignee_id" in patch) || patch.assignee_id === undefined) {
		return undefined;
	}
	const single =
		typeof patch.assignee_id === "string" ? patch.assignee_id.trim() : "";
	return single ? [single] : [];
};

/**
 * Apply an assignee set to a task with the mirror rule: `assignee_ids` = the
 * set, `assignee_id` = the first id (null when empty), `assignees` = the known
 * profiles for those ids in set order (profiles for ids we have never seen
 * fill in on the next full reload), `assignee` = the primary profile.
 */
export const withTaskAssignees = <T extends TaskAssignmentFields>(
	task: T,
	ids: string[],
	knownProfiles: AssigneeProfile[] = getTaskAssigneeProfiles(task),
): T => {
	const nextIds = normalizeAssigneeIds(ids);
	const profileById = new Map<string, AssigneeProfile>();
	for (const profile of knownProfiles) {
		if (profile?.id && !profileById.has(profile.id)) {
			profileById.set(profile.id, profile);
		}
	}
	const assignees = nextIds
		.map((id) => profileById.get(id))
		.filter((profile): profile is AssigneeProfile => profile !== undefined);
	return {
		...task,
		assignee_ids: nextIds,
		assignee_id: nextIds[0] ?? null,
		assignees,
		assignee: assignees[0],
	};
};

/**
 * Add one person to a task's assignee set (the dock drag-to-assign). Returns
 * null when they are already assigned so callers can skip the write.
 */
export const addTaskAssignee = <T extends TaskAssignmentFields>(
	task: T,
	profile: AssigneeProfile,
): T | null => {
	const currentIds = getTaskAssigneeIds(task);
	if (!profile.id || currentIds.includes(profile.id)) return null;
	return withTaskAssignees(
		task,
		[...currentIds, profile.id],
		[...getTaskAssigneeProfiles(task), profile],
	);
};
