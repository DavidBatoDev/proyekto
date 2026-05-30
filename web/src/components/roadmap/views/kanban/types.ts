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
	id: TaskStatus;
	label: string;
	accent: string;
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
	{ id: "todo", label: "To do", accent: "bg-gray-400" },
	{ id: "in_progress", label: "In progress", accent: "bg-blue-500" },
	{ id: "in_review", label: "In review", accent: "bg-amber-500" },
	{ id: "done", label: "Done", accent: "bg-emerald-500" },
	{ id: "blocked", label: "Blocked", accent: "bg-red-500" },
];
