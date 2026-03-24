import { type ComponentType, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Workflow, ListChecks, UserRoundSearch } from "lucide-react";

type ProductTab = "roadmap" | "tasks" | "matching";

const tabs: Array<{
  id: ProductTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  copy: string;
  chips: string[];
}> = [
  {
    id: "roadmap",
    label: "Roadmap Studio",
    icon: Workflow,
    title: "Build a roadmap with strategic clarity.",
    copy:
      "Convert a raw concept into milestones, dependencies, and execution lanes your whole team can align around.",
    chips: ["Milestone sequencing", "Risk flags", "Owner mapping"],
  },
  {
    id: "tasks",
    label: "Task Flow",
    icon: ListChecks,
    title: "Move from planning to execution without context loss.",
    copy:
      "Every milestone creates actionable workstreams, handoffs, and progress tracking across consultants and freelancers.",
    chips: ["Task readiness", "Delivery health", "Automated updates"],
  },
  {
    id: "matching",
    label: "Expert Matching",
    icon: UserRoundSearch,
    title: "Match the right people to the right milestone.",
    copy:
      "Get consultant recommendations first, then staff the execution layer with freelancers tailored to project phase and domain.",
    chips: ["Skill scoring", "Budget-aware", "Execution-fit ranking"],
  },
];

function ProductPreview({ active }: { active: ProductTab }) {
  if (active === "tasks") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Delivery Board</p>
          <p className="text-xs text-emerald-600">78% done</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {["Now", "Next", "Blocked"].map((lane) => (
            <div key={lane} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{lane}</p>
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  API contract review
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  Onboarding flow polish
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (active === "matching") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Matching Engine</p>
          <p className="text-xs text-slate-500">Phase: Build Sprint</p>
        </div>
        <div className="space-y-3">
          {[
            { name: "Maya Santos", role: "Product Consultant", fit: "97% fit" },
            { name: "Jordan Lee", role: "Frontend Freelancer", fit: "94% fit" },
            { name: "Nina Patel", role: "Backend Freelancer", fit: "92% fit" },
          ].map((person) => (
            <div key={person.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-slate-200" />
                <div>
                  <p className="text-sm font-medium text-slate-900">{person.name}</p>
                  <p className="text-xs text-slate-600">{person.role}</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                {person.fit}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Roadmap Studio</p>
        <p className="text-xs text-slate-500">Q2 Product Launch</p>
      </div>
      <div className="space-y-2">
        {[
          { name: "Foundation", progress: "Done" },
          { name: "Core Workflows", progress: "In review" },
          { name: "Team Matching", progress: "In progress" },
          { name: "Launch Readiness", progress: "Pending" },
        ].map((row, idx) => (
          <div key={row.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-slate-600">
                {idx + 1}
              </span>
              <span className="text-sm text-slate-800">{row.name}</span>
            </div>
            <span className="text-xs text-slate-500">{row.progress}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductExperienceSection() {
  const [activeTab, setActiveTab] = useState<ProductTab>("roadmap");
  const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveTab((prev) => {
        const currentIndex = tabs.findIndex((tab) => tab.id === prev);
        const nextIndex = (currentIndex + 1) % tabs.length;
        return tabs[nextIndex]?.id ?? tabs[0].id;
      });
    }, 2600);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section id="product-experience" className="mt-16 lg:mt-20">
      <div className="rounded-3xl border border-slate-200 bg-linear-to-br from-white to-slate-50 p-6 shadow-[0_16px_32px_rgba(15,23,42,0.08)] sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Product Experience
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              See how Proyekto moves your project from concept to completion.
            </h2>
            <p className="mt-3 text-sm text-slate-600 sm:text-base">
              Not just a landing page promise. This is the actual workflow layer your team uses daily.
            </p>

            <div className="mt-6 space-y-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <motion.button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    whileTap={{ scale: 0.99 }}
                    className={`relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-200 ${
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm"
                    }`}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="product-experience-active"
                        className="pointer-events-none absolute inset-0 rounded-2xl bg-slate-900"
                        transition={{ type: "spring", stiffness: 500, damping: 34 }}
                      />
                    ) : null}

                    <div className="relative flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-semibold">{tab.label}</span>
                    </div>
                    <p className={`relative mt-1 text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                      {tab.copy}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          </div>

          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">{activeConfig.title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeConfig.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <ProductPreview active={activeTab} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
