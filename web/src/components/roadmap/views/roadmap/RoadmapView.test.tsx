/* @vitest-environment jsdom */

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import { RoadmapView } from "./RoadmapView";
import type { RoadmapPerformanceMode } from "./models/types";

type ReactFlowMockProps = {
	children?: ReactNode;
	edges?: Array<{ animated?: boolean }>;
} & Record<string, unknown>;

let reactFlowProps: ReactFlowMockProps | null = null;

vi.mock("@xyflow/react", () => ({
	ReactFlow: ({ children, ...props }: ReactFlowMockProps) => {
		reactFlowProps = props;
		return <div data-testid="react-flow">{children}</div>;
	},
	Controls: () => <div data-testid="controls" />,
	MiniMap: () => <div data-testid="mini-map" />,
	Background: () => <div data-testid="background" />,
	BackgroundVariant: {
		Dots: "dots",
	},
	Handle: () => <div data-testid="flow-handle" />,
	Position: {
		Bottom: "bottom",
		Left: "left",
		Right: "right",
		Top: "top",
	},
	applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
	useReactFlow: () => ({
		getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
	}),
}));

vi.mock("@/hooks/useRecentAssignees", () => ({
	useRecentAssignees: () => ({ avatars: [] }),
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => null,
}));

const roadmap: Roadmap = {
	id: "roadmap-1",
	project_id: "project-1",
	name: "Roadmap",
	owner_id: "owner-1",
	status: "active",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	currentUserRole: "owner",
};

const epics: RoadmapEpic[] = [
	{
		id: "epic-1",
		roadmap_id: "roadmap-1",
		title: "Epic",
		description: "",
		priority: "medium",
		status: "planned",
		position: 1000,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		features: [
			{
				id: "feature-1",
				roadmap_id: "roadmap-1",
				epic_id: "epic-1",
				title: "Feature",
				description: "",
				position: 1000,
				is_deliverable: false,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				tasks: [
					{
						id: "task-1",
						feature_id: "feature-1",
						title: "Active task",
						status: "in_progress",
						priority: "medium",
						position: 1000,
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		],
	},
];

function renderRoadmapView(performanceMode: RoadmapPerformanceMode = "normal") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<RoadmapView
				roadmap={roadmap}
				epics={epics}
				performanceMode={performanceMode}
				onUpdateEpic={vi.fn()}
				onDeleteEpic={vi.fn()}
				onUpdateFeature={vi.fn()}
				onDeleteFeature={vi.fn()}
				onUpdateTask={vi.fn()}
			/>
		</QueryClientProvider>,
	);
}

describe("RoadmapView performance mode", () => {
	afterEach(() => {
		cleanup();
		reactFlowProps = null;
	});

	it("does not render the MiniMap", () => {
		renderRoadmapView();

		expect(screen.queryByTestId("mini-map")).toBeNull();
	});

	it("disables animated edges in reduced-motion mode", () => {
		renderRoadmapView("reducedMotion");

		expect(reactFlowProps?.edges?.some((edge) => edge.animated)).toBe(false);
	});
});
