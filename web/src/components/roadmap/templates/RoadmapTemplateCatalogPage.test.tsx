/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoadmapTemplateCatalogPage } from "@/routes/roadmap-templates/index";

const queryCapture = vi.hoisted(() => ({
	options: undefined as { queryKey: readonly unknown[] } | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: [] }),
	useInfiniteQuery: (options: { queryKey: readonly unknown[] }) => {
		queryCapture.options = options;
		return {
			data: { pages: [{ items: [], next_cursor: null }] },
			isPending: false,
			isError: false,
			hasNextPage: false,
			isFetchingNextPage: false,
			fetchNextPage: vi.fn(),
		};
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => options,
	useNavigate: () => vi.fn(),
	Link: ({
		children,
		to,
		className,
	}: {
		children?: ReactNode;
		to: string;
		className?: string;
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));

vi.mock("@/lib/roadmapIntakeDraft", () => ({
	createRoadmapIntakeDraft: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("RoadmapTemplateCatalogPage", () => {
	it("keeps template keyword search in filters beside the AI prompt", () => {
		render(<RoadmapTemplateCatalogPage />);

		expect(
			screen.getByLabelText("Describe what you want to build"),
		).toBeTruthy();
		const templateSearch = screen.getByLabelText("Search roadmap templates");
		const tags = screen.getByPlaceholderText("Filter by tags");

		fireEvent.change(templateSearch, { target: { value: "SaaS onboarding" } });
		fireEvent.change(tags, { target: { value: "retention" } });

		expect(queryCapture.options?.queryKey[1]).toMatchObject({
			search: "SaaS onboarding",
			tags: "retention",
		});

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect((templateSearch as HTMLInputElement).value).toBe("");
		expect((tags as HTMLInputElement).value).toBe("");
		expect(queryCapture.options?.queryKey[1]).toMatchObject({
			search: "",
			tags: "",
		});
	});
});
