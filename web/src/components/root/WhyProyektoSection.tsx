import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Layers3, TimerReset, Target } from "lucide-react";

const ITEMS = [
  {
    icon: Target,
    title: "You know the work — Proyekto helps you run it",
    body: "Turn your ideas into clear steps, align your team, and keep projects moving forward — without juggling a dozen tools.",
  },
  {
    icon: Layers3,
    title: "Everything stays in one place",
    body: "Your roadmap, your team, your tasks and payments — all connected in one easy-to-use workspace.",
  },
  {
    icon: TimerReset,
    title: "Projects move forward, automatically",
    body: "Track progress, surface blockers, and keep everyone aligned — no more chasing updates or falling behind.",
  },
];

const CYCLE_MS = 3800;

export function WhyProyektoSection({ isActive: _isActive = true }: { isActive?: boolean }) {
  const [offset, setOffset] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  useEffect(() => {
    const id = setInterval(() => setOffset((i) => (i + 1) % ITEMS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const throneItem = ITEMS[offset % ITEMS.length];
  const card2Item = ITEMS[(offset + 1) % ITEMS.length];
  const card3Item = ITEMS[(offset + 2) % ITEMS.length];

  const ThroneIcon = throneItem.icon;
  const Card2Icon = card2Item.icon;
  const Card3Icon = card3Item.icon;

  return (
    <section id="why-proyekto" className="relative flex flex-col py-6">
      <motion.div
        className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl"
        animate={{ scale: [1, 1.15, 1], opacity: [0.25, 0.4, 0.25] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute right-0 top-12 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl"
        animate={{ scale: [1, 1.12, 1], opacity: [0.25, 0.38, 0.25] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
      />

      <div ref={ref} className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Why Proyekto</p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            The easiest way to get your project across the finish line
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
            Built for consultants, freelancers, and client teams who need clarity, speed, and alignment — all in one place.
          </p>
        </motion.div>

        <motion.div
          className="mt-10 grid gap-4 lg:grid-cols-12"
          initial={{ opacity: 0, y: 28 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.18 }}
        >
          {/* Card 1 — the throne, always blue */}
          <div
            className="relative overflow-hidden rounded-3xl p-8 text-white lg:col-span-5 lg:flex lg:min-h-[300px] lg:flex-col"
            style={{ background: "linear-gradient(135deg, rgb(37,99,235), rgb(67,56,202))" }}
          >
            {/* Decorative circles */}
            <motion.div
              animate={{ scale: [1, 1.12, 1], x: [0, 6, 0], y: [0, -8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10"
            />
            <motion.div
              animate={{ scale: [1, 1.18, 1], x: [0, -8, 0], y: [0, 6, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
              className="pointer-events-none absolute -bottom-6 right-4 h-32 w-32 rounded-full bg-black/10"
            />
            <motion.div
              animate={{ opacity: [0.25, 0.45, 0.25] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-blue-300/25 blur-2xl"
            />
            <motion.div
              animate={{ opacity: [0.2, 0.4, 0.2] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="pointer-events-none absolute -bottom-14 -left-14 h-40 w-40 rounded-full bg-indigo-400/20 blur-3xl"
            />

            {/* Cycling content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={offset}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.38, ease: "easeOut" }}
                className="relative z-10 flex h-full flex-col"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/15">
                  <ThroneIcon className="h-5 w-5 text-white" />
                </div>
                <div className="mt-auto pt-10 pb-8">
                  <h3 className="text-2xl font-semibold leading-snug">{throneItem.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-blue-100/90">{throneItem.body}</p>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Progress dots */}
            <div className="absolute bottom-5 left-8 z-10 flex items-center gap-1.5">
              {ITEMS.map((_, i) => (
                <motion.div
                  key={i}
                  className="h-1.5 rounded-full bg-white"
                  animate={{ width: i === offset % ITEMS.length ? 20 : 6, opacity: i === offset % ITEMS.length ? 1 : 0.35 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              ))}
            </div>

            {/* Timing bar */}
            <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 overflow-hidden rounded-b-3xl">
              <motion.div
                key={offset}
                className="h-full bg-white/40"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: CYCLE_MS / 1000, ease: "linear" }}
              />
            </div>
          </div>

          {/* Right stack */}
          <div className="grid gap-4 lg:col-span-7 lg:grid-rows-2">
            {/* Card 2 */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`c2-${offset}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28 }}
                  className="flex w-full gap-5"
                >
                  <div className="shrink-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                      <Card2Icon className="h-5 w-5 text-blue-600" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{card2Item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{card2Item.body}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Card 3 */}
            <div className="overflow-hidden rounded-3xl border border-slate-100 bg-slate-50 p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`c3-${offset}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28 }}
                  className="flex w-full gap-5"
                >
                  <div className="shrink-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                      <Card3Icon className="h-5 w-5 text-blue-600" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{card3Item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{card3Item.body}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
