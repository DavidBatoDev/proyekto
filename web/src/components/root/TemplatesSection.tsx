import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Clock3, DollarSign, Layers3, Sparkles } from "lucide-react";

const categories = ["All", "Web App", "SaaS", "AI", "Marketplace", "Mobile"];

type TemplateItem = {
  id: string;
  name: string;
  category: "Web App" | "SaaS" | "AI" | "Marketplace" | "Mobile";
  difficulty: "Starter" | "Growth" | "Advanced";
  timeline: string;
  cost: string;
  description: string;
  milestones: string[];
};

const templates: TemplateItem[] = [
  {
    id: "tpl-1",
    name: "B2B SaaS Platform Launch",
    category: "SaaS",
    difficulty: "Advanced",
    timeline: "14-18 weeks",
    cost: "$35k-$60k",
    description: "Full roadmap for launching a subscription SaaS with onboarding, billing, and analytics.",
    milestones: ["MVP scope", "Activation loop", "Billing + metering", "Growth experiments"],
  },
  {
    id: "tpl-2",
    name: "AI Assistant for Support",
    category: "AI",
    difficulty: "Growth",
    timeline: "8-12 weeks",
    cost: "$18k-$32k",
    description: "Design, evaluate, and deploy an AI assistant tied to product documentation and support history.",
    milestones: ["Intent mapping", "Knowledge sync", "Guardrails", "Agent handoff"],
  },
  {
    id: "tpl-3",
    name: "Marketplace MVP",
    category: "Marketplace",
    difficulty: "Advanced",
    timeline: "12-16 weeks",
    cost: "$28k-$48k",
    description: "Roadmap for two-sided marketplace launch including matching, transactions, and trust workflows.",
    milestones: ["Supply onboarding", "Demand funnel", "Payments + escrow", "Quality controls"],
  },
  {
    id: "tpl-4",
    name: "Web App Modernization",
    category: "Web App",
    difficulty: "Growth",
    timeline: "6-10 weeks",
    cost: "$14k-$24k",
    description: "Upgrade a legacy web product into a modern architecture with incremental rollout phases.",
    milestones: ["Architecture audit", "Core refactor", "Performance hardening", "Release train"],
  },
  {
    id: "tpl-5",
    name: "Mobile Product Kickoff",
    category: "Mobile",
    difficulty: "Starter",
    timeline: "6-8 weeks",
    cost: "$10k-$18k",
    description: "Validate, design, and launch a production-ready mobile app roadmap with measurable milestones.",
    milestones: ["User journey map", "Feature sequencing", "QA system", "Launch + learn"],
  },
  {
    id: "tpl-6",
    name: "SaaS Revamp for Scale",
    category: "SaaS",
    difficulty: "Growth",
    timeline: "10-14 weeks",
    cost: "$22k-$38k",
    description: "Prioritize architecture, growth loops, and delivery operations to unlock scale.",
    milestones: ["Retention audit", "Workflow redesign", "Ops automation", "Scale QA"],
  },
];

const difficultyStyles: Record<TemplateItem["difficulty"], string> = {
  Starter: "bg-emerald-100 text-emerald-700",
  Growth: "bg-amber-100 text-amber-700",
  Advanced: "bg-rose-100 text-rose-700",
};

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
    <section id="templates" className="mt-16 lg:mt-20">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Roadmap Templates</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Start faster with curated execution blueprints.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
            Explore proven roadmap structures across product types. Every template includes milestones, complexity, timeline, and expected cost range.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Marketplace-ready template system
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
          <motion.article
            key={template.id}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.28, delay: index * 0.05 }}
            whileHover={{ y: -4 }}
            className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_16px_30px_rgba(15,23,42,0.12)]"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500">{template.category}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{template.name}</h3>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${difficultyStyles[template.difficulty]}`}>
                {template.difficulty}
              </span>
            </div>

            <p className="text-sm text-slate-600">{template.description}</p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600">
                <p className="inline-flex items-center gap-1 font-medium text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  Timeline
                </p>
                <p className="mt-1 text-slate-800">{template.timeline}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600">
                <p className="inline-flex items-center gap-1 font-medium text-slate-500">
                  <DollarSign className="h-3.5 w-3.5" />
                  Cost
                </p>
                <p className="mt-1 text-slate-800">{template.cost}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600">
                <p className="inline-flex items-center gap-1 font-medium text-slate-500">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Scope
                </p>
                <p className="mt-1 text-slate-800">{template.milestones.length} phases</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <Layers3 className="h-3.5 w-3.5" />
                Milestone Preview
              </p>
              <ul className="space-y-1 text-xs text-slate-700">
                {template.milestones.map((milestone) => (
                  <li
                    key={milestone}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 transition-colors group-hover:border-slate-300"
                  >
                    {milestone}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              Preview Template
            </button>
          </motion.article>
        ))}
      </div>
    </section>
  );
};
