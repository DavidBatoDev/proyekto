import { useMemo, useState } from "react";
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

export const TemplatesSection = () => {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>("All");

  const filteredTemplates = useMemo(
    () =>
      activeCategory === "All"
        ? templates
        : templates.filter((template) => template.category === activeCategory),
    [activeCategory],
  );

  return (
    <section id="templates" className="mt-14 lg:mt-16">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Roadmap Templates</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Start with a proven roadmap
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
            Skip the guesswork. Use structured plans designed for real projects.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
          <Sparkles className="h-4 w-4 text-cyan-600" />
          Templates as execution entry points
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredTemplates.map((template, index) => (
          <TemplateEntryCard key={template.id} template={template} index={index} />
        ))}
      </div>
    </section>
  );
};
