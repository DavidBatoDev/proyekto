// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import { MilestonesView } from "./MilestonesView";

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		showToast: vi.fn(),
		toast: vi.fn(),
	}),
}));

vi.mock("@/components/team-time/useActiveTimer", () => ({
	useActiveTimer: () => ({
		runningTaskId: null,
		isRunning: false,
		isPaused: false,
		isBusy: false,
		start: vi.fn(),
		stop: vi.fn(),
	}),
}));

describe("MilestonesView Timer Integration", () => {
	const mockRoadmap: Roadmap = {
		id: "roadmap-1",
		project_id: "project-1",
		name: "Test Roadmap",
		owner_id: "user-1",
		status: "active",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};

	const mockEpics: RoadmapEpic[] = [
		{
			id: "epic-1",
			roadmap_id: "roadmap-1",
			title: "Epic 1",
			position: 0,
			priority: "medium",
			status: "in_progress",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			features: [
				{
					id: "feature-1",
					roadmap_id: "roadmap-1",
					epic_id: "epic-1",
					title: "Feature 1",
					position: 0,
					is_deliverable: true,
					status: "not_started",
					start_date: "2026-08-01",
					end_date: "2026-08-15",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					tasks: [
						{
							id: "task-1",
							feature_id: "feature-1",
							title: "Task 1",
							position: 0,
							board_order: 0,
							status: "todo",
							priority: "medium",
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					],
				},
			],
		},
	];

	it("renders TaskTimerButton for features with tasks in Milestones view", () => {
		render(
			<MilestonesView
				roadmap={mockRoadmap}
				milestones={[]}
				epics={mockEpics}
				onAddMilestone={vi.fn()}
				onUpdateMilestone={vi.fn()}
				onDeleteMilestone={vi.fn()}
				onUpdateFeature={vi.fn()}
			/>,
		);

		const timerButtons = screen.getAllByRole("button", {
			name: /start timer/i,
		});
		expect(timerButtons.length).toBeGreaterThan(0);
	});
});
