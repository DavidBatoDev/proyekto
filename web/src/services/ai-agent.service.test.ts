import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedPost, mockedGet } = vi.hoisted(() => ({
	mockedPost: vi.fn(),
	mockedGet: vi.fn(),
}));

vi.mock("@/api/agent-axios", () => ({
	default: {
		post: mockedPost,
		get: mockedGet,
	},
}));

import { AxiosError, type AxiosResponse } from "axios";
import {
	AiAgentServiceError,
	aiAgentService,
	getAgentErrorCode,
	isAgentTimeoutError,
	isAiAgentServiceError,
	parseAgentErrorBody,
	type RunView,
} from "./ai-agent.service";

function axiosFailure(status: number, data: unknown): AxiosError {
	const response = {
		status,
		data,
		statusText: "",
		headers: {},
		config: {},
	} as unknown as AxiosResponse;
	return new AxiosError(
		`Request failed with status code ${status}`,
		"ERR_BAD_REQUEST",
		undefined,
		undefined,
		response,
	);
}

function runView(overrides: Partial<RunView> = {}): RunView {
	return {
		run_id: "run-1",
		trace_id: "trace-1",
		status: "running",
		phase: "execute",
		next: "continue",
		scope: { kind: "roadmap", roadmap_id: "rm-1" },
		created_at: "2026-09-04T00:00:00Z",
		updated_at: "2026-09-04T00:00:01Z",
		...overrides,
	};
}

const PLAN_CONFIRM_SENTINEL = [
	"__plan_decision__",
	JSON.stringify({ decision: "confirm", plan_id: "p1" }),
].join("\n");

describe("agent service timeout detection", () => {
	it("detects timeout service errors", () => {
		const error = new AiAgentServiceError(
			"Send AI message failed: timeout of 30000ms exceeded",
		);
		expect(isAgentTimeoutError(error)).toBe(true);
	});

	it("does not flag unrelated errors as timeout", () => {
		const error = new Error("validation failed");
		expect(isAgentTimeoutError(error)).toBe(false);
	});
});

describe("agent error body parsing", () => {
	it("reads the code from FastAPI's {detail:{code}} envelope", () => {
		expect(
			parseAgentErrorBody({
				detail: { code: "SESSION_NOT_FOUND", message: "gone" },
			}),
		).toEqual({ code: "SESSION_NOT_FOUND", run: null });
	});

	it("reads a bare {code, run} body and exposes the run view", () => {
		const run = runView();
		expect(parseAgentErrorBody({ code: "RUN_IN_PROGRESS", run })).toEqual({
			code: "RUN_IN_PROGRESS",
			run,
		});
	});

	it("finds the run inside the detail envelope", () => {
		const run = runView({ status: "done", next: "done" });
		expect(
			parseAgentErrorBody({ detail: { code: "RUN_NOT_CONTINUABLE", run } }).run,
		).toBe(run);
	});

	it("yields nothing for string details and non-objects", () => {
		expect(parseAgentErrorBody({ detail: "Not authenticated" })).toEqual({
			code: null,
			run: null,
		});
		expect(parseAgentErrorBody("nope")).toEqual({ code: null, run: null });
		expect(parseAgentErrorBody(undefined)).toEqual({ code: null, run: null });
	});
});

describe("agent service session + message APIs", () => {
	beforeEach(() => {
		mockedPost.mockReset();
		mockedGet.mockReset();
		vi.spyOn(console, "debug").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("creates a session with the scope body", async () => {
		mockedPost.mockResolvedValue({
			data: {
				session_id: "session-1",
				scope: { kind: "workspace", workspace_id: "ws-1" },
				roadmap_id: null,
				created_at: "2026-09-04T00:00:00Z",
			},
		});

		const created = await aiAgentService.createSession({
			session_id: "session-1",
			scope: { kind: "workspace", workspace_id: "ws-1" },
			seed_messages: [{ role: "user", content: "hi" }],
		});

		expect(mockedPost).toHaveBeenCalledWith("/agent/sessions", {
			session_id: "session-1",
			scope: { kind: "workspace", workspace_id: "ws-1" },
			seed_messages: [{ role: "user", content: "hi" }],
		});
		expect(created.scope).toEqual({ kind: "workspace", workspace_id: "ws-1" });
	});

	it("sends message with X-Trace-Id when provided", async () => {
		mockedPost.mockResolvedValue({
			data: {
				session_id: "session-1",
				assistant_message: "Prepared operations.",
				parse_mode: "openai_tool_calling",
				intent_type: "roadmap_edit",
				response_mode: "edit_plan",
				operations: [],
				staged_operations_version: 2,
				staged_operations_count: 1,
				artifacts: [],
				debug_trace_id: "trace-123",
			},
		});

		await aiAgentService.sendMessage(
			"session-1",
			{ message: "Assign all tasks to me" },
			{ traceId: "trace-123" },
		);

		expect(mockedPost).toHaveBeenCalledWith(
			"/agent/sessions/session-1/messages",
			{ message: "Assign all tasks to me" },
			{
				headers: {
					"X-Trace-Id": "trace-123",
				},
			},
		);
	});

	it("passes refs and capabilities through untouched", async () => {
		mockedPost.mockResolvedValue({
			data: {
				session_id: "session-1",
				assistant_message: "",
				parse_mode: "run_step",
				intent_type: "roadmap_edit",
				response_mode: "edit_plan",
				operations: [],
				staged_operations_version: 0,
				staged_operations_count: 0,
				commits: [],
				run: runView(),
			},
		});

		const response = await aiAgentService.sendMessage("session-1", {
			message: "In @Onboarding add an epic",
			refs: [{ kind: "roadmap", id: "rm-1", label: "Onboarding" }],
			capabilities: ["continue"],
		});

		expect(mockedPost).toHaveBeenCalledWith(
			"/agent/sessions/session-1/messages",
			{
				message: "In @Onboarding add an epic",
				refs: [{ kind: "roadmap", id: "rm-1", label: "Onboarding" }],
				capabilities: ["continue"],
			},
			undefined,
		);
		expect(response.run?.next).toBe("continue");
	});

	it("retries a plan decision once after a transport failure", async () => {
		vi.useFakeTimers();
		try {
			mockedPost
				.mockRejectedValueOnce(new Error("Network Error"))
				.mockResolvedValueOnce({
					data: {
						session_id: "session-1",
						assistant_message: "Applied.",
						parse_mode: "run_report",
						intent_type: "confirm_action",
						response_mode: "chat",
						operations: [],
						staged_operations_version: 0,
						staged_operations_count: 0,
					},
				});

			const pending = aiAgentService.sendMessage("session-1", {
				message: PLAN_CONFIRM_SENTINEL,
			});
			await vi.advanceTimersByTimeAsync(1500);
			const response = await pending;

			expect(mockedPost).toHaveBeenCalledTimes(2);
			expect(response.assistant_message).toBe("Applied.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retry a plain message on a transport failure", async () => {
		mockedPost.mockRejectedValueOnce(new Error("Network Error"));
		await expect(
			aiAgentService.sendMessage("session-1", { message: "hello" }),
		).rejects.toBeInstanceOf(AiAgentServiceError);
		expect(mockedPost).toHaveBeenCalledTimes(1);
	});

	it("surfaces SESSION_NOT_FOUND with the status code", async () => {
		mockedPost.mockRejectedValueOnce(
			axiosFailure(404, {
				detail: { code: "SESSION_NOT_FOUND", message: "Session not found." },
			}),
		);

		const failure = await aiAgentService
			.sendMessage("session-1", { message: "hi" })
			.catch((error: unknown) => error);

		expect(isAiAgentServiceError(failure)).toBe(true);
		const typed = failure as AiAgentServiceError;
		expect(typed.statusCode).toBe(404);
		expect(typed.code).toBe("SESSION_NOT_FOUND");
		expect(getAgentErrorCode(failure)).toBe("SESSION_NOT_FOUND");
		expect(typed.run).toBeNull();
		expect(typed.message).toContain("Session not found.");
	});

	it("exposes the run view on 409 RUN_IN_PROGRESS", async () => {
		const run = runView();
		mockedPost.mockRejectedValueOnce(
			axiosFailure(409, {
				detail: { code: "RUN_IN_PROGRESS", message: "busy", run },
			}),
		);

		const failure = (await aiAgentService
			.sendMessage("session-1", { message: "hi" })
			.catch((error: unknown) => error)) as AiAgentServiceError;

		expect(failure.statusCode).toBe(409);
		expect(failure.code).toBe("RUN_IN_PROGRESS");
		expect(failure.run).toEqual(run);
	});
});

describe("agent service run APIs", () => {
	beforeEach(() => {
		mockedPost.mockReset();
		mockedGet.mockReset();
		vi.spyOn(console, "debug").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("continues a run on the run's continue route", async () => {
		mockedPost.mockResolvedValue({
			data: {
				session_id: "session-1",
				assistant_message: "Done.",
				parse_mode: "run_report",
				intent_type: "roadmap_edit",
				response_mode: "edit_plan",
				operations: [],
				staged_operations_version: 1,
				staged_operations_count: 3,
				commits: [
					{
						batch_id: "b1",
						roadmap_id: "rm-1",
						status: "committed",
						operations_count: 3,
					},
				],
				run: runView({ status: "done", next: "done", phase: "verify" }),
			},
		});

		const response = await aiAgentService.continueRun("session-1", "run-1", {
			traceId: "trace-1",
		});

		expect(mockedPost).toHaveBeenCalledWith(
			"/agent/sessions/session-1/runs/run-1/continue",
			{},
			{ headers: { "X-Trace-Id": "trace-1" } },
		);
		expect(response.run?.status).toBe("done");
		expect(response.commits?.[0]?.status).toBe("committed");
	});

	it("omits the trace header on continue when none is given", async () => {
		mockedPost.mockResolvedValue({ data: { run: runView() } });
		await aiAgentService.continueRun("session-1", "run-1");
		expect(mockedPost).toHaveBeenCalledWith(
			"/agent/sessions/session-1/runs/run-1/continue",
			{},
			undefined,
		);
	});

	it("settles RUN_NOT_CONTINUABLE from the 409 body", async () => {
		const run = runView({ status: "done", next: "done" });
		mockedPost.mockRejectedValueOnce(
			axiosFailure(409, { detail: { code: "RUN_NOT_CONTINUABLE", run } }),
		);

		const failure = (await aiAgentService
			.continueRun("session-1", "run-1")
			.catch((error: unknown) => error)) as AiAgentServiceError;

		expect(failure.statusCode).toBe(409);
		expect(failure.code).toBe("RUN_NOT_CONTINUABLE");
		expect(failure.run?.status).toBe("done");
	});

	it("distinguishes RUN_NOT_FOUND from SESSION_NOT_FOUND on continue", async () => {
		mockedPost.mockRejectedValueOnce(
			axiosFailure(404, { detail: { code: "RUN_NOT_FOUND" } }),
		);
		const failure = (await aiAgentService
			.continueRun("session-1", "run-1")
			.catch((error: unknown) => error)) as AiAgentServiceError;
		expect(failure.statusCode).toBe(404);
		expect(failure.code).toBe("RUN_NOT_FOUND");
	});

	it("cancels a run and returns the run view", async () => {
		mockedPost.mockResolvedValue({
			data: { run: runView({ status: "cancelled", next: "done" }) },
		});

		const response = await aiAgentService.cancelRun("session-1", "run-1");

		expect(mockedPost).toHaveBeenCalledWith(
			"/agent/sessions/session-1/runs/run-1/cancel",
			{},
		);
		expect(response.run.status).toBe("cancelled");
	});
});

describe("agent service trace APIs", () => {
	beforeEach(() => {
		mockedPost.mockReset();
		mockedGet.mockReset();
	});

	it("requests trace events with cursor and detail mode", async () => {
		mockedGet.mockResolvedValue({
			data: {
				trace_id: "trace-xyz",
				session_id: "session-1",
				roadmap_id: "roadmap-1",
				run_id: "run-1",
				phase: "investigate",
				events: [
					{
						seq: 11,
						ts: "2026-04-12T07:17:31.665102+00:00",
						event: "plan_generated",
						title: "Plan generated",
						status: "success",
						summary: "Generated plan with 1 operations.",
					},
				],
				next_seq: 11,
				done: false,
				started_at: "2026-04-12T07:17:17.414098+00:00",
			},
		});

		const response = await aiAgentService.getTraceEvents(
			"session-1",
			"trace-xyz",
			{
				afterSeq: 10,
				limit: 20,
				detail: "structured",
			},
		);

		expect(mockedGet).toHaveBeenCalledWith(
			"/agent/sessions/session-1/traces/trace-xyz/events",
			{
				params: {
					after_seq: 10,
					limit: 20,
					detail: "structured",
				},
			},
		);
		expect(response.next_seq).toBe(11);
		expect(response.events).toHaveLength(1);
		expect(response.events[0].event).toBe("plan_generated");
		expect(response.run_id).toBe("run-1");
	});
});
