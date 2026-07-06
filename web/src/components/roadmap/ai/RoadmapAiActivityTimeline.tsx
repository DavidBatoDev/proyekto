import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  RoadmapAiActivityStep,
  RoadmapAiActivityTimeline,
} from "./useRoadmapAiAssistantSession";

interface RoadmapAiActivityTimelineProps {
  timeline: RoadmapAiActivityTimeline;
  expanded: boolean;
  onToggle: () => void;
}

const RUNNING_VISIBLE_STEP_COUNT = 3;

export const toElapsedSeconds = (
  timeline: RoadmapAiActivityTimeline,
  now: number,
): number => {
  if (typeof timeline.elapsedMs === "number" && Number.isFinite(timeline.elapsedMs)) {
    return Math.max(1, Math.round(timeline.elapsedMs / 1000));
  }
  if (!timeline.startedAt) return 0;
  const startedMs = Date.parse(timeline.startedAt);
  if (!Number.isFinite(startedMs)) return 0;
  const endMs = timeline.completedAt ? Date.parse(timeline.completedAt) : now;
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startedMs) / 1000));
};

export const getVisibleTimelineSteps = (
  timeline: RoadmapAiActivityTimeline,
): RoadmapAiActivityTimeline["steps"] => {
  if (timeline.done) return timeline.steps;
  return timeline.steps.slice(-RUNNING_VISIBLE_STEP_COUNT);
};

export const getTitleListOverflowCount = (
  titleList: RoadmapAiActivityTimeline["steps"][number]["titleList"] | undefined,
): number => {
  if (!titleList) return 0;
  return Math.max(0, titleList.totalCount - titleList.shownCount);
};

export const getTimelineHeaderLabel = (
  timeline: RoadmapAiActivityTimeline,
  seconds: number,
): string => {
  if (seconds > 0) {
    if (timeline.done && seconds < 10) {
      return "Worked in a while";
    }
    return `${timeline.done ? "Worked" : "Working"} for ${seconds} seconds`;
  }
  return timeline.done ? "Worked" : "Working...";
};

// Group consecutive steps with the same title into a single display entry.
// This silently merges parallel tool calls so the timeline stays clean.
export function groupParallelSteps(
  steps: RoadmapAiActivityStep[],
): RoadmapAiActivityStep[] {
  const result: RoadmapAiActivityStep[] = [];
  let i = 0;
  while (i < steps.length) {
    const current = steps[i];
    let j = i + 1;
    while (j < steps.length && steps[j].title === current.title) {
      j++;
    }
    if (j - i === 1) {
      result.push(current);
    } else {
      const group = steps.slice(i, j);
      const worstStatus = group.reduce<RoadmapAiActivityStep["status"]>(
        (worst, s) => {
          if (s.status === "error") return "error";
          if (s.status === "running" && worst !== "error") return "running";
          return worst;
        },
        current.status,
      );
      // Use last step's summary (result steps are more informative than request steps)
      const lastSummary = group[group.length - 1].summary;
      // Merge titleLists from all steps, deduplicating by value
      const allItems = group
        .flatMap((s) => s.titleList?.items ?? [])
        .filter((item, idx, arr) => arr.indexOf(item) === idx);
      const totalCount = group.reduce(
        (sum, s) => sum + (s.titleList?.totalCount ?? 0),
        0,
      );
      const hasMore = group.some((s) => s.titleList?.hasMore ?? false);
      const mergedTitleList =
        allItems.length > 0
          ? { items: allItems, shownCount: allItems.length, totalCount, hasMore }
          : undefined;
      // Patch the first number in the summary to match the real merged count
      // e.g. "I found 1 matching roadmap item" → "I found 2 matching roadmap items"
      const mergedCount = mergedTitleList?.items.length ?? 0;
      const correctedSummary =
        mergedCount > 0
          ? lastSummary.replace(/\b\d+\b/, String(mergedCount))
          : lastSummary;
      result.push({
        ...current,
        status: worstStatus,
        summary: correctedSummary,
        titleList: mergedTitleList,
      });
    }
    i = j;
  }
  return result;
}

const statusClassName: Record<string, string> = {
  running: "text-gray-600",
  success: "text-gray-700",
  error: "text-red-700",
};

export function RoadmapAiActivityTimelineView({
  timeline,
  expanded,
  onToggle,
}: RoadmapAiActivityTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedStepSeq, setExpandedStepSeq] = useState<number | null>(null);
  const previousDoneRef = useRef(timeline.done);

  useEffect(() => {
    if (timeline.done) return;
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(handle);
  }, [timeline.done]);

  const seconds = useMemo(() => toElapsedSeconds(timeline, now), [timeline, now]);
  const workedLabel = useMemo(
    () => getTimelineHeaderLabel(timeline, seconds),
    [timeline, seconds],
  );
  const visibleSteps = useMemo(
    () => groupParallelSteps(getVisibleTimelineSteps(timeline)),
    [timeline],
  );

  useEffect(() => {
    if (visibleSteps.length === 0) {
      setExpandedStepSeq(null);
      return;
    }
    const newestSeq = visibleSteps[visibleSteps.length - 1].seq;
    if (!timeline.done) {
      // While running, always focus the latest row.
      setExpandedStepSeq(newestSeq);
      return;
    }
    setExpandedStepSeq((prev) =>
      visibleSteps.some((step) => step.seq === prev) ? prev : null,
    );
  }, [visibleSteps, timeline.done]);

  useEffect(() => {
    if (!previousDoneRef.current && timeline.done) {
      setExpandedStepSeq(null);
    }
    previousDoneRef.current = timeline.done;
  }, [timeline.done]);

  const toggleStep = (seq: number) => {
    setExpandedStepSeq((prev) => (prev === seq ? null : seq));
  };

  return (
    <div className="text-[11px] text-gray-700">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-800"
        onClick={onToggle}
      >
        <span className="inline-flex transition-transform duration-200 ease-out">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span>{workedLabel}</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="timeline-steps"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mt-2 overflow-hidden"
          >
            <div className="space-y-1.5">
              {visibleSteps.length === 0 ? (
                <p className="text-[11px] text-gray-500">Gathering activity...</p>
              ) : (
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleSteps.map((step) => {
                    const statusColor =
                      statusClassName[step.status] ?? statusClassName.running;
                    const isStepExpanded = expandedStepSeq === step.seq;
                    return (
                      <motion.div
                        layout
                        key={`${step.seq}-${step.event}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      >
                        <button
                          type="button"
                          className="w-full inline-flex items-center gap-1.5 text-left hover:text-gray-900"
                          onClick={() => toggleStep(step.seq)}
                        >
                          <span className="inline-flex transition-transform duration-200 ease-out">
                            {isStepExpanded ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
                            )}
                          </span>
                          <p className={`text-[11px] font-medium ${statusColor}`}>
                            {step.title}
                          </p>
                          {step.toolName && (
                            <code className="shrink-0 rounded bg-gray-100 px-1 py-px font-mono text-[9px] leading-4 text-gray-500">
                              {step.toolName}
                            </code>
                          )}
                          <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                            {new Date(step.ts).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                              second: "2-digit",
                              hour12: true,
                            })}
                          </span>
                        </button>
                        <AnimatePresence initial={false}>
                          {isStepExpanded && (
                            <motion.div
                              layout
                              initial={{ opacity: 0, height: 0, y: -2 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -2 }}
                              transition={{ duration: 0.18, ease: "easeOut" }}
                              className="ml-4 mt-1 overflow-hidden border-l border-gray-300 pl-2"
                            >
                              <p className="text-[11px] leading-relaxed text-gray-600">
                                {step.summary}
                              </p>
                              {Array.isArray(step.titleList?.items) &&
                                step.titleList.items.length > 0 && (
                                  <div className="mt-1.5 max-h-36 overflow-y-auto pr-1 text-[10.5px] text-gray-600">
                                    <ul className="space-y-0.5">
                                      {step.titleList.items.map((item, index) => (
                                        <li
                                          key={`${step.seq}-title-${index}`}
                                          className="flex gap-1"
                                        >
                                          <span className="text-gray-400">-</span>
                                          <span className="break-words">{item}</span>
                                        </li>
                                      ))}
                                    </ul>
                                    {getTitleListOverflowCount(step.titleList) > 0 && (
                                      <p className="mt-1 text-[10px] text-gray-500">
                                        ...and {getTitleListOverflowCount(step.titleList)}{" "}
                                        more
                                      </p>
                                    )}
                                  </div>
                                )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default RoadmapAiActivityTimelineView;
