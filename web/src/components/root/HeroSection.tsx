import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Workflow, Users2 } from "lucide-react";

const heroStats = [
  { label: "Ideas converted to plans", value: "24k+" },
  { label: "Consultant-guided projects", value: "8.2k+" },
  { label: "Freelancer deliverables", value: "63k+" },
];

const roadmapRows = [
  { step: "Project Framing", owner: "Consultant", status: "Complete" },
  { step: "Roadmap Architecture", owner: "Proyekto AI", status: "In Review" },
  { step: "Execution Team Match", owner: "Platform", status: "Ready" },
  { step: "Delivery Sprint", owner: "Freelancers", status: "Queued" },
];

export const HeroSection = () => {
  return (
    <section className="relative overflow-hidden pt-6 sm:pt-10">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-lg -translate-x-1/2 rounded-full bg-linear-to-r from-sky-100 to-amber-100 blur-3xl" />
      <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.06fr]">
        <div className="flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold tracking-[0.06em] text-slate-600"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            Product-First Execution Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06 }}
            className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
          >
            Turn ideas into
            <span className="block bg-linear-to-r from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent">
              structured execution.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.12 }}
            className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base"
          >
            Proyekto helps you define the project, match with expert consultants, generate a roadmap, and execute with vetted freelancers in one connected workflow.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2 }}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <Link to="/auth/signup" search={{ redirect: window.location.pathname }}>
              <Button
                variant="contained"
                colorScheme="primary"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(15,23,42,0.25)] hover:bg-slate-800"
              >
                Create Your Roadmap
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
            >
              See How It Works
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.26 }}
            className="mt-7 grid gap-3 sm:grid-cols-3"
          >
            {heroStats.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-lg font-semibold text-slate-900">{metric.value}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.18 }}
          className="relative"
        >
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_40px_rgba(15,23,42,0.14)]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Live Product Preview</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">Roadmap Command Center</h3>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                  Active
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Workflow className="h-3.5 w-3.5 text-sky-600" />
                    Roadmap Pipeline
                  </span>
                  <span>Q3 Release Cycle</span>
                </div>

                <div className="space-y-2">
                  {roadmapRows.map((row) => (
                    <div key={row.step} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{row.step}</p>
                        <p className="text-xs text-slate-500">Owner: {row.owner}</p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                        {row.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Matching Status</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">3 consultants shortlisted</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Execution Team</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                    <Users2 className="h-4 w-4 text-violet-600" />
                    12 freelancers in pool
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
