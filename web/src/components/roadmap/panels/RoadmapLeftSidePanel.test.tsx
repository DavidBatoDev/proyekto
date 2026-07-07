/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapTask,
} from "@/types/roadmap";
import { RoadmapLeftSidePanel } from "./RoadmapLeftSidePanel";

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
	}),
}));

const makeTask = (index: number): RoadmapTask => ({
	id: `task-${index}`,
	feature_id: "feature-large",
	title: `Large task ${index}`,
	status: "todo",
	priority: "medium",
	position: index * 1000,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
});

const largeFeature: RoadmapFeature = {
	id: "feature-large",
	roadmap_id: "roadmap-large",
	epic_id: "epic-large",
	title: "Large feature",
	description: "",
	position: 1000,
	is_deliverable: false,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	tasks: Array.from({ length: 300 }, (_, index) => makeTask(index + 1)),
};

const largeEpic: RoadmapEpic = {
	id: "epic-large",
	roadmap_id: "roadmap-large",
	title: "Large epic",
	description: "",
	priority: "medium",
	status: "planned",
	position: 1000,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	features: [largeFeature],
};

const roadmap: Roadmap = {
	id: "roadmap-large",
	project_id: "project-1",
	name: "Large roadmap",
	owner_id: "owner-1",
	status: "active",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	currentUserRole: "owner",
};

describe("RoadmapLeftSidePanel large roadmap rendering", () => {
	beforeEach(() => {
		useRoadmapStore.setState({
			roadmap,
			epics: [largeEpic],
			milestones: [],
		});
	});

	afterEach(() => {
		cleanup();
		useRoadmapStore.getState().resetRoadmap();
	});

	it("keeps task rows collapsed by default on large roadmaps", async () => {
		render(
			<RoadmapLeftSidePanel
				messages={[]}
				onSendMessage={vi.fn()}
				isCollapsed={false}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Large feature")).toBeTruthy();
		});

		expect(screen.queryByText("Large task 1")).toBeNull();
	});
});
