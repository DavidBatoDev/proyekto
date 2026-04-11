import { motion } from "framer-motion";
import { BriefcaseBusiness } from "lucide-react";

const useCases = [
  {
    title: "One-Time Projects",
    description:
      "Perfect for projects with a clear start and finish. Plan everything upfront, follow the steps, and close it out with confidence.",
    examples: "Examples: Website Build · Logo Project · Landing Page Copywriting",
  },
  {
    title: "Ongoing work",
    description:
      "Keep everything in one place as work continues. Add new tasks, phases, or deliverables as your project evolves.",
    examples:
      "Examples: Monthly marketing · Continuous improvements · Long-term client work",
  },
  {
    title: "Repeatable projects",
    description:
      "Use the same structure again and again. Create once, reuse for every new client or project.",
    examples: "Examples: Client onboarding · Website builds · Campaign setups",
  },
  {
    title: "Projects with phases",
    description:
      "Break big projects into smaller parts. Plan each phase clearly — and move forward step by step.",
    examples: "Examples: Strategy → Design → Development → Launch",
  },
  {
    title: "Projects with clients",
    description:
      "Share your plan with clients so everyone stays aligned. No more back-and-forth or confusion on what's next.",
  },
  {
    title: "Projects that grow over time",
    description:
      "Start simple, then expand as needed. Add new goals, tasks, or deliverables anytime.",
  },
  {
    title: "Internal projects",
    description:
      "Use it to manage your own team and operations. Keep everything organized without needing another tool.",
    examples: "Examples: Hiring process · Internal systems · Product builds",
  },
];

export function UseItYourWaySection() {
  return (
    <section id="use-it-your-way" className="mt-16 lg:mt-20">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[0.55fr_1fr] lg:gap-8">
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative h-full overflow-hidden rounded-3xl border border-slate-200/70 bg-linear-to-br from-slate-100 to-slate-200 p-6"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-100/80 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-14 -left-14 h-40 w-40 rounded-full bg-indigo-100/70 blur-3xl" />

            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                Flexible Project Modes
              </span>

              <div className="mt-6">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                  Use it your way — from simple projects to ongoing work
                </h2>
                <p className="mt-3 text-sm text-slate-600">
                  Your project isn't always the same.
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Sometimes it's a one-time build.
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Sometimes it keeps evolving.
                </p>
                <p className="mt-3 text-sm text-slate-600">
                  Proyekto adapts to how you work —
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  not the other way around.
                </p>
              </div>
            </div>
          </motion.div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            {useCases.map((useCase, index) => (
              <motion.article
                key={useCase.title}
                whileHover={{ x: 6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={`group relative overflow-hidden px-4 py-4 sm:px-5 ${
                  index < useCases.length - 1 ? "border-b border-slate-200" : ""
                }`}
              >
                <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span className="absolute -right-10 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-cyan-200/40 blur-2xl" />
                  <span className="absolute -left-10 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-indigo-200/35 blur-2xl" />
                </span>
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 transition-all duration-200 group-hover:border-slate-500 group-hover:bg-white group-hover:text-slate-900">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{useCase.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {useCase.description}
                    </p>
                    {useCase.examples ? (
                      <p className="mt-2 text-xs font-medium text-slate-500 transition-colors duration-200 group-hover:text-slate-600">
                        {useCase.examples}
                      </p>
                    ) : null}
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
