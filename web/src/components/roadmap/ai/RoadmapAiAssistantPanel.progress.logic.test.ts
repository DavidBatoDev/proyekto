import { describe, expect, it } from "vitest";
import {
  collectUnseenDeltaEvents,
  ensureTimelineCompleted,
  getDefaultTimelineExpanded,
  mergeTimelineSteps,
  normalizeTimelineForDisplay,
  parseCommitImpactedItemsFromTraceDetails,
  parseCommitImpactedItemsFromOperations,
  parseProgressPresentationMode,
  shouldRenderThinkingFallback,
  toTimelineFromTraceResponse,
} from "./RoadmapAiAssistantPanel";

describe("assistant progress timeline logic", () => {
  it("hides intent and route stages in curated mode", () => {
    const merged = mergeTimelineSteps(
      [],
      [
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
      ],
    );

    expect(merged.map((step) => step.seq)).toEqual([3, 4]);
    expect(merged[0].title).toBe("Planning the next steps");
    expect(merged[1].title).toBe("Finding the right roadmap item");
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

  it("renders planner_summary as a user-facing timeline row", () => {
    const merged = mergeTimelineSteps(
      [],
      [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "planner_summary",
          title: "Planner summary",
          status: "success",
          summary: "Prepared a concise planning summary.",
          details: {
            summary_text:
              "I reviewed the roadmap context and prepared 3 safe updates for staging.",
            summary_source: "model_assistant_message",
            operations_count: 3,
          },
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Gearing up your plan");
    expect(merged[0].summary).toBe(
      "I reviewed the roadmap context and prepared 3 safe updates for staging.",
    );
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
    expect(timeline.steps[0].title).toBe(
      "Could not apply changes automatically",
    );
    expect(timeline.steps[0].summary.toLowerCase()).toContain(
      "invalid status value",
    );
    expect(timeline.steps[0].summary.toLowerCase()).toContain("in review");
  });

  it("keeps elapsed time anchored to message completion when auto-commit continues", () => {
    const timeline = toTimelineFromTraceResponse(
      "structured",
      "trace-auto-commit-elapsed",
      {
        trace_id: "trace-auto-commit-elapsed",
        session_id: "session-1",
        roadmap_id: "roadmap-1",
        events: [
          {
            seq: 12,
            ts: "2026-04-12T07:15:03.000Z",
            event: "message_completed",
            title: "Message completed",
            status: "success",
            summary: "Completed response in 3000 ms.",
            details: {
              elapsed_ms: 3000,
            },
          },
          {
            seq: 13,
            ts: "2026-04-12T07:15:10.000Z",
            event: "auto_commit_async_completed",
            title: "Auto-commit completed",
            status: "success",
            summary: "Auto-commit completed in 7000 ms.",
          },
        ],
        next_seq: 13,
        done: true,
        started_at: "2026-04-12T07:15:00.000Z",
        completed_at: "2026-04-12T07:15:10.000Z",
        elapsed_ms: 10000,
      },
      undefined,
      "curated",
    );

    expect(timeline.elapsedMs).toBe(3000);
  });

  it("parses committed impacted items from trace details", () => {
    const impactedItems = parseCommitImpactedItemsFromTraceDetails({
      impacted_items: [
        {
          node_id: "epic-1",
          node_type: "epic",
          title: "Authentication",
          impact: "created",
          change_type: "NODE_ADDED",
        },
        {
          node_id: "task-1",
          node_type: "task",
          title: "Implement OAuth callback",
          impact: "modified",
          change_type: "STATUS_CHANGED",
        },
      ],
    });

    expect(impactedItems).toHaveLength(2);
    expect(impactedItems[0]?.kind).toBe("created");
    expect(impactedItems[1]?.kind).toBe("modified");
  });

  it("falls back to operation-derived impacted items for rename updates", () => {
    const impactedItems = parseCommitImpactedItemsFromOperations([
      {
        op: "update_node",
        node_type: "epic",
        node_id: "epic-123",
        patch: {
          title: "PM Module",
        },
      },
    ]);

    expect(impactedItems).toHaveLength(1);
    expect(impactedItems[0]?.nodeId).toBe("epic-123");
    expect(impactedItems[0]?.nodeType).toBe("epic");
    expect(impactedItems[0]?.kind).toBe("modified");
    expect(impactedItems[0]?.title).toBe("PM Module");
  });

  it("expands bulk update_node operations with targets[] into one impacted item per target", () => {
    const impactedItems = parseCommitImpactedItemsFromOperations([
      {
        op: "update_node",
        node_type: "task",
        targets: ["task-1", "task-2", "task-3"],
        patch: {
          assignee_id: "user-42",
        },
      },
    ]);

    expect(impactedItems).toHaveLength(3);
    expect(impactedItems.map((item) => item.nodeId).sort()).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
    for (const item of impactedItems) {
      expect(item.nodeType).toBe("task");
      expect(item.kind).toBe("modified");
    }
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
            summary:
              "Tool_get_tasks_assigned_to_me completed (tasks_count=19).",
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

describe("assistant_thought timeline steps", () => {
  const thoughtEvent = (seq: number, text: string) => ({
    seq,
    ts: `2026-04-12T07:15:0${seq}.000Z`,
    event: "assistant_thought",
    title: "Thinking",
    status: "success" as const,
    summary: text,
    details: {
      text,
      turn: 1,
      thought_seq: seq,
    },
  });

  it("renders the thought text as a Thinking row in curated mode", () => {
    const merged = mergeTimelineSteps(
      [],
      [thoughtEvent(1, "The user wants overdue items closed.")],
      "curated",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Thinking");
    expect(merged[0].status).toBe("success");
    expect(merged[0].summary).toBe("The user wants overdue items closed.");
  });

  it("stays visible in friendly_minimal mode", () => {
    const merged = mergeTimelineSteps(
      [],
      [thoughtEvent(1, "Checking the Auth epic first.")],
      "friendly_minimal",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].summary).toBe("Checking the Auth epic first.");
  });

  it("falls back to the wire summary when details.text is missing", () => {
    const merged = mergeTimelineSteps(
      [],
      [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "assistant_thought",
          title: "Thinking",
          status: "success",
          summary: "Persisted thought text.",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].summary).toBe("Persisted thought text.");
  });

  it("dedupes by seq when the same thought arrives twice (push + poll)", () => {
    const first = mergeTimelineSteps(
      [],
      [thoughtEvent(1, "Only once, please.")],
    );
    const merged = mergeTimelineSteps(first, [
      thoughtEvent(1, "Only once, please."),
      thoughtEvent(2, "A second thought."),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((step) => step.seq)).toEqual([1, 2]);
  });
});

describe("streaming delta dedupe across poll and push", () => {
  const deltaEvent = (seq: number, text: string) => ({
    seq,
    ts: `2026-04-12T07:15:0${seq}.000Z`,
    event: "assistant_delta",
    title: "Assistant writing",
    status: "running" as const,
    summary: "Assistant is writing…",
    details: { text, turn: 1, delta_seq: seq },
  });

  it("returns each delta seq exactly once across repeated windows", () => {
    const seen = new Set<number>();
    const first = collectUnseenDeltaEvents(
      [deltaEvent(1, "Hel"), deltaEvent(2, "lo")],
      seen,
    );
    expect(first.map((event) => event.seq)).toEqual([1, 2]);
    // The same events arriving again (push replay or poll overlap) are dropped.
    const second = collectUnseenDeltaEvents(
      [deltaEvent(1, "Hel"), deltaEvent(2, "lo"), deltaEvent(3, "!")],
      seen,
    );
    expect(second.map((event) => event.seq)).toEqual([3]);
  });

  it("ignores non-delta events", () => {
    const seen = new Set<number>();
    const fresh = collectUnseenDeltaEvents(
      [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "assistant_thought",
          title: "Thinking",
          status: "success",
          summary: "A thought.",
        },
      ],
      seen,
    );
    expect(fresh).toEqual([]);
    expect(seen.size).toBe(0);
  });
});
