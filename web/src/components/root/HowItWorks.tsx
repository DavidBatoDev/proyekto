import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ClipboardPen, Users, Gauge } from "lucide-react";

const steps = [
  {
    number: "1",
    title: "Start with a Roadmap",
    description:
      "Use a roadmap template or create a plan from scratch — break it down into steps, add deadlines, and visualize the entire process.",
    icon: ClipboardPen,
  },
  {
    number: "2",
    title: "Add people to your project",
    description:
      "Bring in your clients, team, or collaborators — so everyone knows what's happening and what's next.",
    icon: Users,
  },
  {
    number: "3",
    title: "Stay on Track",
    description:
      "From timelines to tasks, conversations to payments — everything is organized in one place so your project keeps moving.",
    icon: Gauge,
  },
];

const PATH = "M 0 130 C 150 190, 250 190, 390 105 C 495 35, 650 35, 760 104 C 880 180, 1000 180, 1200 108";

const FirstIcon = steps[0].icon;
const SecondIcon = steps[1].icon;
const ThirdIcon = steps[2].icon;

export const HowItWorks = ({ isActive: _isActive }: { isActive?: boolean } = {}) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="how-it-works" className="relative py-6">
      <div className="pointer-events-none absolute -left-16 top-12 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-44 w-44 -translate-x-1/2 rounded-full bg-sky-200/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div ref={ref} className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10">
        <div className="relative text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">How It Works</p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Plan your project in minutes, not weeks
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
            From idea to execution — break your project into clear steps, assign ownership, and keep everything moving.
          </p>
        </div>

        <div className="relative mt-10 hidden lg:block">
          <svg
            viewBox="0 0 1200 210"
            preserveAspectRatio="none"
            className="h-[165px] w-full"
            aria-hidden
          >
            {/* Ghost track */}
            <path
              d={PATH}
              fill="none"
              stroke="rgba(148, 163, 184, 0.28)"
              strokeWidth="6"
              strokeLinecap="round"
            />
            {/* Animated blue line */}
            <motion.path
              d={PATH}
              fill="none"
              stroke="rgba(59, 130, 246, 0.9)"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={inView ? { pathLength: 1, opacity: 1 } : {}}
              transition={{ duration: 1.6, ease: "easeInOut", delay: 0.3 }}
            />
          </svg>

          {/* Glow blob that follows the wave */}
          <motion.div
            className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/50 blur-3xl"
            initial={{ left: "0%", top: "62%" }}
            animate={
              inView
                ? {
                    left: ["0%", "17%", "33%", "54%", "73%", "100%"],
                    top: ["62%", "90%", "50%", "17%", "86%", "51%"],
                  }
                : {}
            }
            transition={{
              duration: 1.6,
              ease: "easeInOut",
              delay: 0.3,
              times: [0, 0.17, 0.33, 0.54, 0.73, 1],
            }}
          />

          {/* Node glows */}
          <div className="pointer-events-none absolute left-[12%] top-[132px] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200/30 blur-2xl" />
          <div className="pointer-events-none absolute left-1/2 top-7 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/30 blur-2xl" />
          <div className="pointer-events-none absolute right-[12%] top-[94px] h-16 w-16 translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-200/30 blur-2xl" />

          {/* Icon nodes — spring pop-in */}
          <motion.div
            className="absolute left-[12%] top-[132px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            initial={{ scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.7 }}
          >
            <FirstIcon className="h-5 w-5 text-blue-600" />
          </motion.div>
          <motion.div
            className="absolute left-1/2 top-7 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            initial={{ scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 1.1 }}
          >
            <SecondIcon className="h-5 w-5 text-blue-600" />
          </motion.div>
          <motion.div
            className="absolute right-[12%] top-[94px] translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            initial={{ scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 1.5 }}
          >
            <ThirdIcon className="h-5 w-5 text-blue-600" />
          </motion.div>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          {steps.map((step, index) => (
            <motion.article
              key={step.title}
              className={`text-left ${index === 1 ? "lg:pl-6" : ""} ${index === 2 ? "lg:pl-10" : ""}`}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: 0.5 + index * 0.12 }}
            >
              <p className="text-6xl font-semibold leading-none text-slate-300">{step.number}</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
                {step.description}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
};
