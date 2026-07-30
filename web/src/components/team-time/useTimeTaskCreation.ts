import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	epicService,
	featureService,
	roadmapService,
	taskService,
} from "@/services/roadmap.service";
import type { ProjectTaskOption } from "@/services/team-time.service";
import type { RoadmapTask } from "@/types/roadmap";

/**
 * Create epics, features and tasks from inside the timer picker.
 *
 * Lifted verbatim out of `routes/teams/$teamId/time/my-logs.tsx`, where it was
 * ~140 lines of route-local mutations. `AddLogModal` has always been a shared,
 * fully-controlled component, but this wiring was not — which is why the
 * project Time page could never render the picker.
 *
 * The title→id resolution is inherent, not incidental: `AddLogModal` builds its
 * epic/feature tree from the flat `ProjectTaskOption[]`, so a node that has no
 * tasks yet is known only by its title until something is logged against it.
 */

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
	pendingEpics: PendingEpic[];
	pendingFeatures: PendingFeature[];
	/**
	 * Promise-returning (mutateAsync, not mutate) because `AddLogModal` awaits
	 * these to know when to close its inline create row. Errors are already
	 * toasted by the mutation's onError, so callers may ignore the rejection —
	 * hence the `.catch` inside rather than at every call site.
	 */
	createEpic: (
		title: string,
	) => Promise<undefined | { id: string; title: string }>;
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
	/** Clear pending nodes — call when the selected project changes. */
	reset: () => void;
}

export function normalizePathLabel(value?: string | null): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export function useTimeTaskCreation({
	projectId,
	tasks,
	invalidateKeys,
	onTaskCreated,
	onTaskSettled,
}: {
	projectId: string | null;
	/** Current task list — lets feature resolution short-circuit without a fetch. */
	tasks: ProjectTaskOption[];
	/** Query keys to invalidate after a create (the picker's task list). */
	invalidateKeys: readonly unknown[][];
	onTaskCreated?: (taskId: string) => void;
	onTaskSettled?: () => void;
}): TimeTaskCreation {
	const qc = useQueryClient();
	const toast = useToast();
	const [pendingEpics, setPendingEpics] = useState<PendingEpic[]>([]);
	const [pendingFeatures, setPendingFeatures] = useState<PendingFeature[]>([]);

	const invalidate = useCallback(() => {
		for (const queryKey of invalidateKeys) {
			void qc.invalidateQueries({ queryKey });
		}
	}, [qc, invalidateKeys]);

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
			// Keep it visible in the picker: a task-less epic won't come back in
			// ProjectTaskOption[], so without this it vanishes on refetch.
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
				// The picker only knows the epic by title — resolve it to an id.
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
				const nFt = normalizePathLabel(context?.featureTitle);
				const nEt = normalizePathLabel(context?.epicTitle);
				if (!nFt) return null;
				const matched = tasks.find((t) => {
					if (normalizePathLabel(t.feature_title) !== nFt) return false;
					return !nEt || normalizePathLabel(t.epic_title) === nEt;
				});
				if (matched?.feature_id) return matched.feature_id;
				if (!projectId) return null;
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
	// doesn't leave an unhandled promise behind when the title is a duplicate.
	// Returns `undefined` rather than `void` so the resolved union stays a real
	// value type the picker can narrow on.
	const swallow = (): undefined => undefined;

	return {
		pendingEpics,
		pendingFeatures,
		createEpic: (title: string) =>
			createEpicMutation.mutateAsync(title).catch(swallow),
		createFeature: (input: {
			epicId: string | null;
			epicTitle: string;
			title: string;
		}) => createFeatureMutation.mutateAsync(input).catch(swallow),
		createTask: (input: {
			taskData: Partial<RoadmapTask>;
			featureId: string | null;
			context: CreateTaskContext | null;
		}) => createTaskMutation.mutateAsync(input).then(swallow).catch(swallow),
		creatingEpic: createEpicMutation.isPending,
		creatingFeature: createFeatureMutation.isPending,
		creatingTask: createTaskMutation.isPending,
		reset,
	};
}
