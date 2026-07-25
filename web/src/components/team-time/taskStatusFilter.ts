/**
 * Task kanban statuses used to filter time logs by their underlying task's
 * status. Mirrors the backend `TASK_KANBAN_STATUSES` (the `task_status` enum)
 * so the two stay in lockstep.
 */
export const TASK_STATUS_FILTER_OPTIONS: Array<{
	value: string;
	label: string;
}> = [
	{ value: "", label: "All task statuses" },
	{ value: "todo", label: "To do" },
	{ value: "in_progress", label: "In progress" },
	{ value: "in_review", label: "In review" },
	{ value: "done", label: "Done" },
	{ value: "blocked", label: "Blocked" },
];
