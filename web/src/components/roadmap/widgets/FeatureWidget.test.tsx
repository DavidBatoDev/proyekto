/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoadmapFeature, RoadmapTask } from "@/types/roadmap";
import { FeatureWidget, type FeatureWidgetData } from "./FeatureWidget";

vi.mock("@xyflow/react", () => ({
	Handle: () => <div data-testid="flow-handle" />,
	Position: {
		Left: "left",
		Right: "right",
	},
}));

vi.mock("../modals/TaskListModal", () => ({
	TaskListModal: ({ feature }: { feature: RoadmapFeature }) => (
		<div role="dialog">Full task controls for {feature.title}</div>
	),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const makeTask = (overrides: Partial<RoadmapTask>): RoadmapTask => ({
	id: "task-1",
	feature_id: "feature-1",
	title: "Design onboarding",
	status: "todo",
	priority: "medium",
	position: 1000,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	...overrides,
});

const makeFeature = (): RoadmapFeature => ({
	id: "feature-1",
	roadmap_id: "roadmap-1",
	epic_id: "epic-1",
	title: "Onboarding",
	description: "",
	position: 1000,
	is_deliverable: false,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	tasks: [
		makeTask({
			id: "task-1",
			title: "Design onboarding",
			comment_count: 3,
			assignees: [{ id: "user-1", display_name: "Ada Lovelace" }],
		}),
		makeTask({
			id: "task-2",
			title: "Build welcome email",
			status: "done",
			position: 2000,
			comment_count: 0,
		}),
	],
});

function renderWidget(overrides: Partial<FeatureWidgetData> = {}) {
	const props = {
		data: {
			feature: makeFeature(),
			onSelectTask: vi.fn(),
			onUpdateTask: vi.fn(),
			...overrides,
		},
	} as unknown as ComponentProps<typeof FeatureWidget>;

	return render(<FeatureWidget {...props} />);
}

describe("FeatureWidget canvas task list", () => {
	it("renders lightweight inline task rows with task signals", () => {
		const { container } = renderWidget({ runningTaskId: "task-1" });

		expect(screen.getByText("Design onboarding")).toBeTruthy();
		expect(screen.getByText("Build welcome email")).toBeTruthy();
		expect(screen.getByText("Todo")).toBeTruthy();
		expect(screen.getByText("Done")).toBeTruthy();
		expect(screen.getByTitle("Ada Lovelace")).toBeTruthy();

		const controlGrids = container.querySelectorAll("[data-task-row-controls]");
		expect(controlGrids).toHaveLength(2);
		for (const controls of controlGrids) {
			expect(controls.children).toHaveLength(4);
			expect(controls.className).toContain("grid-cols-");
		}

		const taskListShell = container.querySelector<HTMLElement>(
			"[data-task-list-shell]",
		);
		expect(taskListShell?.className).toContain("top-1/2");
		expect(taskListShell?.style.height).toContain("7rem");
	});

	it("fades overflowing descriptions into the themed card surface", () => {
		vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
		const feature = makeFeature();
		feature.description = "A longer feature description that needs a fade.";

		const { container } = renderWidget({ feature });
		const fade = container.querySelector("[data-description-overflow-fade]");

		expect(fade?.className).toContain("from-card");
		expect(fade?.className).toContain("to-transparent");
		expect(fade?.className).not.toContain("from-white");
	});

	it("quick-completes a task without mounting the full sortable task row", () => {
		const onUpdateTask = vi.fn();
		renderWidget({ onUpdateTask });

		fireEvent.click(
			screen.getAllByRole("button", { name: "Mark as complete" })[0],
		);

		expect(onUpdateTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1", status: "done" }),
		);
	});

	it("opens a task and the full task controls modal from the lightweight list", () => {
		const onSelectTask = vi.fn();
		renderWidget({ onSelectTask });

		fireEvent.click(screen.getByText("Design onboarding"));
		expect(onSelectTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
		);

		fireEvent.click(
			screen.getByRole("button", { name: /full task controls/i }),
		);
		expect(screen.getByRole("dialog").textContent).toContain(
			"Full task controls for Onboarding",
		);
	});

	it("shows nonzero comment counts outside the task container", () => {
		const onSelectTask = vi.fn();
		renderWidget({ onSelectTask });

		const commentsButton = screen.getByRole("button", {
			name: "Open 3 comments for Design onboarding",
		});
		expect(commentsButton.textContent).toBe("3");
		expect(commentsButton.closest("[data-task-list-container]")).toBeNull();
		expect(
			commentsButton.closest("[data-task-comment-gutter]")?.className,
		).toContain("-right-12");
		expect(
			screen.queryByRole("button", {
				name: /comments for Build welcome email/i,
			}),
		).toBeNull();

		fireEvent.click(commentsButton);
		expect(onSelectTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			"comments",
		);
	});
});
