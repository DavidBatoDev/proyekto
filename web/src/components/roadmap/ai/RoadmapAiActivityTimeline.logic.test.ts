import { describe, expect, it } from "vitest";
import {
  collapseToolCallPairs,
  declutterProviderAttempts,
  getTitleListOverflowCount,
  getVisibleTimelineSteps,
  groupParallelSteps,
  toElapsedSeconds,
} from "./RoadmapAiActivityTimeline";
import type {
  RoadmapAiActivityStep,
  RoadmapAiActivityTimeline,
} from "./useRoadmapAiAssistantSession";

const baseTimeline = (
  overrides: Partial<RoadmapAiActivityTimeline> = {},
): RoadmapAiActivityTimeline => ({
  traceId: "trace-1",
  startedAt: "2026-04-12T07:15:00.000Z",
  done: false,
  detailMode: "verbose",
  steps: [],
  ...overrides,
});

describe("activity timeline elapsed seconds", () => {
  it("uses elapsedMs when available", () => {
    expect(
      toElapsedSeconds(
        baseTimeline({
          elapsedMs: 4000,
          done: true,
        }),
        Date.parse("2026-04-12T07:15:10.000Z"),
      ),
    ).toBe(4);
  });

  it("computes running elapsed from startedAt and now", () => {
    expect(
      toElapsedSeconds(
        baseTimeline({
          startedAt: "2026-04-12T07:15:00.000Z",
        }),
        Date.parse("2026-04-12T07:15:05.000Z"),
      ),
    ).toBe(5);
  });

  it("returns zero when startedAt is missing", () => {
    expect(
      toElapsedSeconds(
        baseTimeline({
          startedAt: undefined,
        }),
        Date.parse("2026-04-12T07:15:05.000Z"),
      ),
    ).toBe(0);
  });

  it("shows only the latest 3 rows while running", () => {
    const timeline = baseTimeline({
      done: false,
      steps: [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "a",
          title: "a",
          status: "running",
          summary: "a",
        },
        {
          seq: 2,
          ts: "2026-04-12T07:15:02.000Z",
          event: "b",
          title: "b",
          status: "running",
          summary: "b",
        },
        {
          seq: 3,
          ts: "2026-04-12T07:15:03.000Z",
          event: "c",
          title: "c",
          status: "running",
          summary: "c",
        },
        {
          seq: 4,
          ts: "2026-04-12T07:15:04.000Z",
          event: "d",
          title: "d",
          status: "running",
          summary: "d",
        },
      ],
    });
    expect(
      getVisibleTimelineSteps(timeline.steps, timeline.done).map(
        (step) => step.seq,
      ),
    ).toEqual([2, 3, 4]);
  });

  it("shows all rows after completion", () => {
    const timeline = baseTimeline({
      done: true,
      steps: [
        {
          seq: 1,
          ts: "2026-04-12T07:15:01.000Z",
          event: "a",
          title: "a",
          status: "running",
          summary: "a",
        },
        {
          seq: 2,
          ts: "2026-04-12T07:15:02.000Z",
          event: "b",
          title: "b",
          status: "running",
          summary: "b",
        },
        {
          seq: 3,
          ts: "2026-04-12T07:15:03.000Z",
          event: "c",
          title: "c",
          status: "running",
          summary: "c",
        },
        {
          seq: 4,
          ts: "2026-04-12T07:15:04.000Z",
          event: "d",
          title: "d",
          status: "running",
          summary: "d",
        },
      ],
    });
    expect(
      getVisibleTimelineSteps(timeline.steps, timeline.done).map(
        (step) => step.seq,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("computes title-list overflow count for compact list rendering", () => {
    expect(
      getTitleListOverflowCount({
        items: ["Task A", "Task B"],
        shownCount: 2,
        totalCount: 5,
        hasMore: true,
      }),
    ).toBe(3);
    expect(
      getTitleListOverflowCount({
        items: ["Task A", "Task B"],
        shownCount: 2,
        totalCount: 2,
        hasMore: false,
      }),
    ).toBe(0);
  });
});

describe("parallel step grouping", () => {
  const step = (
    seq: number,
    overrides: Partial<RoadmapAiActivityStep> = {},
  ): RoadmapAiActivityStep => ({
    seq,
    ts: `2026-04-12T07:15:0${seq}.000Z`,
    event: "tool_call_result",
    title: "Searched tasks",
    status: "success",
    summary: `step ${seq}`,
    ...overrides,
  });

  it("merges consecutive same-title tool steps", () => {
    const grouped = groupParallelSteps([step(1), step(2)]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].seq).toBe(1);
  });

  it("never merges consecutive thought steps despite the shared title", () => {
    const grouped = groupParallelSteps([
      step(1, {
        event: "assistant_thought",
        title: "Thinking",
        summary: "First thought.",
      }),
      step(2, {
        event: "assistant_thought",
        title: "Thinking",
        summary: "Second thought.",
      }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((s) => s.summary)).toEqual([
      "First thought.",
      "Second thought.",
    ]);
  });

  it("keeps a thought step separate from a same-title neighbor", () => {
    const grouped = groupParallelSteps([
      step(1, { title: "Thinking" }),
      step(2, {
        event: "assistant_thought",
        title: "Thinking",
        summary: "Actual thought.",
      }),
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe("tool call pair collapsing", () => {
  const mkStep = (
    seq: number,
    overrides: Partial<RoadmapAiActivityStep> = {},
  ): RoadmapAiActivityStep => ({
    seq,
    ts: `2026-04-12T07:15:${String(seq).padStart(2, "0")}.000Z`,
    event: "tool_call_requested",
    title: "Searching tasks",
    status: "running",
    summary: "searching",
    toolName: "search_tasks",
    ...overrides,
  });

  it("a result consumes its requested row, leaving one row per call", () => {
    const collapsed = collapseToolCallPairs([
      mkStep(1),
      mkStep(2, {
        event: "tool_call_result",
        title: "Searched tasks",
        status: "success",
      }),
    ]);
    expect(collapsed.map((s) => s.seq)).toEqual([2]);
    expect(collapsed[0].event).toBe("tool_call_result");
  });

  it("an in-flight requested row without a result survives", () => {
    const collapsed = collapseToolCallPairs([
      mkStep(1),
      mkStep(2, {
        event: "tool_call_result",
        title: "Searched tasks",
        status: "success",
      }),
      mkStep(3, { toolName: "get_node_details", title: "Loading item details" }),
    ]);
    expect(collapsed.map((s) => s.seq)).toEqual([2, 3]);
  });

  it("an error result also consumes its requested row", () => {
    const collapsed = collapseToolCallPairs([
      mkStep(1),
      mkStep(2, { event: "tool_call_result", status: "error" }),
    ]);
    expect(collapsed.map((s) => s.seq)).toEqual([2]);
    expect(collapsed[0].status).toBe("error");
  });

  it("parallel same-tool calls consume nearest-first, one per result", () => {
    const collapsed = collapseToolCallPairs([
      mkStep(1),
      mkStep(2),
      mkStep(3, { event: "tool_call_result", status: "success" }),
    ]);
    // One requested consumed (the nearest, seq 2); the other still in flight.
    expect(collapsed.map((s) => s.seq)).toEqual([1, 3]);
  });

  it("unnamed steps and other events pass through untouched", () => {
    const thought = mkStep(2, {
      event: "assistant_thought",
      title: "Thinking",
      toolName: undefined,
    });
    const unnamedRequested = mkStep(1, { toolName: undefined });
    const unnamedResult = mkStep(3, {
      event: "tool_call_result",
      toolName: undefined,
    });
    expect(
      collapseToolCallPairs([unnamedRequested, thought, unnamedResult]).map(
        (s) => s.seq,
      ),
    ).toEqual([1, 2, 3]);
  });
});

describe("provider attempt decluttering", () => {
  const attempt = (seq: number): RoadmapAiActivityStep => ({
    seq,
    ts: `2026-04-12T07:15:${String(seq).padStart(2, "0")}.000Z`,
    event: "provider_attempt",
    title: "Planning the next steps",
    status: "running",
    summary: "planning",
  });
  const content = (
    seq: number,
    event = "tool_call_result",
  ): RoadmapAiActivityStep => ({
    seq,
    ts: `2026-04-12T07:15:${String(seq).padStart(2, "0")}.000Z`,
    event,
    title: `content-${seq}`,
    status: "success",
    summary: "done",
  });

  it("hides attempts that have later content", () => {
    const result = declutterProviderAttempts(
      [attempt(1), content(2), attempt(3), content(4)],
      true,
    );
    expect(result.map((s) => s.seq)).toEqual([2, 4]);
  });

  it("keeps the trailing attempt as the live spinner while running", () => {
    const result = declutterProviderAttempts(
      [attempt(1), content(2), attempt(3)],
      false,
    );
    expect(result.map((s) => s.seq)).toEqual([2, 3]);
  });

  it("drops trailing attempts once done when other content exists", () => {
    const result = declutterProviderAttempts(
      [content(1), attempt(2)],
      true,
    );
    expect(result.map((s) => s.seq)).toEqual([1]);
  });

  it("keeps only the newest of stacked trailing attempts", () => {
    const result = declutterProviderAttempts(
      [content(1), attempt(2), attempt(3)],
      false,
    );
    expect(result.map((s) => s.seq)).toEqual([1, 3]);
  });

  it("falls back to the last attempt when nothing else would show", () => {
    expect(
      declutterProviderAttempts([attempt(1), attempt(2)], true).map(
        (s) => s.seq,
      ),
    ).toEqual([2]);
    expect(declutterProviderAttempts([], true)).toEqual([]);
  });
});

describe("declutter pipeline composition", () => {
  it("reduces a realistic edit turn to one row per meaningful step", () => {
    // Modeled on the live 27s rename + bulk-update turn.
    const mk = (
      seq: number,
      event: string,
      title: string,
      overrides: Partial<RoadmapAiActivityStep> = {},
    ): RoadmapAiActivityStep => ({
      seq,
      ts: `2026-04-12T07:15:${String(seq).padStart(2, "0")}.000Z`,
      event,
      title,
      status: "success",
      summary: title,
      ...overrides,
    });
    const steps = [
      mk(1, "provider_attempt", "Planning the next steps", {
        status: "running",
      }),
      mk(2, "assistant_thought", "Thinking", {
        summary: "Planning task updates for the feature.",
      }),
      mk(3, "tool_call_requested", "Listing tasks under a parent item", {
        status: "running",
        toolName: "get_tasks_by_parent",
      }),
      mk(4, "tool_call_result", "Listed tasks under a parent item", {
        toolName: "get_tasks_by_parent",
      }),
      mk(5, "provider_attempt", "Planning the next steps", {
        status: "running",
      }),
      mk(6, "assistant_thought", "Thinking", {
        summary: "Resolving the right roadmap item.",
      }),
      mk(7, "tool_call_requested", "Finding the right roadmap item", {
        status: "running",
        toolName: "resolve_node_reference",
      }),
      mk(8, "tool_call_result", "Found the right roadmap item", {
        toolName: "resolve_node_reference",
      }),
      mk(9, "provider_attempt", "Planning the next steps", {
        status: "running",
      }),
      mk(10, "plan_generated", "Finalizing your change plan"),
      mk(11, "auto_commit_async_completed", "Applied your changes"),
    ];
    const visible = groupParallelSteps(
      getVisibleTimelineSteps(
        declutterProviderAttempts(collapseToolCallPairs(steps), true),
        true,
      ),
    );
    expect(visible.map((s) => s.seq)).toEqual([2, 4, 6, 8, 10, 11]);
    expect(visible.map((s) => s.title)).toEqual([
      "Thinking",
      "Listed tasks under a parent item",
      "Thinking",
      "Found the right roadmap item",
      "Finalizing your change plan",
      "Applied your changes",
    ]);
  });
});
