import type {
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
	RoadmapTask,
	TaskStatus,
} from "@/types/roadmap";

export interface KanbanTaskContext {
	task: RoadmapTask;
	feature: RoadmapFeature;
	epic: RoadmapEpic;
	milestone: RoadmapMilestone | null;
	project?: { id: string; title: string } | null;
	roadmapId?: string;
}

export interface KanbanColumnDef {
	id: string;
	label: string;
	accent: string;
	bucketStatus: TaskStatus;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumnDef[] = [
	{
		id: "todo",
		label: "To do",
		accent: "bg-gray-400",
		bucketStatus: "todo",
	},
	{
		id: "in_progress",
		label: "In progress",
		accent: "bg-blue-500",
		bucketStatus: "in_progress",
	},
	{
		id: "in_review",
		label: "In review",
		accent: "bg-amber-500",
		bucketStatus: "in_review",
	},
	{ id: "done", label: "Done", accent: "bg-emerald-500", bucketStatus: "done" },
	{
		id: "blocked",
		label: "Blocked",
		accent: "bg-red-500",
		bucketStatus: "blocked",
	},
];
