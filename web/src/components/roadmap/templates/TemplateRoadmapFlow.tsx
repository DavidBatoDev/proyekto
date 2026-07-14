import { useMemo } from "react";
import type {
	EpicPriority,
	Roadmap,
	RoadmapEpic,
	TaskPriority,
} from "@/types/roadmap";
import type { RoadmapTemplateVersionContent } from "@/types/roadmap-template";
import { RoadmapView } from "../views/roadmap/RoadmapView";

const CREATED_AT = "1970-01-01T00:00:00.000Z";
const EPIC_PRIORITIES = new Set<EpicPriority>([
	"critical",
	"high",
	"medium",
	"low",
	"nice_to_have",
]);
const TASK_PRIORITIES = new Set<TaskPriority>([
	"urgent",
	"high",
	"medium",
	"low",
]);

const addDays = (startDate: string, offset: number) => {
	const [year, month, day] = startDate.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + offset));
	return date.toISOString().slice(0, 10);
};

const toEpicPriority = (priority: string): EpicPriority =>
	EPIC_PRIORITIES.has(priority as EpicPriority)
		? (priority as EpicPriority)
		: "medium";

const toTaskPriority = (priority: string): TaskPriority =>
	TASK_PRIORITIES.has(priority as TaskPriority)
		? (priority as TaskPriority)
		: "medium";

export function buildTemplateRoadmapPreview(
	templateId: string,
	content: RoadmapTemplateVersionContent,
	startDate: string,
): { roadmap: Roadmap; epics: RoadmapEpic[] } {
	const roadmapId = `template-${templateId}`;
	const roadmap: Roadmap = {
		id: roadmapId,
		project_id: null,
		name: content.roadmap.name,
		description: content.roadmap.description,
		owner_id: "template-marketplace",
		status: "draft",
		start_date: addDays(startDate, content.roadmap.start_day_offset),
		end_date: addDays(startDate, content.roadmap.end_day_offset),
		created_at: CREATED_AT,
		updated_at: CREATED_AT,
		currentUserRole: "viewer",
	};

	const epics: RoadmapEpic[] = content.epics.map((epic, epicIndex) => {
		const epicId = `${roadmapId}-epic-${epic.key}`;
		return {
			id: epicId,
			roadmap_id: roadmapId,
			title: `${epic.time_label} ${epic.title}`,
			description: epic.description,
			priority: toEpicPriority(epic.priority),
			status: "backlog",
			position: (epicIndex + 1) * 1000,
			start_date: addDays(startDate, epic.start_day_offset),
			end_date: addDays(startDate, epic.end_day_offset),
			tags: epic.tags,
			progress: 0,
			created_at: CREATED_AT,
			updated_at: CREATED_AT,
			features: epic.features.map((feature, featureIndex) => {
				const featureId = `${roadmapId}-feature-${feature.key}`;
				return {
					id: featureId,
					roadmap_id: roadmapId,
					epic_id: epicId,
					title: `${feature.time_label} ${feature.title}`,
					description: feature.description,
					position: (featureIndex + 1) * 1000,
					is_deliverable: feature.is_deliverable,
					start_date: addDays(startDate, feature.start_day_offset),
					end_date: addDays(startDate, feature.end_day_offset),
					progress: 0,
					created_at: CREATED_AT,
					updated_at: CREATED_AT,
					tasks: feature.tasks.map((task, taskIndex) => ({
						id: `${roadmapId}-task-${task.key}`,
						feature_id: featureId,
						title: task.title,
						description: task.description,
						status: "todo" as const,
						priority: toTaskPriority(task.priority),
						position: (taskIndex + 1) * 1000,
						due_date:
							task.due_day_offset === undefined
								? undefined
								: addDays(startDate, task.due_day_offset),
						work_type: task.work_type,
						checklist: task.checklist,
						created_at: CREATED_AT,
						updated_at: CREATED_AT,
					})),
				};
			}),
		};
	});

	return { roadmap, epics };
}

type TemplateRoadmapFlowProps = {
	templateId: string;
	content: RoadmapTemplateVersionContent;
	startDate: string;
};

const ignoreUpdate = () => undefined;

export function TemplateRoadmapFlow({
	templateId,
	content,
	startDate,
}: TemplateRoadmapFlowProps) {
	const preview = useMemo(
		() => buildTemplateRoadmapPreview(templateId, content, startDate),
		[content, startDate, templateId],
	);

	return (
		<section
			aria-label="Interactive roadmap template preview"
			className="h-[680px] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-(--app-shadow-sm) sm:h-[760px] lg:h-[820px]"
			data-testid="template-roadmap-flow"
		>
			<RoadmapView
				roadmap={preview.roadmap}
				epics={preview.epics}
				minZoom={0.2}
				readOnly
				fitView
				performanceMode="reducedMotion"
				onUpdateEpic={ignoreUpdate}
				onDeleteEpic={ignoreUpdate}
				onUpdateFeature={ignoreUpdate}
				onDeleteFeature={ignoreUpdate}
				onUpdateTask={ignoreUpdate}
			/>
		</section>
	);
}
