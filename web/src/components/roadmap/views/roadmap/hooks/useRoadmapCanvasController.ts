import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { type CanvasViewMode, useRoadmapStore } from "@/stores/roadmapStore";
import type { EpicPriority, RoadmapTask } from "@/types/roadmap";
import type { UseRoadmapCanvasControllerArgs } from "../models/types";

/** @deprecated Use CanvasViewMode from roadmapStore instead */
export type ViewMode = CanvasViewMode;
const TASK_NAVIGATE_OFFSET_X = 620;

const getErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error) || error.message.trim().length === 0) {
		return fallback;
	}

	const message = error.message.toLowerCase();

	if (
		message.includes("missing permission") ||
		message.includes("forbidden") ||
		message.includes("do not have permission")
	) {
		return "You do not have permission to edit this roadmap item.";
	}

	if (
		message.includes("not a member of this project") ||
		message.includes("not part of this project")
	) {
		return "You do not have access to this project.";
	}

	if (message.includes("not found") || message.includes("no longer exists")) {
		return "This roadmap item could not be found. It may have been removed.";
	}

	return fallback;
};

export function useRoadmapCanvasController({
	roadmap: roadmapProp,
	milestones: milestonesProp,
	onAddMilestone: onAddMilestoneProp,
	epics: epicsProp,
	onUpdateMilestone: onUpdateMilestoneProp,
	onDeleteMilestone: onDeleteMilestoneProp,
	onAddEpic: onAddEpicProp,
	onUpdateEpic: onUpdateEpicProp,
	onDeleteEpic: onDeleteEpicProp,
	onAddFeature: onAddFeatureProp,
	onUpdateFeature: onUpdateFeatureProp,
	onDeleteFeature: onDeleteFeatureProp,
	onAddTask: onAddTaskProp,
	onUpdateTask: onUpdateTaskProp,
	onDeleteTask: onDeleteTaskProp,
	focusNodeId: focusNodeIdProp,
	focusNodeOffsetX: focusNodeOffsetXProp,
	focusTaskId: focusTaskIdProp,
	onFocusComplete: onFocusCompleteProp,
	navigateToEpicId: navigateToEpicIdProp,
	onNavigateToEpicHandled: onNavigateToEpicHandledProp,
	navigateToFeature: navigateToFeatureProp,
	onNavigateToFeatureHandled: onNavigateToFeatureHandledProp,
	openEpicEditorId: openEpicEditorIdProp,
	onOpenEpicEditorHandled: onOpenEpicEditorHandledProp,
	openFeatureEditor: openFeatureEditorProp,
	onOpenFeatureEditorHandled: onOpenFeatureEditorHandledProp,
	openTaskDetailId: openTaskDetailIdProp,
	onOpenTaskDetailHandled: onOpenTaskDetailHandledProp,
	onActiveEpicChange,
	onNodeOpen,
	onNodeClose,
}: UseRoadmapCanvasControllerArgs) {
	const toast = useToast();

	const storeRoadmap = useRoadmapStore((state) => state.roadmap);
	const storeMilestones = useRoadmapStore((state) => state.milestones);
	const storeEpics = useRoadmapStore((state) => state.epics);
	const storeAddMilestone = useRoadmapStore((state) => state.addMilestone);
	const storeUpdateMilestone = useRoadmapStore(
		(state) => state.updateMilestone,
	);
	const storeDeleteMilestone = useRoadmapStore(
		(state) => state.deleteMilestone,
	);
	const storeAddEpic = useRoadmapStore((state) => state.addEpic);
	const storeUpdateEpic = useRoadmapStore((state) => state.updateEpic);
	const storeDeleteEpic = useRoadmapStore((state) => state.deleteEpic);
	const storeAddFeature = useRoadmapStore((state) => state.addFeature);
	const storeUpdateFeature = useRoadmapStore((state) => state.updateFeature);
	const storeDeleteFeature = useRoadmapStore((state) => state.deleteFeature);
	const storeAddTask = useRoadmapStore((state) => state.addTask);
	const storeUpdateTask = useRoadmapStore((state) => state.updateTask);
	const storeUpdateTaskStatusIntent = useRoadmapStore(
		(state) => state.updateTaskStatusIntent,
	);
	const storeDeleteTask = useRoadmapStore((state) => state.deleteTask);
	const tempToRealNodeId = useRoadmapStore((state) => state.tempToRealNodeId);
	const storeIsOptimisticNodeId = useRoadmapStore(
		(state) => state.isOptimisticNodeId,
	);
	const storeResolveCanonicalNodeId = useRoadmapStore(
		(state) => state.resolveCanonicalNodeId,
	);
	const storeFocusNodeId = useRoadmapStore((state) => state.focusNodeId);
	const storeFocusNodeOffsetX = useRoadmapStore(
		(state) => state.focusNodeOffsetX,
	);
	const storeFocusTaskId = useRoadmapStore((state) => state.focusTaskId);
	const storeNavigateToEpicId = useRoadmapStore(
		(state) => state.navigateToEpicId,
	);
	const storeNavigateToNode = useRoadmapStore((state) => state.navigateToNode);
	const storeNavigateToFeature = useRoadmapStore(
		(state) => state.navigateToFeature,
	);
	const storeOpenEpicEditorId = useRoadmapStore(
		(state) => state.openEpicEditorId,
	);
	const storeOpenFeatureEditor = useRoadmapStore(
		(state) => state.openFeatureEditor,
	);
	const storeOpenTaskDetailId = useRoadmapStore(
		(state) => state.openTaskDetailId,
	);
	const storeClearNodeFocus = useRoadmapStore((state) => state.clearNodeFocus);
	const storeClearNavigateToEpicTab = useRoadmapStore(
		(state) => state.clearNavigateToEpicTab,
	);
	const storeClearNavigateToFeatureNode = useRoadmapStore(
		(state) => state.clearNavigateToFeatureNode,
	);
	const storeClearOpenEpicEditor = useRoadmapStore(
		(state) => state.clearOpenEpicEditor,
	);
	const storeClearOpenFeatureEditor = useRoadmapStore(
		(state) => state.clearOpenFeatureEditorModal,
	);
	const storeClearOpenTaskDetail = useRoadmapStore(
		(state) => state.clearOpenTaskDetail,
	);
	const storeSetActiveEpicId = useRoadmapStore(
		(state) => state.setActiveEpicId,
	);

	// Canvas view-mode — sourced from store so RoadmapTopBar / RoadmapViewContent can react
	const viewMode = useRoadmapStore((state) => state.canvasViewMode);
	const selectedEpic = useRoadmapStore((state) => state.canvasSelectedEpicId);
	const openEpicTabs = useRoadmapStore((state) => state.canvasOpenEpicTabs);
	const setViewMode = useRoadmapStore((state) => state.setCanvasViewMode);
	const setSelectedEpic = useRoadmapStore(
		(state) => state.setCanvasSelectedEpicId,
	);
	const setOpenEpicTabs = useRoadmapStore(
		(state) => state.setCanvasOpenEpicTabs,
	);
	const closeCanvasEpicTab = useRoadmapStore(
		(state) => state.closeCanvasEpicTab,
	);

	const addFeatureEpicId = useRoadmapStore((state) => state.addFeatureEpicId);
	const addTaskFeatureId = useRoadmapStore((state) => state.addTaskFeatureId);
	const closeAddFeatureModal = useRoadmapStore(
		(state) => state.closeAddFeatureModal,
	);
	const closeAddTaskPanel = useRoadmapStore((state) => state.closeAddTaskPanel);

	const roadmap = roadmapProp ?? storeRoadmap;
	const milestones = milestonesProp ?? storeMilestones;
	const epics = epicsProp ?? storeEpics;
	const onAddMilestoneBase = onAddMilestoneProp ?? storeAddMilestone;
	const onUpdateMilestone = onUpdateMilestoneProp ?? storeUpdateMilestone;
	const onDeleteMilestone = onDeleteMilestoneProp ?? storeDeleteMilestone;
	const onAddEpic = onAddEpicProp ?? storeAddEpic;
	const onUpdateEpicBase = onUpdateEpicProp ?? storeUpdateEpic;
	const onDeleteEpic = onDeleteEpicProp ?? storeDeleteEpic;
	const onAddFeature = onAddFeatureProp ?? storeAddFeature;
	const onUpdateFeatureBase = onUpdateFeatureProp ?? storeUpdateFeature;
	const onDeleteFeature = onDeleteFeatureProp ?? storeDeleteFeature;
	const onAddTask = onAddTaskProp ?? storeAddTask;
	const onUpdateTaskBase = onUpdateTaskProp ?? storeUpdateTask;
	const onDeleteTask = onDeleteTaskProp ?? storeDeleteTask;
	const focusNodeId = focusNodeIdProp ?? storeFocusNodeId;
	const focusNodeOffsetX = focusNodeOffsetXProp ?? storeFocusNodeOffsetX;
	const focusTaskId = focusTaskIdProp ?? storeFocusTaskId;
	const navigateToEpicId = navigateToEpicIdProp ?? storeNavigateToEpicId;
	const navigateToFeature = navigateToFeatureProp ?? storeNavigateToFeature;
	const openEpicEditorId = openEpicEditorIdProp ?? storeOpenEpicEditorId;
	const openFeatureEditor = openFeatureEditorProp ?? storeOpenFeatureEditor;
	const openTaskDetailId = openTaskDetailIdProp ?? storeOpenTaskDetailId;
	const onFocusComplete = onFocusCompleteProp ?? storeClearNodeFocus;
	const onNavigateToEpicHandled =
		onNavigateToEpicHandledProp ?? storeClearNavigateToEpicTab;
	const onNavigateToFeatureHandled =
		onNavigateToFeatureHandledProp ?? storeClearNavigateToFeatureNode;
	const onOpenEpicEditorHandled =
		onOpenEpicEditorHandledProp ?? storeClearOpenEpicEditor;
	const onOpenFeatureEditorHandled =
		onOpenFeatureEditorHandledProp ?? storeClearOpenFeatureEditor;
	const onOpenTaskDetailHandled =
		onOpenTaskDetailHandledProp ?? storeClearOpenTaskDetail;
	const onActiveEpicChangeResolved = onActiveEpicChange ?? storeSetActiveEpicId;

	const { epicById, featureById, taskById } = useMemo(() => {
		const nextEpicById = new Map<string, (typeof epics)[number]>();
		const nextFeatureById = new Map<
			string,
			{
				feature: NonNullable<(typeof epics)[number]["features"]>[number];
				epicId: string;
			}
		>();
		const nextTaskById = new Map<
			string,
			{ task: RoadmapTask; featureId: string; epicId: string }
		>();

		for (const epic of epics) {
			nextEpicById.set(epic.id, epic);
			for (const feature of epic.features || []) {
				nextFeatureById.set(feature.id, { feature, epicId: epic.id });
				for (const task of feature.tasks || []) {
					nextTaskById.set(task.id, {
						task,
						featureId: feature.id,
						epicId: epic.id,
					});
				}
			}
		}

		return {
			epicById: nextEpicById,
			featureById: nextFeatureById,
			taskById: nextTaskById,
		};
	}, [epics]);

	const onUpdateEpic = useCallback(
		async (...args: Parameters<typeof onUpdateEpicBase>) => {
			try {
				toast.success("Epic updated");
				await onUpdateEpicBase(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to update epic"));
				throw error;
			}
		},
		[onUpdateEpicBase, toast],
	);

	const onAddEpicWithToast = useCallback(
		async (...args: Parameters<typeof onAddEpic>) => {
			try {
				toast.success("Epic created");
				await onAddEpic(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to create epic"));
				throw error;
			}
		},
		[onAddEpic, toast],
	);

	const onUpdateFeature = useCallback(
		async (...args: Parameters<typeof onUpdateFeatureBase>) => {
			try {
				toast.success("Feature updated");
				await onUpdateFeatureBase(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to update feature"));
				throw error;
			}
		},
		[onUpdateFeatureBase, toast],
	);

	const onAddFeatureWithToast = useCallback(
		async (
			epicId: Parameters<typeof onAddFeature>[0],
			data: Parameters<typeof onAddFeature>[1],
		) => {
			try {
				toast.success("Feature created");
				await onAddFeature(epicId, data);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to create feature"));
				throw error;
			}
		},
		[onAddFeature, toast],
	);

	const stripTaskStatus = useCallback((task: RoadmapTask) => {
		const nextTask = { ...task };
		delete (nextTask as Partial<RoadmapTask>).status;
		return nextTask;
	}, []);

	const isStatusOnlyTaskUpdate = useCallback(
		(nextTask: RoadmapTask): boolean => {
			if (onUpdateTaskProp) return false;

			const currentTask = taskById.get(nextTask.id)?.task;
			if (!currentTask) return false;
			if (currentTask.status === nextTask.status) return false;

			const currentWithoutStatus = stripTaskStatus(currentTask);
			const nextWithoutStatus = stripTaskStatus(nextTask);
			return (
				JSON.stringify(currentWithoutStatus) ===
				JSON.stringify(nextWithoutStatus)
			);
		},
		[onUpdateTaskProp, stripTaskStatus, taskById],
	);

	const onUpdateTask = useCallback(
		async (...args: Parameters<typeof onUpdateTaskBase>) => {
			const [nextTask] = args;
			if (nextTask && isStatusOnlyTaskUpdate(nextTask)) {
				try {
					await storeUpdateTaskStatusIntent(nextTask.id, nextTask.status);
				} catch (error) {
					toast.error(getErrorMessage(error, "Failed to update task"));
					throw error;
				}
				return;
			}

			try {
				await onUpdateTaskBase(...args);
				toast.success("Task updated");
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to update task"));
				throw error;
			}
		},
		[
			isStatusOnlyTaskUpdate,
			onUpdateTaskBase,
			storeUpdateTaskStatusIntent,
			toast,
		],
	);

	const onAddMilestone = useCallback(
		async (...args: Parameters<typeof onAddMilestoneBase>) => {
			try {
				toast.success("Milestone created");
				await onAddMilestoneBase(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to create milestone"));
				throw error;
			}
		},
		[onAddMilestoneBase, toast],
	);

	const onUpdateMilestoneWithToast = useCallback(
		async (...args: Parameters<typeof onUpdateMilestone>) => {
			try {
				toast.success("Milestone updated");
				await onUpdateMilestone(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to update milestone"));
				throw error;
			}
		},
		[onUpdateMilestone, toast],
	);

	const onDeleteMilestoneWithToast = useCallback(
		async (...args: Parameters<typeof onDeleteMilestone>) => {
			try {
				toast.success("Milestone deleted");
				await onDeleteMilestone(...args);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to delete milestone"));
				throw error;
			}
		},
		[onDeleteMilestone, toast],
	);

	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [sidePanelOpen, setSidePanelOpen] = useState(false);
	const [targetFeatureForTask, setTargetFeatureForTask] = useState<
		string | null
	>(null);
	const [isAddEpicModalOpen, setIsAddEpicModalOpen] = useState(false);
	const [isEditEpicModalOpen, setIsEditEpicModalOpen] = useState(false);
	const [editingEpicId, setEditingEpicId] = useState<string | null>(null);
	const [targetEpicForAddBelow, setTargetEpicForAddBelow] = useState<
		string | null
	>(null);
	const [isAddFeatureModalOpen, setIsAddFeatureModalOpen] = useState(false);
	const [targetEpicForFeature, setTargetEpicForFeature] = useState<
		string | null
	>(null);
	const [isEditFeatureModalOpen, setIsEditFeatureModalOpen] = useState(false);
	const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
	const [editingFeatureEpicId, setEditingFeatureEpicId] = useState<
		string | null
	>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<{
		type: "epic" | "feature";
		id: string;
		label: string;
	} | null>(null);
	const [scrollToFeatureId, setScrollToFeatureId] = useState<string | null>(
		null,
	);

	const [isEpicLoading, setIsEpicLoading] = useState(false);
	const [isFeatureLoading, setIsFeatureLoading] = useState(false);
	const [isTaskLoading, setIsTaskLoading] = useState(false);
	const hasNotifiedOpenNodeRef = useRef(false);

	useEffect(() => {
		if (!navigateToEpicId) {
			return;
		}

		const epicExists = epicById.has(navigateToEpicId);
		if (!epicExists) {
			onNavigateToEpicHandled?.();
			return;
		}

		setSelectedEpic(navigateToEpicId);
		setViewMode("epic");
		setOpenEpicTabs((prevTabs) =>
			prevTabs.includes(navigateToEpicId)
				? prevTabs
				: [...prevTabs, navigateToEpicId],
		);
		onNavigateToEpicHandled?.();
	}, [
		epicById,
		navigateToEpicId,
		onNavigateToEpicHandled,
		setOpenEpicTabs,
		setSelectedEpic,
		setViewMode,
	]);

	useEffect(() => {
		if (!navigateToFeature) {
			return;
		}

		const targetEpic = epicById.get(navigateToFeature.epicId);
		if (!targetEpic) {
			onNavigateToFeatureHandled?.();
			return;
		}

		setSelectedEpic(navigateToFeature.epicId);
		setViewMode("epic");
		setOpenEpicTabs((prevTabs) =>
			prevTabs.includes(navigateToFeature.epicId)
				? prevTabs
				: [...prevTabs, navigateToFeature.epicId],
		);
		setScrollToFeatureId(navigateToFeature.featureId);
	}, [
		epicById,
		navigateToFeature,
		onNavigateToFeatureHandled,
		setOpenEpicTabs,
		setSelectedEpic,
		setViewMode,
	]);

	useEffect(() => {
		onActiveEpicChangeResolved(viewMode === "epic" ? selectedEpic : null);
	}, [onActiveEpicChangeResolved, selectedEpic, viewMode]);

	const activeDetailNodeId = useMemo(() => {
		if (isEditEpicModalOpen && editingEpicId) return editingEpicId;
		if (isEditFeatureModalOpen && editingFeatureId) return editingFeatureId;
		if (sidePanelOpen && selectedTaskId) return selectedTaskId;
		return null;
	}, [
		editingEpicId,
		editingFeatureId,
		isEditEpicModalOpen,
		isEditFeatureModalOpen,
		selectedTaskId,
		sidePanelOpen,
	]);

	const canonicalActiveDetailNodeId = useMemo(
		() => storeResolveCanonicalNodeId(activeDetailNodeId),
		[activeDetailNodeId, storeResolveCanonicalNodeId],
	);

	useEffect(() => {
		const shouldNotifyOpen =
			canonicalActiveDetailNodeId &&
			!storeIsOptimisticNodeId(canonicalActiveDetailNodeId);

		if (shouldNotifyOpen) {
			if (sidePanelOpen && selectedTaskId && viewMode === "roadmap") {
				const taskMeta = taskById.get(selectedTaskId);
				if (taskMeta) {
					storeNavigateToNode(taskMeta.featureId, {
						offsetX: TASK_NAVIGATE_OFFSET_X,
						taskId: selectedTaskId,
					});
				}
			}

			hasNotifiedOpenNodeRef.current = true;
			onNodeOpen?.(canonicalActiveDetailNodeId);
			return;
		}

		if (!hasNotifiedOpenNodeRef.current) {
			return;
		}

		hasNotifiedOpenNodeRef.current = false;
		onNodeClose?.();
	}, [
		canonicalActiveDetailNodeId,
		onNodeClose,
		onNodeOpen,
		selectedTaskId,
		sidePanelOpen,
		storeIsOptimisticNodeId,
		storeNavigateToNode,
		taskById,
		viewMode,
	]);

	const handleCloseEpicTab = useCallback(
		(epicId: string) => {
			closeCanvasEpicTab(epicId);
		},
		[closeCanvasEpicTab],
	);

	const handleCreateEpic = useCallback(
		async (data: {
			title: string;
			description: string;
			priority: EpicPriority;
			tags: string[];
			start_date?: string;
			end_date?: string;
		}) => {
			let position = epics.length;
			if (targetEpicForAddBelow) {
				const targetEpic = epicById.get(targetEpicForAddBelow);
				if (targetEpic) {
					position = targetEpic.position + 1;
				}
			}

			setIsAddEpicModalOpen(false);
			setTargetEpicForAddBelow(null);

			void onAddEpicWithToast(undefined, {
				title: data.title,
				description: data.description,
				priority: data.priority,
				tags: data.tags,
				status: "backlog",
				position,
				start_date: data.start_date,
				end_date: data.end_date,
			}).catch(() => undefined);
		},
		[epicById, epics.length, onAddEpicWithToast, targetEpicForAddBelow],
	);

	const handleAddEpicBelow = useCallback((epicId: string) => {
		setTargetEpicForAddBelow(epicId);
		setIsAddEpicModalOpen(true);
	}, []);

	const handleOpenAddFeatureModal = useCallback((epicId: string) => {
		setTargetEpicForFeature(epicId);
		setIsAddFeatureModalOpen(true);
	}, []);

	const handleOpenEditEpicModal = useCallback((epicId: string) => {
		setEditingEpicId(epicId);
		setIsEditEpicModalOpen(true);
	}, []);

	const handleUpdateEpicFromModal = useCallback(
		async (data: {
			title: string;
			description: string;
			priority: EpicPriority;
			tags: string[];
			start_date?: string;
			end_date?: string;
		}) => {
			if (!editingEpicId) return;
			const epic = epicById.get(editingEpicId);
			if (!epic) return;

			setIsEditEpicModalOpen(false);
			setEditingEpicId(null);
			setIsEpicLoading(true);

			void onUpdateEpic({
				...epic,
				title: data.title,
				description: data.description,
				priority: data.priority,
				tags: data.tags,
				start_date: data.start_date,
				end_date: data.end_date,
				updated_at: new Date().toISOString(),
			})
				.catch(() => undefined)
				.finally(() => setIsEpicLoading(false));
		},
		[editingEpicId, epicById, onUpdateEpic],
	);

	const handleCreateFeature = useCallback(
		async (data: {
			title: string;
			description: string;
			is_deliverable: boolean;
			start_date?: string;
			end_date?: string;
			assignee_ids?: string[];
		}) => {
			if (!targetEpicForFeature) return;

			const epicId = targetEpicForFeature;
			setIsAddFeatureModalOpen(false);
			setTargetEpicForFeature(null);

			void onAddFeatureWithToast(epicId, data).catch(() => undefined);
		},
		[onAddFeatureWithToast, targetEpicForFeature],
	);

	const handleOpenEditFeatureModal = useCallback(
		(epicId: string, featureId: string) => {
			setEditingFeatureEpicId(epicId);
			setEditingFeatureId(featureId);
			setIsEditFeatureModalOpen(true);
		},
		[],
	);

	useEffect(() => {
		if (!openEpicEditorId) {
			return;
		}

		const resolvedEpicId =
			storeResolveCanonicalNodeId(openEpicEditorId) ?? openEpicEditorId;
		const epicExists = epicById.has(resolvedEpicId);
		if (epicExists) {
			handleOpenEditEpicModal(resolvedEpicId);
		}
		onOpenEpicEditorHandled?.();
	}, [
		epicById,
		handleOpenEditEpicModal,
		onOpenEpicEditorHandled,
		openEpicEditorId,
		storeResolveCanonicalNodeId,
	]);

	useEffect(() => {
		if (!openFeatureEditor) {
			return;
		}

		const resolvedFeatureId =
			storeResolveCanonicalNodeId(openFeatureEditor.featureId) ??
			openFeatureEditor.featureId;
		const resolvedEpicId =
			storeResolveCanonicalNodeId(openFeatureEditor.epicId) ??
			openFeatureEditor.epicId;
		const featureMeta = featureById.get(resolvedFeatureId);
		if (featureMeta && featureMeta.epicId === resolvedEpicId) {
			handleOpenEditFeatureModal(resolvedEpicId, resolvedFeatureId);
		}
		onOpenFeatureEditorHandled?.();
	}, [
		featureById,
		handleOpenEditFeatureModal,
		onOpenFeatureEditorHandled,
		openFeatureEditor,
		storeResolveCanonicalNodeId,
	]);

	useEffect(() => {
		if (!openTaskDetailId) {
			return;
		}

		const resolvedTaskId =
			storeResolveCanonicalNodeId(openTaskDetailId) ?? openTaskDetailId;

		const taskExists = taskById.has(resolvedTaskId);

		if (taskExists) {
			setSelectedTaskId(resolvedTaskId);
			setTargetFeatureForTask(null);
			setSidePanelOpen(true);
		}
		onOpenTaskDetailHandled?.();
	}, [
		onOpenTaskDetailHandled,
		openTaskDetailId,
		storeResolveCanonicalNodeId,
		taskById,
	]);

	useEffect(() => {
		if (!editingEpicId || !isEditEpicModalOpen) return;

		const canonicalEpicId = storeResolveCanonicalNodeId(editingEpicId);
		if (canonicalEpicId && canonicalEpicId !== editingEpicId) {
			setEditingEpicId(canonicalEpicId);
			return;
		}

		if (epicById.has(editingEpicId)) return;

		const mappedRealId = tempToRealNodeId[editingEpicId];
		if (mappedRealId && epicById.has(mappedRealId)) {
			setEditingEpicId(mappedRealId);
			return;
		}

		if (!storeIsOptimisticNodeId(editingEpicId)) return;

		setIsEditEpicModalOpen(false);
		setEditingEpicId(null);
		setScrollToFeatureId(null);
		if (selectedEpic === editingEpicId) {
			setSelectedEpic(null);
		}
		storeClearNodeFocus();
	}, [
		editingEpicId,
		epicById,
		isEditEpicModalOpen,
		selectedEpic,
		setSelectedEpic,
		storeClearNodeFocus,
		storeIsOptimisticNodeId,
		storeResolveCanonicalNodeId,
		tempToRealNodeId,
	]);

	useEffect(() => {
		if (!editingFeatureId || !isEditFeatureModalOpen) return;

		const canonicalFeatureId = storeResolveCanonicalNodeId(editingFeatureId);
		if (canonicalFeatureId && canonicalFeatureId !== editingFeatureId) {
			setEditingFeatureId(canonicalFeatureId);
			return;
		}

		const currentFeatureMeta = featureById.get(editingFeatureId);
		if (currentFeatureMeta) {
			if (editingFeatureEpicId !== currentFeatureMeta.epicId) {
				setEditingFeatureEpicId(currentFeatureMeta.epicId);
			}
			return;
		}

		const mappedRealId = tempToRealNodeId[editingFeatureId];
		const mappedFeatureMeta = mappedRealId
			? featureById.get(mappedRealId)
			: undefined;
		if (mappedRealId && mappedFeatureMeta) {
			setEditingFeatureId(mappedRealId);
			setEditingFeatureEpicId(mappedFeatureMeta.epicId);
			return;
		}

		if (!storeIsOptimisticNodeId(editingFeatureId)) return;

		setIsEditFeatureModalOpen(false);
		setEditingFeatureId(null);
		setEditingFeatureEpicId(null);
		setScrollToFeatureId(null);
		storeClearNodeFocus();
	}, [
		editingFeatureEpicId,
		editingFeatureId,
		featureById,
		isEditFeatureModalOpen,
		storeClearNodeFocus,
		storeIsOptimisticNodeId,
		storeResolveCanonicalNodeId,
		tempToRealNodeId,
	]);

	useEffect(() => {
		if (!selectedTaskId || !sidePanelOpen) return;

		const canonicalTaskId = storeResolveCanonicalNodeId(selectedTaskId);
		if (canonicalTaskId && canonicalTaskId !== selectedTaskId) {
			setSelectedTaskId(canonicalTaskId);
			return;
		}

		if (taskById.has(selectedTaskId)) return;

		const mappedRealId = tempToRealNodeId[selectedTaskId];
		if (mappedRealId && taskById.has(mappedRealId)) {
			setSelectedTaskId(mappedRealId);
			return;
		}

		if (!storeIsOptimisticNodeId(selectedTaskId)) return;

		setSidePanelOpen(false);
		setSelectedTaskId(null);
		setTargetFeatureForTask(null);
		storeClearNodeFocus();
	}, [
		selectedTaskId,
		sidePanelOpen,
		storeClearNodeFocus,
		storeIsOptimisticNodeId,
		storeResolveCanonicalNodeId,
		taskById,
		tempToRealNodeId,
	]);

	useEffect(() => {
		if (!addFeatureEpicId) {
			return;
		}

		setTargetEpicForFeature(addFeatureEpicId);
		setIsAddFeatureModalOpen(true);
		closeAddFeatureModal();
	}, [addFeatureEpicId, closeAddFeatureModal]);

	useEffect(() => {
		if (!addTaskFeatureId) {
			return;
		}

		setTargetFeatureForTask(addTaskFeatureId);
		setSelectedTaskId(null);
		setSidePanelOpen(true);
		closeAddTaskPanel();
	}, [addTaskFeatureId, closeAddTaskPanel]);

	const handleUpdateFeatureFromModal = useCallback(
		async (data: {
			title: string;
			description: string;
			is_deliverable: boolean;
			start_date?: string;
			end_date?: string;
			assignee_ids?: string[];
		}) => {
			if (!editingFeatureId || !editingFeatureEpicId) return;
			const featureMeta = featureById.get(editingFeatureId);
			const feature = featureMeta?.feature;
			if (!feature || featureMeta.epicId !== editingFeatureEpicId) return;

			setIsEditFeatureModalOpen(false);
			setEditingFeatureId(null);
			setEditingFeatureEpicId(null);
			setIsFeatureLoading(true);

			void onUpdateFeature({
				...feature,
				title: data.title,
				description: data.description,
				is_deliverable: data.is_deliverable,
				start_date: data.start_date,
				end_date: data.end_date,
				assignee_ids: data.assignee_ids,
				updated_at: new Date().toISOString(),
			})
				.catch(() => undefined)
				.finally(() => setIsFeatureLoading(false));
		},
		[editingFeatureEpicId, editingFeatureId, featureById, onUpdateFeature],
	);

	const handleDeleteEpic = useCallback(
		(id: string) => {
			const epic = epicById.get(id);
			setDeleteConfirm({
				type: "epic",
				id,
				label: epic?.title ? `"${epic.title}"` : "this epic",
			});
		},
		[epicById],
	);

	const handleDeleteFeature = useCallback(
		(featureId: string) => {
			const feature = featureById.get(featureId)?.feature;
			setDeleteConfirm({
				type: "feature",
				id: featureId,
				label: feature?.title ? `"${feature.title}"` : "this feature",
			});
		},
		[featureById],
	);

	const handleConfirmDelete = useCallback(() => {
		if (!deleteConfirm) return;

		const target = deleteConfirm;
		const selectedEpicBeforeDelete = selectedEpic;
		setDeleteConfirm(null);

		if (target.type === "epic" && selectedEpicBeforeDelete === target.id) {
			setSelectedEpic(null);
		}

		void (async () => {
			try {
				if (target.type === "epic") {
					await onDeleteEpic(target.id);
					return;
				}

				await onDeleteFeature(target.id);
			} catch (error) {
				toast.error(
					getErrorMessage(
						error,
						target.type === "epic"
							? "Failed to delete epic"
							: "Failed to delete feature",
					),
				);

				if (target.type === "epic" && selectedEpicBeforeDelete === target.id) {
					setSelectedEpic(target.id);
				}
			}
		})();
	}, [
		deleteConfirm,
		onDeleteEpic,
		onDeleteFeature,
		selectedEpic,
		setSelectedEpic,
		toast,
	]);

	const handleTaskCreate = useCallback(
		async (taskData: Partial<RoadmapTask>) => {
			if (targetFeatureForTask) {
				try {
					await onAddTask(targetFeatureForTask, taskData);
				} catch (error) {
					toast.error(getErrorMessage(error, "Failed to create task"));
					throw error;
				}
			}
		},
		[onAddTask, targetFeatureForTask, toast],
	);

	const handleTaskUpdate = useCallback(
		async (task: RoadmapTask) => {
			setIsTaskLoading(true);
			try {
				await onUpdateTask(task);
			} finally {
				setIsTaskLoading(false);
			}
		},
		[onUpdateTask],
	);

	const handleTaskDelete = useCallback(
		async (taskId: string) => {
			const wasPanelOpen = sidePanelOpen;
			const selectedTaskBeforeDelete = selectedTaskId;

			setSidePanelOpen(false);
			setSelectedTaskId(null);
			setTargetFeatureForTask(null);
			setIsTaskLoading(true);

			try {
				await onDeleteTask(taskId);
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to delete task"));

				if (wasPanelOpen && selectedTaskBeforeDelete === taskId) {
					setSelectedTaskId(taskId);
					setSidePanelOpen(true);
				}
			} finally {
				setIsTaskLoading(false);
			}
		},
		[onDeleteTask, selectedTaskId, sidePanelOpen, toast],
	);

	const currentEpic = selectedEpic ? epicById.get(selectedEpic) : undefined;
	const selectedTask = selectedTaskId
		? (taskById.get(selectedTaskId)?.task ?? null)
		: null;
	const isEditingEpicPending =
		Boolean(editingEpicId) && storeIsOptimisticNodeId(editingEpicId);
	const isEditingFeaturePending =
		Boolean(editingFeatureId) && storeIsOptimisticNodeId(editingFeatureId);
	const isSelectedTaskPending =
		Boolean(selectedTaskId) && storeIsOptimisticNodeId(selectedTaskId);

	return {
		roadmap,
		milestones,
		epics,
		viewMode,
		selectedEpic,
		openEpicTabs,
		selectedTaskId,
		sidePanelOpen,
		// Canonical id of the epic/feature/task whose detail is currently open (or
		// null) — used to broadcast "editing" presence to collaborators.
		canonicalActiveDetailNodeId,
		targetFeatureForTask,
		isAddEpicModalOpen,
		isEditEpicModalOpen,
		editingEpicId,
		isAddFeatureModalOpen,
		targetEpicForFeature,
		isEditFeatureModalOpen,
		editingFeatureId,
		editingFeatureEpicId,
		deleteConfirm,
		scrollToFeatureId,
		isTaskLoading,
		isEpicLoading,
		isFeatureLoading,
		isEditingEpicPending,
		isEditingFeaturePending,
		isSelectedTaskPending,
		currentEpic,
		selectedTask,
		focusNodeId,
		focusNodeOffsetX,
		focusTaskId,
		onAddMilestone,
		onUpdateMilestone: onUpdateMilestoneWithToast,
		onDeleteMilestone: onDeleteMilestoneWithToast,
		onUpdateEpic,
		onUpdateFeature,
		onDeleteTask,
		onUpdateTask,
		onFocusComplete,
		onNavigateToFeatureHandled,
		closeAddTaskPanel,
		setViewMode,
		setSelectedEpic,
		setOpenEpicTabs,
		setSelectedTaskId,
		setTargetFeatureForTask,
		setSidePanelOpen,
		setIsAddEpicModalOpen,
		setIsEditEpicModalOpen,
		setEditingEpicId,
		setIsAddFeatureModalOpen,
		setTargetEpicForFeature,
		setIsEditFeatureModalOpen,
		setEditingFeatureId,
		setEditingFeatureEpicId,
		setDeleteConfirm,
		setScrollToFeatureId,
		handleCloseEpicTab,
		handleDeleteEpic,
		handleDeleteFeature,
		handleCreateEpic,
		handleUpdateEpicFromModal,
		handleCreateFeature,
		handleUpdateFeatureFromModal,
		handleOpenEditFeatureModal,
		handleOpenEditEpicModal,
		handleOpenAddFeatureModal,
		handleAddEpicBelow,
		handleConfirmDelete,
		handleTaskCreate,
		handleTaskUpdate,
		handleTaskDelete,
	};
}
