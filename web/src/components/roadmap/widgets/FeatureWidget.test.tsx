/* @vitest-environment jsdom */

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
			assignees: [{ id: "user-1", display_name: "Ada Lovelace" }],
		}),
		makeTask({
			id: "task-2",
			title: "Build welcome email",
			status: "done",
			position: 2000,
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
		renderWidget({ runningTaskId: "task-1" });

		expect(screen.getByText("Design onboarding")).toBeTruthy();
		expect(screen.getByText("Build welcome email")).toBeTruthy();
		expect(screen.getByText("Todo")).toBeTruthy();
		expect(screen.getByText("Done")).toBeTruthy();
		expect(screen.getByTitle("Ada Lovelace")).toBeTruthy();
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
});
