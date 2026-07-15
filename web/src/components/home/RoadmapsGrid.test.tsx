/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
		expect(
			screen.getByRole("link", { name: /new roadmap/i }).getAttribute("href"),
		).toBe("/roadmap-templates");
	});

	it("retains the empty-state creation action", async () => {
		getRoadmapsPreview.mockResolvedValue([]);

		renderGrid();

		expect(
			await screen.findByText("Your first roadmap is taking shape"),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: /^create roadmap$/i })
				.getAttribute("href"),
		).toBe("/roadmap-templates");
		expect(
			screen.getByRole("link", { name: /new roadmap/i }).getAttribute("href"),
		).toBe("/roadmap-templates");
	});
});
