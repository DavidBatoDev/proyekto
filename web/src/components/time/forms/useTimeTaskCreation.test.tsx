/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

const roadmap = vi.hoisted(() => ({
	roadmapService: {
		getByProjectId: vi.fn(),
		getFull: vi.fn(),
	},
	epicService: { create: vi.fn() },
	featureService: { create: vi.fn() },
	taskService: { create: vi.fn() },
}));
vi.mock("@/services/roadmap.service", () => roadmap);

import { timeKeys } from "@/queries/time";
import type { ProjectTaskOption } from "@/services/time.types";
import {
	featureIdFromTasks,
	normalizePathLabel,
	useTimeTaskCreation,
} from "./useTimeTaskCreation";

const PROJECT = "p1";

const tasks: ProjectTaskOption[] = [
	{
		id: "t1",
		title: "Fix login bug",
		work_type: "real_work",
		feature_id: "f1",
		feature_title: "Sign-in",
		epic_id: "e1",
		epic_title: "Auth",
	},
];

let client: QueryClient;

function setup(
	options: Partial<Parameters<typeof useTimeTaskCreation>[0]> = {},
) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(
		() =>
			useTimeTaskCreation({
				projectId: PROJECT,
				tasks,
				...options,
			}),
		{ wrapper },
	);
}

afterEach(() => {
	cleanup();
	client?.clear();
	vi.clearAllMocks();
});

describe("title matching", () => {
	it("ignores case, punctuation and spacing", () => {
		expect(normalizePathLabel("  Sign-In!  ")).toBe("sign in");
		expect(normalizePathLabel(null)).toBe("");
	});

	it("finds a feature id from the listed tasks without a fetch", () => {
		expect(
			featureIdFromTasks(tasks, { epicTitle: "auth", featureTitle: "SIGN IN" }),
		).toBe("f1");
		expect(
			featureIdFromTasks(tasks, {
				epicTitle: "Billing",
				featureTitle: "Sign-in",
			}),
		).toBeNull();
		expect(
			featureIdFromTasks(tasks, { epicTitle: null, featureTitle: null }),
		).toBeNull();
	});
});

describe("useTimeTaskCreation", () => {
	it("creates a task under a feature known from the task list and refreshes the work items", async () => {
		roadmap.taskService.create.mockResolvedValue({ id: "t-new" });
		const onTaskCreated = vi.fn();
		const onTaskSettled = vi.fn();
		const { result } = setup({ onTaskCreated, onTaskSettled });
		const invalidate = vi.spyOn(client, "invalidateQueries");

		await act(async () => {
			await result.current.createTask({
				taskData: { title: " New task " },
				featureId: null,
				context: {
					featureId: null,
					epicTitle: "Auth",
					featureTitle: "Sign-in",
				},
			});
		});

		expect(roadmap.roadmapService.getByProjectId).not.toHaveBeenCalled();
		expect(roadmap.taskService.create).toHaveBeenCalledWith(
			expect.objectContaining({
				feature_id: "f1",
				title: "New task",
				status: "todo",
				priority: "medium",
				work_type: "real_work",
			}),
		);
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: timeKeys.workItems(PROJECT),
		});
		expect(onTaskCreated).toHaveBeenCalledWith("t-new");
		expect(onTaskSettled).toHaveBeenCalled();
		expect(toast.success).toHaveBeenCalledWith("Task created");
	});

	it("resolves an unknown feature title through the roadmap", async () => {
		roadmap.roadmapService.getByProjectId.mockResolvedValue({ id: "r1" });
		roadmap.roadmapService.getFull.mockResolvedValue({
			epics: [
				{
					id: "e9",
					title: "Billing",
					features: [{ id: "f9", title: "Invoices UI" }],
				},
			],
		});
		roadmap.taskService.create.mockResolvedValue({ id: "t2" });
		const { result } = setup();
		await act(async () => {
			await result.current.createTask({
				taskData: {},
				featureId: null,
				context: {
					featureId: null,
					epicTitle: "Billing",
					featureTitle: "Invoices UI",
				},
			});
		});
		expect(roadmap.taskService.create).toHaveBeenCalledWith(
			expect.objectContaining({ feature_id: "f9", title: "Untitled task" }),
		);
	});

	it("keeps a new task-less epic pending and swallows a failed create (toasted)", async () => {
		roadmap.roadmapService.getByProjectId.mockResolvedValue({ id: "r1" });
		roadmap.epicService.create.mockResolvedValueOnce({
			id: "e2",
			title: "Onboarding",
		});
		const { result } = setup();
		let created: unknown;
		await act(async () => {
			created = await result.current.createEpic("Onboarding");
		});
		expect(created).toEqual({ id: "e2", title: "Onboarding" });
		await waitFor(() =>
			expect(result.current.pendingEpics).toEqual([
				{ id: "e2", title: "Onboarding" },
			]),
		);

		roadmap.epicService.create.mockRejectedValueOnce(
			new Error("Duplicate epic."),
		);
		let failed: unknown = "unset";
		await act(async () => {
			failed = await result.current.createEpic("Onboarding");
		});
		expect(failed).toBeUndefined();
		expect(toast.error).toHaveBeenCalledWith("Duplicate epic.");

		act(() => result.current.reset());
		expect(result.current.pendingEpics).toEqual([]);
	});

	it("needs a project", async () => {
		const { result } = setup({ projectId: null });
		await act(async () => {
			await result.current.createFeature({
				epicId: "e1",
				epicTitle: "Auth",
				title: "X",
			});
		});
		expect(toast.error).toHaveBeenCalledWith("Select a project first.");
		expect(roadmap.featureService.create).not.toHaveBeenCalled();
	});
});
