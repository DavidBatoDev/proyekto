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

import {
  RoadmapAgentServiceError,
  isAgentTimeoutError,
  roadmapAgentService,
} from "./roadmap-agent.service";

describe("roadmap agent service timeout detection", () => {
  it("detects timeout roadmap service errors", () => {
    const error = new RoadmapAgentServiceError(
      "Send AI message failed: timeout of 30000ms exceeded",
    );
    expect(isAgentTimeoutError(error)).toBe(true);
  });

  it("does not flag unrelated errors as timeout", () => {
    const error = new Error("validation failed");
    expect(isAgentTimeoutError(error)).toBe(false);
  });
});

describe("roadmap agent service trace APIs", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedGet.mockReset();
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

    await roadmapAgentService.sendMessage(
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

  it("requests trace events with cursor and detail mode", async () => {
    mockedGet.mockResolvedValue({
      data: {
        trace_id: "trace-xyz",
        session_id: "session-1",
        roadmap_id: "roadmap-1",
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

    const response = await roadmapAgentService.getTraceEvents(
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
  });
});
