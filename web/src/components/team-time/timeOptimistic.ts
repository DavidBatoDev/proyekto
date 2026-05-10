import type { TaskTimeLog } from "@/services/team-time.service";

export type ReviewDecision = "approved" | "rejected" | "pending";

export const clearRecordKey = <T>(
	record: Record<string, T>,
	key: string,
): Record<string, T> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

export const clearLogRollbackKey = (
	record: Partial<Record<string, TaskTimeLog>>,
	key: string,
): Partial<Record<string, TaskTimeLog>> => {
	if (!(key in record)) return record;
	const next = { ...record };
	delete next[key];
	return next;
};

export const createTempId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const patchLogById = (
	logs: TaskTimeLog[],
	logId: string,
	patcher: (log: TaskTimeLog) => TaskTimeLog,
): TaskTimeLog[] => logs.map((log) => (log.id === logId ? patcher(log) : log));

export const patchLogsByIds = (
	logs: TaskTimeLog[],
	logIds: string[],
	patcher: (log: TaskTimeLog) => TaskTimeLog,
): TaskTimeLog[] => {
	const idSet = new Set(logIds);
	return logs.map((log) => (idSet.has(log.id) ? patcher(log) : log));
};

export const findLogById = (logs: TaskTimeLog[], logId: string) =>
	logs.find((log) => log.id === logId);

export const removeLogById = (
	logs: TaskTimeLog[],
	logId: string,
): { logs: TaskTimeLog[]; removedLog: TaskTimeLog; removedIndex: number } | null => {
	const removedIndex = logs.findIndex((log) => log.id === logId);
	if (removedIndex === -1) return null;
	const removedLog = logs[removedIndex];
	return {
		logs: logs.filter((log) => log.id !== logId),
		removedLog,
		removedIndex,
	};
};

export const restoreLogAtIndex = (
	logs: TaskTimeLog[],
	log: TaskTimeLog,
	index: number,
) => {
	const next = [...logs];
	const safeIndex = Math.max(0, Math.min(index, next.length));
	next.splice(safeIndex, 0, log);
	return next;
};

export const replaceLogByTempId = (
	logs: TaskTimeLog[],
	tempId: string,
	serverLog: TaskTimeLog,
) => logs.map((log) => (log.id === tempId ? serverLog : log));

export const prependLog = (logs: TaskTimeLog[], log: TaskTimeLog) => [log, ...logs];

export interface LogTaskIntentRuntime {
	getLog: (logId: string) => TaskTimeLog | undefined;
	isActive: (logId: string) => boolean;
	setActive: (logId: string, value: boolean) => void;
	getQueuedIntent: (logId: string) => string | undefined;
	setQueuedIntent: (logId: string, taskId: string) => void;
	clearQueuedIntent: (logId: string) => void;
	getRollbackLog: (logId: string) => TaskTimeLog | undefined;
	setRollbackLog: (logId: string, log: TaskTimeLog) => void;
	clearRollbackLog: (logId: string) => void;
	applyOptimisticTask: (logId: string, taskId: string) => void;
	applyServerLog: (
		logId: string,
		serverLog: TaskTimeLog,
		options: { preserveOptimisticTask: boolean },
	) => void;
	rollbackLog: (logId: string, rollbackLog: TaskTimeLog) => void;
	sendTaskUpdate: (
		logId: string,
		taskId: string,
		logForRequest: TaskTimeLog,
	) => Promise<TaskTimeLog>;
}

export const enqueueLogTaskIntent = async (
	runtime: LogTaskIntentRuntime,
	logId: string,
	taskId: string,
) => {
	const logBeforeIntent = runtime.getLog(logId);
	if (!logBeforeIntent) return;

	const shouldStart = !runtime.isActive(logId);
	runtime.applyOptimisticTask(logId, taskId);
	runtime.setQueuedIntent(logId, taskId);
	runtime.setRollbackLog(logId, { ...logBeforeIntent });

	if (!shouldStart) return;
	runtime.setActive(logId, true);

	try {
		while (true) {
			const queuedTaskId = runtime.getQueuedIntent(logId);
			if (!queuedTaskId) break;

			runtime.clearQueuedIntent(logId);
			const logForRequest = runtime.getLog(logId);
			if (!logForRequest) break;

			try {
				const serverLog = await runtime.sendTaskUpdate(
					logId,
					queuedTaskId,
					logForRequest,
				);
				runtime.applyServerLog(logId, serverLog, {
					preserveOptimisticTask: Boolean(runtime.getQueuedIntent(logId)),
				});
			} catch (error) {
				if (runtime.getQueuedIntent(logId)) continue;
				const rollbackLog = runtime.getRollbackLog(logId);
				if (rollbackLog) {
					runtime.rollbackLog(logId, rollbackLog);
				}
				throw error;
			}
		}
	} finally {
		runtime.clearQueuedIntent(logId);
		runtime.setActive(logId, false);
		runtime.clearRollbackLog(logId);
	}
};

export interface ReviewIntentRuntime {
	getLog: (logId: string) => TaskTimeLog | undefined;
	isActive: (logId: string) => boolean;
	setActive: (logId: string, value: boolean) => void;
	getQueuedIntent: (logId: string) => ReviewDecision | undefined;
	setQueuedIntent: (logId: string, decision: ReviewDecision) => void;
	clearQueuedIntent: (logId: string) => void;
	getRollbackLog: (logId: string) => TaskTimeLog | undefined;
	setRollbackLog: (logId: string, log: TaskTimeLog) => void;
	clearRollbackLog: (logId: string) => void;
	applyOptimisticReview: (logId: string, decision: ReviewDecision) => void;
	applyServerLog: (
		logId: string,
		serverLog: TaskTimeLog,
		options: { preserveOptimisticStatus: boolean },
	) => void;
	rollbackLog: (logId: string, rollbackLog: TaskTimeLog) => void;
	sendReviewUpdate: (
		logId: string,
		decision: ReviewDecision,
		logForRequest: TaskTimeLog,
	) => Promise<TaskTimeLog>;
}

export const enqueueReviewIntent = async (
	runtime: ReviewIntentRuntime,
	logId: string,
	decision: ReviewDecision,
) => {
	const logBeforeIntent = runtime.getLog(logId);
	if (!logBeforeIntent) return;

	const shouldStart = !runtime.isActive(logId);
	runtime.applyOptimisticReview(logId, decision);
	runtime.setQueuedIntent(logId, decision);
	runtime.setRollbackLog(logId, { ...logBeforeIntent });

	if (!shouldStart) return;
	runtime.setActive(logId, true);

	try {
		while (true) {
			const queuedDecision = runtime.getQueuedIntent(logId);
			if (!queuedDecision) break;

			runtime.clearQueuedIntent(logId);
			const logForRequest = runtime.getLog(logId);
			if (!logForRequest) break;

			try {
				const serverLog = await runtime.sendReviewUpdate(
					logId,
					queuedDecision,
					logForRequest,
				);
				runtime.applyServerLog(logId, serverLog, {
					preserveOptimisticStatus: Boolean(runtime.getQueuedIntent(logId)),
				});
			} catch (error) {
				if (runtime.getQueuedIntent(logId)) continue;
				const rollbackLog = runtime.getRollbackLog(logId);
				if (rollbackLog) {
					runtime.rollbackLog(logId, rollbackLog);
				}
				throw error;
			}
		}
	} finally {
		runtime.clearQueuedIntent(logId);
		runtime.setActive(logId, false);
		runtime.clearRollbackLog(logId);
	}
};
