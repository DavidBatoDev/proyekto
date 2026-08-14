/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import type { RoadmapPerformanceMode } from "./models/types";
import { RoadmapView } from "./RoadmapView";

type ReactFlowMockProps = {
	children?: ReactNode;
	edges?: Array<{ animated?: boolean }>;
	nodes?: Array<{ type?: string; data?: Record<string, unknown> }>;
	nodesDraggable?: boolean;
} & Record<string, unknown>;

let reactFlowProps: ReactFlowMockProps | null = null;

/**
 * Stub instance handed to `onInit`, so the shell-owned canvas chrome (which
 * drives the renderer imperatively) can be exercised in jsdom.
 */
const flowInstance = {
	zoomIn: vi.fn(),
	zoomOut: vi.fn(),
	fitView: vi.fn(),
	getZoom: () => 0.67,
	getViewport: () => ({ x: 0, y: 0, zoom: 0.67 }),
	getNode: () => undefined,
	getNodes: () => [],
	setCenter: vi.fn(),
	screenToFlowPosition: (p: { x: number; y: number }) => p,
};

vi.mock("@xyflow/react", () => ({
	ReactFlow: ({ children, ...props }: ReactFlowMockProps) => {
		reactFlowProps = props;
		const onInit = props.onInit as ((i: unknown) => void) | undefined;
		// In an effect, not during render: `onInit` sets state on the parent, and
		// the real ReactFlow also fires it post-mount.
		useEffect(() => {
			onInit?.(flowInstance);
		}, [onInit]);
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
	useNodesInitialized: () => true,
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
				status: "not_started",
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
						board_order: 0,
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		],
	},
];

function renderRoadmapView(
	performanceMode: RoadmapPerformanceMode = "normal",
	readOnly = false,
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<RoadmapView
				roadmap={roadmap}
				epics={epics}
				performanceMode={performanceMode}
				readOnly={readOnly}
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

	it("removes editing controls and node dragging in read-only mode", () => {
		renderRoadmapView("normal", true);

		const epicNode = reactFlowProps?.nodes?.find(
			(node) => node.type === "epicWidget",
		);
		const featureNode = reactFlowProps?.nodes?.find(
			(node) => node.type === "featureWidget",
		);

		expect(reactFlowProps?.nodesDraggable).toBe(false);
		expect(epicNode?.data?.onEdit).toBeUndefined();
		expect(epicNode?.data?.onDelete).toBeUndefined();
		expect(featureNode?.data?.onEdit).toBeUndefined();
		expect(featureNode?.data?.onDelete).toBeUndefined();
		expect(featureNode?.data?.onUpdateTask).toBeUndefined();
		expect(screen.queryByText("Drag To Add")).toBeNull();
	});
});

describe("RoadmapView canvas chrome", () => {
	afterEach(() => {
		cleanup();
		reactFlowProps = null;
		vi.clearAllMocks();
	});

	it("exposes renderer-independent test hooks on the shell", () => {
		// These are what the e2e suite targets instead of React Flow's internal
		// class names, so they must survive the renderer swap.
		renderRoadmapView();

		const shell = screen.getByTestId("roadmap-canvas");
		expect(shell).toBeTruthy();
		expect(shell.getAttribute("data-canvas-engine")).toBe("react-flow");
		expect(shell.getAttribute("data-canvas-ready")).toBeTruthy();
	});

	it("renders its own zoom and fit-view controls, not React Flow's", () => {
		renderRoadmapView();

		expect(screen.getByTestId("roadmap-canvas-zoom-in")).toBeTruthy();
		expect(screen.getByTestId("roadmap-canvas-zoom-out")).toBeTruthy();
		expect(screen.getByTestId("roadmap-canvas-fit-view")).toBeTruthy();
		// React Flow's <Controls> is no longer mounted.
		expect(screen.queryByTestId("controls")).toBeNull();
	});

	it("drives the renderer viewport from the controls", () => {
		renderRoadmapView();

		screen.getByTestId("roadmap-canvas-zoom-in").click();
		expect(flowInstance.zoomIn).toHaveBeenCalled();

		screen.getByTestId("roadmap-canvas-zoom-out").click();
		expect(flowInstance.zoomOut).toHaveBeenCalled();

		screen.getByTestId("roadmap-canvas-fit-view").click();
		// Must keep the framing the canvas was designed around.
		expect(flowInstance.fitView).toHaveBeenCalledWith({
			padding: 0.12,
			maxZoom: 0.67,
		});
	});
});
