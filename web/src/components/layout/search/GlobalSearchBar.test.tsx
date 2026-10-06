/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearchBar } from "./GlobalSearchBar";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

const authState: { user: { id: string } | null } = { user: { id: "u1" } };

vi.mock("@/stores/authStore", () => ({
	useUser: () => authState.user,
	useProfile: () => ({ id: "u1", is_consultant_verified: false }),
}));

vi.mock("@/hooks/useDashboardProjectsQuery", () => ({
	useDashboardProjectsQuery: () => ({
		data: [{ id: "p1", title: "Website revamp" }],
	}),
}));

vi.mock("@/hooks/useProjectQueries", () => ({
	useAllRoadmapsFullQuery: () => ({
		data: [
			{
				id: "r1",
				project: { id: "p1", title: "Website revamp" },
				epics: [
					{
						id: "e1",
						title: "Launch epic",
						position: 0,
						features: [
							{
								id: "f1",
								title: "Landing page",
								tasks: [{ id: "t1", title: "Hero section" }],
							},
						],
					},
				],
			},
		],
		isPending: false,
		isFetching: false,
	}),
}));

// The sidebar's Time gate reads GET /time/me/overview; the search shares it.
const timeState: {
	overview:
		| {
				can_log?: boolean;
				approvals_waiting?: number;
				workspace_time_admin?: unknown[];
		  }
		| undefined;
} = { overview: undefined };

vi.mock("@/queries/time", () => ({
	useTimeOverview: () => ({ data: timeState.overview }),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

beforeEach(() => {
	authState.user = { id: "u1" };
	timeState.overview = undefined;
});

const getInput = () => screen.getByRole("combobox", { name: "Search" });

describe("GlobalSearchBar", () => {
	it("renders nothing for guests", () => {
		authState.user = null;
		const { container } = render(<GlobalSearchBar />);
		expect(container.firstChild).toBeNull();
	});

	it("opens a grouped listbox when a query matches", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "revamp" } });

		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.getByText("Projects")).toBeTruthy();
		expect(screen.getByRole("option", { name: /Website revamp/ })).toBeTruthy();
		expect(input.getAttribute("aria-expanded")).toBe("true");
	});

	it("navigates to the active option on Enter, work items deep-linking the node", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "hero" } });
		fireEvent.keyDown(input, { key: "Enter" });

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "p1", roadmapId: "r1" },
			search: { nodeId: "t1" },
		});
		// The query clears after committing.
		expect((input as HTMLInputElement).value).toBe("");
	});

	it("moves the active option with arrow keys, wrapping around", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		// "la" matches the Landing page feature and the Launch epic.
		fireEvent.change(input, { target: { value: "la" } });
		const options = screen.getAllByRole("option");
		expect(options.length).toBeGreaterThan(1);

		expect(options[0].getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(input, { key: "ArrowUp" });
		const after = screen.getAllByRole("option");
		expect(after[after.length - 1].getAttribute("aria-selected")).toBe("true");
	});

	it("Escape clears the dropdown first, then closes on the next press", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "hero" } });
		expect(screen.getByRole("listbox")).toBeTruthy();

		fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect((input as HTMLInputElement).value).toBe("");

		// A second Escape collapses (reported via onExpandedChange).
		const onExpandedChange = vi.fn();
		cleanup();
		render(<GlobalSearchBar onExpandedChange={onExpandedChange} />);
		const second = getInput();
		fireEvent.focus(second);
		expect(onExpandedChange).toHaveBeenLastCalledWith(true);
		fireEvent.keyDown(second, { key: "Escape" });
		expect(onExpandedChange).toHaveBeenLastCalledWith(false);
	});

	it("focuses the input on '/' unless typing elsewhere or a dialog is open", () => {
		render(
			<div>
				<GlobalSearchBar />
				<input aria-label="Other field" />
			</div>,
		);
		const input = getInput();

		fireEvent.keyDown(window, { key: "/" });
		expect(document.activeElement).toBe(input);

		input.blur();
		const other = screen.getByRole("textbox", { name: "Other field" });
		other.focus();
		fireEvent.keyDown(other, { key: "/" });
		expect(document.activeElement).toBe(other);

		other.blur();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.appendChild(dialog);
		fireEvent.keyDown(window, { key: "/" });
		expect(document.activeElement).not.toBe(input);
		dialog.remove();
	});

	it("offers the Time page to someone the sidebar shows it to", () => {
		timeState.overview = { can_log: true };
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "time" } });

		const option = screen.getByRole("option", { name: "Time" });
		fireEvent.click(option);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/time" });
	});

	it("offers Time to a decider or a workspace time admin who cannot log", () => {
		timeState.overview = { can_log: false, approvals_waiting: 2 };
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "time" } });
		expect(screen.getByRole("option", { name: "Time" })).toBeTruthy();

		cleanup();
		timeState.overview = { can_log: false, workspace_time_admin: [{}] };
		render(<GlobalSearchBar />);
		const second = getInput();
		fireEvent.focus(second);
		fireEvent.change(second, { target: { value: "time" } });
		expect(screen.getByRole("option", { name: "Time" })).toBeTruthy();
	});

	it("hides the Time page while the overview loads or when the gate is shut", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "time" } });
		expect(screen.queryByRole("option", { name: "Time" })).toBeNull();

		cleanup();
		timeState.overview = {
			can_log: false,
			approvals_waiting: 0,
			workspace_time_admin: [],
		};
		render(<GlobalSearchBar />);
		const second = getInput();
		fireEvent.focus(second);
		fireEvent.change(second, { target: { value: "time" } });
		expect(screen.queryByRole("option", { name: "Time" })).toBeNull();
	});

	it("shows No results for a query nothing matches", () => {
		render(<GlobalSearchBar />);
		const input = getInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "zzzz-no-match" } });

		expect(screen.getByText("No results")).toBeTruthy();
	});
});
