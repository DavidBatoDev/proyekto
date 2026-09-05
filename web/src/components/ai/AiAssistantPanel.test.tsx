/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: null,
		workspaces: [],
		isLoading: false,
	}),
}));

vi.mock("@/hooks/useDashboardProjectsQuery", () => ({
	useDashboardProjectsQuery: () => ({ data: [], isLoading: false }),
}));

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

import { useAiRunStore } from "@/stores/aiRunStore";
import { useAiThreadsStore } from "@/stores/aiThreadsStore";
import {
	AiAssistantPanel,
	type AiAssistantPanelProps,
} from "./AiAssistantPanel";
import { aiRunController } from "./runController";
import type { AiSessionScope } from "./scope";
import type { AiMentionPick } from "./types";
import { useThreadMessagesStore } from "./useAiThreadMessages";

const roadmapScope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "rm-1",
	projectId: "proj-1",
};

const EMPTY_STATE_COPY = "Ask questions or request roadmap edits";
const PLACEHOLDER = "Chat or request roadmap edits...";

function baseProps(
	overrides: Partial<AiAssistantPanelProps> = {},
): AiAssistantPanelProps {
	return {
		scope: roadmapScope,
		variant: "panel",
		ariaLabel: "AI Assistant Panel",
		title: <span>AI Assistant</span>,
		emptyState: <p>{EMPTY_STATE_COPY}</p>,
		placeholder: PLACEHOLDER,
		...overrides,
	};
}

function renderPanel(props: AiAssistantPanelProps) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrap = (element: ReactElement) => (
		<QueryClientProvider client={client}>{element}</QueryClientProvider>
	);
	const utils = render(wrap(<AiAssistantPanel {...props} />));
	return {
		...utils,
		rerender: (next: AiAssistantPanelProps) =>
			utils.rerender(wrap(<AiAssistantPanel {...next} />)),
	};
}

beforeEach(() => {
	// jsdom has no layout: the thread view's autoscroll anchor needs a stub.
	Element.prototype.scrollIntoView = vi.fn();
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
		draftAutoExcludedByThread: {},
	});
});

async function enabledTextarea() {
	const textarea = (await screen.findByPlaceholderText(
		PLACEHOLDER,
	)) as HTMLTextAreaElement;
	await waitFor(() => expect(textarea.disabled).toBe(false));
	return textarea;
}

const ROADMAP_REF: AiMentionPick = {
	kind: "roadmap",
	id: "rm-1",
	label: "Onboarding",
	roadmapId: "rm-1",
	projectId: "proj-1",
};
const PROJECT_REF: AiMentionPick = {
	kind: "project",
	id: "proj-1",
	label: "Client project",
	projectId: "proj-1",
};
const AUTO_REFS = [ROADMAP_REF, PROJECT_REF];
/** Before the first thread exists the draft is keyed by scope. */
const SCOPE_DRAFT_KEY = "scope:roadmap:rm-1";
const removeName = (label: string) => `Remove ${label} from context`;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("AiAssistantPanel", () => {
	it("renders the unavailable hint and a disabled composer without a scope", () => {
		renderPanel(
			baseProps({
				scope: null,
				ariaLabel: "Proyekto assistant",
				placeholder: "Ask Proyekto...",
				unavailableHint: "Choose a workspace to start",
			}),
		);
		expect(screen.getByLabelText("Proyekto assistant")).toBeTruthy();
		expect(screen.getByText("Choose a workspace to start")).toBeTruthy();
		const textarea = screen.getByPlaceholderText(
			"Ask Proyekto...",
		) as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(true);
		expect(screen.getByText(EMPTY_STATE_COPY)).toBeTruthy();
	});

	it("renders the empty state and enables the composer once the thread list loads", async () => {
		renderPanel(baseProps());
		expect(screen.getByLabelText("AI Assistant Panel")).toBeTruthy();
		expect(screen.getByText(EMPTY_STATE_COPY)).toBeTruthy();
		const textarea = (await screen.findByPlaceholderText(
			PLACEHOLDER,
		)) as HTMLTextAreaElement;
		await waitFor(() => expect(textarea.disabled).toBe(false));
		expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
	});

	it("dispatches initialMessage exactly once through the controller across re-renders", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		const onConsumed = vi.fn();
		const props = baseProps({
			initialMessage: "Plan a launch",
			onInitialMessageConsumed: onConsumed,
		});
		const { rerender } = renderPanel(props);

		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			scope: roadmapScope,
			content: "Plan a launch",
			refs: [],
		});
		expect(onConsumed).toHaveBeenCalledTimes(1);

		rerender({ ...props });
		rerender({ ...props, isVisible: false });
		rerender({ ...props, isVisible: true });
		rerender({ ...props, initialMessage: null });
		rerender({ ...props });
		await act(async () => {});

		expect(send).toHaveBeenCalledTimes(1);
		expect(onConsumed).toHaveBeenCalledTimes(1);
	});

	it("sends the typed draft on Enter through the controller and clears it", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(baseProps());
		const textarea = (await screen.findByPlaceholderText(
			PLACEHOLDER,
		)) as HTMLTextAreaElement;
		await waitFor(() => expect(textarea.disabled).toBe(false));

		fireEvent.change(textarea, { target: { value: "Add an epic" } });
		expect(textarea.value).toBe("Add an epic");
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			threadId: null,
			content: "Add an epic",
			refs: [],
		});
		expect(typeof send.mock.calls[0][0].ensureThread).toBe("function");
		expect(textarea.value).toBe("");
	});

	it("shows the run banner and disables the composer while the thread is sending", async () => {
		useAiThreadsStore.setState({
			activeThreadIdByScope: { "roadmap:rm-1": "t1" },
		});
		useThreadMessagesStore.setState({ hydratedThreads: { t1: true } });
		useAiRunStore.getState().patchRun("t1", {
			scopeKey: "roadmap:rm-1",
			isSending: true,
			phase: "execute",
			commitsProgress: { done: 1, total: 2 },
		});
		renderPanel(baseProps());
		const textarea = (await screen.findByPlaceholderText(
			PLACEHOLDER,
		)) as HTMLTextAreaElement;
		expect(textarea.disabled).toBe(true);
		expect(screen.getByTestId("ai-run-banner").textContent).toContain(
			"Applying changes (1/2 roadmaps)",
		);
	});
});

describe("AiAssistantPanel context chips", () => {
	it("sends auto context refs as context-only spans and shows them as chips", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(baseProps({ autoContextRefs: AUTO_REFS }));
		const textarea = await enabledTextarea();
		expect(
			screen.getByRole("button", { name: removeName("Onboarding") }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: removeName("Client project") }),
		).toBeTruthy();

		fireEvent.change(textarea, { target: { value: "Add an epic" } });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			content: "Add an epic",
			refs: [
				{ ...ROADMAP_REF, offset: -1, length: 0 },
				{ ...PROJECT_REF, offset: -1, length: 0 },
			],
		});
		expect(textarea.value).toBe("");
	});

	it("removing an auto chip drops it for one message; it returns after the send", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(baseProps({ autoContextRefs: AUTO_REFS }));
		const textarea = await enabledTextarea();

		fireEvent.click(
			screen.getByRole("button", { name: removeName("Client project") }),
		);
		expect(
			screen.queryByRole("button", { name: removeName("Client project") }),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: removeName("Onboarding") }),
		).toBeTruthy();
		expect(
			useAiThreadsStore.getState().draftAutoExcludedByThread[SCOPE_DRAFT_KEY],
		).toEqual(["project:proj-1"]);

		fireEvent.change(textarea, { target: { value: "Add an epic" } });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0].refs).toEqual([
			{ ...ROADMAP_REF, offset: -1, length: 0 },
		]);

		// The exclusion went with the draft: the chip is back for the next turn.
		expect(
			await screen.findByRole("button", {
				name: removeName("Client project"),
			}),
		).toBeTruthy();
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread).toEqual({});
	});

	it("an @-mention of an auto ref shows one chip and is sent once, inline", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		useAiThreadsStore.setState({
			draftInputByThread: { [SCOPE_DRAFT_KEY]: "Fix @Onboarding" },
			draftPicksByThread: { [SCOPE_DRAFT_KEY]: [ROADMAP_REF] },
		});
		renderPanel(baseProps({ autoContextRefs: AUTO_REFS }));
		const textarea = await enabledTextarea();
		expect(textarea.value).toBe("Fix @Onboarding");
		expect(
			screen.getAllByRole("button", { name: removeName("Onboarding") }),
		).toHaveLength(1);

		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0].refs).toEqual([
			{ ...ROADMAP_REF, offset: 4, length: 11 },
			{ ...PROJECT_REF, offset: -1, length: 0 },
		]);
	});

	it("the add-context popover records a chip-only pick that is sent as context", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		const epic = {
			kind: "epic" as const,
			id: "e1",
			label: "Signup flow",
			roadmapId: "rm-1",
			projectId: "proj-1",
		};
		renderPanel(baseProps({ primaryMentionCandidates: [epic] }));
		const textarea = await enabledTextarea();

		fireEvent.click(screen.getByRole("button", { name: "Add context" }));
		await waitFor(() =>
			expect(screen.getByRole("option", { name: "Signup flow" })).toBeTruthy(),
		);
		fireEvent.keyDown(screen.getByLabelText("Search context"), {
			key: "Enter",
		});
		expect(
			screen.getByRole("button", { name: removeName("Signup flow") }),
		).toBeTruthy();
		expect(textarea.value).toBe("");
		expect(
			useAiThreadsStore.getState().draftPicksByThread[SCOPE_DRAFT_KEY],
		).toEqual([epic]);

		// Removing a picked chip drops the pick.
		fireEvent.click(
			screen.getByRole("button", { name: removeName("Signup flow") }),
		);
		expect(
			screen.queryByRole("button", { name: removeName("Signup flow") }),
		).toBeNull();
		expect(
			useAiThreadsStore.getState().draftPicksByThread[SCOPE_DRAFT_KEY],
		).toEqual([]);

		// Add it back and send: it travels as a context-only span.
		fireEvent.click(screen.getByRole("button", { name: "Add context" }));
		await waitFor(() =>
			expect(screen.getByRole("option", { name: "Signup flow" })).toBeTruthy(),
		);
		fireEvent.keyDown(screen.getByLabelText("Search context"), {
			key: "Enter",
		});
		fireEvent.change(textarea, { target: { value: "Split it" } });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			content: "Split it",
			refs: [{ ...epic, offset: -1, length: 0 }],
		});
		expect(useAiThreadsStore.getState().draftPicksByThread).toEqual({});
	});

	it("initialMessage carries the visible auto refs", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(
			baseProps({
				initialMessage: "Plan a launch",
				autoContextRefs: [ROADMAP_REF],
			}),
		);
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			content: "Plan a launch",
			refs: [{ ...ROADMAP_REF, offset: -1, length: 0 }],
		});
	});

	it("attaches nothing without autoContextRefs (the dashboard) but still offers Add context", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(baseProps());
		const textarea = await enabledTextarea();
		expect(
			screen
				.getByTestId("ai-context-row")
				.querySelectorAll("[data-context-source]"),
		).toHaveLength(0);
		expect(screen.getByRole("button", { name: "Add context" })).toBeTruthy();

		fireEvent.change(textarea, { target: { value: "hi" } });
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0].refs).toEqual([]);
	});
});

describe("AiAssistantPanel empty-state sends", () => {
	it("a function-valued emptyState sends through the panel with the auto refs", async () => {
		const send = vi.spyOn(aiRunController, "send").mockResolvedValue();
		renderPanel(
			baseProps({
				autoContextRefs: AUTO_REFS,
				emptyState: ({ send: ask, disabled }) => (
					<button
						type="button"
						disabled={disabled}
						onClick={() => ask("  What is next?  ")}
					>
						Quick question
					</button>
				),
			}),
		);
		await enabledTextarea();
		const card = screen.getByRole("button", {
			name: "Quick question",
		}) as HTMLButtonElement;
		await waitFor(() => expect(card.disabled).toBe(false));
		fireEvent.click(card);
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toMatchObject({
			content: "What is next?",
			refs: [
				{ ...ROADMAP_REF, offset: -1, length: 0 },
				{ ...PROJECT_REF, offset: -1, length: 0 },
			],
		});
	});

	it("reports the empty-state send as disabled without a scope", () => {
		renderPanel(
			baseProps({
				scope: null,
				emptyState: ({ disabled }) => (
					<button type="button" disabled={disabled}>
						Quick question
					</button>
				),
			}),
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Quick question",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
});
