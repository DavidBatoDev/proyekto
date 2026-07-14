import { useMemo, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Sparkles } from "lucide-react";
import { TemplateEntryCard, type TemplateEntry } from "./TemplateEntryCard";

const categories = ["All", "SaaS", "AI", "Web Apps", "E-commerce"] as const;

const templates: TemplateEntry[] = [
  {
    id: "saas-mvp-launch",
    name: "SaaS MVP Launch",
    category: "SaaS",
    description: "Ship a usable SaaS MVP with clear milestones from scope to first paying users.",
    milestones: ["Scope framing", "Core product sprint", "Billing setup", "Launch checklist"],
  },
  {
    id: "ai-copilot",
    name: "AI Copilot Rollout",
    category: "AI",
    description: "Define use cases, safety rules, and deployment steps for a production AI assistant.",
    milestones: ["Use-case map", "Knowledge integration", "Guardrails", "Pilot rollout"],
  },
  {
    id: "web-app-replatform",
    name: "Web App Replatform",
    category: "Web Apps",
    description: "Modernize architecture and delivery velocity without interrupting active users.",
    milestones: ["Audit + architecture", "Incremental migration", "Performance pass", "Release hardening"],
  },
  {
    id: "ecom-growth-engine",
    name: "E-commerce Growth Engine",
    category: "E-commerce",
    description: "Turn your store into a repeatable conversion system with prioritized growth sprints.",
    milestones: ["Funnel baseline", "Conversion fixes", "Lifecycle flows", "Experiment cadence"],
  },
  {
    id: "ai-automation-stack",
    name: "AI Automation Stack",
    category: "AI",
    description: "Build a practical automation layer that removes repetitive operational bottlenecks.",
    milestones: ["Workflow discovery", "Integration map", "Automation sprint", "Team handoff"],
  },
  {
    id: "saas-scale-ops",
    name: "SaaS Scale Operations",
    category: "SaaS",
    description: "Strengthen retention, reliability, and release cadence before the next growth wave.",
    milestones: ["Retention deep dive", "Workflow redesign", "Ops automation", "Scale QA"],
  },
];

export const TemplatesSection = ({ isActive: _isActive }: { isActive?: boolean } = {}) => {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("All");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const filteredTemplates = useMemo(
    () =>
      activeCategory === "All"
        ? templates
        : templates.filter((template) => template.category === activeCategory),
    [activeCategory],
  );

  return (
    <section id="templates" className="relative py-6">
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[62%] bg-[radial-gradient(75%_95%_at_50%_100%,rgba(37,99,235,0.26),rgba(37,99,235,0)_72%)]"
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -left-28 bottom-10 z-0 h-64 w-64 rounded-full bg-blue-400/30 blur-3xl"
        animate={{ scale: [1, 1.14, 1], opacity: [0.3, 0.45, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute left-1/2 bottom-8 z-0 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/22 blur-3xl"
        animate={{ scale: [1, 1.1, 1], opacity: [0.22, 0.35, 0.22] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />
      <motion.div
        className="pointer-events-none absolute -right-28 bottom-10 z-0 h-64 w-64 rounded-full bg-indigo-400/30 blur-3xl"
        animate={{ scale: [1, 1.12, 1], opacity: [0.3, 0.42, 0.3] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />

      <div ref={ref} className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10">
        <motion.div
          className="relative z-10 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          <div className="pr-0 sm:pr-80">
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
        </motion.div>

        <motion.div
          className="relative z-10 mb-6 flex flex-wrap gap-2"
          initial={{ opacity: 0, y: 14 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.45, delay: 0.14 }}
        >
          {categories.map((category) => {
            const isActive = category === activeCategory;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-900 hover:text-slate-900"
                }`}
              >
                {category}
              </button>
            );
          })}
        </motion.div>

        <motion.div
          className="relative z-10 rounded-3xl bg-white/55 p-1 backdrop-blur-[1px]"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.24 }}
        >
          <div className="grid items-start gap-x-3 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template, index) => (
              <TemplateEntryCard key={template.id} template={template} index={index} />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
};
