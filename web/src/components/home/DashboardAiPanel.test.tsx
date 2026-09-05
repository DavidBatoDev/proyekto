/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// The dashboard assistant is the shared kit in workspace scope. These tests
// exercise the wiring (scope from the current workspace, the two shapes'
// accessible names, the inert rail under the overlay, the commit
// invalidations) against the REAL `AiAssistantPanel`; only the network edges
// and the router are stubbed, the same way `AiAssistantPanel.test.tsx` does.
// -----------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
	currentWorkspace: vi.fn(() => ({
		workspace: null as null | { id: string; slug: string },
		workspaces: [] as Array<{ id: string; slug: string }>,
		isLoading: true,
	})),
	search: { current: {} as { assistant?: "full" } },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useSearch: (opts?: { select?: (search: unknown) => unknown }) =>
			opts?.select
				? opts.select(hoisted.search.current)
				: hoisted.search.current,
		useParams: () => ({}),
	};
});

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => hoisted.currentWorkspace(),
}));

vi.mock("@/services/ai-agent.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/ai-agent.service")>();
	const aiAgentService = {
		createSession: vi.fn(async () => ({ session_id: "t1" })),
		sendMessage: vi.fn(),
		continueRun: vi.fn(),
		cancelRun: vi.fn(),
		getTraceEvents: vi.fn(),
	};
	return { ...actual, aiAgentService, default: aiAgentService };
});

vi.mock("@/services/ai-sessions.service", () => ({
	aiSessionsService: {
		list: vi.fn(async () => []),
		create: vi.fn(async () => ({ id: "t1", title: null })),
		getById: vi.fn(async () => ({ id: "t1", metadata: {} })),
		update: vi.fn(),
		delete: vi.fn(),
		listMessages: vi.fn(async () => []),
		appendMessage: vi.fn(async () => ({ message: {}, seed_messages: [] })),
	},
	AiSessionsServiceError: class AiSessionsServiceError extends Error {
		statusCode?: number;
	},
}));

vi.mock("@/lib/realtime", () => ({
	isRealtimeConfigured: () => false,
	RealtimeRoom: class RealtimeRoom {
		on() {
			return this;
		}
		connect() {}
		close() {}
	},
}));

vi.mock("@/hooks/useDashboardProjectsQuery", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/hooks/useDashboardProjectsQuery")>();
	return {
		...actual,
		useDashboardProjectsQuery: () => ({ data: [], isLoading: false }),
	};
});

vi.mock("@/hooks/useRoadmapsPreviewQuery", () => ({
	roadmapsPreviewQueryOptions: (userId?: string) => ({
		queryKey: ["dashboard", "roadmaps-preview", userId ?? "anonymous"],
		queryFn: async () => [],
	}),
}));

vi.mock("@/services/teams.service", () => ({
	listMyTeams: async () => [],
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => null,
}));

import { aiRunController } from "@/components/ai/runController";
import { useThreadMessagesStore } from "@/components/ai/useAiThreadMessages";
import { projectKeys } from "@/queries/project";
import type { RunCommitView } from "@/services/ai-agent.service";
import { useAiRunStore } from "@/stores/aiRunStore";
import { useAiThreadsStore } from "@/stores/aiThreadsStore";
import {
	DashboardAiFullscreen,
	DashboardAiRail,
	invalidateAfterDashboardCommits,
} from "./DashboardAiPanel";

const WORKSPACE = { id: "ws-1", slug: "acme" };
const INTRO_COPY = "Ask Proyekto about your projects and roadmaps";
const PLACEHOLDER = "Ask Proyekto...";
const HINT = "Choose a workspace to start";

function setWorkspace(
	workspace: { id: string; slug: string } | null,
	isLoading: boolean,
) {
	hoisted.currentWorkspace.mockReturnValue({
		workspace,
		workspaces: workspace ? [workspace] : [],
		isLoading,
	});
}

function renderWithClient(element: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrap = (node: ReactElement) => (
		<QueryClientProvider client={client}>{node}</QueryClientProvider>
	);
	const utils = render(wrap(element));
	return {
		...utils,
		rerender: (next: ReactElement) => utils.rerender(wrap(next)),
	};
}

function stubMatchMedia() {
	// `useIsMobile` and framer-motion's `useReducedMotion` both read
	// matchMedia, which jsdom does not implement. Desktop, motion allowed.
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: vi.fn((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

beforeEach(() => {
	stubMatchMedia();
	// jsdom has no layout: the thread view's autoscroll anchor needs a stub.
	Element.prototype.scrollIntoView = vi.fn();
	hoisted.search.current = {};
	setWorkspace(WORKSPACE, false);
	aiRunController.resetForTests();
	useAiRunStore.setState({ runsByThread: {}, startingByScope: {} });
	useThreadMessagesStore.setState({
		messagesByThread: {},
		hydratedThreads: {},
	});
	useAiThreadsStore.setState({
		activeThreadIdByScope: {},
		draftInputByThread: {},
		draftPicksByThread: {},
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("DashboardAiRail", () => {
	it("renders the intro on an empty thread and expands from the header", async () => {
		const onExpand = vi.fn();
		renderWithClient(<DashboardAiRail onExpand={onExpand} />);

		expect(screen.getByLabelText("Proyekto assistant")).toBeTruthy();
		expect(screen.getByText(INTRO_COPY)).toBeTruthy();
		expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
		expect(onExpand).toHaveBeenCalledTimes(1);

		// The disconnected stub is gone for good.
		expect(screen.queryByText(/Not connected yet/)).toBeNull();
		expect(screen.queryByText(/not the assistant/)).toBeNull();
	});

	it("enables the composer once a workspace resolves", async () => {
		setWorkspace(null, true);
		const { rerender } = renderWithClient(
			<DashboardAiRail onExpand={() => {}} />,
		);
		const textarea = screen.getByPlaceholderText(
			PLACEHOLDER,
		) as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(true);
		expect(textarea.getAttribute("aria-label")).toBe("Ask Proyekto");

		setWorkspace(WORKSPACE, false);
		rerender(<DashboardAiRail onExpand={() => {}} />);
		await waitFor(() => expect(textarea.disabled).toBe(false));
		expect(screen.queryByText(HINT)).toBeNull();
	});

	it("shows the workspace hint only after loading settles without one", () => {
		setWorkspace(null, true);
		const { rerender } = renderWithClient(
			<DashboardAiRail onExpand={() => {}} />,
		);
		// Still loading: a disabled composer, but no hint that would flash on
		// every reload.
		expect(screen.queryByText(HINT)).toBeNull();

		setWorkspace(null, false);
		rerender(<DashboardAiRail onExpand={() => {}} />);
		expect(screen.getByText(HINT)).toBeTruthy();
		expect(
			(screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement)
				.disabled,
		).toBe(true);
	});

	it("is interactive and exposed while the overlay is closed", () => {
		hoisted.search.current = {};
		renderWithClient(<DashboardAiRail onExpand={() => {}} />);
		const aside = screen.getByLabelText("Proyekto assistant").closest("aside");
		expect(aside).not.toBeNull();
		expect(aside?.hasAttribute("inert")).toBe(false);
		expect(aside?.getAttribute("aria-hidden")).toBeNull();
		expect(
			screen.getByRole("region", { name: "Proyekto assistant" }),
		).toBeTruthy();
	});
});

describe("DashboardAiRail + DashboardAiFullscreen together", () => {
	it("carry distinct accessible names, and the rail is inert under the overlay", async () => {
		hoisted.search.current = { assistant: "full" };
		renderWithClient(
			<>
				<DashboardAiRail onExpand={() => {}} />
				<DashboardAiFullscreen onCollapse={() => {}} />
			</>,
		);

		// Exact-name lookups: one match each, so strict-mode locators hold.
		const rail = screen.getByLabelText("Proyekto assistant");
		const fullscreen = screen.getByLabelText("Proyekto assistant, full screen");
		expect(rail).not.toBe(fullscreen);

		const aside = rail.closest("aside");
		expect(aside?.hasAttribute("inert")).toBe(true);
		expect(aside?.getAttribute("aria-hidden")).toBe("true");

		// Only the fullscreen panel is in the accessibility tree.
		expect(
			screen.getByRole("region", { name: "Proyekto assistant, full screen" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Proyekto assistant" }),
		).toBeNull();

		// Both shapes greet with the same intro and carry the same composer.
		expect(screen.getAllByText(INTRO_COPY)).toHaveLength(2);
		const composers = screen.getAllByPlaceholderText(PLACEHOLDER);
		expect(composers).toHaveLength(2);
		await waitFor(() =>
			expect((composers[1] as HTMLTextAreaElement).disabled).toBe(false),
		);
		expect(
			screen.getByRole("button", { name: "Exit full screen" }),
		).toBeTruthy();
	});
});

describe("invalidateAfterDashboardCommits", () => {
	it("refreshes the dashboard lists, the search index, and each written roadmap once", () => {
		const client = new QueryClient();
		const invalidate = vi
			.spyOn(client, "invalidateQueries")
			.mockResolvedValue(undefined);
		const commit = (roadmapId: string): RunCommitView => ({
			batch_id: `b-${roadmapId}`,
			roadmap_id: roadmapId,
			status: "committed",
			operations_count: 1,
		});

		invalidateAfterDashboardCommits(client, [
			commit("rm-1"),
			commit("rm-2"),
			{ ...commit("rm-1"), batch_id: "b-rm-1-again" },
		]);

		const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
		expect(keys).toEqual([
			["dashboard", "roadmaps-preview"],
			["dashboard", "projects"],
			projectKeys.allRoadmapsFull,
			projectKeys.roadmapFull("rm-1"),
			projectKeys.roadmapFull("rm-2"),
		]);
	});
});

describe("DashboardAiPanel source", () => {
	const source = readFileSync(join(__dirname, "DashboardAiPanel.tsx"), "utf8");

	it("has no disconnected stub left", () => {
		expect(source).not.toContain("NOT_CONNECTED");
		expect(source).not.toContain("Not connected yet");
		expect(source).not.toMatch(/AssistantComposer|ThreadMenuButton\b/);
	});

	it("never imports the roadmap store (the dashboard renders many roadmaps)", () => {
		expect(source).not.toMatch(/from\s+["']@\/stores\/roadmapStore["']/);
		expect(source).not.toMatch(/from\s+["']@\/components\/roadmap\//);
	});
});

describe("DashboardAiRail quick questions", () => {
	it("sends the card's question verbatim as the first turn", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderWithClient(<DashboardAiRail onExpand={() => {}} />);
		const textarea = screen.getByPlaceholderText(
			PLACEHOLDER,
		) as HTMLTextAreaElement;
		await waitFor(() => expect(textarea.disabled).toBe(false));

		const group = screen.getByRole("group", { name: "Quick questions" });
		expect(within(group).getAllByRole("button")).toHaveLength(4);
		fireEvent.click(
			within(group).getByRole("button", {
				name: "What should I work on today?",
			}),
		);
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			content: "What should I work on today?",
			refs: [],
		});
		// The card sent; the composer draft is untouched.
		expect(textarea.value).toBe("");
	});

	it("keeps the cards disabled until a workspace resolves", () => {
		setWorkspace(null, false);
		renderWithClient(<DashboardAiRail onExpand={() => {}} />);
		const buttons = within(
			screen.getByRole("group", { name: "Quick questions" }),
		).getAllByRole("button");
		expect(buttons).toHaveLength(4);
		for (const button of buttons) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});
});
