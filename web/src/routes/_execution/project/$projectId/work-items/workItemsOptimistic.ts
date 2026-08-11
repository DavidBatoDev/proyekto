import type { RoadmapEpic, RoadmapFeature, RoadmapTask, TaskStatus } from "@/types/roadmap";

export const clearRecordKey = <T>(
	record: Record<string, T>,
	key: string,
): Record<string, T> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

export const clearTaskRollbackKey = (
	record: Partial<Record<string, RoadmapTask>>,
	key: string,
): Partial<Record<string, RoadmapTask>> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

export const patchEpicById = (
	epics: RoadmapEpic[],
	epicId: string,
	patcher: (epic: RoadmapEpic) => RoadmapEpic,
): RoadmapEpic[] =>
	epics.map((epic) => (epic.id === epicId ? patcher(epic) : epic));

export const patchFeatureById = (
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

export const patchTaskById = (
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

export const findEpicById = (
	epics: RoadmapEpic[],
	epicId: string,
): RoadmapEpic | undefined => epics.find((epic) => epic.id === epicId);

export const findFeatureById = (
	epics: RoadmapEpic[],
	featureId: string,
): RoadmapFeature | undefined =>
	epics
		.flatMap((epic) => epic.features || [])
		.find((feature) => feature.id === featureId);

export const findTaskById = (
	epics: RoadmapEpic[],
	taskId: string,
): RoadmapTask | undefined =>
	epics
		.flatMap((epic) => epic.features || [])
		.flatMap((feature) => feature.tasks || [])
		.find((task) => task.id === taskId);

export interface TaskLocationSnapshot {
	featureId: string;
	index: number;
	task: RoadmapTask;
}

export const removeTaskById = (
	epics: RoadmapEpic[],
	taskId: string,
): { epics: RoadmapEpic[]; snapshot: TaskLocationSnapshot } | null => {
	for (const epic of epics) {
		for (const feature of epic.features || []) {
			const tasks = feature.tasks || [];
			const index = tasks.findIndex((task) => task.id === taskId);
			if (index === -1) continue;

			const task = tasks[index];
			const nextEpics = epics.map((candidateEpic) => ({
				...candidateEpic,
				features: (candidateEpic.features || []).map((candidateFeature) =>
					candidateFeature.id === feature.id
						? {
								...candidateFeature,
								tasks: (candidateFeature.tasks || []).filter(
									(candidateTask) => candidateTask.id !== taskId,
								),
							}
						: candidateFeature,
				),
			}));
			return {
				epics: nextEpics,
				snapshot: {
					featureId: feature.id,
					index,
					task,
				},
			};
		}
	}

	return null;
};

export const restoreTaskAtLocation = (
	epics: RoadmapEpic[],
	snapshot: TaskLocationSnapshot,
): RoadmapEpic[] =>
	epics.map((epic) => ({
		...epic,
		features: (epic.features || []).map((feature) => {
			if (feature.id !== snapshot.featureId) return feature;
			const tasks = [...(feature.tasks || [])];
			const safeIndex = Math.max(0, Math.min(snapshot.index, tasks.length));
			tasks.splice(safeIndex, 0, snapshot.task);
			return { ...feature, tasks };
		}),
	}));

export const buildStatusPatch = (
	task: RoadmapTask,
	nextStatus: TaskStatus,
): RoadmapTask => ({
	...task,
	status: nextStatus,
	completed_at:
		nextStatus === "done"
			? (task.completed_at ?? new Date().toISOString())
			: undefined,
});

export const stripTaskStatus = (task: RoadmapTask) => {
	const nextTask = { ...task } as Partial<RoadmapTask>;
	delete nextTask.status;
	return nextTask;
};

export const isStatusOnlyTaskUpdate = (
	currentTask: RoadmapTask,
	nextTask: RoadmapTask,
): boolean => {
	if (currentTask.status === nextTask.status) return false;
	return (
		JSON.stringify(stripTaskStatus(currentTask)) ===
		JSON.stringify(stripTaskStatus(nextTask))
	);
};

export interface TaskStatusIntentRuntime {
	getTask: (taskId: string) => RoadmapTask | undefined;
	isActive: (taskId: string) => boolean;
	setActive: (taskId: string, value: boolean) => void;
	getQueuedIntent: (taskId: string) => TaskStatus | undefined;
	setQueuedIntent: (taskId: string, value: TaskStatus) => void;
	clearQueuedIntent: (taskId: string) => void;
	getRollbackTask: (taskId: string) => RoadmapTask | undefined;
	setRollbackTask: (taskId: string, task: RoadmapTask) => void;
	clearRollbackTask: (taskId: string) => void;
	applyOptimisticStatus: (taskId: string, nextStatus: TaskStatus) => void;
	applyServerTask: (
		taskId: string,
		serverTask: RoadmapTask,
		options: { preserveOptimisticStatus: boolean },
	) => void;
	rollbackTask: (taskId: string, rollbackTask: RoadmapTask) => void;
	sendTaskStatusUpdate: (
		taskId: string,
		intentStatus: TaskStatus,
		taskForRequest: RoadmapTask,
	) => Promise<RoadmapTask>;
}

export const enqueueTaskStatusIntent = async (
	runtime: TaskStatusIntentRuntime,
	taskId: string,
	nextStatus: TaskStatus,
): Promise<void> => {
	const taskBeforeIntent = runtime.getTask(taskId);
	if (!taskBeforeIntent) return;

	const shouldStartSync = !runtime.isActive(taskId);

	runtime.applyOptimisticStatus(taskId, nextStatus);
	runtime.setQueuedIntent(taskId, nextStatus);
	runtime.setRollbackTask(taskId, { ...taskBeforeIntent });

	if (!shouldStartSync) return;
	runtime.setActive(taskId, true);

	try {
		while (true) {
			const intentStatus = runtime.getQueuedIntent(taskId);
			if (!intentStatus) break;

			runtime.clearQueuedIntent(taskId);

			const taskForRequest = runtime.getTask(taskId);
			if (!taskForRequest) break;

			try {
				const serverTask = await runtime.sendTaskStatusUpdate(
					taskId,
					intentStatus,
					taskForRequest,
				);
				runtime.applyServerTask(taskId, serverTask, {
					preserveOptimisticStatus: Boolean(runtime.getQueuedIntent(taskId)),
				});
			} catch (error) {
				if (runtime.getQueuedIntent(taskId)) {
					continue;
				}
				const rollbackTask = runtime.getRollbackTask(taskId);
				if (rollbackTask) {
					runtime.rollbackTask(taskId, rollbackTask);
				}
				throw error;
			}
		}
	} finally {
		runtime.clearQueuedIntent(taskId);
		runtime.setActive(taskId, false);
		runtime.clearRollbackTask(taskId);
	}
};
