/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrimaryFlow } from "./LeftSide";

const { useDashboardContent } = vi.hoisted(() => ({
	useDashboardContent: vi.fn(),
}));

vi.mock("@/hooks/useDashboardContent", () => ({ useDashboardContent }));

// The three grids and the widget shell each own a stack of queries, realtime
// subscriptions and router hooks. This suite is about which of them renders.
vi.mock("./DashboardWidgets", () => ({
	DashboardWidgets: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="dashboard-widgets">{children}</div>
	),
}));
vi.mock("./DashboardEmptyState", () => ({
	DashboardEmptyState: () => <div data-testid="dashboard-empty-state" />,
}));
vi.mock("./ProjectsGrid", () => ({
	ProjectsGrid: () => <div data-testid="projects-grid" />,
}));
vi.mock("./RoadmapsGrid", () => ({
	RoadmapsGrid: () => <div data-testid="roadmaps-grid" />,
}));
vi.mock("./TeamsGrid", () => ({
	TeamsGrid: () => <div data-testid="teams-grid" />,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function setContent(overrides: { isEmpty: boolean }) {
	useDashboardContent.mockReturnValue({
		projects: [],
		roadmaps: [],
		teams: [],
		teamInvites: [],
		isLoading: false,
		...overrides,
	});
}

describe("PrimaryFlow", () => {
	it("gives a blank account the get-started card and nothing else", () => {
		setContent({ isEmpty: true });

		render(<PrimaryFlow />);

		expect(screen.getByTestId("dashboard-empty-state")).toBeTruthy();
		// The five panels a new account used to meet: three grids plus the
		// meetings and activity cards inside DashboardWidgets.
		expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
		expect(screen.queryByTestId("projects-grid")).toBeNull();
		expect(screen.queryByTestId("roadmaps-grid")).toBeNull();
		expect(screen.queryByTestId("teams-grid")).toBeNull();
	});

	it("renders every section once there is content, teams first", () => {
		setContent({ isEmpty: false });

		render(<PrimaryFlow />);

		expect(screen.queryByTestId("dashboard-empty-state")).toBeNull();
		expect(screen.getByTestId("dashboard-widgets")).toBeTruthy();

		// Teams keeps the top of the page; it earns the spot by rendering nothing
		// when there is no team to show (see TeamsGrid).
		const sections = screen
			.getAllByTestId(/-grid$/)
			.map((el) => el.getAttribute("data-testid"));
		expect(sections).toEqual(["teams-grid", "projects-grid", "roadmaps-grid"]);
	});

	it("keeps the full layout while the lists are still loading", () => {
		// isEmpty stays false until every query settles, so the onboarding card
		// cannot flash on a hard refresh and then be yanked away.
		setContent({ isEmpty: false });
		useDashboardContent.mockReturnValue({
			projects: [],
			roadmaps: [],
			teams: [],
			teamInvites: [],
			isLoading: true,
			isEmpty: false,
		});

		render(<PrimaryFlow />);

		expect(screen.getByTestId("dashboard-widgets")).toBeTruthy();
		expect(screen.queryByTestId("dashboard-empty-state")).toBeNull();
	});
});
