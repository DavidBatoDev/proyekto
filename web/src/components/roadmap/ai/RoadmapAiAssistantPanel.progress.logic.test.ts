import { describe, expect, it } from "vitest";
import {
  ensureTimelineCompleted,
  getDefaultTimelineExpanded,
  mergeTimelineSteps,
  normalizeTimelineForDisplay,
  parseProgressPresentationMode,
  shouldRenderThinkingFallback,
  toTimelineFromTraceResponse,
} from "./RoadmapAiAssistantPanel";

describe("assistant progress timeline logic", () => {
  it("uses curated mode by default and keeps selected internal reasoning stages", () => {
    const merged = mergeTimelineSteps([], [
      {
        seq: 1,
        ts: "2026-04-12T07:15:01.000Z",
        event: "message_received",
        title: "Message received",
        status: "running",
        summary: "Received user message",
      },
      {
        seq: 2,
        ts: "2026-04-12T07:15:02.000Z",
        event: "intent_classified",
        title: "Intent classified",
        status: "success",
        summary: "roadmap_edit",
        details: {
          intent_type: "roadmap_edit",
        },
      },
      {
        seq: 3,
        ts: "2026-04-12T07:15:03.000Z",
        event: "provider_attempt",
        title: "Provider attempt",
        status: "running",
        summary: "Planning edit",
        details: {
          phase: "edit_plan",
        },
      },
      {
        seq: 4,
        ts: "2026-04-12T07:15:04.000Z",
        event: "tool_call_requested",
        title: "Tool call requested",
        status: "running",
        summary: "Calling resolve_node_reference",
        details: {
          tool_name: "resolve_node_reference",
        },
      },
    ]);

    expect(merged.map((step) => step.seq)).toEqual([2, 3, 4]);
    expect(merged[0].title).toBe("Understanding your request");
    expect(merged[1].title).toBe("Planning the next steps");
    expect(merged[2].title).toBe("Finding the right roadmap item");
  });

  it("keeps friendly_minimal fallback behavior when explicitly requested", () => {
    const merged = mergeTimelineSteps(
      [],
      [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "provider_attempt",
          title: "Provider attempt",
          status: "running",
          summary: "Started provider call.",
        },
        {
          seq: 2,
          ts: "2026-04-12T07:15:02.000Z",
          event: "tool_call_requested",
          title: "Tool call requested",
          status: "running",
          summary: "Calling resolve_node_reference.",
          details: {
            tool_name: "resolve_node_reference",
          },
        },
      ],
      "friendly_minimal",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].seq).toBe(2);
    expect(merged[0].title).toBe("Finding the right roadmap item");
    expect(merged[0].summary).toBe("Working on this step now.");
  });

  it("humanizes tool results and strips operation/tool codes from summary text", () => {
    const timeline = toTimelineFromTraceResponse(
      "structured",
      "trace-1",
      {
        trace_id: "trace-1",
        session_id: "session-1",
        roadmap_id: "roadmap-1",
        events: [
          {
            seq: 2,
            ts: "2026-04-12T07:15:03.000Z",
            event: "tool_call_result",
            title: "Tool call result",
            status: "success",
            summary:
              "Tool plan_roadmap_operations completed (operations_count=19, operation_types=['mark_status']).",
            details: {
              tool_name: "plan_roadmap_operations",
              result_summary: {
                operations_count: 19,
                operation_types: ["mark_status", "mark_status"],
              },
            },
          },
        ],
        next_seq: 2,
        done: true,
        started_at: "2026-04-12T07:15:00.000Z",
        completed_at: "2026-04-12T07:15:03.000Z",
        elapsed_ms: 3000,
      },
      undefined,
      "curated",
    );

    expect(timeline.done).toBe(true);
    expect(timeline.elapsedMs).toBe(3000);
    expect(timeline.steps).toHaveLength(1);
    expect(timeline.steps[0].title).toBe("Prepared your roadmap changes");
    expect(timeline.steps[0].summary).toBe(
      "I prepared your roadmap changes. I prepared 19 roadmap changes.",
    );
    expect(timeline.steps[0].summary.toLowerCase()).not.toContain(
      "mark_status",
    );
    expect(timeline.steps[0].summary.toLowerCase()).not.toContain(
      "plan_roadmap_operations",
    );
  });

  it("keeps tool-specific curated rows stable across polling merges", () => {
    const firstMerge = mergeTimelineSteps(
      [],
      [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "tool_call_requested",
          title: "Tool call requested",
          status: "running",
          summary: "Calling tool get_tasks_assigned_to_me.",
          details: {
            tool_name: "get_tasks_assigned_to_me",
            tool_args: {
              status: "all",
              limit: 500,
            },
          },
        },
        {
          seq: 2,
          ts: "2026-04-12T07:15:02.000Z",
          event: "tool_call_result",
          title: "Tool call result",
          status: "success",
          summary: "Tool get_tasks_assigned_to_me completed (tasks_count=19).",
          details: {
            tool_name: "get_tasks_assigned_to_me",
            result_summary: {
              tasks_count: 19,
            },
          },
        },
      ],
      "curated",
    );

    const secondMerge = mergeTimelineSteps(firstMerge, [], "curated");

    expect(secondMerge).toHaveLength(2);
    expect(secondMerge[0].title).toBe("Reviewing your assigned tasks");
    expect(secondMerge[1].title).toBe("Reviewed your assigned tasks");
    expect(secondMerge[0].summary.toLowerCase()).not.toContain(
      "get_tasks_assigned_to_me",
    );
    expect(secondMerge[1].summary.toLowerCase()).not.toContain(
      "get_tasks_assigned_to_me",
    );
  });

  it("uses friendly validation guidance when auto-commit fails on invalid status", () => {
    const timeline = toTimelineFromTraceResponse(
      "structured",
      "trace-auto-commit",
      {
        trace_id: "trace-auto-commit",
        session_id: "session-1",
        roadmap_id: "roadmap-1",
        events: [
          {
            seq: 10,
            ts: "2026-04-12T07:15:10.000Z",
            event: "auto_commit_async_failed",
            title: "Auto-commit failed",
            status: "error",
            summary: "Auto-commit failed",
            details: {
              auto_commit_error_message:
                "Commit has validation errors and cannot be applied",
              auto_commit_invalid_operation: {
                reason: "mark_status.status_invalid",
              },
            },
          },
        ],
        next_seq: 10,
        done: true,
        started_at: "2026-04-12T07:15:00.000Z",
        completed_at: "2026-04-12T07:15:10.000Z",
        elapsed_ms: 10000,
      },
      undefined,
      "curated",
    );

    expect(timeline.steps).toHaveLength(1);
    expect(timeline.steps[0].title).toBe("Could not apply changes automatically");
    expect(timeline.steps[0].summary.toLowerCase()).toContain(
      "invalid status value",
    );
    expect(timeline.steps[0].summary.toLowerCase()).toContain("in review");
  });

  it("normalizes previously saved technical timeline rows at render time", () => {
    const normalized = normalizeTimelineForDisplay(
      {
        traceId: "trace-legacy",
        startedAt: "2026-04-12T07:15:00.000Z",
        done: true,
        detailMode: "verbose",
        steps: [
          {
            seq: 1,
            ts: "2026-04-12T07:15:01.000Z",
            event: "tool_call_requested",
            title: "Tool call requested",
            status: "running",
            summary: "Calling tool_get_tasks_assigned_to_me.",
          },
          {
            seq: 2,
            ts: "2026-04-12T07:15:02.000Z",
            event: "tool_call_result",
            title: "Tool call result",
            status: "success",
            summary: "Tool_get_tasks_assigned_to_me completed (tasks_count=19).",
          },
        ],
      },
      "curated",
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.steps).toHaveLength(2);
    expect(normalized?.steps[0].title).toBe("Reviewing your assigned tasks");
    expect(normalized?.steps[0].summary.toLowerCase()).not.toContain(
      "get_tasks_assigned_to_me",
    );
    expect(normalized?.steps[1].summary).toBe(
      "I reviewed your assigned tasks. I found 19 assigned tasks.",
    );
  });

  it("auto-expands running timelines and auto-collapses completed timelines", () => {
    expect(getDefaultTimelineExpanded(false, undefined)).toBe(true);
    expect(getDefaultTimelineExpanded(true, undefined)).toBe(false);
    expect(getDefaultTimelineExpanded(true, true)).toBe(true);
  });

  it("falls back to thinking state when polling fails during send", () => {
    expect(shouldRenderThinkingFallback(true, false, false)).toBe(true);
    expect(shouldRenderThinkingFallback(true, true, true)).toBe(true);
    expect(shouldRenderThinkingFallback(true, true, false)).toBe(false);
    expect(shouldRenderThinkingFallback(false, false, true)).toBe(false);
  });

  it("forces a completed timeline state when the turn is done", () => {
    const completed = ensureTimelineCompleted(
      {
        traceId: "trace-complete",
        startedAt: "2026-04-12T07:15:00.000Z",
        done: false,
        detailMode: "structured",
        steps: [
          {
            seq: 1,
            ts: "2026-04-12T07:15:01.000Z",
            event: "tool_call_requested",
            title: "Working on your request",
            status: "running",
            summary: "Working on this step now.",
          },
        ],
      },
      "2026-04-12T07:15:03.000Z",
    );

    expect(completed.done).toBe(true);
    expect(completed.completedAt).toBe("2026-04-12T07:15:03.000Z");
    expect(completed.elapsedMs).toBe(3000);
  });

  it("parses presentation mode env values safely", () => {
    expect(parseProgressPresentationMode("curated")).toBe("curated");
    expect(parseProgressPresentationMode("friendly-minimal")).toBe(
      "friendly_minimal",
    );
    expect(parseProgressPresentationMode("unknown")).toBe("curated");
  });
});
