import { useMemo } from "react";
import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";
import type { RoadmapEpic, RoadmapFeature, RoadmapTask } from "@/types/roadmap";
import type { EpicWidgetData } from "../../../../widgets/EpicWidget";
import type { FeatureWidgetData } from "../../../../widgets/FeatureWidget";
import type { RoadmapPerformanceMode } from "../../models/types";
import type { ToolbarItemType } from "../model/toolbar";
import type {
	CanvasNode,
	StructuralEpicNodeData,
	StructuralFeatureNodeData,
	StructuralNodeData,
} from "../model/types";

/** Focus pulse tokens; incrementing the token re-triggers the highlight. */
export interface NodePulseFocus {
	nodeId: string;
	token: number;
}
export interface TaskPulseFocus {
	featureId: string;
	taskId: string;
	token: number;
}

export interface UseCanvasNodeDataArgs {
	/** Positioned nodes from the layout pass. Recomputed only on structural change. */
	layoutedNodes: CanvasNode<StructuralNodeData>[];
	/** Authoritative epics, used to refresh node content without re-laying out. */
	epics: RoadmapEpic[];
	canEditRoadmap: boolean;
	performanceMode: RoadmapPerformanceMode;
	runningTaskId: string | null;
	toolbarDraggingType: ToolbarItemType | null;
	editorsByNodeId: Map<string, CollaboratorInfo[]>;
	pulseNodeFocus: NodePulseFocus | null;
	pulseTaskFocus: TaskPulseFocus | null;
	onUpdateEpic: (epic: RoadmapEpic) => void;
	onDeleteEpic: (epicId: string) => void;
	onDuplicateEpic?: (epicId: string) => void;
	onDeleteFeature: (featureId: string) => void;
	onDuplicateFeature?: (featureId: string) => void;
	onSelectFeature?: (feature: RoadmapFeature) => void;
	onSelectEpic?: (epicId: string) => void;
	onSelectTask?: (
		task: RoadmapTask,
		initialTab?: "details" | "comments",
	) => void;
	onAddEpicBelow?: (epicId: string) => void;
	onAddFeature?: (epicId: string) => void;
	onAddTask?: (featureId: string) => void;
	onEditFeature?: (epicId: string, featureId: string) => void;
	onNavigateToEpic?: (epicId: string) => void;
	onUpdateTask: (task: RoadmapTask) => void;
}

/**
 * Binds layout output to widget props: looks up fresh epic/feature objects,
 * wires the callbacks each card needs, and gates every editing affordance on
 * `canEditRoadmap`.
 *
 * Read-only mode is expressed by passing `undefined` for the mutating callbacks
 * rather than by a flag inside the widgets — so a widget cannot accidentally
 * render an edit control it has no handler for.
 */
export function useCanvasNodeData({
	layoutedNodes,
	epics,
	canEditRoadmap,
	performanceMode,
	runningTaskId,
	toolbarDraggingType,
	editorsByNodeId,
	pulseNodeFocus,
	pulseTaskFocus,
	onUpdateEpic,
	onDeleteEpic,
	onDuplicateEpic,
	onDeleteFeature,
	onDuplicateFeature,
	onSelectFeature,
	onSelectEpic,
	onSelectTask,
	onAddEpicBelow,
	onAddFeature,
	onAddTask,
	onEditFeature,
	onNavigateToEpic,
	onUpdateTask,
}: UseCanvasNodeDataArgs): CanvasNode<EpicWidgetData | FeatureWidgetData>[] {
	return useMemo((): CanvasNode<EpicWidgetData | FeatureWidgetData>[] => {
		// layoutedNodes only recalculates when positions change (layoutKey).
		// For content-only changes (title, status, tasks) we look up fresh
		// epic/feature objects from the current epics array so widgets stay
		// in sync even when the layout didn't need to recompute.
		const epicById = new Map(epics.map((e) => [e.id, e]));
		const featureById = new Map(
			epics.flatMap((e) => e.features ?? []).map((f) => [f.id, f]),
		);

		return layoutedNodes.map((node) => {
			if (node.type === "epicWidget") {
				const epic =
					epicById.get(node.id) ?? (node.data as StructuralEpicNodeData).epic;
				return {
					...node,
					data: {
						epic,
						onClick: onSelectEpic ? () => onSelectEpic(epic.id) : undefined,
						onEdit: canEditRoadmap
							? (updatedEpic) => onUpdateEpic(updatedEpic)
							: undefined,
						onDelete: canEditRoadmap ? onDeleteEpic : undefined,
						onDuplicate: canEditRoadmap ? onDuplicateEpic : undefined,
						onAddEpicBelow: canEditRoadmap ? onAddEpicBelow : undefined,
						onAddFeature: canEditRoadmap ? onAddFeature : undefined,
						onNavigateToTab: onNavigateToEpic,
						pulseToken:
							pulseNodeFocus?.nodeId === epic.id
								? pulseNodeFocus.token
								: undefined,
						toolbarDraggingType,
						performanceMode,
						canEditRoadmap,
						editors: editorsByNodeId.get(epic.id),
					} satisfies EpicWidgetData,
				};
			}

			const feature =
				featureById.get(node.id) ??
				(node.data as StructuralFeatureNodeData).feature;
			return {
				...node,
				data: {
					feature,
					showTaskCount: true,
					onEdit:
						canEditRoadmap && onEditFeature
							? () => onEditFeature(feature.epic_id, feature.id)
							: undefined,
					onDelete: canEditRoadmap ? onDeleteFeature : undefined,
					onDuplicate: canEditRoadmap ? onDuplicateFeature : undefined,
					onClick: onSelectFeature,
					onAddTask: canEditRoadmap ? onAddTask : undefined,
					onSelectTask,
					onUpdateTask: canEditRoadmap ? onUpdateTask : undefined,
					runningTaskId,
					pulseTaskId:
						pulseTaskFocus?.featureId === feature.id
							? pulseTaskFocus.taskId
							: null,
					pulseTaskToken:
						pulseTaskFocus?.featureId === feature.id
							? pulseTaskFocus.token
							: undefined,
					pulseToken:
						pulseNodeFocus?.nodeId === feature.id
							? pulseNodeFocus.token
							: undefined,
					toolbarDraggingType,
					performanceMode,
					canEditRoadmap,
					editors: editorsByNodeId.get(feature.id),
					// Same node-id→editors map; the task list looks up its own task ids.
					taskEditorsByNodeId: editorsByNodeId,
				} satisfies FeatureWidgetData,
			};
		});
	}, [
		layoutedNodes,
		epics,
		onAddEpicBelow,
		onAddFeature,
		onAddTask,
		onDeleteEpic,
		onDuplicateEpic,
		onDeleteFeature,
		onDuplicateFeature,
		onEditFeature,
		onNavigateToEpic,
		onSelectEpic,
		onSelectFeature,
		onSelectTask,
		onUpdateEpic,
		onUpdateTask,
		performanceMode,
		pulseNodeFocus,
		pulseTaskFocus,
		toolbarDraggingType,
		canEditRoadmap,
		runningTaskId,
		editorsByNodeId,
	]);
}
