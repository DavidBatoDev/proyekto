import { describe, expect, it } from "vitest";
import {
  getTitleListOverflowCount,
  getVisibleTimelineSteps,
  toElapsedSeconds,
} from "./RoadmapAiActivityTimeline";
import type { RoadmapAiActivityTimeline } from "./useRoadmapAiAssistantSession";

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
    expect(getVisibleTimelineSteps(timeline).map((step) => step.seq)).toEqual([
      2, 3, 4,
    ]);
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
    expect(getVisibleTimelineSteps(timeline).map((step) => step.seq)).toEqual([
      1, 2, 3, 4,
    ]);
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
