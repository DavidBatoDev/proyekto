import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, RotateCcw, Pencil, X } from "lucide-react";

const PHASE_DELAYS: Record<number, number> = {
  1: 500,   // user msg → typing
  2: 1300,  // typing → plan proposal (phase 3 waits for user to click Apply)
  4: 600,   // apply clicked → epic
  5: 550,   // feature 1
  6: 550,   // feature 2
  7: 450,   // feature 3 → confirmation
};

const EPIC = {
  title: "Onboarding Improvements",
  description:
    "Reduce new-user drop-off and accelerate time-to-value through signup and first-time user experience upgrades.",
};

const FEATURES = [
  {
    title: "Streamlined Signup & Account Creation",
    description:
      "Simplify and shorten the signup flow, reduce friction, and add progressive profiling.",
    tasks: ["Audit signup funnel", "Implement reduced-field form", "Add progressive profiling"],
  },
  {
    title: "Guided First-Run Experience",
    description: "Introduce an interactive product tour tailored to user goals.",
    tasks: ["Design 3-step contextual tour", "Build opt-in tour engine"],
  },
  {
    title: "First-Action Templates & In-app Guidance",
    description:
      "Provide templates and inline help so users complete a meaningful task quickly.",
    tasks: ["Create 3 starter templates", "Add contextual help links"],
  },
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </div>
  );
}

export function HowItWorksAIDemo({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (phase === 0 || phase === 8) return;
    const delay = PHASE_DELAYS[phase];
    if (!delay) return;
    const timer = setTimeout(() => setPhase((p) => p + 1), delay);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleSend = () => { if (phase === 0) setPhase(1); };
  const handleReset = () => setPhase(0);

  const showUserMsg = phase >= 1;
  const showTyping = phase === 2;
  const showPlan = phase >= 3;
  const planApplied = phase >= 4;
  const isDone = phase === 8;
  const showEpic = phase >= 4;
  const showFeature = [phase >= 5, phase >= 6, phase >= 7];
  const visibleCount = showFeature.filter(Boolean).length;

  // ── Shared chat pane (light-mode) ──────────────────────────────────
  const ChatPane = (
    <>
    <style>{`@keyframes demo-caret { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${
        compact ? "h-[260px]" : "w-[30%] min-w-[220px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-[11px] font-semibold text-slate-700">AI Assistant</span>
        <span className="ml-auto truncate text-[9px] text-slate-400">Roadmap Assistance</span>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2">
        {showUserMsg && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-end gap-0.5"
          >
            <span className="text-[9px] text-slate-400">You</span>
            <div className="rounded-2xl rounded-br-sm border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
              add an epic for onboarding improvements
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {showTyping ? (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-0.5"
            >
              <span className="text-[9px] text-slate-400">Assistant</span>
              <div className="w-fit rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3 py-2">
                <TypingDots />
              </div>
            </motion.div>
          ) : showPlan ? (
            <motion.div
              key={isDone ? "done" : "plan"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="flex flex-col gap-0.5"
            >
              <span className="text-[9px] text-slate-400">Assistant</span>
              {isDone ? (
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Staged 1 epic, 3 features, 7 tasks from the confirmed plan.
                </p>
              ) : (
                <>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    I prepared a focused epic for onboarding improvements with
                    three high-impact features. Say "apply this plan" to proceed.
                  </p>
                  {/* Plan proposal card */}
                  <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <span className="inline-flex rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
                      Plan proposal
                    </span>
                    <div className="mt-1.5 space-y-1.5">
                      {/* Epic */}
                      <div className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                          Epic
                        </span>
                        <div>
                          <p className="text-[10px] font-semibold leading-tight text-slate-900">
                            {EPIC.title}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-slate-500">
                            {EPIC.description}
                          </p>
                        </div>
                      </div>
                      {/* Features */}
                      {FEATURES.map((f) => (
                        <div key={f.title} className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0 rounded bg-teal-500 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                            Feat
                          </span>
                          <p className="text-[9px] leading-tight text-slate-700">
                            {f.title}
                          </p>
                        </div>
                      ))}
                    </div>
                    {/* Action buttons */}
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => { if (!planApplied) setPhase(4); }}
                        disabled={planApplied}
                        className={`rounded-lg px-2 py-1 text-[10px] font-semibold text-white transition-colors ${
                          planApplied
                            ? "cursor-default bg-slate-300"
                            : "cursor-pointer bg-blue-600 hover:bg-blue-500"
                        }`}
                      >
                        {planApplied ? "Applied ✓" : "Apply this plan"}
                      </button>
                      <button
                        onClick={handleReset}
                        disabled={planApplied}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-500 disabled:cursor-default disabled:opacity-50"
                      >
                        Discard plan
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Input row */}
      <div className="border-t border-slate-100 px-2.5 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <span className="flex-1 truncate text-[11px]">
            {phase === 0 ? (
              <span className="text-slate-700">
                add an epic for onboarding improvements
                <span className="ml-px inline-block h-[0.85em] w-px translate-y-px bg-slate-600 align-middle" style={{ animation: "demo-caret 1s step-end infinite" }} />
              </span>
            ) : (
              <span className="text-slate-400">Chat or request roadmap edits...</span>
            )}
          </span>
          {isDone ? (
            <button
              onClick={handleReset}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={phase !== 0}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                phase === 0
                  ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-500"
                  : "cursor-not-allowed bg-slate-200 text-slate-400"
              }`}
            >
              <Send className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );

  // ── Compact (mobile) ────────────────────────────────────────────────
  if (compact) {
    return (
      <div className="flex flex-col gap-2.5">
        {ChatPane}

        {/* Mobile roadmap canvas — simplified (no SVG lines or task panels) */}
        <AnimatePresence>
          {showEpic && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden rounded-xl border border-slate-200 bg-[#f1f3f5] p-2.5"
            >
              {/* Epic card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[10px] font-semibold leading-tight text-slate-900">
                    Onboarding Improvements
                  </p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Pencil className="h-2.5 w-2.5 text-slate-400" />
                    <X className="h-2.5 w-2.5 text-red-400" />
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-[8px] leading-relaxed text-slate-500">
                  {EPIC.description}
                </p>
                <p className="mt-1.5 text-[8px] text-slate-400">{visibleCount} features</p>
              </div>

              {/* Feature cards */}
              <div className="mt-2 flex flex-col gap-1.5">
                {FEATURES.map((feature, i) => {
                  if (!showFeature[i]) return null;
                  return (
                    <motion.div
                      key={feature.title}
                      initial={{ x: 8, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-[9px] font-semibold leading-tight text-slate-900">
                          {feature.title}
                        </p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Pencil className="h-2 w-2 text-slate-400" />
                          <X className="h-2 w-2 text-red-400" />
                          <span className="ml-0.5 h-2 w-2 rounded-full bg-amber-400" />
                        </div>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[8px] leading-relaxed text-slate-500">
                        {feature.description}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[8px] text-slate-500">
                          not started
                        </span>
                        <span className="text-[8px] text-slate-400">
                          ≡ {feature.tasks.length} tasks
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isDone && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[11px] font-medium text-emerald-600"
            >
              ✓ Staged 1 epic, 3 features, 7 tasks from the confirmed plan.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Desktop ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-[380px] gap-3">
      {ChatPane}

      {/* Roadmap canvas — mirrors actual app layout */}
      <div className="flex flex-1 overflow-hidden rounded-xl border border-slate-200 bg-[#f1f3f5] p-3">
        {!showEpic && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[11px] text-slate-400">
              Your roadmap will appear here
            </p>
          </div>
        )}

        {showEpic && (
          <div className="flex h-full w-full items-stretch gap-0">

            {/* Epic card column */}
            <div className="flex w-32 shrink-0 items-center">
              <motion.div
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="w-full rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[10px] font-semibold leading-tight text-slate-900">
                    Onboarding Improvements
                  </p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Pencil className="h-2.5 w-2.5 text-slate-400" />
                    <X className="h-2.5 w-2.5 text-red-400" />
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 text-[8px] leading-relaxed text-slate-500">
                  {EPIC.description}
                </p>
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-[8px] text-slate-400">
                    <span>Progress</span>
                    <span>0%</span>
                  </div>
                  <div className="h-0.5 overflow-hidden rounded-full bg-slate-100" />
                </div>
                <p className="mt-1.5 text-[8px] text-slate-400">
                  {visibleCount} features
                </p>
              </motion.div>
            </div>

            {/* SVG connector lines (bezier curves matching actual app) */}
            <svg
              className="h-full w-10 shrink-0"
              viewBox="0 0 1 3"
              preserveAspectRatio="none"
            >
              {showFeature[0] && (
                <path
                  d="M0,1.5 C0.5,1.5 0.5,0.5 1,0.5"
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                />
              )}
              {showFeature[1] && (
                <path
                  d="M0,1.5 L1,1.5"
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                />
              )}
              {showFeature[2] && (
                <path
                  d="M0,1.5 C0.5,1.5 0.5,2.5 1,2.5"
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                />
              )}
            </svg>

            {/* Feature rows — each slot is flex-1 so positions stay fixed as features animate in */}
            <div className="flex flex-1 flex-col">
              {FEATURES.map((feature, i) => (
                <div key={feature.title} className="flex flex-1 items-center gap-1.5">
                  <AnimatePresence>
                    {showFeature[i] && (
                      <motion.div
                        initial={{ x: 10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        className="flex w-full gap-1.5"
                      >
                        {/* Feature card */}
                        <div className="flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-[9px] font-semibold leading-tight text-slate-900">
                              {feature.title}
                            </p>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Pencil className="h-2 w-2 text-slate-400" />
                              <X className="h-2 w-2 text-red-400" />
                              <span className="ml-0.5 h-2 w-2 rounded-full bg-amber-400" />
                            </div>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[8px] leading-relaxed text-slate-500">
                            {feature.description}
                          </p>
                          <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[8px] text-slate-500">
                            not started
                          </span>
                          <div className="mt-1">
                            <div className="mb-0.5 flex justify-between text-[8px] text-slate-400">
                              <span>Progress</span>
                              <span>0%</span>
                            </div>
                            <div className="h-0.5 overflow-hidden rounded-full bg-slate-100" />
                          </div>
                          <div className="mt-0.5 flex justify-between text-[8px] text-slate-400">
                            <span>≡ {feature.tasks.length} tasks</span>
                            <span>0/{feature.tasks.length} done</span>
                          </div>
                        </div>

                        {/* Task mini-panel */}
                        <div className="flex w-20 shrink-0 flex-col gap-0.5">
                          {feature.tasks.map((task) => (
                            <div
                              key={task}
                              className="flex items-center gap-1 overflow-hidden rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm"
                            >
                              <span className="h-2 w-2 shrink-0 rounded-sm border border-slate-300" />
                              <span className="flex-1 truncate text-[7.5px] text-slate-600">
                                {task}
                              </span>
                              <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[7px] text-slate-400">
                                todo
                              </span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
