/* @vitest-environment jsdom */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";

vi.mock("@/services/ai-agent.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/ai-agent.service")>();
	const aiAgentService = {
		createSession: vi.fn(),
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
		create: vi.fn(),
		getById: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		listMessages: vi.fn(async () => []),
		appendMessage: vi.fn(),
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

import {
	type AgentRunResponse,
	type AgentTraceEvent,
	AiAgentServiceError,
	aiAgentService,
	type RunCommitView,
	type RunView,
} from "@/services/ai-agent.service";
import { useAiRunStore } from "@/stores/aiRunStore";
import {
	aiRunController,
	RUN_LOST_CONTACT_MESSAGE,
	RUN_TIMED_OUT_MESSAGE,
	type SendParams,
	STOPPED_MESSAGE,
	type ThreadPersistence,
} from "./runController";
import type { AiSessionScope } from "./scope";
import type { AiMentionSpan } from "./types";
import { useThreadMessagesStore } from "./useAiThreadMessages";

const agent = aiAgentService as unknown as {
	createSession: Mock;
	sendMessage: Mock;
	continueRun: Mock;
	cancelRun: Mock;
	getTraceEvents: Mock;
};

const THREAD = "t1";
const scope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "rm-1",
	projectId: "proj-1",
};

const runView = (overrides: Partial<RunView> = {}): RunView => ({
	run_id: "run-1",
	trace_id: "trace-1",
	status: "running",
	phase: "investigate",
	next: "continue",
	scope: { kind: "roadmap", roadmap_id: "rm-1" },
	commits: [],
	created_at: "2026-09-04T10:00:00.000Z",
	updated_at: "2026-09-04T10:00:00.000Z",
	...overrides,
});

const response = (
	overrides: Partial<AgentRunResponse> = {},
): AgentRunResponse => ({
	session_id: THREAD,
	assistant_message: "",
	parse_mode: "run_step",
	intent_type: "roadmap_edit",
	response_mode: "chat",
	operations: [],
	staged_operations_version: 0,
	staged_operations_count: 0,
	...overrides,
});

const doneResponse = (
	message = "Done!",
	extra: Partial<AgentRunResponse> = {},
) =>
	response({
		assistant_message: message,
		parse_mode: "run_report",
		run: runView({ status: "done", next: "done", phase: "verify" }),
		...extra,
	});

const committed = (overrides: Partial<RunCommitView> = {}): RunCommitView => ({
	batch_id: "b1",
	roadmap_id: "rm-1",
	roadmap_title: "Alpha",
	project_id: "proj-1",
	status: "committed",
	change_id: "chg-1",
	operations_count: 1,
	operations: [{ op: "add_epic", temp_id: "e1", data: { title: "X" } }],
	impacted_items: [
		{ node_id: "epic-1", node_type: "epic", title: "X", impact: "created" },
	],
	...overrides,
});

const traceResponse = (
	overrides: Partial<{
		trace_id: string;
		events: AgentTraceEvent[];
		next_seq: number;
		done: boolean;
	}> = {},
) => ({
	trace_id: "trace-1",
	events: [],
	next_seq: 0,
	done: true,
	...overrides,
});

const agentError = (
	status: number | undefined,
	code: string | null,
	run?: RunView,
	message = "Request failed",
) => new AiAgentServiceError(message, status, undefined, { code, run });

const timeoutError = () =>
	new AiAgentServiceError(
		"Continue AI run failed: timeout of 180000ms exceeded",
	);

function makePersist(): ThreadPersistence & {
	persistTurn: Mock;
	rehydrateAgentSession: Mock;
	ensureAgentSession: Mock;
} {
	return {
		persistTurn: vi.fn(async () => ({
			seed_messages: [{ role: "user", content: "Add an epic" }],
		})),
		rehydrateAgentSession: vi.fn(async () => {}),
		ensureAgentSession: vi.fn(async () => {}),
	};
}

function sendParams(overrides: Partial<SendParams> = {}): SendParams {
	return {
		scope,
		threadId: THREAD,
		ensureThread: vi.fn(async () => THREAD),
		content: "Add an epic",
		refs: [],
		persist: makePersist(),
		hooks: {},
		...overrides,
	};
}

const messages = () =>
	useThreadMessagesStore.getState().messagesByThread[THREAD] ?? [];
const runState = () => useAiRunStore.getState().runsByThread[THREAD];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.clearAllMocks();
	aiRunController.resetForTests();
	useAiRunStore.setState({ runsByThread: {}, startingByScope: {} });
	useThreadMessagesStore.setState({
		messagesByThread: {},
		hydratedThreads: {},
	});
	agent.getTraceEvents.mockImplementation(async () => traceResponse());
	agent.cancelRun.mockResolvedValue({
		run: runView({ status: "cancelled", next: "done" }),
	});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("aiRunController.send", () => {
	it("drives send -> continue x2 -> done and appends one assistant turn with commits", async () => {
		const span: AiMentionSpan = {
			kind: "roadmap",
			id: "rm-2",
			label: "Beta",
			offset: 0,
			length: 5,
			roadmapId: "rm-2",
			projectId: null,
		};
		agent.sendMessage.mockResolvedValue(
			response({ run: runView({ next: "continue", phase: "investigate" }) }),
		);
		agent.continueRun
			.mockResolvedValueOnce(
				response({
					run: runView({ next: "continue", phase: "execute" }),
					commits: [committed()],
				}),
			)
			.mockResolvedValueOnce(
				doneResponse("Done!", {
					commits: [committed({ operations: undefined })],
				}),
			);
		const onCommits = vi.fn();
		const params = sendParams({ refs: [span], hooks: { onCommits } });

		await aiRunController.send(params);

		expect(agent.sendMessage).toHaveBeenCalledTimes(1);
		expect(agent.sendMessage.mock.calls[0][0]).toBe(THREAD);
		expect(agent.sendMessage.mock.calls[0][1]).toEqual({
			message: "Add an epic",
			refs: [{ kind: "roadmap", id: "rm-2", label: "Beta" }],
			capabilities: ["continue"],
		});
		expect(agent.continueRun).toHaveBeenCalledTimes(2);
		expect(agent.continueRun.mock.calls[0].slice(0, 2)).toEqual([
			THREAD,
			"run-1",
		]);
		expect(agent.continueRun.mock.calls[1].slice(0, 2)).toEqual([
			THREAD,
			"run-1",
		]);

		const thread = messages();
		expect(thread).toHaveLength(2);
		expect(thread[0]).toMatchObject({
			role: "user",
			content: "Add an epic",
			refs: [span],
		});
		expect(thread[1]).toMatchObject({
			role: "assistant",
			content: "Done!",
			runId: "run-1",
		});
		expect(thread[1].commits).toHaveLength(1);

		const persist = params.persist as ReturnType<typeof makePersist>;
		expect(persist.persistTurn).toHaveBeenCalledTimes(2);
		expect(persist.persistTurn.mock.calls[0].slice(1, 3)).toEqual([
			"user",
			"Add an epic",
		]);
		expect(persist.persistTurn.mock.calls[0][3]).toEqual({
			metadata: { refs: [span] },
		});
		expect(persist.persistTurn.mock.invocationCallOrder[0]).toBeLessThan(
			agent.sendMessage.mock.invocationCallOrder[0],
		);
		expect(persist.persistTurn.mock.calls[1][1]).toBe("assistant");
		expect(persist.persistTurn.mock.invocationCallOrder[1]).toBeGreaterThan(
			agent.continueRun.mock.invocationCallOrder[1],
		);
		const assistantMeta = persist.persistTurn.mock.calls[1][3].metadata;
		expect(assistantMeta.run).toMatchObject({
			run_id: "run-1",
			status: "done",
			phase: "verify",
		});
		expect(assistantMeta.run.commits[0].operations).toBeUndefined();

		// The commit is handed to the hook exactly once, with its operations.
		expect(onCommits).toHaveBeenCalledTimes(1);
		expect(onCommits.mock.calls[0][0][0].operations).toHaveLength(1);
		expect(onCommits.mock.calls[0][1]).toEqual({
			threadId: THREAD,
			runId: "run-1",
		});

		expect(runState()).toMatchObject({
			isSending: false,
			status: "done",
			phase: "verify",
			runId: "run-1",
			resumable: null,
		});
	});

	it("settles at a checkpoint without calling continue and carries the clarifier", async () => {
		const clarifier = {
			lane: "edit" as const,
			question_id: "q1",
			question: "Which roadmap?",
			options: ["Alpha", "Beta"],
			allow_custom: true,
		};
		agent.sendMessage.mockResolvedValue(
			response({
				assistant_message: "Which one?",
				clarifier,
				run: runView({
					status: "awaiting_user",
					next: "await_user",
					checkpoint: "clarifier",
				}),
			}),
		);

		await aiRunController.send(sendParams());

		expect(agent.continueRun).not.toHaveBeenCalled();
		const thread = messages();
		expect(thread).toHaveLength(2);
		expect(thread[1].clarifier).toEqual(clarifier);
		expect(thread[1].content).toBe("Which one?");
		expect(runState()).toMatchObject({
			isSending: false,
			status: "awaiting_user",
			next: "await_user",
		});
	});

	it("cancel calls cancelRun and the in-flight leg settles as Stopped.", async () => {
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		const pending = deferred<AgentRunResponse>();
		agent.continueRun.mockImplementationOnce(() => pending.promise);

		const sending = aiRunController.send(sendParams());
		await flush();
		expect(agent.continueRun).toHaveBeenCalledTimes(1);

		await aiRunController.cancel(THREAD);
		expect(agent.cancelRun).toHaveBeenCalledWith(THREAD, "run-1");
		expect(runState().cancelRequested).toBe(true);

		pending.resolve(
			response({ run: runView({ status: "cancelled", next: "done" }) }),
		);
		await sending;

		expect(agent.continueRun).toHaveBeenCalledTimes(1);
		const thread = messages();
		expect(thread[1]).toMatchObject({
			role: "assistant",
			content: STOPPED_MESSAGE,
		});
		expect(runState()).toMatchObject({
			isSending: false,
			status: "cancelled",
			cancelRequested: false,
		});
	});

	it("rehydrates the agent session with the seeds and retries once on SESSION_NOT_FOUND (send)", async () => {
		agent.sendMessage
			.mockRejectedValueOnce(agentError(404, "SESSION_NOT_FOUND"))
			.mockResolvedValueOnce(doneResponse());
		const params = sendParams({ baseRevision: 7 });

		await aiRunController.send(params);

		const persist = params.persist as ReturnType<typeof makePersist>;
		expect(persist.rehydrateAgentSession).toHaveBeenCalledTimes(1);
		expect(persist.rehydrateAgentSession).toHaveBeenCalledWith(
			THREAD,
			[{ role: "user", content: "Add an epic" }],
			{ scope, baseRevision: 7 },
		);
		expect(agent.sendMessage).toHaveBeenCalledTimes(2);
		expect(messages()[1].content).toBe("Done!");
	});

	it("rehydrates and retries once on SESSION_NOT_FOUND (continue)", async () => {
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun
			.mockRejectedValueOnce(agentError(404, "SESSION_NOT_FOUND"))
			.mockResolvedValueOnce(doneResponse());
		const params = sendParams();

		await aiRunController.send(params);

		const persist = params.persist as ReturnType<typeof makePersist>;
		expect(persist.rehydrateAgentSession).toHaveBeenCalledTimes(1);
		expect(agent.continueRun).toHaveBeenCalledTimes(2);
		expect(messages()[1].content).toBe("Done!");
		expect(runState().isSending).toBe(false);
	});

	it("RUN_IN_PROGRESS on send adopts the run, drives it, then re-sends the message", async () => {
		const adopted = runView({
			run_id: "run-0",
			trace_id: "trace-0",
			phase: "execute",
			next: "continue",
		});
		agent.sendMessage
			.mockRejectedValueOnce(agentError(409, "RUN_IN_PROGRESS", adopted))
			.mockResolvedValueOnce(doneResponse("Second turn"));
		agent.continueRun.mockResolvedValueOnce(
			response({
				assistant_message: "Finished the earlier run",
				run: runView({
					run_id: "run-0",
					trace_id: "trace-0",
					status: "done",
					next: "done",
				}),
			}),
		);
		const params = sendParams();

		await aiRunController.send(params);

		expect(agent.continueRun).toHaveBeenCalledTimes(1);
		expect(agent.continueRun.mock.calls[0].slice(0, 2)).toEqual([
			THREAD,
			"run-0",
		]);
		expect(agent.sendMessage).toHaveBeenCalledTimes(2);
		expect(agent.continueRun.mock.invocationCallOrder[0]).toBeLessThan(
			agent.sendMessage.mock.invocationCallOrder[1],
		);
		// The user turn was persisted once; the agent never saw it before the re-send.
		const persist = params.persist as ReturnType<typeof makePersist>;
		expect(
			persist.persistTurn.mock.calls.filter((call) => call[1] === "user"),
		).toHaveLength(1);
		const thread = messages();
		expect(thread.map((m) => [m.role, m.content])).toEqual([
			["user", "Add an epic"],
			["assistant", "Finished the earlier run"],
			["assistant", "Second turn"],
		]);
		expect(runState()).toMatchObject({ isSending: false, runId: "run-1" });
	});

	it("RUN_NOT_CONTINUABLE settles from the body without retrying", async () => {
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun.mockRejectedValueOnce(
			agentError(
				409,
				"RUN_NOT_CONTINUABLE",
				runView({
					status: "awaiting_user",
					next: "await_user",
					checkpoint: "proposal",
				}),
			),
		);

		await aiRunController.send(sendParams());

		expect(agent.continueRun).toHaveBeenCalledTimes(1);
		const thread = messages();
		expect(thread).toHaveLength(2);
		expect(thread[1].role).toBe("assistant");
		expect(thread[1].content).toBe("I analyzed your request.");
		expect(runState()).toMatchObject({
			isSending: false,
			status: "awaiting_user",
			resumable: null,
		});
	});

	it("RUN_NOT_FOUND on continue is terminal", async () => {
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun.mockRejectedValueOnce(agentError(404, "RUN_NOT_FOUND"));

		await aiRunController.send(sendParams());

		expect(agent.continueRun).toHaveBeenCalledTimes(1);
		expect(messages()[1].content).toBe(
			"This run expired before it could finish.",
		);
		expect(runState()).toMatchObject({ isSending: false, status: "failed" });
	});

	it("RUN_IN_PROGRESS on continue polls every 3s until the lock frees", async () => {
		vi.useFakeTimers();
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun
			.mockRejectedValueOnce(agentError(409, "RUN_IN_PROGRESS", runView()))
			.mockRejectedValueOnce(agentError(409, "RUN_IN_PROGRESS", runView()))
			.mockResolvedValueOnce(doneResponse());

		const sending = aiRunController.send(sendParams());
		await vi.advanceTimersByTimeAsync(7_000);
		await sending;

		expect(agent.continueRun).toHaveBeenCalledTimes(3);
		expect(messages()[1].content).toBe("Done!");
	});

	it("two transport failures on continue leave the run resumable; resume settles it", async () => {
		vi.useFakeTimers();
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun
			.mockRejectedValueOnce(timeoutError())
			.mockRejectedValueOnce(timeoutError());

		const sending = aiRunController.send(sendParams());
		await vi.advanceTimersByTimeAsync(5_000);
		await sending;

		expect(agent.continueRun).toHaveBeenCalledTimes(2);
		expect(messages()).toHaveLength(1);
		expect(runState()).toMatchObject({
			isSending: false,
			resumable: { runId: "run-1", traceId: "trace-1" },
			errorMessage: RUN_LOST_CONTACT_MESSAGE,
		});

		agent.continueRun.mockResolvedValueOnce(doneResponse("Resumed and done"));
		const resuming = aiRunController.resume(THREAD);
		await vi.advanceTimersByTimeAsync(1_000);
		await resuming;

		expect(agent.continueRun).toHaveBeenCalledTimes(3);
		expect(messages()[1].content).toBe("Resumed and done");
		expect(runState()).toMatchObject({
			isSending: false,
			resumable: null,
			status: "done",
		});
	});

	it("keeps the trace cursor across sends that share a trace id", async () => {
		agent.getTraceEvents.mockImplementation(
			async (
				_session: string,
				traceId: string,
				options: { afterSeq: number },
			) => ({
				trace_id: traceId,
				events: [],
				next_seq:
					traceId === "trace-shared" ? Math.max(7, options.afterSeq) : 3,
				done: true,
			}),
		);
		agent.sendMessage.mockResolvedValue(
			doneResponse("First", {
				run: runView({
					trace_id: "trace-shared",
					status: "done",
					next: "done",
				}),
			}),
		);

		await aiRunController.send(sendParams());
		await flush();
		const firstSeqs = agent.getTraceEvents.mock.calls
			.filter((call) => call[1] === "trace-shared")
			.map((call) => call[2].afterSeq);
		expect(firstSeqs[0]).toBe(0);
		expect(aiRunController.getTraceCursor("trace-shared")).toBe(7);

		agent.getTraceEvents.mockClear();
		await aiRunController.send(sendParams());
		await flush();
		const secondSeqs = agent.getTraceEvents.mock.calls
			.filter((call) => call[1] === "trace-shared")
			.map((call) => call[2].afterSeq);
		expect(secondSeqs.length).toBeGreaterThan(0);
		expect(secondSeqs.every((seq) => seq >= 7)).toBe(true);
	});

	it("synthesizes a focus-roadmap commit from a legacy commit_summary", async () => {
		const operations = [
			{ op: "add_epic" as const, temp_id: "e1", data: { title: "X" } },
		];
		agent.sendMessage.mockResolvedValue(
			response({
				assistant_message: "Added it",
				response_mode: "edit_plan",
				operations,
				commit_summary: {
					committed: true,
					change_id: "chg-9",
					impacted_items: [
						{
							node_id: "epic-1",
							node_type: "epic",
							title: "X",
							impact: "created",
						},
					],
				},
			}),
		);
		const onCommits = vi.fn();

		await aiRunController.send(sendParams({ hooks: { onCommits } }));

		expect(onCommits).toHaveBeenCalledTimes(1);
		const [commits] = onCommits.mock.calls[0];
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({
			roadmap_id: "rm-1",
			status: "committed",
			change_id: "chg-9",
			operations,
		});
		expect(messages()[1].commits?.[0]).toMatchObject({ status: "committed" });
	});

	it("maps a failed legacy commit_summary to a failed commit with its reason", async () => {
		agent.sendMessage.mockResolvedValue(
			response({
				assistant_message: "Could not apply",
				response_mode: "edit_plan",
				commit_summary: {
					committed: false,
					error_code: "INVALID_STATUS",
					error_message: "Status 'later' is not valid.",
				},
			}),
		);
		const onCommits = vi.fn();

		await aiRunController.send(sendParams({ hooks: { onCommits } }));

		expect(onCommits).not.toHaveBeenCalled();
		expect(messages()[1].commits?.[0]).toMatchObject({
			roadmap_id: "rm-1",
			status: "failed",
			error_message: "Status 'later' is not valid.",
		});
	});

	it("phase_entered trace events patch the phase and commit progress live", async () => {
		const events: AgentTraceEvent[] = [
			{
				seq: 1,
				ts: "2026-09-04T10:00:01.000Z",
				event: "phase_entered",
				title: "",
				status: "success",
				summary: "",
				details: { phase: "execute", commits_done: 1, commits_total: 2 },
			},
		];
		agent.getTraceEvents
			.mockResolvedValueOnce(
				traceResponse({ events, next_seq: 1, done: false }),
			)
			.mockResolvedValue(traceResponse({ next_seq: 1, done: true }));
		const pending = deferred<AgentRunResponse>();
		agent.sendMessage.mockImplementation(() => pending.promise);
		const onTraceEvents = vi.fn();

		const sending = aiRunController.send(
			sendParams({ hooks: { onTraceEvents } }),
		);
		await flush();
		expect(runState()).toMatchObject({
			isSending: true,
			phase: "execute",
			commitsProgress: { done: 1, total: 2 },
		});
		expect(onTraceEvents).toHaveBeenCalled();
		expect(onTraceEvents.mock.calls[0][1]).toEqual(events);

		pending.resolve(doneResponse());
		await sending;
		expect(runState().isSending).toBe(false);
	});

	it("resets the poll deadline per leg: 150s of silence is fine, 200s flips tracePollingFailed", async () => {
		vi.useFakeTimers();
		agent.getTraceEvents.mockImplementation(async () =>
			traceResponse({ done: false }),
		);
		agent.sendMessage.mockImplementation(() => new Promise(() => {}));

		void aiRunController.send(sendParams());
		await vi.advanceTimersByTimeAsync(150_000);
		expect(runState().tracePollingFailed).toBe(false);
		expect(runState().isSending).toBe(true);

		await vi.advanceTimersByTimeAsync(50_000);
		expect(runState().tracePollingFailed).toBe(true);
	});

	it("caps a run at 30 minutes of wall clock and leaves it resumable", async () => {
		vi.useFakeTimers();
		// The poll loop's own cap check shares the leg-deadline branch tested
		// above; a done trace keeps this test to the continue loop (3,700 fake
		// polls would blow the real-time budget).
		agent.getTraceEvents.mockImplementation(async () => traceResponse());
		agent.sendMessage.mockResolvedValue(response({ run: runView() }));
		agent.continueRun.mockImplementation(
			() =>
				new Promise<AgentRunResponse>((resolve) => {
					setTimeout(() => resolve(response({ run: runView() })), 100_000);
				}),
		);

		const sending = aiRunController.send(sendParams());
		// One long advance stalls in sinon once a timer is registered from a
		// microtask continuation after the last in-range timer; step per leg.
		for (let step = 0; step < 20; step += 1) {
			await vi.advanceTimersByTimeAsync(100_000);
		}
		await sending;

		expect(agent.continueRun.mock.calls.length).toBeLessThanOrEqual(19);
		expect(runState()).toMatchObject({
			isSending: false,
			resumable: { runId: "run-1", traceId: "trace-1" },
			errorMessage: RUN_TIMED_OUT_MESSAGE,
		});
		expect(messages()).toHaveLength(1);
	});

	it("startingByScope blocks a second send while the thread is being created", async () => {
		agent.sendMessage.mockResolvedValue(doneResponse());
		const creating = deferred<string>();
		const firstEnsure = vi.fn(() => creating.promise);
		const secondEnsure = vi.fn(async () => THREAD);

		const first = aiRunController.send(
			sendParams({ threadId: null, ensureThread: firstEnsure }),
		);
		await flush();
		expect(useAiRunStore.getState().startingByScope["roadmap:rm-1"]).toBe(true);

		const second = aiRunController.send(
			sendParams({ threadId: null, ensureThread: secondEnsure }),
		);
		await second;
		expect(secondEnsure).not.toHaveBeenCalled();

		creating.resolve(THREAD);
		await first;
		expect(agent.sendMessage).toHaveBeenCalledTimes(1);
		expect(
			useAiRunStore.getState().startingByScope["roadmap:rm-1"],
		).toBeUndefined();
		expect(messages()).toHaveLength(2);
	});

	it("a failed send appends an error bubble and clears the run", async () => {
		agent.sendMessage.mockRejectedValue(
			agentError(500, null, undefined, "boom"),
		);

		await aiRunController.send(sendParams());

		const thread = messages();
		expect(thread).toHaveLength(2);
		expect(thread[1]).toMatchObject({
			role: "assistant",
			parseMode: "agent_error",
		});
		expect(runState()).toMatchObject({
			isSending: false,
			errorMessage: "boom",
			liveActivity: null,
		});
	});
});
