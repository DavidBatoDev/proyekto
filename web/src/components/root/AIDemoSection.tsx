import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  CalendarDays,
  FileText,
  GitBranch,
  GripVertical,
  Layers,
  ListTodo,
  Maximize2,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Send,
  Share2,
  Sparkles,
} from "lucide-react";

type DemoPhase = "idle" | "greeting" | "typing" | "thinking" | "done";

type MockFeature = {
  title: string;
  description: string;
  taskCount: number;
  tasks: string[];
};

type MockEpic = {
  title: string;
  description: string;
  features: MockFeature[];
};

type MockRoadmap = {
  name: string;
  epics: MockEpic[];
};

type DemoTurn = {
  prompt: string;
  response: string;
  visibleEpicCount: number;
};

const FULL_STACK_ROADMAP: MockRoadmap = {
  name: "Full-Stack Fitness App Roadmap",
  epics: [
    {
      title: "Phase 1 - Platform Foundation",
      description:
        "Stand up the app shell, authentication, database model, API layer, and deployment pipeline.",
      features: [
        {
          title: "Auth, Profiles & Roles",
          description: "Create secure onboarding, sessions, user profiles, and role-aware access.",
          taskCount: 5,
          tasks: ["Email and OAuth login", "Profile setup", "Protected routes"],
        },
        {
          title: "Backend, Database & CI",
          description: "Design core entities, API contracts, environments, and automated deploys.",
          taskCount: 6,
          tasks: ["Schema design", "API modules", "Preview deployments"],
        },
        {
          title: "App Shell & Design System",
          description: "Create responsive navigation, shared components, and product-ready layouts.",
          taskCount: 4,
          tasks: ["Navigation shell", "Reusable UI kit", "Responsive states"],
        },
      ],
    },
    {
      title: "Phase 2 - Core Product Experience",
      description:
        "Build the workout planning, session logging, progress tracking, and responsive dashboard flows.",
      features: [
        {
          title: "Workout Builder",
          description: "Let users create routines with exercises, sets, reps, rest timers, and notes.",
          taskCount: 7,
          tasks: ["Exercise catalog", "Routine templates", "Set and rep editor"],
        },
        {
          title: "Progress Dashboard",
          description: "Surface workout history, streaks, personal records, and weekly summaries.",
          taskCount: 5,
          tasks: ["Activity timeline", "PR cards", "Weekly insights"],
        },
        {
          title: "Nutrition & Body Metrics",
          description: "Track goals, meals, measurements, and lightweight health progress signals.",
          taskCount: 5,
          tasks: ["Meal logging", "Body metrics", "Goal comparisons"],
        },
      ],
    },
    {
      title: "Phase 3 - Launch & Growth",
      description:
        "Prepare beta release, notifications, team workflows, analytics, and monetization experiments.",
      features: [
        {
          title: "Release Readiness",
          description: "Add QA coverage, observability, seed data, support flows, and launch checklist.",
          taskCount: 6,
          tasks: ["E2E smoke tests", "Error monitoring", "Launch checklist"],
        },
        {
          title: "Retention & Monetization",
          description: "Ship reminders, achievements, referral hooks, pricing tests, and analytics.",
          taskCount: 5,
          tasks: ["Workout reminders", "Achievement badges", "Pricing experiment"],
        },
        {
          title: "Team Operations & Support",
          description: "Prepare admin tools, feedback loops, customer support, and launch reporting.",
          taskCount: 4,
          tasks: ["Admin dashboard", "Feedback intake", "Support playbooks"],
        },
      ],
    },
  ],
};

const DEMO_TURNS: DemoTurn[] = [
  {
    prompt: "Build a full-stack fitness app roadmap.",
    response:
      "Phase 1 is ready: platform foundation, auth, database, API, and deployment work are now mapped.",
    visibleEpicCount: 1,
  },
  {
    prompt: "Add the core product experience for workouts and progress tracking.",
    response:
      "Phase 2 added: workout planning, session logging, progress dashboards, and user-facing flows.",
    visibleEpicCount: 2,
  },
  {
    prompt: "Add launch readiness and growth work as phase three.",
    response:
      "Phase 3 added: QA, release readiness, reminders, analytics, and monetization experiments.",
    visibleEpicCount: 3,
  },
];

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-slate-300"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </div>
  );
}

const STATUS_STYLES = [
  {
    featureLabel: "not started",
    taskLabel: "todo",
    border: "border-gray-300",
    featureBadge: "bg-gray-100 text-gray-800 border-gray-300",
    taskBadge: "bg-gray-100 text-gray-800",
    stroke: "#94a3b8",
    progress: "0%",
    progressWidth: "0%",
  },
] as const;

const FLOW_LAYOUT = {
  epicLeft: 66,
  epicTop: 110,
  epicWidth: 286,
  epicHeight: 190,
  epicGap: 590,
  featureLeft: 430,
  featureWidth: 320,
  featureHeight: 152,
  featureGap: 198,
  taskLeft: 780,
  taskTopOffset: -4,
  taskWidth: 156,
  canvasMinWidth: 980,
};

function getEpicTop(epicIndex: number) {
  return FLOW_LAYOUT.epicTop + epicIndex * FLOW_LAYOUT.epicGap;
}

function getFeatureTop(epicIndex: number, featureIndex: number) {
  return getEpicTop(epicIndex) - 52 + featureIndex * FLOW_LAYOUT.featureGap;
}

function RoadmapStructurePanel({
  roadmap,
  phase,
  visibleEpicCount,
}: {
  roadmap: MockRoadmap | null;
  phase: DemoPhase;
  visibleEpicCount: number;
}) {
  const visibleEpics = roadmap?.epics.slice(0, visibleEpicCount) ?? [];
  const features = visibleEpics.flatMap((epic) => epic.features);
  const featureCount = features.length;
  const taskCount = features.reduce((sum, feature) => sum + feature.taskCount, 0);
  const isPopulated = visibleEpics.length > 0;

  return (
    <aside className="hidden min-w-0 border-r border-slate-200 bg-white lg:flex lg:w-[300px] lg:flex-col">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-950">Roadmap Structure</h3>
          <span className="text-xs font-medium text-slate-500">
            {visibleEpics.length} {visibleEpics.length === 1 ? "epic" : "epics"}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <div className="rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-400">
            Search epics, features, tasks...
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-slate-500" />
            {featureCount} features
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-slate-500" />
            {taskCount} tasks
          </span>
          <span className="ml-auto flex items-center gap-3">
            <RotateCcw className="h-4 w-4 text-slate-500" />
            <span className="h-4 w-4 rounded border border-slate-300" />
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-4 py-4">
        <motion.div
          animate={phase === "thinking" ? { opacity: [0.55, 0.9, 0.55] } : { opacity: 1 }}
          transition={{ duration: 1.2, repeat: phase === "thinking" ? Infinity : 0 }}
          className="space-y-3"
        >
          {isPopulated &&
            visibleEpics.map((epic, epicIndex) => (
              <motion.div
                key={epic.title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.28, delay: epicIndex * 0.08 }}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-slate-400" />
                  <GitBranch className="h-4 w-4 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                    {epic.title}
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    {epic.features.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {epic.features.map((feature, featureIndex) => {
                    const status = STATUS_STYLES[0];
                    return (
                      <motion.div
                        key={`${epic.title}-${feature.title}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.24, delay: featureIndex * 0.05 }}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-600"
                      >
                        <GripVertical className="h-3.5 w-3.5 text-slate-300" />
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                        <span className="min-w-0 flex-1 truncate">{feature.title}</span>
                        <span className={`rounded-md border px-1.5 py-0.5 ${status.featureBadge}`}>
                          {status.featureLabel}
                        </span>
                        <span className="text-slate-500">{feature.taskCount}</span>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
        </motion.div>
      </div>
    </aside>
  );
}

function FlowEpicNode({
  epic,
  epicIndex,
  phase,
}: {
  epic: MockEpic;
  epicIndex: number;
  phase: DemoPhase;
}) {
  const status = STATUS_STYLES[0];
  const taskCount = epic.features.reduce((sum, feature) => sum + feature.taskCount, 0);

  return (
    <motion.div
      initial={phase === "done" ? { opacity: 0, scale: 0.96, x: -16 } : false}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ duration: 0.36, delay: epicIndex * 0.08 }}
      className={`absolute overflow-hidden rounded-[1.65rem] border-2 ${status.border} bg-white p-5 pb-6 shadow-md`}
      style={{
        left: FLOW_LAYOUT.epicLeft,
        top: getEpicTop(epicIndex),
        width: FLOW_LAYOUT.epicWidth,
        height: FLOW_LAYOUT.epicHeight,
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-600">
          Epic
        </span>
        <div className="flex gap-1 pt-1">
          <span className="h-2 w-2 rounded-full bg-slate-200" />
          <span className="h-2 w-2 rounded-full bg-slate-200" />
        </div>
      </div>
      <h3 className="line-clamp-2 text-sm font-bold leading-tight text-slate-950">{epic.title}</h3>
      <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-slate-500/95">
        {epic.description}
      </p>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[9px] text-slate-400">
          <span>Progress</span>
          <span>{status.progress}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: status.progressWidth }}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-slate-400">
        <span>{epic.features.length} features</span>
        <span>{taskCount} tasks</span>
      </div>
    </motion.div>
  );
}

function FlowFeatureNode({
  feature,
  epicIndex,
  featureIndex,
  phase,
}: {
  feature: MockFeature;
  epicIndex: number;
  featureIndex: number;
  phase: DemoPhase;
}) {
  const status = STATUS_STYLES[0];

  return (
    <motion.div
      initial={phase === "done" ? { opacity: 0, scale: 0.96, x: -10 } : false}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ duration: 0.32, delay: featureIndex * 0.07 + 0.12 }}
      className="absolute overflow-hidden rounded-[1.45rem] border-2 border-transparent bg-white p-4 pb-5 shadow-md"
      style={{
        left: FLOW_LAYOUT.featureLeft,
        top: getFeatureTop(epicIndex, featureIndex),
        width: FLOW_LAYOUT.featureWidth,
        height: FLOW_LAYOUT.featureHeight,
      }}
    >
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-slate-900">{feature.title}</p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500/95">
            {feature.description}
          </p>
        </div>
        <div className="mt-1 flex shrink-0 gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-200" />
          <span className="h-2 w-2 rounded-full bg-slate-200" />
        </div>
      </div>
      <span className={`inline-flex rounded border px-2 py-0.5 text-[9px] font-medium ${status.featureBadge}`}>
        {status.featureLabel}
      </span>
      <div className="mt-1.5">
        <div className="mb-1 flex items-center justify-between text-[9px] text-slate-400">
          <span>Progress</span>
          <span>{status.progress}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-amber-500"
            style={{ width: status.progressWidth }}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[9px] text-slate-500">
        <ListTodo className="h-2.5 w-2.5" />
        <span>{feature.taskCount} tasks</span>
        <span className="ml-auto">0/{feature.taskCount} done</span>
      </div>
    </motion.div>
  );
}

function TaskStack({
  feature,
  epicIndex,
  featureIndex,
  phase,
}: {
  feature: MockFeature;
  epicIndex: number;
  featureIndex: number;
  phase: DemoPhase;
}) {
  const status = STATUS_STYLES[0];

  return (
    <motion.div
      initial={phase === "done" ? { opacity: 0, x: 10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: featureIndex * 0.07 + 0.2 }}
      className="absolute rounded-xl border border-gray-200 bg-white/95 p-2.5 pb-3 shadow-sm"
      style={{
        left: FLOW_LAYOUT.taskLeft,
        top: getFeatureTop(epicIndex, featureIndex) + FLOW_LAYOUT.taskTopOffset,
        width: FLOW_LAYOUT.taskWidth,
      }}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">
          Tasks - {feature.tasks.length}
        </span>
        <Maximize2 className="h-2.5 w-2.5 text-slate-300" />
      </div>
      <div className="space-y-1">
        {feature.tasks.slice(0, 3).map((task) => (
          <div key={task} className="flex items-center gap-1.5">
            <span className="h-3 w-3 shrink-0 rounded-sm border-2 border-gray-300 bg-white" />
            <span className="min-w-0 flex-1 truncate text-[8px] font-medium text-slate-700">
              {task}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[7px] font-medium ${status.taskBadge}`}>
              {status.taskLabel}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function RoadmapFlowCanvas({
  roadmap,
  phase,
  visibleEpicCount,
}: {
  roadmap: MockRoadmap | null;
  phase: DemoPhase;
  visibleEpicCount: number;
}) {
  const visibleEpics = roadmap?.epics.slice(0, visibleEpicCount) ?? [];
  const isPopulated = visibleEpics.length > 0;
  const activeEpicIndex = Math.max(visibleEpics.length - 1, 0);
  const panY = isPopulated ? -activeEpicIndex * 500 : 0;
  const contentHeight =
    FLOW_LAYOUT.epicTop +
    Math.max(visibleEpics.length, 1) * FLOW_LAYOUT.epicGap +
    260;

  return (
    <div
      className="relative h-full min-h-[560px] overflow-hidden bg-slate-50"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.35) 1px, transparent 0)",
        backgroundSize: "18px 18px",
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(59,130,246,0.08),transparent_30%),radial-gradient(circle_at_80%_80%,rgba(16,185,129,0.08),transparent_28%)]" />
      <div className="absolute right-3 top-3 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <button type="button" className="flex h-9 w-9 items-center justify-center border-b border-slate-200">
          <Plus className="h-4 w-4 text-slate-700" />
        </button>
        <button type="button" className="flex h-9 w-9 items-center justify-center border-b border-slate-200">
          <Minus className="h-4 w-4 text-slate-700" />
        </button>
        <button type="button" className="flex h-9 w-9 items-center justify-center">
          <Maximize2 className="h-4 w-4 text-slate-700" />
        </button>
      </div>

      <div className="absolute bottom-3 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-xl xl:flex">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Drag to add</span>
        <span className="rounded-xl border border-slate-200 px-3 py-1.5 font-medium">Epic</span>
        <span className="rounded-xl border border-slate-200 px-3 py-1.5 font-medium">Feature</span>
        <span className="rounded-xl border border-slate-200 px-3 py-1.5 font-medium">Task</span>
      </div>

      <div className="absolute bottom-3 right-3 z-20 rounded-lg bg-white/80 px-2 py-1 text-[10px] text-slate-400">
        React Flow
      </div>

      <motion.div
        className="relative"
        animate={{ y: panY }}
        transition={{ type: "spring", stiffness: 82, damping: 20, mass: 0.9 }}
        style={{ minWidth: FLOW_LAYOUT.canvasMinWidth, height: contentHeight }}
      >
        {isPopulated ? (
          <>
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              {visibleEpics.slice(0, -1).map((epic, index) => {
                const nextStatus = STATUS_STYLES[(index + 1) % STATUS_STYLES.length];
                const x = FLOW_LAYOUT.epicLeft + FLOW_LAYOUT.epicWidth / 2;
                const fromY = getEpicTop(index) + FLOW_LAYOUT.epicHeight;
                const toY = getEpicTop(index + 1);
                return (
                  <motion.path
                    key={`${epic.title}-to-${visibleEpics[index + 1]?.title}`}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.16 }}
                    d={`M ${x} ${fromY} C ${x} ${fromY + 72}, ${x} ${toY - 72}, ${x} ${toY}`}
                    fill="none"
                    stroke={nextStatus.stroke}
                    strokeDasharray="5 7"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                );
              })}

              {visibleEpics.flatMap((epic, epicIndex) =>
                epic.features.map((feature, featureIndex) => {
                  const status = STATUS_STYLES[(epicIndex + featureIndex) % STATUS_STYLES.length];
                  const epicY = getEpicTop(epicIndex) + FLOW_LAYOUT.epicHeight / 2;
                  const featureY = getFeatureTop(epicIndex, featureIndex) + FLOW_LAYOUT.featureHeight / 2;
                  return (
                    <motion.path
                      key={`${epic.title}-${feature.title}-edge`}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.46, delay: featureIndex * 0.08 }}
                      d={`M ${FLOW_LAYOUT.epicLeft + FLOW_LAYOUT.epicWidth} ${epicY} C ${FLOW_LAYOUT.featureLeft - 72} ${epicY}, ${FLOW_LAYOUT.featureLeft - 72} ${featureY}, ${FLOW_LAYOUT.featureLeft} ${featureY}`}
                      fill="none"
                      stroke={status.stroke}
                      strokeLinecap="round"
                      strokeWidth="2"
                    />
                  );
                })
              )}

              {visibleEpics.flatMap((epic, epicIndex) =>
                epic.features.map((feature, featureIndex) => {
                  const featureY = getFeatureTop(epicIndex, featureIndex) + FLOW_LAYOUT.featureHeight / 2;
                  return (
                    <motion.path
                      key={`${feature.title}-tasks-edge`}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.36, delay: featureIndex * 0.06 + 0.08 }}
                      d={`M ${FLOW_LAYOUT.featureLeft + FLOW_LAYOUT.featureWidth} ${featureY} C ${FLOW_LAYOUT.taskLeft - 24} ${featureY}, ${FLOW_LAYOUT.taskLeft - 18} ${featureY}, ${FLOW_LAYOUT.taskLeft} ${featureY}`}
                      fill="none"
                      stroke="#cbd5e1"
                      strokeLinecap="round"
                      strokeWidth="1.5"
                    />
                  );
                })
              )}
            </svg>

            {visibleEpics.map((epic, epicIndex) => (
              <FlowEpicNode
                key={epic.title}
                epic={epic}
                epicIndex={epicIndex}
                phase={phase}
              />
            ))}

            {visibleEpics.flatMap((epic, epicIndex) =>
              epic.features.map((feature, featureIndex) => (
                <FlowFeatureNode
                  key={`${epic.title}-${feature.title}`}
                  feature={feature}
                  epicIndex={epicIndex}
                  featureIndex={featureIndex}
                  phase={phase}
                />
              ))
            )}

            {visibleEpics.flatMap((epic, epicIndex) =>
              epic.features.map((feature, featureIndex) => (
                <TaskStack
                  key={`${epic.title}-${feature.title}-tasks`}
                  feature={feature}
                  epicIndex={epicIndex}
                  featureIndex={featureIndex}
                  phase={phase}
                />
              ))
            )}

            {visibleEpics.map((epic, epicIndex) => {
              const status = STATUS_STYLES[epicIndex % STATUS_STYLES.length];
              const y = getEpicTop(epicIndex) - 24;
              return (
                <motion.div
                  key={`${epic.title}-phase-label`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: 0.08 }}
                  className="absolute flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 shadow-sm"
                  style={{
                    left: FLOW_LAYOUT.epicLeft,
                    top: y,
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.stroke }} />
                  Phase {epicIndex + 1}
                </motion.div>
              );
            })}
          </>
        ) : null}
      </motion.div>
    </div>
  );
}


export function AIDemoSection({ isActive: _isActive }: { isActive?: boolean } = {}) {
  const sectionRef = useRef<HTMLElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [typedText, setTypedText] = useState("");
  const [submittedPrompts, setSubmittedPrompts] = useState<string[]>([]);
  const [activeRoadmap, setActiveRoadmap] = useState<MockRoadmap | null>(null);
  const [aiResponses, setAiResponses] = useState<string[]>([]);
  const [visibleEpicCount, setVisibleEpicCount] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting && entry.intersectionRatio >= 0.25),
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setPhase("idle");
      setTypedText("");
      setSubmittedPrompts([]);
      setActiveRoadmap(null);
      setAiResponses([]);
      setVisibleEpicCount(0);
    }
  }, [isVisible]);

  useEffect(() => {
    if (phase === "idle") return;

    const container = chatScrollRef.current;
    if (!container) return;

    const frameId = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [phase, submittedPrompts.length, aiResponses.length]);

  useEffect(() => {
    if (!isVisible) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
    };

    let elapsed = 400;

    t(elapsed, () => {
      setPhase("greeting");
    });
    elapsed += 850;

    DEMO_TURNS.forEach((turn, turnIndex) => {
      for (let i = 0; i < turn.prompt.length; i++) {
        const charI = i;
        t(elapsed + charI * 34, () => {
          setPhase("typing");
          setTypedText(turn.prompt.slice(0, charI + 1));
        });
      }
      elapsed += turn.prompt.length * 34;

      t(elapsed + 280, () => {
        setSubmittedPrompts(DEMO_TURNS.slice(0, turnIndex + 1).map((item) => item.prompt));
        setTypedText("");
        setPhase("thinking");
      });
      elapsed += 280;

      t(elapsed + 1250, () => {
        setActiveRoadmap(FULL_STACK_ROADMAP);
        setVisibleEpicCount(turn.visibleEpicCount);
        setAiResponses(DEMO_TURNS.slice(0, turnIndex + 1).map((item) => item.response));
        setPhase("done");
      });
      elapsed += turnIndex === DEMO_TURNS.length - 1 ? 1500 : 1750;
    });

    return () => timers.forEach(clearTimeout);
  }, [isVisible]);

  return (
    <section ref={sectionRef} className="flex flex-col py-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col px-4 sm:px-6 lg:px-10">
        <div className="mb-4 text-center shrink-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
            Use It With AI
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Watch Proyekto build a full-stack roadmap
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
            Three prompts become a Phase 1, Phase 2, and Phase 3 execution plan.
          </p>
        </div>

        <div
          className="flex flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.10)]"
          style={{ height: "calc(100vh - 255px)", minHeight: "640px" }}
        >
          {/* Roadmap workspace toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <div className="flex items-center gap-6">
              <button
                type="button"
                className="flex h-10 items-center gap-2 border-b-2 border-slate-950 px-1 text-sm font-semibold text-slate-950"
              >
                <GitBranch className="h-4 w-4" />
                Roadmap
              </button>
              <button
                type="button"
                className="hidden h-10 items-center gap-2 px-1 text-sm font-medium text-slate-500 sm:flex"
              >
                <CalendarDays className="h-4 w-4" />
                Milestones
              </button>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"
              >
                <FileText className="h-4 w-4" />
                Edit Roadmap
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"
              >
                <MessageCircle className="h-4 w-4" />
                AI Chat
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)_330px]">
            <RoadmapStructurePanel
              roadmap={activeRoadmap}
              phase={phase}
              visibleEpicCount={visibleEpicCount}
            />
            <RoadmapFlowCanvas
              roadmap={activeRoadmap}
              phase={phase}
              visibleEpicCount={visibleEpicCount}
            />

              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="text-sm font-semibold text-slate-800">AI Assistant</span>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  New thread
                </button>
              </div>

                <div
                  ref={chatScrollRef}
                  className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-slate-50/40 px-4 pb-24 pt-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                {phase === "idle" && (
                  <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                    <Bot className="mb-3 h-9 w-9 text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">
                      Ask questions or request roadmap edits
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Example: "add an epic for onboarding improvements"
                    </p>
                  </div>
                )}
                <AnimatePresence>
                  {phase !== "idle" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-start gap-2"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
                        Hi! Tell me what you're building and I'll create a step-by-step roadmap for you.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {submittedPrompts.map((prompt, index) => (
                    <div key={`${prompt}-${index}`} className="contents">
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="flex justify-end"
                      >
                        <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">
                          {prompt}
                        </div>
                      </motion.div>
                      {aiResponses[index] && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.24, delay: 0.05 }}
                          className="flex items-start gap-2"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                            <Sparkles className="h-3.5 w-3.5 text-white" />
                          </div>
                          <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
                            {aiResponses[index]}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  ))}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {phase === "thinking" && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-start gap-2"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white shadow-sm">
                        <TypingIndicator />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

                <div className="sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white p-3">
                  <div className="mb-2 hidden text-[10px] text-slate-400 xl:block">
                    Agent endpoint: https://proyekto-agent-demo.run.app
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm">
                    <span className="min-w-0 flex-1 text-sm">
                      {typedText ? (
                        <span className="text-slate-900">
                          {typedText}
                          <motion.span
                            animate={{ opacity: [1, 0, 1] }}
                            transition={{ duration: 0.7, repeat: Infinity }}
                            className="ml-px inline-block h-3.5 w-0.5 translate-y-px rounded-full bg-slate-700"
                          />
                        </span>
                      ) : (
                        <span className="text-slate-400">Chat or request roadmap edits...</span>
                      )}
                    </span>
                    <motion.div
                      animate={phase === "thinking" ? { scale: [1, 1.18, 1], backgroundColor: ["rgb(37,99,235)", "rgb(96,165,250)", "rgb(37,99,235)"] } : {}}
                      transition={{ duration: 0.4 }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600"
                    >
                      <Send className="h-3.5 w-3.5 text-white" />
                    </motion.div>
                  </div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
