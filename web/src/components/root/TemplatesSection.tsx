import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { TemplateEntryCard, type TemplateEntry } from "./TemplateEntryCard";

const categories = ["All", "SaaS", "AI", "Web Apps", "E-commerce"] as const;

const templates: TemplateEntry[] = [
  {
    id: "saas-mvp-launch",
    name: "SaaS MVP Launch",
    category: "SaaS",
    timeline: "6-8 weeks",
    complexity: "Beginner",
    description: "Ship a usable SaaS MVP with clear milestones from scope to first paying users.",
    milestones: ["Scope framing", "Core product sprint", "Billing setup", "Launch checklist"],
  },
  {
    id: "ai-copilot",
    name: "AI Copilot Rollout",
    category: "AI",
    timeline: "8-10 weeks",
    complexity: "Intermediate",
    description: "Define use cases, safety rules, and deployment steps for a production AI assistant.",
    milestones: ["Use-case map", "Knowledge integration", "Guardrails", "Pilot rollout"],
  },
  {
    id: "web-app-replatform",
    name: "Web App Replatform",
    category: "Web Apps",
    timeline: "10-12 weeks",
    complexity: "Advanced",
    description: "Modernize architecture and delivery velocity without interrupting active users.",
    milestones: ["Audit + architecture", "Incremental migration", "Performance pass", "Release hardening"],
  },
  {
    id: "ecom-growth-engine",
    name: "E-commerce Growth Engine",
    category: "E-commerce",
    timeline: "7-9 weeks",
    complexity: "Intermediate",
    description: "Turn your store into a repeatable conversion system with prioritized growth sprints.",
    milestones: ["Funnel baseline", "Conversion fixes", "Lifecycle flows", "Experiment cadence"],
  },
  {
    id: "ai-automation-stack",
    name: "AI Automation Stack",
    category: "AI",
    timeline: "5-7 weeks",
    complexity: "Beginner",
    description: "Build a practical automation layer that removes repetitive operational bottlenecks.",
    milestones: ["Workflow discovery", "Integration map", "Automation sprint", "Team handoff"],
  },
  {
    id: "saas-scale-ops",
    name: "SaaS Scale Operations",
    category: "SaaS",
    timeline: "9-11 weeks",
    complexity: "Advanced",
    description: "Strengthen retention, reliability, and release cadence before the next growth wave.",
    milestones: ["Retention deep dive", "Workflow redesign", "Ops automation", "Scale QA"],
  },
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "60%" : "-60%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-60%" : "60%", opacity: 0 }),
};

export const TemplatesSection = () => {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("All");
  const [direction, setDirection] = useState(0);
  const activeCategoryIndexRef = useRef(0);

  const filteredTemplates = useMemo(
    () =>
      activeCategory === "All"
        ? templates
        : templates.filter((template) => template.category === activeCategory),
    [activeCategory],
  );

  const handleCategoryClick = (category: (typeof categories)[number]) => {
    const nextIndex = categories.indexOf(category);
    const dir = nextIndex > activeCategoryIndexRef.current ? 1 : -1;
    setDirection(dir);
    activeCategoryIndexRef.current = nextIndex;
    setActiveCategory(category);
  };

  return (
    <section id="templates" className="relative flex flex-col h-full py-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[62%] bg-[radial-gradient(75%_95%_at_50%_100%,rgba(37,99,235,0.26),rgba(37,99,235,0)_72%)]" />
      <div className="pointer-events-none absolute -left-28 bottom-10 z-0 h-64 w-64 rounded-full bg-blue-400/30 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 bottom-8 z-0 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/22 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-10 z-0 h-64 w-64 rounded-full bg-indigo-400/30 blur-3xl" />

      <div className="relative z-10 mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Roadmap Templates</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Start your project with just a few clicks
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
            Choose a template or create your own — Proyekto helps you get started without the hassle.
          </p>
        </div>

        <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm sm:absolute sm:right-0 sm:top-0 sm:mt-0">
          <Sparkles className="h-4 w-4 text-cyan-600" />
          Templates as execution entry points
        </div>
      </div>

      <div className="relative z-10 mb-4 flex flex-wrap gap-2">
        {categories.map((category) => {
          const isActive = category === activeCategory;
          return (
            <button
              key={category}
              type="button"
              onClick={() => handleCategoryClick(category)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                isActive
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-900 hover:text-slate-900"
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Clip container — hides the sliding grid during transition */}
      <div
        className="relative z-10 flex-1 overflow-hidden rounded-3xl bg-white/55 backdrop-blur-[1px]"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <AnimatePresence custom={direction} mode="wait" initial={false}>
          <motion.div
            key={activeCategory}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.32, ease: EASE }}
            className="presentation-inner-scroll h-full p-1"
          >
            <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTemplates.map((template, index) => (
                <TemplateEntryCard key={template.id} template={template} index={index} />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
};
