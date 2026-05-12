import { useState } from "react";
import { motion } from "framer-motion";
import { Layers3, TimerReset, Target } from "lucide-react";

const SCHEMES = [
  {
    name: "blue",
    grad: ["rgb(37,99,235)", "rgb(67,56,202)"],
    bodyText: "rgb(219,234,254)",
    card2Bg: "rgb(255,255,255)", card2Border: "rgb(226,232,240)",
    card3Bg: "rgb(248,250,252)", card3Border: "rgb(241,245,249)",
    iconAccent: "rgb(37,99,235)",
    iconAccentBg: "rgb(248,250,252)", iconAccentBorder: "rgb(241,245,249)",
  },
  {
    name: "violet",
    grad: ["rgb(124,58,237)", "rgb(109,40,217)"],
    bodyText: "rgb(237,233,254)",
    card2Bg: "rgb(255,255,255)", card2Border: "rgb(221,214,254)",
    card3Bg: "rgb(245,243,255)", card3Border: "rgb(237,233,254)",
    iconAccent: "rgb(124,58,237)",
    iconAccentBg: "rgb(245,243,255)", iconAccentBorder: "rgb(221,214,254)",
  },
  {
    name: "emerald",
    grad: ["rgb(5,150,105)", "rgb(15,118,110)"],
    bodyText: "rgb(209,250,229)",
    card2Bg: "rgb(255,255,255)", card2Border: "rgb(167,243,208)",
    card3Bg: "rgb(236,253,245)", card3Border: "rgb(209,250,229)",
    iconAccent: "rgb(5,150,105)",
    iconAccentBg: "rgb(236,253,245)", iconAccentBorder: "rgb(167,243,208)",
  },
  {
    name: "rose",
    grad: ["rgb(225,29,72)", "rgb(194,65,12)"],
    bodyText: "rgb(255,228,230)",
    card2Bg: "rgb(255,255,255)", card2Border: "rgb(253,164,175)",
    card3Bg: "rgb(255,241,242)", card3Border: "rgb(255,228,230)",
    iconAccent: "rgb(225,29,72)",
    iconAccentBg: "rgb(255,241,242)", iconAccentBorder: "rgb(253,164,175)",
  },
];

const T = { duration: 0.5, ease: "easeInOut" as const };

export function WhyProyektoSection({ isActive: _isActive = true }: { isActive?: boolean }) {
  const [idx, setIdx] = useState(0);
  const s = SCHEMES[idx];

  const cycle = () => setIdx((i) => (i + 1) % SCHEMES.length);

  return (
    <section id="why-proyekto" className="relative flex flex-col h-full py-6 overflow-hidden justify-center">
      <div className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-12 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Why Proyekto</p>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          The easiest way to get your project across the finish line
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Built for consultants, freelancers, and client teams who need clarity, speed, and alignment — all in one place.
        </p>
      </div>

      {/* Bento grid */}
      <div
        className="mt-10 grid cursor-pointer gap-4 select-none lg:grid-cols-12"
        onClick={cycle}
        title="Click to change theme"
      >
        {/* Primary card */}
        <div className="relative overflow-hidden rounded-3xl p-8 text-white lg:col-span-5 lg:flex lg:min-h-[300px] lg:flex-col">
          {/* Gradient layers — cross-fade between schemes */}
          {SCHEMES.map((sc, i) => (
            <motion.div
              key={sc.name}
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${sc.grad[0]}, ${sc.grad[1]})` }}
              animate={{ opacity: i === idx ? 1 : 0 }}
              transition={T}
            />
          ))}

          {/* Decorative circles */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-6 right-4 h-32 w-32 rounded-full bg-black/10" />

          <div className="relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/15">
            <Target className="h-5 w-5 text-white" />
          </div>

          <div className="relative z-10 mt-auto pt-10">
            <h3 className="text-2xl font-semibold leading-snug">
              You know the work — Proyekto helps you run it
            </h3>
            <motion.p
              animate={{ color: s.bodyText }}
              transition={T}
              className="mt-3 text-sm leading-relaxed"
            >
              Turn your ideas into clear steps, align your team, and keep projects moving forward — without juggling a dozen tools.
            </motion.p>
          </div>
        </div>

        {/* Right stack */}
        <div className="grid gap-4 lg:col-span-7 lg:grid-rows-2">
          <motion.div
            animate={{ backgroundColor: s.card2Bg, borderColor: s.card2Border }}
            transition={T}
            className="flex gap-5 rounded-3xl border p-6 shadow-sm"
          >
            <div className="shrink-0">
              <motion.div
                animate={{ backgroundColor: s.iconAccentBg, borderColor: s.iconAccentBorder }}
                transition={T}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border"
              >
                <motion.div animate={{ color: s.iconAccent }} transition={T}>
                  <Layers3 className="h-5 w-5" />
                </motion.div>
              </motion.div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Everything stays in one place</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                Your roadmap, your team, your tasks and payments — all connected in one easy-to-use workspace.
              </p>
            </div>
          </motion.div>

          <motion.div
            animate={{ backgroundColor: s.card3Bg, borderColor: s.card3Border }}
            transition={T}
            className="flex gap-5 rounded-3xl border p-6"
          >
            <div className="shrink-0">
              <motion.div
                animate={{ backgroundColor: s.iconAccentBg, borderColor: s.iconAccentBorder }}
                transition={T}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border"
              >
                <motion.div animate={{ color: s.iconAccent }} transition={T}>
                  <TimerReset className="h-5 w-5" />
                </motion.div>
              </motion.div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Projects move forward, automatically</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                Track progress, surface blockers, and keep everyone aligned — no more chasing updates or falling behind.
              </p>
            </div>
          </motion.div>
        </div>
      </div>

    </section>
  );
}
