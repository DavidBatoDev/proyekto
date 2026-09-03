/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoadmapsGrid } from "./RoadmapsGrid";

const { getRoadmapsPreview, deleteRoadmap } = vi.hoisted(() => ({
	getRoadmapsPreview: vi.fn(),
	deleteRoadmap: vi.fn(),
}));

vi.mock("@/api", () => ({ getRoadmapsPreview, deleteRoadmap }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
	}: {
		children?: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
	}) => (
		<a
			href={to.replace("$projectId", params?.projectId ?? "$projectId")}
			className={className}
		>
			{children}
		</a>
	),
}));

vi.mock("@/components/roadmap/RoadmapStartDialog", () => ({
	RoadmapStartTrigger: ({
		children,
		className,
		hierarchyLevel,
	}: {
		children?: ReactNode;
		className?: string;
		hierarchyLevel?: string;
	}) => (
		<button
			type="button"
			className={className}
			data-hierarchy-level={hierarchyLevel}
		>
			{children}
		</button>
	),
}));

vi.mock("@/components/home/RoadmapPreviewCard", () => ({
	RoadmapPreviewCard: ({ title }: { title: string }) => (
		<article>{title}</article>
	),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderGrid() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<RoadmapsGrid />
		</QueryClientProvider>,
	);
}

describe("RoadmapsGrid", () => {
	it("keeps standalone roadmap creation visible when roadmaps already exist", async () => {
		getRoadmapsPreview.mockResolvedValue([
			{
				id: "roadmap-1",
				name: "Existing roadmap",
				description: "Current plan",
				status: "draft",
				project_id: null,
				epics: [],
			},
		]);

		renderGrid();

		expect(await screen.findByText("Existing roadmap")).toBeTruthy();
		expect(screen.getByRole("button", { name: /new roadmap/i })).toBeTruthy();
	});

	it("renders nothing at all when there are no roadmaps", async () => {
		getRoadmapsPreview.mockResolvedValue([]);

		const { container } = renderGrid();

		// An empty section is a heading, a subtitle and a prompt spending a
		// screenful to say "no". Creating a roadmap stays available on the welcome
		// card above.
		await waitFor(() => {
			expect(screen.queryByText("MY ROADMAPS")).toBeNull();
		});
		expect(container.textContent).toBe("");
	});
});
