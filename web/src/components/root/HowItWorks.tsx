import { Users, Gauge } from "lucide-react";
import { HowItWorksAIDemo } from "./HowItWorksAIDemo";

const laterSteps = [
  {
    number: "02",
    Icon: Users,
    title: "Add people to your project",
    description:
      "Bring in your clients, team, or collaborators — so everyone knows what's happening and what's next.",
  },
  {
    number: "03",
    Icon: Gauge,
    title: "Stay on Track",
    description:
      "From timelines to tasks, conversations to payments — everything is organized in one place so your project keeps moving.",
  },
];

export const HowItWorks = () => {
  return (
    <section id="how-it-works" className="relative mt-16 lg:mt-20">
      <div className="pointer-events-none absolute -left-16 top-12 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      {/* Section header */}
      <div className="relative text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          How It Works
        </h2>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          Plan your project in minutes, not weeks.
        </p>
      </div>

      {/* Step 1 — AI showcase card */}
      <div className="relative mt-10 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(16,24,40,0.06)]">

        {/* Desktop: text header on top, full-width demo below */}
        <div className="hidden lg:flex lg:flex-col">
          <div className="flex items-center gap-5 border-b border-slate-100 px-8 py-5">
            <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-500">
              Step 01
            </span>
            <div>
              <h3 className="text-lg font-semibold leading-tight tracking-tight text-slate-900">
                AI builds your roadmap instantly
              </h3>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
                Describe your project goal and the AI assistant creates a complete roadmap — epics, features, and tasks — in seconds.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 p-5">
            <HowItWorksAIDemo />
          </div>
        </div>

        {/* Mobile: stacked */}
        <div className="lg:hidden">
          <div className="px-5 pt-6 pb-4">
            <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-500">
              Step 01
            </span>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
              AI builds your roadmap instantly
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Describe your project goal and the AI assistant creates a complete
              roadmap — epics, features, and tasks — in seconds. No setup
              required.
            </p>
          </div>
          <div className="bg-slate-50 px-4 pb-5 pt-1">
            <HowItWorksAIDemo compact />
          </div>
        </div>
      </div>

      {/* Steps 2 & 3 */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {laterSteps.map((step) => (
          <div
            key={step.number}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(16,24,40,0.04)]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                <step.Icon className="h-5 w-5 text-slate-600" />
              </div>
              <span className="text-sm font-semibold text-slate-400">
                Step {step.number}
              </span>
            </div>
            <h3 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};
