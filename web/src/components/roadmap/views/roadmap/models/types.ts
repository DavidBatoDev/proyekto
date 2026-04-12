import type {
	FeatureStatus,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
	RoadmapTask,
} from "@/types/roadmap";

export interface RoadmapCanvasControllerProps {
	roadmap?: Roadmap | null;
	milestones?: RoadmapMilestone[];
	onAddMilestone?: (data: {
		title: string;
		target_date: string;
		description?: string;
		status?: RoadmapMilestone["status"];
		color?: string;
	}) => void | Promise<void>;
	epics?: RoadmapEpic[];
	onUpdateMilestone?: (milestone: RoadmapMilestone) => void | Promise<void>;
	onDeleteMilestone?: (id: string) => void | Promise<void>;
	onAddEpic?: (
		milestoneId?: string,
		epicInput?: Partial<RoadmapEpic>,
	) => void | Promise<void>;
	onUpdateEpic?: (epic: RoadmapEpic) => void | Promise<void>;
	onDeleteEpic?: (epicId: string) => void | Promise<void>;
	onAddFeature?: (
		epicId: string,
		data: {
			title: string;
			description: string;
			status: FeatureStatus;
			is_deliverable: boolean;
		},
	) => void | Promise<void>;
	onUpdateFeature?: (feature: RoadmapFeature) => void | Promise<void>;
	onDeleteFeature?: (featureId: string) => void | Promise<void>;
	onAddTask?: (
		featureId: string,
		taskData: Partial<RoadmapTask>,
	) => void | Promise<void>;
	onUpdateTask?: (task: RoadmapTask) => void | Promise<void>;
	onDeleteTask?: (taskId: string) => void | Promise<void>;
	focusNodeId?: string | null;
	focusNodeOffsetX?: number;
	focusTaskId?: string | null;
	onFocusComplete?: () => void;
	navigateToEpicId?: string | null;
	onNavigateToEpicHandled?: () => void;
	navigateToFeature?: { epicId: string; featureId: string } | null;
	onNavigateToFeatureHandled?: () => void;
	openEpicEditorId?: string | null;
	onOpenEpicEditorHandled?: () => void;
	openFeatureEditor?: { epicId: string; featureId: string } | null;
	onOpenFeatureEditorHandled?: () => void;
	openTaskDetailId?: string | null;
	onOpenTaskDetailHandled?: () => void;
	onActiveEpicChange?: (epicId: string | null) => void;
	onNodeOpen?: (nodeId: string) => void;
}

export interface RoadmapCanvasProps extends RoadmapCanvasControllerProps {
	projectTitle?: string;
	onUpdateRoadmap?: (roadmap: Roadmap) => void | Promise<void>;
	onShare?: () => void;
	onExport?: () => void;
	canEditTimelineDates?: boolean;
	hideMiniMap?: boolean;
}

export type UseRoadmapCanvasControllerArgs = RoadmapCanvasControllerProps;
