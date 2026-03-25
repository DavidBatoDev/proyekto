import { motion } from "framer-motion";
import { ClipboardPen, UserRoundSearch, Map, Wrench } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Describe your project",
    description: "Share your goal, scope, and constraints in a guided brief.",
    icon: ClipboardPen,
  },
  {
    number: "02",
    title: "Match with consultants",
    description: "Get expert recommendations aligned to your domain and budget.",
    icon: UserRoundSearch,
  },
  {
    number: "03",
    title: "Get your roadmap",
    description: "Receive a milestone-based plan with dependencies and timelines.",
    icon: Map,
  },
  {
    number: "04",
    title: "Execute with freelancers",
    description: "Launch delivery with talent matched to each milestone phase.",
    icon: Wrench,
  },
];

export const HowItWorks = () => {
  return (
    <section id="how-it-works" className="mt-16 lg:mt-20">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          How It Works
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          One flow from concept to delivery.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Proyekto orchestrates planning, matching, and execution so momentum never breaks between phases.
        </p>
      </div>

      <div className="relative mt-10 grid gap-4 lg:grid-cols-4">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-7 hidden h-px bg-linear-to-r from-slate-200 via-slate-300 to-slate-200 lg:block" />

        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: index * 0.08 }}
              className="relative rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold tracking-[0.14em] text-slate-400">
                  {step.number}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.description}</p>

              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: "0%" }}
                  whileInView={{ width: "100%" }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.08 }}
                  className="h-full rounded-full bg-linear-to-r from-slate-400 to-slate-700"
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600 sm:text-base">
        Result: a roadmap-driven operating system, not disconnected tools.
      </div>
    </section>
  );
};
