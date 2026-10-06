// web/src/components/time/forms/useTimeTaskCreation.ts
//
// Create epics, features and tasks from inside the task picker
// (ux.md › Timer › Picker order: "Task (search, inline create through
// useTimeTaskCreation)"). A port of `components/team-time/useTimeTaskCreation`
// onto the `/api/time` keys: after a create, the project's work items
// (`["time", "work-items", projectId]`) refetch, so the new node shows in the
// picker without any team-time cache.
//
// The title → id resolution is inherent, not incidental: the picker builds its
// epic/feature tree from the flat task list, so a node that has no tasks yet is
// known only by its title until something is logged against it.

import {
	type QueryKey,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { timeKeys } from "@/queries/time";
import {
	epicService,
	featureService,
	roadmapService,
	taskService,
} from "@/services/roadmap.service";
import type { ProjectTaskOption } from "@/services/time.types";
import type { RoadmapTask } from "@/types/roadmap";

export interface CreateTaskContext {
	featureId: string | null;
	epicTitle: string | null;
	featureTitle: string | null;
}

export interface PendingEpic {
	id: string;
	title: string;
}

export interface PendingFeature {
	id: string;
	epicId: string | null;
	epicTitle: string;
	title: string;
}

export interface TimeTaskCreation {
	/** Epics and features created this session that have no task yet. */
	pendingEpics: PendingEpic[];
	pendingFeatures: PendingFeature[];
	/**
	 * Promise-returning because the picker awaits these to close its inline
	 * create row. A failure is already toasted, so the promise resolves
	 * `undefined` instead of rejecting.
	 */
	createEpic: (title: string) => Promise<undefined | PendingEpic>;
	createFeature: (input: {
		epicId: string | null;
		epicTitle: string;
		title: string;
	}) => Promise<undefined | { id: string; title: string }>;
	createTask: (input: {
		taskData: Partial<RoadmapTask>;
		featureId: string | null;
		context: CreateTaskContext | null;
	}) => Promise<void>;
	creatingEpic: boolean;
	creatingFeature: boolean;
	creatingTask: boolean;
	/** Clears pending nodes; call when the selected project changes. */
	reset: () => void;
}

/** Titles compared loosely: case, punctuation and spacing ignored. */
export function normalizePathLabel(value?: string | null): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * The feature a task should be created under: a task already listed under
 * that epic and feature title gives its id without a fetch.
 */
export function featureIdFromTasks(
	tasks: readonly ProjectTaskOption[],
	context: Pick<CreateTaskContext, "epicTitle" | "featureTitle"> | null,
): string | null {
	const nFt = normalizePathLabel(context?.featureTitle);
	const nEt = normalizePathLabel(context?.epicTitle);
	if (!nFt) return null;
	const matched = tasks.find((t) => {
		if (normalizePathLabel(t.feature_title) !== nFt) return false;
		return !nEt || normalizePathLabel(t.epic_title) === nEt;
	});
	return matched?.feature_id ?? null;
}

export interface UseTimeTaskCreationOptions {
	projectId: string | null;
	/** The picker's current task list: lets feature resolution skip a fetch. */
	tasks: readonly ProjectTaskOption[];
	/** Refetched after a create. Defaults to the project's work items. */
	invalidateKeys?: readonly QueryKey[];
	onTaskCreated?: (taskId: string) => void;
	onTaskSettled?: () => void;
}

export function useTimeTaskCreation({
	projectId,
	tasks,
	invalidateKeys,
	onTaskCreated,
	onTaskSettled,
}: UseTimeTaskCreationOptions): TimeTaskCreation {
	const qc = useQueryClient();
	const toast = useToast();
	const [pendingEpics, setPendingEpics] = useState<PendingEpic[]>([]);
	const [pendingFeatures, setPendingFeatures] = useState<PendingFeature[]>([]);

	const keys = useMemo<readonly QueryKey[]>(
		() => invalidateKeys ?? (projectId ? [timeKeys.workItems(projectId)] : []),
		[invalidateKeys, projectId],
	);
	const invalidate = useCallback(() => {
		for (const queryKey of keys) {
			void qc.invalidateQueries({ queryKey });
		}
	}, [qc, keys]);

	const createEpicMutation = useMutation({
		mutationFn: async (title: string) => {
			if (!projectId) throw new Error("Select a project first.");
			const roadmap = await roadmapService.getByProjectId(projectId);
			if (!roadmap?.id)
				throw new Error("This project has no roadmap to add an epic to.");
			return epicService.create({
				roadmap_id: roadmap.id,
				title: title.trim() || "Untitled epic",
			});
		},
		onSuccess: (created) => {
			toast.success("Epic created");
			// A task-less epic never comes back in the task list, so keep it here
			// or it vanishes from the picker on the next refetch.
			setPendingEpics((prev) =>
				prev.some((e) => e.id === created.id)
					? prev
					: [...prev, { id: created.id, title: created.title }],
			);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const createFeatureMutation = useMutation({
		mutationFn: async (input: {
			epicId: string | null;
			epicTitle: string;
			title: string;
		}) => {
			if (!projectId) throw new Error("Select a project first.");
			const roadmap = await roadmapService.getByProjectId(projectId);
			if (!roadmap?.id)
				throw new Error("This project has no roadmap to add a feature to.");
			let epicId = input.epicId?.trim() ?? "";
			if (!epicId) {
				// The picker only knows the epic by title: resolve it to an id.
				const full = await roadmapService.getFull(roadmap.id);
				const nEt = normalizePathLabel(input.epicTitle);
				epicId =
					(full.epics ?? []).find(
						(epic) => normalizePathLabel(epic.title) === nEt,
					)?.id ?? "";
			}
			if (!epicId) throw new Error("Select an epic before creating a feature.");
			return featureService.create({
				roadmap_id: roadmap.id,
				epic_id: epicId,
				title: input.title.trim() || "Untitled feature",
			});
		},
		onSuccess: (created, variables) => {
			toast.success("Feature created");
			setPendingFeatures((prev) =>
				prev.some((f) => f.id === created.id)
					? prev
					: [
							...prev,
							{
								id: created.id,
								epicId: variables.epicId,
								epicTitle: variables.epicTitle,
								title: created.title,
							},
						],
			);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const createTaskMutation = useMutation({
		mutationFn: async (input: {
			taskData: Partial<RoadmapTask>;
			featureId: string | null;
			context: CreateTaskContext | null;
		}) => {
			const { taskData, context } = input;
			const resolveFeature = async (): Promise<string | null> => {
				const listed = featureIdFromTasks(tasks, context);
				if (listed) return listed;
				const nFt = normalizePathLabel(context?.featureTitle);
				const nEt = normalizePathLabel(context?.epicTitle);
				if (!nFt || !projectId) return null;
				const roadmap = await roadmapService.getByProjectId(projectId);
				if (!roadmap?.id) return null;
				const full = await roadmapService.getFull(roadmap.id);
				for (const epic of full.epics ?? []) {
					const et = normalizePathLabel(epic.title);
					if (nEt && et !== nEt) continue;
					const feat = (epic.features ?? []).find(
						(f) => normalizePathLabel(f.title) === nFt,
					);
					if (feat?.id) return feat.id;
				}
				return null;
			};
			let featureId = input.featureId?.trim() ?? "";
			if (!featureId) featureId = (await resolveFeature()) ?? "";
			if (!featureId)
				throw new Error("Select a feature before creating a task.");
			const title = (taskData.title ?? "").trim();
			return taskService.create({
				feature_id: featureId,
				title: title || "Untitled task",
				status: taskData.status ?? "todo",
				priority: taskData.priority ?? "medium",
				work_type: taskData.work_type ?? "real_work",
				assignee_id: taskData.assignee_id ?? null,
				due_date: taskData.due_date || undefined,
			});
		},
		onSuccess: (created) => {
			toast.success("Task created");
			invalidate();
			onTaskCreated?.(created.id);
		},
		onError: (e: Error) => toast.error(e.message),
		onSettled: () => onTaskSettled?.(),
	});

	const reset = useCallback(() => {
		setPendingEpics([]);
		setPendingFeatures([]);
	}, []);

	// onError already toasts; swallow the rejection so an inline create row
	// never leaves an unhandled promise behind (a duplicate title, say).
	const swallow = (): undefined => undefined;

	return {
		pendingEpics,
		pendingFeatures,
		createEpic: (title: string) =>
			createEpicMutation
				.mutateAsync(title)
				.then((created) => ({ id: created.id, title: created.title }))
				.catch(swallow),
		createFeature: (input) =>
			createFeatureMutation
				.mutateAsync(input)
				.then((created) => ({ id: created.id, title: created.title }))
				.catch(swallow),
		createTask: (input) =>
			createTaskMutation.mutateAsync(input).then(swallow).catch(swallow),
		creatingEpic: createEpicMutation.isPending,
		creatingFeature: createFeatureMutation.isPending,
		creatingTask: createTaskMutation.isPending,
		reset,
	};
}
