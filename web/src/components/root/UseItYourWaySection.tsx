import { useState } from "react";
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
    examples: "Examples: Monthly marketing · Continuous improvements · Long-term client work",
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

type UseCase = { title: string; description: string; examples?: string };

function UseCaseRow({ useCase, index, isLast }: { useCase: UseCase; index: number; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <article
      className={`relative overflow-hidden px-4 py-4 sm:px-5 ${!isLast ? "border-b border-slate-100" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.span
        className="pointer-events-none absolute inset-0"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <span className="absolute -right-8 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-blue-500/30 blur-2xl" />
        <span className="absolute -left-8 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-indigo-500/25 blur-2xl" />
      </motion.span>

      <motion.div
        className="relative flex items-start gap-3"
        animate={{ x: hovered ? 6 : 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <motion.span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-xs font-bold text-slate-700"
          animate={{ scale: hovered ? 1.12 : 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {String(index + 1).padStart(2, "0")}
        </motion.span>
        <div>
          <h3 className="text-base font-bold text-slate-900">{useCase.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{useCase.description}</p>
          {useCase.examples ? (
            <p className="mt-2 text-xs italic text-slate-400">{useCase.examples}</p>
          ) : null}
        </div>
      </motion.div>
    </article>
  );
}

export function UseItYourWaySection() {
  return (
    <section id="use-it-your-way" className="flex flex-col py-6">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[0.55fr_1fr] lg:gap-8">
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative h-full overflow-hidden rounded-3xl p-6"
            style={{ background: "linear-gradient(135deg, rgb(37,99,235), rgb(67,56,202))" }}
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-6 right-4 h-32 w-32 rounded-full bg-black/10" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-blue-300/25 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-14 -left-14 h-40 w-40 rounded-full bg-indigo-400/20 blur-3xl" />

            <div className="relative z-10 flex h-full flex-col">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs font-semibold text-white/90">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                Flexible Project Modes
              </span>

              <h2 className="mt-6 text-2xl font-semibold leading-snug tracking-tight text-white sm:text-3xl">
                Use it your way — from simple projects to ongoing work
              </h2>

              <p className="mt-4 text-sm leading-relaxed text-blue-100/90">
                Your project isn't always the same shape. Sometimes it's a one-time build, sometimes it keeps evolving — and sometimes it's both.
              </p>

              <div className="mt-6 border-t border-white/15 pt-5">
                <p className="text-sm font-medium text-white">
                  Proyekto adapts to how you work.
                </p>
                <p className="mt-1 text-sm text-blue-200/80">
                  Not the other way around.
                </p>
              </div>
            </div>
          </motion.div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {useCases.map((useCase, index) => (
              <UseCaseRow
                key={useCase.title}
                useCase={useCase}
                index={index}
                isLast={index === useCases.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
