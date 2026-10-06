// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeKeys } from "@/queries/time";
import { timeService } from "@/services/time.service";
import type { LoggingForResult, LoggingOption } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import { MilestonesView } from "./MilestonesView";

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		showToast: vi.fn(),
		toast: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));

// The timer buttons (components/time/timer/TaskTimerButton) render only on a
// project the person can log on: seed its For options, and no timer running.
const USER = "user-1";
const teamOption: LoggingOption = {
	kind: "team",
	id: "team-1",
	label: "Prodigitality Services Inc. Team",
	sheet_scope: { kind: "team", ref: "team-1" },
	rate_source: "none",
	workspace_tag: null,
	approver_hint: "team",
};

function renderWithTime(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(timeKeys.running(USER), null);
	client.setQueryData<LoggingForResult>(timeKeys.loggingFor("project-1"), {
		options: [teamOption],
		selected: teamOption,
		prefill: null,
		unavailable: [],
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
	// No network: the running poll and the For read answer from here.
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
	vi.spyOn(timeService, "getLoggingFor").mockResolvedValue({
		options: [teamOption],
		selected: teamOption,
		prefill: null,
		unavailable: [],
	});
});

afterEach(() => {
	cleanup();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

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
		renderWithTime(
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
