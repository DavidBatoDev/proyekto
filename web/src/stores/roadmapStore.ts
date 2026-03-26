/**
 * Roadmap Store - Zustand
 * Centralized state management for roadmap data and UI state
 */

import { create } from "zustand";
import {
	epicService,
	featureService,
	milestoneService,
	roadmapService,
	taskService,
	type FullRoadmap,
} from "@/services/roadmap.service";
import type {
	FeatureStatus,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
	RoadmapTask,
} from "@/types/roadmap";
import type { RoadmapArtifactPreview } from "@/types/roadmapArtifact";

export type CanvasViewMode = "roadmap" | "epic" | "milestones" | "artifact";

interface RoadmapState {
	// Data
	roadmap: Roadmap | null;
	epics: RoadmapEpic[];
	milestones: RoadmapMilestone[];
	pendingEpicById: Record<string, boolean>;
	pendingFeatureById: Record<string, boolean>;
	pendingTaskById: Record<string, boolean>;
	queuedTaskStatusIntentById: Record<string, RoadmapTask["status"]>;
	activeTaskStatusSyncById: Record<string, boolean>;
	taskStatusRollbackById: Partial<Record<string, RoadmapTask>>;

	// UI State - Canvas Navigation
	focusNodeId: string | null;
	focusNodeOffsetX: number;
	navigateToEpicId: string | null;
	navigateToFeature: { epicId: string; featureId: string } | null;
	openEpicEditorId: string | null;
	openFeatureEditor: { epicId: string; featureId: string } | null;
	openTaskDetailId: string | null;
	activeEpicId: string | null;

	// UI State - Canvas View Mode (shared so RoadmapViewContent can react)
	canvasViewMode: CanvasViewMode;
	canvasSelectedEpicId: string | null;
	canvasOpenEpicTabs: string[];
	canvasSelectedArtifactId: string | null;
	canvasOpenArtifactTabs: string[];
	artifactsById: Record<string, RoadmapArtifactPreview>;

	// UI State - Modal Triggers
	addFeatureEpicId: string | null;
	addTaskFeatureId: string | null;

	// Loading States
	isLoadingRoadmap: boolean;
	isLoadingEpic: boolean;
	isLoadingFeature: boolean;
	isLoadingTask: boolean;
}

interface FeatureData {
	title: string;
	description: string;
	status: FeatureStatus;
	is_deliverable: boolean;
	start_date?: string;
	end_date?: string;
}

interface RoadmapActions {
	// Initialize & Reset
	loadRoadmap: (
		roadmapId: string,
		options?: { force?: boolean },
	) => Promise<void>;
	applyRoadmapSnapshot: (fullRoadmap: FullRoadmap) => void;
	resetRoadmap: () => void;
	updateRoadmapMetadata: (roadmap: Partial<Roadmap>) => Promise<void>;

	// Epic CRUD
	addEpic: (
		milestoneId?: string,
		epicInput?: Partial<RoadmapEpic>,
	) => Promise<void>;
	updateEpic: (epic: RoadmapEpic) => Promise<void>;
	reorderEpicsInRoadmap: (orderedEpicIds: string[]) => Promise<void>;
	previewEpicOrderInRoadmap: (orderedEpicIds: string[]) => void;
	deleteEpic: (epicId: string) => Promise<void>;

	// Feature CRUD
	addFeature: (epicId: string, data: FeatureData) => Promise<void>;
	updateFeature: (feature: RoadmapFeature) => Promise<void>;
	reorderFeaturesInEpic: (
		epicId: string,
		orderedFeatureIds: string[],
	) => Promise<void>;
	previewFeatureOrderInEpic: (epicId: string, orderedFeatureIds: string[]) => void;
	deleteFeature: (featureId: string) => Promise<void>;

	// Task CRUD
	addTask: (featureId: string, data: Partial<RoadmapTask>) => Promise<void>;
	updateTask: (task: RoadmapTask) => Promise<void>;
	updateTaskStatusIntent: (
		taskId: string,
		nextStatus: RoadmapTask["status"],
	) => Promise<void>;
	deleteTask: (taskId: string) => Promise<void>;

	// Milestone CRUD
	addMilestone: (data: {
		title: string;
		target_date: string;
		description?: string;
		status?: RoadmapMilestone["status"];
		color?: string;
	}) => Promise<void>;
	updateMilestone: (milestone: RoadmapMilestone) => Promise<void>;
	deleteMilestone: (id: string) => Promise<void>;

	// UI Actions
	openAddFeatureModal: (epicId: string) => void;
	closeAddFeatureModal: () => void;
	openAddTaskPanel: (featureId: string) => void;
	closeAddTaskPanel: () => void;
	navigateToNode: (nodeId: string, options?: { offsetX?: number }) => void;
	clearNodeFocus: () => void;
	navigateToEpicTab: (epicId: string) => void;
	clearNavigateToEpicTab: () => void;
	navigateToFeatureNode: (epicId: string, featureId: string) => void;
	clearNavigateToFeatureNode: () => void;
	openEpicEditor: (epicId: string) => void;
	clearOpenEpicEditor: () => void;
	openFeatureEditorModal: (epicId: string, featureId: string) => void;
	clearOpenFeatureEditorModal: () => void;
	openTaskDetail: (taskId: string) => void;
	clearOpenTaskDetail: () => void;
	setActiveEpicId: (epicId: string | null) => void;

	// Canvas view-mode actions
	setCanvasViewMode: (mode: CanvasViewMode) => void;
	setCanvasSelectedEpicId: (epicId: string | null) => void;
	setCanvasOpenEpicTabs: (
		tabs: string[] | ((prev: string[]) => string[]),
	) => void;
	closeCanvasEpicTab: (epicId: string) => void;
	openArtifactTab: (artifact: RoadmapArtifactPreview) => void;
	setCanvasSelectedArtifactId: (artifactId: string | null) => void;
	closeCanvasArtifactTab: (artifactId: string) => void;
	applyArtifactSnapshot: (artifactId: string) => void;
	discardArtifact: (artifactId: string) => void;
}

type RoadmapStore = RoadmapState & RoadmapActions;

const clearPendingKey = <T>(
	record: Record<string, T>,
	key: string,
): Record<string, T> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

const patchEpicById = (
	epics: RoadmapEpic[],
	epicId: string,
	patcher: (epic: RoadmapEpic) => RoadmapEpic,
): RoadmapEpic[] =>
	epics.map((epic) => (epic.id === epicId ? patcher(epic) : epic));

const patchFeatureById = (
	epics: RoadmapEpic[],
	featureId: string,
	patcher: (feature: RoadmapFeature) => RoadmapFeature,
): RoadmapEpic[] =>
	epics.map((epic) => ({
		...epic,
		features: (epic.features || []).map((feature) =>
			feature.id === featureId ? patcher(feature) : feature,
		),
	}));

const patchTaskById = (
	epics: RoadmapEpic[],
	taskId: string,
	patcher: (task: RoadmapTask) => RoadmapTask,
): RoadmapEpic[] =>
	epics.map((epic) => ({
		...epic,
		features: (epic.features || []).map((feature) => ({
			...feature,
			tasks: (feature.tasks || []).map((task) =>
				task.id === taskId ? patcher(task) : task,
			),
		})),
	}));

const findTaskById = (
	epics: RoadmapEpic[],
	taskId: string,
): RoadmapTask | undefined =>
	epics
		.flatMap((epic) => epic.features || [])
		.flatMap((feature) => feature.tasks || [])
		.find((task) => task.id === taskId);

const clearTaskRollbackKey = (
	record: Partial<Record<string, RoadmapTask>>,
	key: string,
): Partial<Record<string, RoadmapTask>> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

export const useRoadmapStore = create<RoadmapStore>((set, get) => ({
	// Initial State
	roadmap: null,
	epics: [],
	milestones: [],
	pendingEpicById: {},
	pendingFeatureById: {},
	pendingTaskById: {},
	queuedTaskStatusIntentById: {},
	activeTaskStatusSyncById: {},
	taskStatusRollbackById: {},
	focusNodeId: null,
	focusNodeOffsetX: 0,
	navigateToEpicId: null,
	navigateToFeature: null,
	openEpicEditorId: null,
	openFeatureEditor: null,
	openTaskDetailId: null,
	activeEpicId: null,
	addFeatureEpicId: null,
	addTaskFeatureId: null,
	isLoadingRoadmap: false,
	isLoadingEpic: false,
	isLoadingFeature: false,
	isLoadingTask: false,
	canvasViewMode: "roadmap",
	canvasSelectedEpicId: null,
	canvasOpenEpicTabs: [],
	canvasSelectedArtifactId: null,
	canvasOpenArtifactTabs: [],
	artifactsById: {},

	// Initialize - Load full roadmap data
	loadRoadmap: async (roadmapId: string, options?: { force?: boolean }) => {
		const currentRoadmap = get().roadmap;
		const shouldUseCache =
			!options?.force && currentRoadmap?.id === roadmapId;
		if (shouldUseCache) return;

		try {
			set({ isLoadingRoadmap: true });
			const fullRoadmap = await roadmapService.getFull(roadmapId);
			set({
				roadmap: fullRoadmap,
				epics: fullRoadmap.epics || [],
				milestones: fullRoadmap.milestones || [],
				pendingEpicById: {},
				pendingFeatureById: {},
				pendingTaskById: {},
				queuedTaskStatusIntentById: {},
				activeTaskStatusSyncById: {},
				taskStatusRollbackById: {},
				isLoadingRoadmap: false,
			});
		} catch (error) {
			console.error("Failed to load roadmap:", error);
			set({ isLoadingRoadmap: false });
			throw error;
		}
	},

	// Reset - Clear all roadmap data
	applyRoadmapSnapshot: (fullRoadmap: FullRoadmap) => {
		set({
			roadmap: fullRoadmap,
			epics: fullRoadmap.epics || [],
			milestones: fullRoadmap.milestones || [],
			pendingEpicById: {},
			pendingFeatureById: {},
			pendingTaskById: {},
			queuedTaskStatusIntentById: {},
			activeTaskStatusSyncById: {},
			taskStatusRollbackById: {},
		});
	},

	// Reset - Clear all roadmap data
	resetRoadmap: () => {
		set({
			roadmap: null,
			epics: [],
			milestones: [],
			pendingEpicById: {},
			pendingFeatureById: {},
			pendingTaskById: {},
			queuedTaskStatusIntentById: {},
			activeTaskStatusSyncById: {},
			taskStatusRollbackById: {},
			focusNodeId: null,
			focusNodeOffsetX: 0,
			navigateToEpicId: null,
			navigateToFeature: null,
			openEpicEditorId: null,
			openFeatureEditor: null,
			openTaskDetailId: null,
			activeEpicId: null,
			addFeatureEpicId: null,
			addTaskFeatureId: null,
			canvasViewMode: "roadmap",
			canvasSelectedEpicId: null,
			canvasOpenEpicTabs: [],
			canvasSelectedArtifactId: null,
			canvasOpenArtifactTabs: [],
			artifactsById: {},
		});
	},

	// Update roadmap metadata
	updateRoadmapMetadata: async (updates: Partial<Roadmap>) => {
		const { roadmap } = get();
		if (!roadmap) return;

		try {
			await roadmapService.update(roadmap.id, updates);
			set({ roadmap: { ...roadmap, ...updates } });
		} catch (error) {
			console.error("Failed to update roadmap:", error);
			throw error;
		}
	},

	// Epic CRUD
	addEpic: async (_milestoneId?: string, epicInput?: Partial<RoadmapEpic>) => {
		const { roadmap, epics } = get();
		if (!roadmap) return;

		try {
			set({ isLoadingEpic: true });

			const newEpic = await epicService.create({
				roadmap_id: roadmap.id,
				title: epicInput?.title?.trim() || "New Epic",
				description: epicInput?.description || "",
				priority: epicInput?.priority || "medium",
				status: epicInput?.status || "backlog",
				position: epicInput?.position ?? epics.length,
				color: epicInput?.color,
				estimated_hours: epicInput?.estimated_hours,
				start_date: epicInput?.start_date,
				end_date: epicInput?.end_date,
				tags: epicInput?.tags,
				labels: epicInput?.labels,
			});

			// Update local state with optimistic update
			if (newEpic.position < epics.length) {
				const updatedEpics = epics.map((e) =>
					e.position >= newEpic.position
						? { ...e, position: e.position + 1 }
						: e,
				);
				set({
					epics: [...updatedEpics, { ...newEpic, features: [] }],
					isLoadingEpic: false,
				});
			} else {
				set({
					epics: [...epics, { ...newEpic, features: [] }],
					isLoadingEpic: false,
				});
			}
		} catch (error) {
			console.error("Failed to create epic:", error);
			set({ isLoadingEpic: false });
			throw error;
		}
	},

	updateEpic: async (updatedEpic: RoadmapEpic) => {
		const currentEpic = get().epics.find((epic) => epic.id === updatedEpic.id);
		if (!currentEpic) return;

		const epicId = updatedEpic.id;
		const rollbackSnapshot = { ...currentEpic };
		const optimisticEpic: RoadmapEpic = {
			...currentEpic,
			...updatedEpic,
			features: currentEpic.features,
		};

		set((state) => ({
			isLoadingEpic: true,
			pendingEpicById: {
				...state.pendingEpicById,
				[epicId]: true,
			},
			epics: patchEpicById(state.epics, epicId, () => optimisticEpic),
		}));

		try {
			const updated = await epicService.update(epicId, {
				title: updatedEpic.title,
				description: updatedEpic.description,
				priority: updatedEpic.priority,
				status: updatedEpic.status,
				position: updatedEpic.position,
				color: updatedEpic.color,
				estimated_hours: updatedEpic.estimated_hours,
				actual_hours: updatedEpic.actual_hours,
				start_date: updatedEpic.start_date,
				end_date: updatedEpic.end_date,
				completed_date: updatedEpic.completed_date,
				tags: updatedEpic.tags,
				labels: updatedEpic.labels,
			});

			set((state) => ({
				epics: patchEpicById(state.epics, epicId, (epic) => ({
					...updated,
					features: epic.features || [],
				})),
			}));
		} catch (error) {
			console.error("Failed to update epic:", error);
			set((state) => ({
				epics: patchEpicById(state.epics, epicId, () => rollbackSnapshot),
			}));
			throw error;
		} finally {
			set((state) => ({
				isLoadingEpic: false,
				pendingEpicById: clearPendingKey(state.pendingEpicById, epicId),
			}));
		}
	},

	reorderEpicsInRoadmap: async (orderedEpicIds: string[]) => {
		const { epics, roadmap } = get();
		if (!roadmap) return;
		if ((epics?.length ?? 0) === 0) return;

		const allEpicIds = epics.map((epic) => epic.id);
		const epicIdSet = new Set(allEpicIds);
		const seen = new Set<string>();
		const normalizedOrderIds: string[] = [];
		for (const epicId of orderedEpicIds) {
			if (!epicId || !epicIdSet.has(epicId) || seen.has(epicId)) {
				continue;
			}
			seen.add(epicId);
			normalizedOrderIds.push(epicId);
		}
		for (const epicId of allEpicIds) {
			if (seen.has(epicId)) continue;
			seen.add(epicId);
			normalizedOrderIds.push(epicId);
		}

		const epicIndexById = new Map(epics.map((epic) => [epic.id, epic]));
		try {
			set({ isLoadingEpic: true });
			const changedEpics = normalizedOrderIds
				.map((epicId, index) => {
					const epic = epicIndexById.get(epicId);
					if (!epic) return null;
					return { epic, nextPosition: index };
				})
				.filter(
					(
						item,
					): item is {
						epic: RoadmapEpic;
						nextPosition: number;
					} => item !== null,
				);

			const reorderPatch = normalizedOrderIds.map((epicId, index) => ({
				epic_id: epicId,
				new_order_index: index,
			}));

			const hasInvalidExistingPositions = epics.some((epic) => {
				const position =
					typeof epic.position === "number" ? epic.position : Number(epic.position);
				return !Number.isFinite(position) || position < 0;
			});

			let patchSucceeded = false;
			try {
				await epicService.reorder(roadmap.id, reorderPatch);
				patchSucceeded = true;
			} catch (patchError) {
				const message =
					patchError instanceof Error ? patchError.message.toLowerCase() : "";
				const shouldFallbackToSequential =
					hasInvalidExistingPositions ||
					message.includes("position must not be less than 0") ||
					message.includes("duplicate key value violates unique constraint") ||
					message.includes("invalid input syntax");
				if (!shouldFallbackToSequential) {
					throw patchError;
				}
			}

			if (!patchSucceeded) {
				const currentMaxPosition = epics.reduce((max, epic) => {
					const position =
						typeof epic.position === "number"
							? epic.position
							: Number(epic.position);
					if (!Number.isFinite(position) || position < 0) return max;
					return Math.max(max, position);
				}, 0);
				const tempBase = currentMaxPosition + epics.length + 1000;
				for (const [index, item] of changedEpics.entries()) {
					await epicService.update(item.epic.id, {
						position: tempBase + index,
					});
				}

				for (const item of changedEpics) {
					await epicService.update(item.epic.id, {
						position: Math.max(0, item.nextPosition),
					});
				}
			}

			set({
				epics: normalizedOrderIds
					.map((epicId, index) => {
						const epic = epicIndexById.get(epicId);
						if (!epic) return null;
						return {
							...epic,
							position: index,
							updated_at: new Date().toISOString(),
						};
					})
					.filter((epic): epic is RoadmapEpic => epic !== null),
				isLoadingEpic: false,
			});
		} catch (error) {
			console.error("Failed to reorder epics:", error);
			set({ isLoadingEpic: false });
			throw error;
		}
	},

	previewEpicOrderInRoadmap: (orderedEpicIds: string[]) => {
		const { epics } = get();
		if ((epics?.length ?? 0) === 0) return;

		const epicIndexById = new Map(epics.map((epic) => [epic.id, epic]));
		set({
			epics: orderedEpicIds
				.map((epicId, index) => {
					const epic = epicIndexById.get(epicId);
					if (!epic) return null;
					return {
						...epic,
						position: index,
						updated_at: new Date().toISOString(),
					};
				})
				.filter((epic): epic is RoadmapEpic => epic !== null),
		});
	},

	deleteEpic: async (epicId: string) => {
		const { epics } = get();

		try {
			set({ isLoadingEpic: true });
			await epicService.delete(epicId);
			set({
				epics: epics.filter((e) => e.id !== epicId),
				isLoadingEpic: false,
			});
		} catch (error) {
			console.error("Failed to delete epic:", error);
			set({ isLoadingEpic: false });
			throw error;
		}
	},

	// Feature CRUD
	addFeature: async (epicId: string, data: FeatureData) => {
		const { roadmap, epics } = get();
		if (!roadmap) return;

		const epic = epics.find((e) => e.id === epicId);
		if (!epic) return;

		try {
			set({ isLoadingFeature: true });

			const newFeature = await featureService.create({
				roadmap_id: roadmap.id,
				epic_id: epicId,
				title: data.title,
				description: data.description,
				status: data.status,
				position: epic.features?.length || 0,
				is_deliverable: data.is_deliverable,
				start_date: data.start_date,
				end_date: data.end_date,
			});

			set({
				epics: epics.map((e) =>
					e.id === epicId
						? { ...e, features: [...(e.features || []), newFeature] }
						: e,
				),
				isLoadingFeature: false,
			});
		} catch (error) {
			console.error("Failed to create feature:", error);
			set({ isLoadingFeature: false });
			throw error;
		}
	},

	updateFeature: async (feature: RoadmapFeature) => {
		const currentFeature = get()
			.epics.flatMap((epic) => epic.features || [])
			.find((item) => item.id === feature.id);
		if (!currentFeature) return;

		const featureId = feature.id;
		const rollbackSnapshot = { ...currentFeature };
		const optimisticFeature: RoadmapFeature = {
			...currentFeature,
			...feature,
			tasks: currentFeature.tasks,
		};

		set((state) => ({
			isLoadingFeature: true,
			pendingFeatureById: {
				...state.pendingFeatureById,
				[featureId]: true,
			},
			epics: patchFeatureById(state.epics, featureId, () => optimisticFeature),
		}));

		try {
			const updated = await featureService.update(featureId, {
				title: feature.title,
				description: feature.description,
				status: feature.status,
				position: feature.position,
				is_deliverable: feature.is_deliverable,
				estimated_hours: feature.estimated_hours,
				actual_hours: feature.actual_hours,
				start_date: feature.start_date,
				end_date: feature.end_date,
			});

			set((state) => ({
				epics: patchFeatureById(state.epics, featureId, (current) => ({
					...updated,
					tasks: current.tasks || [],
				})),
			}));
		} catch (error) {
			console.error("Failed to update feature:", error);
			set((state) => ({
				epics: patchFeatureById(state.epics, featureId, () => rollbackSnapshot),
			}));
			throw error;
		} finally {
			set((state) => ({
				isLoadingFeature: false,
				pendingFeatureById: clearPendingKey(
					state.pendingFeatureById,
					featureId,
				),
			}));
		}
	},

	reorderFeaturesInEpic: async (epicId: string, orderedFeatureIds: string[]) => {
		const { epics } = get();
		const epic = epics.find((item) => item.id === epicId);
		if (!epic) return;
		if ((epic.features?.length ?? 0) === 0) return;

		const epicFeatureIds = (epic.features ?? []).map((feature) => feature.id);
		const epicFeatureIdSet = new Set(epicFeatureIds);
		const seen = new Set<string>();
		const normalizedOrderIds: string[] = [];
		for (const featureId of orderedFeatureIds) {
			if (!featureId || !epicFeatureIdSet.has(featureId) || seen.has(featureId)) {
				continue;
			}
			seen.add(featureId);
			normalizedOrderIds.push(featureId);
		}
		for (const featureId of epicFeatureIds) {
			if (seen.has(featureId)) continue;
			seen.add(featureId);
			normalizedOrderIds.push(featureId);
		}

		const featureIndexById = new Map(
			(epic.features ?? []).map((feature) => [feature.id, feature]),
		);
		try {
			set({ isLoadingFeature: true });
			const changedFeatures = normalizedOrderIds
				.map((featureId, index) => {
					const feature = featureIndexById.get(featureId);
					if (!feature) return null;
					return { feature, nextPosition: index };
				})
				.filter(
					(
						item,
					): item is {
						feature: RoadmapFeature;
						nextPosition: number;
					} => item !== null,
				);

			const reorderPatch = normalizedOrderIds.map((featureId, index) => ({
				feature_id: featureId,
				new_order_index: index,
			}));

			const hasInvalidExistingPositions = (epic.features ?? []).some((feature) => {
				const position =
					typeof feature.position === "number"
						? feature.position
						: Number(feature.position);
				return !Number.isFinite(position) || position < 0;
			});

			let patchSucceeded = false;
			try {
				// Keep the reorder patch endpoint as the primary path.
				await featureService.reorder(epicId, reorderPatch);
				patchSucceeded = true;
			} catch (patchError) {
				const message =
					patchError instanceof Error ? patchError.message.toLowerCase() : "";
				const shouldFallbackToSequential =
					hasInvalidExistingPositions ||
					message.includes("position must not be less than 0") ||
					message.includes("duplicate key value violates unique constraint") ||
					message.includes("invalid input syntax");
				if (!shouldFallbackToSequential) {
					throw patchError;
				}
			}

			if (!patchSucceeded) {
				// Fallback: move to temporary high positive positions first, then finals.
				const currentMaxPosition = (epic.features ?? []).reduce(
					(max, feature) => {
						const position =
							typeof feature.position === "number"
								? feature.position
								: Number(feature.position);
						if (!Number.isFinite(position) || position < 0) return max;
						return Math.max(max, position);
					},
					0,
				);
				const tempBase =
					currentMaxPosition + (epic.features?.length ?? 0) + 1000;
				for (const [index, item] of changedFeatures.entries()) {
					await featureService.update(item.feature.id, {
						position: tempBase + index,
					});
				}

				for (const item of changedFeatures) {
					await featureService.update(item.feature.id, {
						position: Math.max(0, item.nextPosition),
					});
				}
			}

			set({
				epics: epics.map((item) => {
					if (item.id !== epicId) return item;
					const reorderedFeatures = normalizedOrderIds
						.map((featureId, index) => {
							const feature = featureIndexById.get(featureId);
							if (!feature) return null;
							return { ...feature, position: index };
						})
						.filter((feature): feature is RoadmapFeature => feature !== null);
					return {
						...item,
						features: reorderedFeatures,
						updated_at: new Date().toISOString(),
					};
				}),
				isLoadingFeature: false,
			});
		} catch (error) {
			console.error(`Failed to reorder features in epic ${epicId}:`, error);
			set({ isLoadingFeature: false });
			throw error;
		}
	},

	previewFeatureOrderInEpic: (epicId: string, orderedFeatureIds: string[]) => {
		const { epics } = get();
		const epic = epics.find((item) => item.id === epicId);
		if (!epic) return;
		if ((epic.features?.length ?? 0) === 0) return;

		const featureIndexById = new Map(
			(epic.features ?? []).map((feature) => [feature.id, feature]),
		);

		set({
			epics: epics.map((item) => {
				if (item.id !== epicId) return item;
				const reorderedFeatures = orderedFeatureIds
					.map((featureId, index) => {
						const feature = featureIndexById.get(featureId);
						if (!feature) return null;
						return { ...feature, position: index };
					})
					.filter((feature): feature is RoadmapFeature => feature !== null);
				return {
					...item,
					features: reorderedFeatures,
					updated_at: new Date().toISOString(),
				};
			}),
		});
	},

	deleteFeature: async (featureId: string) => {
		const { epics } = get();
		const epic = epics.find((e) => e.features?.some((f) => f.id === featureId));
		if (!epic) return;

		try {
			set({ isLoadingFeature: true });
			await featureService.delete(featureId);
			set({
				epics: epics.map((e) =>
					e.id === epic.id
						? {
								...e,
								features: e.features?.filter((f) => f.id !== featureId),
								updated_at: new Date().toISOString(),
							}
						: e,
				),
				isLoadingFeature: false,
			});
		} catch (error) {
			console.error("Failed to delete feature:", error);
			set({ isLoadingFeature: false });
			throw error;
		}
	},

	// Task CRUD
	addTask: async (featureId: string, data: Partial<RoadmapTask>) => {
		if (!data.title) {
			console.warn("Task title is required");
			return;
		}

		const { epics } = get();

		try {
			set({ isLoadingTask: true });

			const newTask = await taskService.create({
				feature_id: featureId,
				title: data.title,
				status: data.status || "todo",
				priority: data.priority || "medium",
				position: data.position,
				due_date: data.due_date,
			});

			set({
				epics: epics.map((epic) => ({
					...epic,
					features: (epic.features || []).map((feature) =>
						feature.id === featureId
							? {
									...feature,
									tasks: [...(feature.tasks || []), newTask],
								}
							: feature,
					),
				})),
				isLoadingTask: false,
			});
		} catch (error) {
			console.error("Failed to create task:", error);
			set({ isLoadingTask: false });
			throw error;
		}
	},

	updateTask: async (task: RoadmapTask) => {
		const { epics, pendingTaskById } = get();
		const taskId = task.id;
		if (pendingTaskById[taskId]) return;

		const currentTask = findTaskById(epics, taskId);
		if (!currentTask) return;

		const rollbackSnapshot = { ...currentTask };
		const optimisticTask: RoadmapTask = {
			...currentTask,
			...task,
		};

		set((state) => ({
			isLoadingTask: true,
			pendingTaskById: {
				...state.pendingTaskById,
				[taskId]: true,
			},
			epics: patchTaskById(state.epics, taskId, () => optimisticTask),
		}));

		try {
			const updated = await taskService.update(taskId, {
				title: task.title,
				status: task.status,
				priority: task.priority,
				position: task.position,
				assignee_id: task.assignee_id,
				due_date: task.due_date,
				completed_at: task.completed_at,
			});

			set((state) => ({
				epics: patchTaskById(state.epics, taskId, () => updated),
			}));
		} catch (error) {
			console.error("Failed to update task:", error);
			set((state) => ({
				epics: patchTaskById(state.epics, taskId, () => rollbackSnapshot),
			}));
			throw error;
		} finally {
			set((state) => ({
				isLoadingTask: false,
				pendingTaskById: clearPendingKey(state.pendingTaskById, taskId),
			}));
		}
	},

	updateTaskStatusIntent: async (
		taskId: string,
		nextStatus: RoadmapTask["status"],
	) => {
		const taskBeforeIntent = findTaskById(get().epics, taskId);
		if (!taskBeforeIntent) return;

		const shouldStartSync = !Boolean(get().activeTaskStatusSyncById[taskId]);

		set((state) => ({
			epics: patchTaskById(state.epics, taskId, (task) => ({
				...task,
				status: nextStatus,
			})),
			queuedTaskStatusIntentById: {
				...state.queuedTaskStatusIntentById,
				[taskId]: nextStatus,
			},
			taskStatusRollbackById: {
				...state.taskStatusRollbackById,
				[taskId]: { ...taskBeforeIntent },
			},
			activeTaskStatusSyncById: shouldStartSync
				? {
						...state.activeTaskStatusSyncById,
						[taskId]: true,
					}
				: state.activeTaskStatusSyncById,
		}));

		if (!shouldStartSync) return;

		try {
			while (true) {
				const intentStatus = get().queuedTaskStatusIntentById[taskId];
				if (!intentStatus) break;

				set((state) => ({
					queuedTaskStatusIntentById: clearPendingKey(
						state.queuedTaskStatusIntentById,
						taskId,
					),
				}));

				const taskForRequest = findTaskById(get().epics, taskId);
				if (!taskForRequest) break;

				try {
					const updated = await taskService.update(taskId, {
						title: taskForRequest.title,
						status: intentStatus,
						priority: taskForRequest.priority,
						position: taskForRequest.position,
						assignee_id: taskForRequest.assignee_id,
						due_date: taskForRequest.due_date,
						completed_at: taskForRequest.completed_at,
					});

					set((state) => ({
						epics: patchTaskById(state.epics, taskId, (task) => {
							const merged = { ...task, ...updated };
							const hasQueuedNewerIntent = Boolean(
								state.queuedTaskStatusIntentById[taskId],
							);
							return hasQueuedNewerIntent
								? { ...merged, status: task.status }
								: merged;
						}),
					}));
				} catch (error) {
					const hasQueuedNewerIntent = Boolean(
						get().queuedTaskStatusIntentById[taskId],
					);
					if (hasQueuedNewerIntent) {
						continue;
					}

					const rollbackTask = get().taskStatusRollbackById[taskId];
					if (rollbackTask) {
						set((state) => ({
							epics: patchTaskById(state.epics, taskId, () => rollbackTask),
						}));
					}
					throw error;
				}
			}
		} finally {
			set((state) => ({
				queuedTaskStatusIntentById: clearPendingKey(
					state.queuedTaskStatusIntentById,
					taskId,
				),
				activeTaskStatusSyncById: clearPendingKey(
					state.activeTaskStatusSyncById,
					taskId,
				),
				taskStatusRollbackById: clearTaskRollbackKey(
					state.taskStatusRollbackById,
					taskId,
				),
			}));
		}
	},

	deleteTask: async (taskId: string) => {
		const { epics } = get();

		try {
			set({ isLoadingTask: true });
			await taskService.delete(taskId);

			set({
				epics: epics.map((epic) => ({
					...epic,
					features: (epic.features || []).map((feature) => ({
						...feature,
						tasks: (feature.tasks || []).filter((t) => t.id !== taskId),
					})),
				})),
				isLoadingTask: false,
			});
		} catch (error) {
			console.error("Failed to delete task:", error);
			set({ isLoadingTask: false });
			throw error;
		}
	},

	// Milestone CRUD
	addMilestone: async (data) => {
		const { roadmap, milestones } = get();
		if (!roadmap) return;
		const nextPosition =
			milestones.reduce(
				(maxPosition, milestone) =>
					Math.max(maxPosition, milestone.position ?? -1),
				-1,
			) + 1;

		const created = await milestoneService.create(roadmap.id, {
			title: data.title,
			target_date: data.target_date,
			description: data.description,
			status: data.status ?? "not_started",
			color: data.color,
			position: nextPosition,
		});

		set({
			milestones: [...milestones, created].sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0),
			),
		});
	},

	updateMilestone: async (updated: RoadmapMilestone) => {
		const { milestones } = get();
		const saved = await milestoneService.update(updated.id, {
			title: updated.title,
			description: updated.description,
			target_date: updated.target_date,
			status: updated.status,
			color: updated.color,
		});

		set({
			milestones: milestones.map((m) => (m.id === saved.id ? saved : m)),
		});
	},

	deleteMilestone: async (id: string) => {
		const { milestones } = get();
		await milestoneService.delete(id);
		set({ milestones: milestones.filter((m) => m.id !== id) });
	},

	// UI Actions - Modal Triggers
	openAddFeatureModal: (epicId: string) => {
		set({ addFeatureEpicId: epicId });
	},

	closeAddFeatureModal: () => {
		set({ addFeatureEpicId: null });
	},

	openAddTaskPanel: (featureId: string) => {
		set({ addTaskFeatureId: featureId });
	},

	closeAddTaskPanel: () => {
		set({ addTaskFeatureId: null });
	},

	navigateToNode: (nodeId: string, options?: { offsetX?: number }) => {
		set({
			focusNodeId: nodeId,
			focusNodeOffsetX: options?.offsetX ?? 0,
		});
	},

	clearNodeFocus: () => {
		set({
			focusNodeId: null,
			focusNodeOffsetX: 0,
		});
	},

	navigateToEpicTab: (epicId: string) => {
		set({ navigateToEpicId: epicId });
	},

	clearNavigateToEpicTab: () => {
		set({ navigateToEpicId: null });
	},

	navigateToFeatureNode: (epicId: string, featureId: string) => {
		set({ navigateToFeature: { epicId, featureId } });
	},

	clearNavigateToFeatureNode: () => {
		set({ navigateToFeature: null });
	},

	openEpicEditor: (epicId: string) => {
		set({ openEpicEditorId: epicId });
	},

	clearOpenEpicEditor: () => {
		set({ openEpicEditorId: null });
	},

	openFeatureEditorModal: (epicId: string, featureId: string) => {
		set({ openFeatureEditor: { epicId, featureId } });
	},

	clearOpenFeatureEditorModal: () => {
		set({ openFeatureEditor: null });
	},

	openTaskDetail: (taskId: string) => {
		set({ openTaskDetailId: taskId });
	},

	clearOpenTaskDetail: () => {
		set({ openTaskDetailId: null });
	},

	setActiveEpicId: (epicId: string | null) => {
		set({ activeEpicId: epicId });
	},

	setCanvasViewMode: (mode: CanvasViewMode) => {
		set({ canvasViewMode: mode });
	},

	setCanvasSelectedEpicId: (epicId: string | null) => {
		set({ canvasSelectedEpicId: epicId });
	},

	setCanvasOpenEpicTabs: (tabs: string[] | ((prev: string[]) => string[])) => {
		if (typeof tabs === "function") {
			set((state) => ({ canvasOpenEpicTabs: tabs(state.canvasOpenEpicTabs) }));
		} else {
			set({ canvasOpenEpicTabs: tabs });
		}
	},

	closeCanvasEpicTab: (epicId: string) => {
		const { canvasOpenEpicTabs, canvasSelectedEpicId } = get();
		const newTabs = canvasOpenEpicTabs.filter((id) => id !== epicId);
		const updates: Partial<RoadmapStore> = { canvasOpenEpicTabs: newTabs };
		if (canvasSelectedEpicId === epicId) {
			if (newTabs.length > 0) {
				updates.canvasSelectedEpicId = newTabs[newTabs.length - 1];
			} else {
				updates.canvasViewMode = "roadmap";
				updates.canvasSelectedEpicId = null;
			}
		}
		set(updates);
	},

	openArtifactTab: (artifact: RoadmapArtifactPreview) => {
		set((state) => {
			const isOpen = state.canvasOpenArtifactTabs.includes(artifact.artifactId);
			return {
				artifactsById: {
					...state.artifactsById,
					[artifact.artifactId]: artifact,
				},
				canvasOpenArtifactTabs: isOpen
					? state.canvasOpenArtifactTabs
					: [...state.canvasOpenArtifactTabs, artifact.artifactId],
				canvasSelectedArtifactId: artifact.artifactId,
				canvasViewMode: "artifact" as CanvasViewMode,
			};
		});
	},

	setCanvasSelectedArtifactId: (artifactId: string | null) => {
		set({
			canvasSelectedArtifactId: artifactId,
			canvasViewMode: artifactId ? "artifact" : "roadmap",
		});
	},

	closeCanvasArtifactTab: (artifactId: string) => {
		set((state) => {
			const newTabs = state.canvasOpenArtifactTabs.filter((id) => id !== artifactId);
			const nextArtifacts = { ...state.artifactsById };
			delete nextArtifacts[artifactId];
			const updates: Partial<RoadmapStore> = {
				canvasOpenArtifactTabs: newTabs,
				artifactsById: nextArtifacts,
			};
			if (state.canvasSelectedArtifactId === artifactId) {
				if (newTabs.length > 0) {
					updates.canvasSelectedArtifactId = newTabs[newTabs.length - 1];
					updates.canvasViewMode = "artifact";
				} else {
					updates.canvasSelectedArtifactId = null;
					updates.canvasViewMode = "roadmap";
				}
			}
			return updates;
		});
	},

	applyArtifactSnapshot: (artifactId: string) => {
		set((state) => {
			const artifact = state.artifactsById[artifactId];
			if (!artifact) return {};
			const snapshot = artifact.candidateSnapshot;
			return {
				roadmap: snapshot,
				epics: snapshot.epics || [],
				milestones: snapshot.milestones || [],
				artifactsById: {
					...state.artifactsById,
					[artifactId]: {
						...artifact,
						status: "applied",
					},
				},
			};
		});
	},

	discardArtifact: (artifactId: string) => {
		get().closeCanvasArtifactTab(artifactId);
	},
}));

// Selectors for fine-grained subscriptions
export const useRoadmap = () => useRoadmapStore((state) => state.roadmap);
export const useEpics = () => useRoadmapStore((state) => state.epics);
export const useMilestones = () => useRoadmapStore((state) => state.milestones);
export const useRoadmapLoading = () =>
	useRoadmapStore((state) => state.isLoadingRoadmap);
