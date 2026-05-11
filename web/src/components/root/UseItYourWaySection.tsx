import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ComponentType } from "react";
import {
  CheckCircle2,
  Circle,
  RefreshCw,
  Copy,
  Layers,
  Users,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type ColorKey = "blue" | "emerald" | "violet" | "amber" | "cyan" | "indigo" | "slate";
type VisualKey = "checklist" | "timeline" | "template" | "phases" | "avatars" | "chart" | "grid";

type UseCase = {
  id: string;
  title: string;
  description: string;
  examples?: string;
  icon: ComponentType<{ className?: string }>;
  color: ColorKey;
  visual: VisualKey;
};

const colorMap: Record<ColorKey, { text: string; bg: string; border: string; iconBg: string }> = {
  blue: { text: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", iconBg: "bg-blue-100" },
  emerald: { text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", iconBg: "bg-emerald-100" },
  violet: { text: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200", iconBg: "bg-violet-100" },
  amber: { text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", iconBg: "bg-amber-100" },
  cyan: { text: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-200", iconBg: "bg-cyan-100" },
  indigo: { text: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200", iconBg: "bg-indigo-100" },
  slate: { text: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", iconBg: "bg-slate-100" },
};

const useCases: UseCase[] = [
  {
    id: "one-time",
    title: "One-Time Projects",
    description: "Perfect for projects with a clear start and finish. Plan everything upfront and close it out with confidence.",
    examples: "Website Build · Logo Project · Copywriting",
    icon: CheckCircle2,
    color: "blue",
    visual: "checklist",
  },
  {
    id: "ongoing",
    title: "Ongoing work",
    description: "Keep everything in one place as work continues. Add new tasks or deliverables as your project evolves.",
    examples: "Monthly marketing · Long-term client work",
    icon: RefreshCw,
    color: "emerald",
    visual: "timeline",
  },
  {
    id: "repeatable",
    title: "Repeatable projects",
    description: "Create once, reuse for every new client. Save time on project setup with reusable templates.",
    examples: "Client onboarding · Website builds · Campaign setups",
    icon: Copy,
    color: "violet",
    visual: "template",
  },
  {
    id: "phases",
    title: "Projects with phases",
    description: "Break big projects into smaller parts. Plan each phase clearly and move forward step by step.",
    examples: "Strategy → Design → Development → Launch",
    icon: Layers,
    color: "amber",
    visual: "phases",
  },
  {
    id: "clients",
    title: "Projects with clients",
    description: "Share your plan with clients so everyone stays aligned. No more back-and-forth or confusion on what's next.",
    icon: Users,
    color: "cyan",
    visual: "avatars",
  },
  {
    id: "growth",
    title: "Projects that grow over time",
    description: "Start simple, then expand as needed. Add new goals, tasks, or deliverables anytime.",
    icon: TrendingUp,
    color: "indigo",
    visual: "chart",
  },
  {
    id: "internal",
    title: "Internal projects",
    description: "Manage your own team and operations. Keep everything organized without needing another tool.",
    examples: "Hiring process · Internal systems · Product builds",
    icon: Settings,
    color: "slate",
    visual: "grid",
  },
];

function CardVisual({ visual }: { visual: VisualKey }) {
  if (visual === "checklist") {
    return (
      <div className="mt-4 rounded-xl border border-slate-100 bg-white p-3 shadow-sm space-y-2">
        {[
          { label: "Define scope", done: true },
          { label: "Design phase", done: true },
          { label: "Final launch", done: false },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            {item.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            )}
            <span className={`text-xs flex-1 ${item.done ? "text-slate-400 line-through" : "font-medium text-slate-700"}`}>
              {item.label}
            </span>
            {item.done && (
              <span className="text-[9px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100">Done</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (visual === "timeline") {
    return (
      <div className="mt-4 space-y-2.5">
        {[
          { label: "Week 1: Discovery", pct: 100 },
          { label: "Week 2: Build", pct: 68 },
          { label: "Week 3: Review", pct: 24 },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-28 shrink-0 font-medium">{item.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden border border-emerald-100">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                style={{ width: `${item.pct}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold text-emerald-600 w-7 text-right">{item.pct}%</span>
          </div>
        ))}
      </div>
    );
  }

  if (visual === "template") {
    return (
      <div className="mt-4 flex items-stretch gap-2">
        <div className="flex-1 rounded-xl border border-violet-100 bg-violet-50/80 p-2.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-violet-400 mb-1">Template</div>
          <div className="text-xs font-semibold text-slate-800">Client Onboarding</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {["Scope", "Design", "Launch"].map((tag) => (
              <span key={tag} className="text-[9px] bg-white rounded-full px-1.5 py-0.5 text-violet-600 font-medium border border-violet-100">{tag}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center">
          <Copy className="h-4 w-4 text-violet-300" />
        </div>
        <div className="flex-1 rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">New Project</div>
          <div className="text-xs font-semibold text-slate-800">Acme Corp</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {["Scope", "Design", "Launch"].map((tag) => (
              <span key={tag} className="text-[9px] bg-slate-50 rounded-full px-1.5 py-0.5 text-slate-500 font-medium border border-slate-100">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (visual === "phases") {
    const phases = ["Strategy", "Design", "Build", "Launch"];
    const progress = [100, 100, 45, 0];
    return (
      <div className="mt-4 rounded-xl border border-amber-100 bg-white p-3 shadow-sm">
        <div className="flex gap-1 mb-2.5">
          {progress.map((pct, i) => (
            <div key={i} className="flex-1 h-2 rounded-full bg-amber-50 border border-amber-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {phases.map((p, i) => (
            <div key={p} className="text-center">
              <span className={`text-[9px] font-bold truncate block ${progress[i] === 100 ? "text-amber-600" : progress[i] > 0 ? "text-amber-400" : "text-slate-300"}`}>
                {p}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual === "avatars") {
    return (
      <div className="mt-4 rounded-xl border border-cyan-100 bg-white p-3 shadow-sm">
        <div className="flex items-center mb-2.5">
          {[
            { init: "M", bg: "bg-cyan-500" },
            { init: "S", bg: "bg-blue-500" },
            { init: "K", bg: "bg-indigo-500" },
          ].map(({ init, bg }, i) => (
            <div
              key={init}
              style={{ marginLeft: i > 0 ? "-8px" : "0" }}
              className={`h-7 w-7 rounded-full border-2 border-white flex items-center justify-center text-[11px] font-bold text-white ${bg}`}
            >
              {init}
            </div>
          ))}
          <div
            style={{ marginLeft: "-8px" }}
            className="h-7 w-7 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500"
          >
            +1
          </div>
          <span className="ml-2.5 text-xs text-slate-500 font-medium">4 members</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-cyan-50 px-2 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-[11px] text-slate-600 font-medium">Everyone aligned · shared roadmap</span>
        </div>
      </div>
    );
  }

  if (visual === "chart") {
    const bars = [20, 35, 45, 58, 78, 100];
    return (
      <div className="mt-4 rounded-xl border border-indigo-100 bg-white p-3 shadow-sm">
        <div className="flex items-end gap-1 h-12 mb-2">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-md transition-all duration-500 ${i === bars.length - 1 ? "bg-indigo-500" : "bg-indigo-200"}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="text-[10px] text-indigo-500 font-semibold">↑ Scope grows with your needs</div>
      </div>
    );
  }

  if (visual === "grid") {
    return (
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {[
          { role: "Design", cls: "bg-slate-100 text-slate-700" },
          { role: "Dev", cls: "bg-blue-50 text-blue-700" },
          { role: "PM", cls: "bg-violet-50 text-violet-700" },
          { role: "QA", cls: "bg-slate-100 text-slate-600" },
          { role: "Content", cls: "bg-slate-100 text-slate-600" },
          { role: "+ Add", cls: "border border-dashed border-slate-200 text-slate-400 bg-white" },
        ].map(({ role, cls }) => (
          <div key={role} className={`rounded-lg px-2 py-2 text-center text-[10px] font-semibold ${cls}`}>
            {role}
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function UseCaseCard({ card }: { card: UseCase }) {
  const { text, bg, border, iconBg } = colorMap[card.color];
  const Icon = card.icon;

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${border} ${bg} p-5 shadow-sm flex flex-col h-full`}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/40 blur-2xl" />

      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-5 w-5 ${text}`} />
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900 leading-snug">{card.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{card.description}</p>

      <CardVisual visual={card.visual} />

      {card.examples && (
        <p className="mt-3 text-[11px] text-slate-400 font-medium">{card.examples}</p>
      )}
    </div>
  );
}

const NUM_SLIDES = 3;

export function UseItYourWaySection() {
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);

  const advance = useCallback((dir: 1 | -1) => {
    setDirection(dir);
    setSlide((prev) => (prev + dir + NUM_SLIDES) % NUM_SLIDES);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => advance(1), 3500);
    return () => clearInterval(id);
  }, [paused, advance]);

  const visibleCards = [0, 1, 2].map((i) => useCases[(slide * 3 + i) % useCases.length]);

  return (
    <section id="use-it-your-way" className="mt-16 scroll-mt-24 lg:mt-20">
      <div className="mb-8 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Use It Your Way</p>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          From simple projects to ongoing work
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Your project isn't always the same. Sometimes it's a one-time build, sometimes it keeps evolving.{" "}
          <span className="font-medium text-slate-700">Proyekto adapts to how you work — not the other way around.</span>
        </p>
      </div>

      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="overflow-hidden rounded-2xl h-[340px]">
          <AnimatePresence mode="popLayout" custom={direction}>
            <motion.div
              key={slide}
              custom={direction}
              variants={{
                enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
              className="grid grid-cols-1 gap-4 sm:grid-cols-3 h-full"
            >
              {visibleCards.map((card) => (
                <UseCaseCard key={card.id} card={card} />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => advance(-1)}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:border-slate-900 hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {Array.from({ length: NUM_SLIDES }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setDirection(i > slide ? 1 : -1);
                setSlide(i);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === slide ? "w-6 bg-slate-900" : "w-1.5 bg-slate-200 hover:bg-slate-400"
              }`}
            />
          ))}

          <button
            type="button"
            onClick={() => advance(1)}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:border-slate-900 hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
