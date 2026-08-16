/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import { useRegisterCanvasViewport } from "./canvas/viewport/CanvasViewportContext";
import type { RoadmapPerformanceMode } from "./models/types";
import { RoadmapView } from "./RoadmapView";

/**
 * Captured props of the canvas renderer.
 *
 * The renderer is mocked rather than the engine's internals: these assertions
 * are about the CONTRACT the shell hands down (which nodes, which edges,
 * whether dragging is allowed), not about how any engine draws it. That is why
 * they survived the swap from @xyflow/react to the in-house engine unchanged.
 */
type RendererMockProps = {
	edges?: Array<{ animated?: boolean }>;
	nodes?: Array<{ type?: string; data?: Record<string, unknown> }>;
	nodesDraggable?: boolean;
} & Record<string, unknown>;

let rendererProps: RendererMockProps | null = null;

/** Viewport port the mock renderer publishes, so canvas chrome is testable. */
const viewportStub = {
	zoomIn: vi.fn(),
	zoomOut: vi.fn(),
	fitView: vi.fn(),
	setCenter: vi.fn(),
	getViewport: () => ({ x: 0, y: 0, zoom: 0.67 }),
	getNode: () => undefined,
	getNodes: () => [],
	screenToCanvas: (p: { x: number; y: number }) => p,
	canvasToScreen: (p: { x: number; y: number }) => p,
};

vi.mock("./canvas/renderers/DomSvgRenderer", () => ({
	DomSvgRenderer: (props: RendererMockProps) => {
		rendererProps = props;
		const onReady = props.onReady as (() => void) | undefined;
		const registerViewport = useRegisterCanvasViewport();

		// Publish the viewport port exactly as a real renderer does, so the
		// shell-owned chrome (zoom buttons, fit view) is exercised rather than
		// silently hitting the no-op port.
		useEffect(() => {
			registerViewport(viewportStub);
			return () => registerViewport(null);
		}, [registerViewport]);
		// In an effect, not during render: the real engine fires this after its
		// first committed layout, and the shell sets state from it.
		useEffect(() => {
			onReady?.();
		}, [onReady]);
		return <div data-testid="canvas-renderer" />;
	},
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
		rendererProps = null;
	});

	it("does not render the MiniMap", () => {
		renderRoadmapView();

		expect(screen.queryByTestId("mini-map")).toBeNull();
	});

	it("disables animated edges in reduced-motion mode", () => {
		renderRoadmapView("reducedMotion");

		expect(rendererProps?.edges?.some((edge) => edge.animated)).toBe(false);
	});

	it("removes editing controls and node dragging in read-only mode", () => {
		renderRoadmapView("normal", true);

		const epicNode = rendererProps?.nodes?.find(
			(node) => node.type === "epicWidget",
		);
		const featureNode = rendererProps?.nodes?.find(
			(node) => node.type === "featureWidget",
		);

		expect(rendererProps?.nodesDraggable).toBe(false);
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
		rendererProps = null;
		vi.clearAllMocks();
	});

	it("exposes renderer-independent test hooks on the shell", () => {
		// These are what the e2e suite targets instead of React Flow's internal
		// class names, so they must survive the renderer swap.
		renderRoadmapView();

		const shell = screen.getByTestId("roadmap-canvas");
		expect(shell).toBeTruthy();
		expect(shell.getAttribute("data-canvas-engine")).toBe("dom-svg");
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
		expect(viewportStub.zoomIn).toHaveBeenCalled();

		screen.getByTestId("roadmap-canvas-zoom-out").click();
		expect(viewportStub.zoomOut).toHaveBeenCalled();

		screen.getByTestId("roadmap-canvas-fit-view").click();
		// Must keep the framing the canvas was designed around.
		expect(viewportStub.fitView).toHaveBeenCalledWith({
			padding: 0.12,
			maxZoom: 0.67,
		});
	});
});
