import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, CircleDot, LoaderCircle, TimerReset } from "lucide-react";

type WorkflowStep = {
  title: string;
  phaseStatus: string;
};

const steps: WorkflowStep[] = [
  { title: "Project Framing", phaseStatus: "Complete" },
  { title: "Consultant Match", phaseStatus: "In Review" },
  { title: "Roadmap Architecture", phaseStatus: "Ready" },
  { title: "Execution Sprint", phaseStatus: "Active" },
];

const statusCycle = ["Queued", "In Review", "Complete"] as const;

const badgeStyles: Record<string, string> = {
  Queued: "border-blue-300 bg-blue-50 text-blue-700",
  "In Review": "border-violet-300 bg-violet-50 text-violet-700",
  Complete: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

function getRowStatus(stepIndex: number, activeIndex: number, tick: number) {
  if (stepIndex < activeIndex) return "Complete";
  if (stepIndex === activeIndex) return statusCycle[tick % statusCycle.length];
  return "Queued";
}

export function HeroLivePreview() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 1400);

    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = tick % steps.length;
  const progress = ((activeIndex + 1) / steps.length) * 100;

  const stepStates = useMemo(
    () => steps.map((step, index) => ({ ...step, status: getRowStatus(index, activeIndex, tick) })),
    [activeIndex, tick],
  );

  return (
    <div className="relative rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_55px_rgba(15,23,42,0.15)]">
      <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(circle_at_18%_12%,rgba(56,189,248,0.13),transparent_36%),radial-gradient(circle_at_93%_2%,rgba(168,85,247,0.09),transparent_34%)]" />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Live Preview</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Roadmap Command Center</h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <CircleDot className="h-3.5 w-3.5" />
            System Snapshot
          </span>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <TimerReset className="h-3.5 w-3.5 text-blue-600" />
              Execution Pipeline
            </span>
            <span>Cycle: Sprint 04</span>
          </div>

          <div className="relative ml-1">
            <div className="absolute bottom-2 left-2.5 top-2.5 w-px bg-slate-200" />

            <motion.div
              className="absolute left-2.5 w-px bg-blue-500"
              animate={{
                top: `calc(${(activeIndex / steps.length) * 100}% + 10px)`,
                height: `calc(${100 / steps.length}% - 8px)`,
              }}
              transition={{ type: "spring", stiffness: 230, damping: 22 }}
            />

            <div className="space-y-2.5">
              {stepStates.map((step, index) => {
                const isActive = index === activeIndex;
                const isDone = step.status === "Complete";

                return (
                  <motion.div
                    key={step.title}
                    layout
                    animate={{
                      borderColor: isActive ? "rgba(59, 130, 246, 0.45)" : "rgba(226, 232, 240, 1)",
                      backgroundColor: isActive ? "rgba(239, 246, 255, 0.98)" : "rgba(255, 255, 255, 0.95)",
                    }}
                    transition={{ duration: 0.25 }}
                    className="relative flex items-center justify-between rounded-xl border px-3 py-2.5"
                  >
                    {isActive ? (
                      <motion.span
                        className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-blue-300/40"
                        animate={{ opacity: [0.15, 0.4, 0.15] }}
                        transition={{ duration: 1.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                      />
                    ) : null}

                    <div className="relative flex items-center gap-2.5">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
                        {isDone ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : isActive ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-600" />
                        ) : (
                          <CircleDot className="h-3.5 w-3.5 text-slate-500" />
                        )}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{step.title}</p>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{step.phaseStatus}</p>
                      </div>
                    </div>

                    <span
                      className={`relative rounded-full border px-2 py-1 text-[11px] font-semibold ${badgeStyles[step.status]}`}
                    >
                      {step.status}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Workflow Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <motion.div
                className="h-full rounded-full bg-linear-to-r from-blue-400 via-violet-400 to-emerald-300"
                animate={{ width: `${progress}%` }}
                transition={{ type: "spring", stiffness: 180, damping: 24 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}