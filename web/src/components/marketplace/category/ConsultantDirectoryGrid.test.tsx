/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsultantDirectoryGrid } from "./ConsultantDirectoryGrid";

const useConsultantDirectoryQuery = vi.fn();

vi.mock("@/hooks/useConsultants", () => ({
	useConsultantDirectoryQuery: (params: unknown) =>
		useConsultantDirectoryQuery(params),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children?: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

const consultant = (id: string) => ({
	id,
	display_name: `Consultant ${id}`,
	headline: "Does the work",
});

afterEach(() => {
	vi.clearAllMocks();
	cleanup();
});

const renderGrid = () =>
	render(
		<ConsultantDirectoryGrid
			params={{ category: "ai-and-data" }}
			emptyState={<p>Nobody here yet</p>}
		/>,
	);

describe("ConsultantDirectoryGrid", () => {
	it("shows skeletons while pending", () => {
		useConsultantDirectoryQuery.mockReturnValue({ isPending: true });
		const { container } = renderGrid();

		expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
			0,
		);
	});

	it("shows a recoverable message on error", () => {
		useConsultantDirectoryQuery.mockReturnValue({
			isPending: false,
			isError: true,
		});
		renderGrid();

		expect(screen.getByText(/could not load consultants/i)).toBeTruthy();
	});

	it("renders the empty state slot when there are no results", () => {
		useConsultantDirectoryQuery.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [], total: 0, limit: 24, offset: 0 },
		});
		renderGrid();

		expect(screen.getByText("Nobody here yet")).toBeTruthy();
	});

	it("renders a card per consultant", () => {
		useConsultantDirectoryQuery.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				items: [consultant("a"), consultant("b")],
				total: 2,
				limit: 24,
				offset: 0,
			},
		});
		renderGrid();

		expect(screen.getByText("Consultant a")).toBeTruthy();
		expect(screen.getByText("Consultant b")).toBeTruthy();
	});

	it("hides Load more once every result is on screen", () => {
		useConsultantDirectoryQuery.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [consultant("a")], total: 1, limit: 24, offset: 0 },
		});
		renderGrid();

		expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
	});

	it("asks for a larger page when Load more is pressed", () => {
		useConsultantDirectoryQuery.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [consultant("a")], total: 50, limit: 24, offset: 0 },
		});
		renderGrid();

		expect(useConsultantDirectoryQuery).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 24 }),
		);

		fireEvent.click(screen.getByRole("button", { name: /load more/i }));

		expect(useConsultantDirectoryQuery).toHaveBeenLastCalledWith(
			expect.objectContaining({ limit: 48, offset: 0 }),
		);
	});
});
