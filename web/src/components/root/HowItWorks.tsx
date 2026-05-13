import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gauge, Map, Users } from "lucide-react";

const steps = [
  {
    number: "1",
    title: "Start with a Roadmap",
    description:
      "Use a roadmap template or create a plan from scratch — break it down into steps, add deadlines, and visualize the entire process.",
    icon: Map,
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

const PATH_D =
  "M 0 130 C 150 190, 250 190, 390 105 C 495 35, 650 35, 760 104 C 880 180, 1000 180, 1200 108";

const REVEAL = [0.28, 0.52, 1.0];

// --- Wave band: many unique lines, each at a distinct Y + amplitude ---
const NUM_LINES = 16;
const BASE_Y = [130, 190, 190, 105, 35, 35, 104, 180, 180, 108];
const CENTER_Y = 110;
const GRADS = ["wg-bp", "wg-ci", "wg-pc", "wg-ib", "wg-pb", "wg-bh"];
// Deterministic per-line oscillation amplitudes (SVG units)
const OSC_AMPS = [3, 5, 2, 4, 6, 3, 5, 2, 4, 6, 3, 5, 2, 4, 6, 3];

function buildPath(yOffset: number, amp: number): string {
  const y = BASE_Y.map((v) => Math.round(CENTER_Y + (v - CENTER_Y) * amp + yOffset));
  return `M 0 ${y[0]} C 150 ${y[1]}, 250 ${y[2]}, 390 ${y[3]} C 495 ${y[4]}, 650 ${y[5]}, 760 ${y[6]} C 880 ${y[7]}, 1000 ${y[8]}, 1200 ${y[9]}`;
}

const WAVE_BAND = Array.from({ length: NUM_LINES }, (_, i) => {
  const t = i / (NUM_LINES - 1);
  const yOffset = -26 + t * 52;         // -26 .. +26  SVG units spread
  const amp    = 0.72 + t * 0.56;       // 0.72 .. 1.28  amplitude variation
  // opacity: highest in the middle of the band
  const opacity = 0.18 + 0.72 * Math.sin(Math.PI * t);
  const dur    = 5.2 + i * 0.42;        // each line has unique period
  const delay  = i * 0.30;
  return {
    path: buildPath(yOffset, amp),
    grad: GRADS[i % GRADS.length],
    opacity,
    dur,
    delay,
    oscAmp: OSC_AMPS[i],
    sw: 0.6 + opacity * 0.8,             // thicker lines in the middle
  };
});

const iconPositions = [
  { style: "left-[12%] top-[132px]", translateClass: "-translate-x-1/2 -translate-y-1/2" },
  { style: "left-1/2 top-[28px]",    translateClass: "-translate-x-1/2 -translate-y-1/2" },
  { style: "right-[12%] top-[94px]", translateClass: "translate-x-1/2 -translate-y-1/2" },
];

export const HowItWorks = ({ isActive = true }: { isActive?: boolean }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pathLength, setPathLength] = useState(0);
  const measureRef = useRef<SVGPathElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (measureRef.current) setPathLength(measureRef.current.getTotalLength());
  }, []);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveStep((s) => (s + 1) % steps.length);
    }, 3000);
  };

  useEffect(() => {
    if (!paused && isActive) startTimer();
    else if (timerRef.current) clearInterval(timerRef.current);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused, isActive]);

  const handleStepClick = (i: number) => { setActiveStep(i); startTimer(); };

  const targetOffset = pathLength > 0 ? pathLength * (1 - REVEAL[activeStep]) : pathLength;
  const ActiveIcon = steps[activeStep].icon;

  return (
    <section
      id="how-it-works"
      className="relative flex flex-col h-full py-6 overflow-hidden justify-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="pointer-events-none absolute -left-16 top-12 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-44 w-44 -translate-x-1/2 rounded-full bg-sky-200/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="relative text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">How It Works</p>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Plan your project in minutes, not weeks.
        </h2>
      </div>

      <div className="relative mt-10 hidden lg:block">
        <svg
          viewBox="0 0 1200 210"
          preserveAspectRatio="none"
          className="h-[165px] w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="wg-bp" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(59,130,246)" />
              <stop offset="50%"  stopColor="rgb(139,92,246)" />
              <stop offset="100%" stopColor="rgb(168,85,247)" />
            </linearGradient>
            <linearGradient id="wg-ci" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(6,182,212)" />
              <stop offset="100%" stopColor="rgb(99,102,241)" />
            </linearGradient>
            <linearGradient id="wg-pc" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(168,85,247)" />
              <stop offset="100%" stopColor="rgb(6,182,212)" />
            </linearGradient>
            <linearGradient id="wg-ib" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(99,102,241)" />
              <stop offset="100%" stopColor="rgb(59,130,246)" />
            </linearGradient>
            <linearGradient id="wg-bh" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(186,230,253)" />
              <stop offset="100%" stopColor="rgb(59,130,246)" />
            </linearGradient>
            <linearGradient id="wg-pb" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgb(139,92,246)" />
              <stop offset="100%" stopColor="rgb(59,130,246)" />
            </linearGradient>
          </defs>

          {/* Measurement path */}
          <path ref={measureRef} d={PATH_D} fill="none" stroke="none" strokeWidth="0" />

          {/* Wave band — 16 lines, each unique, all always visible */}
          {WAVE_BAND.map(({ path, grad, opacity, dur, delay, oscAmp, sw }, i) => (
            <motion.g
              key={i}
              animate={{ y: [0, oscAmp, 0, -oscAmp, 0] }}
              transition={{ repeat: Infinity, duration: dur, delay, ease: "easeInOut" }}
            >
              {/* Soft glow halo */}
              <path
                d={path}
                fill="none"
                stroke={`url(#${grad})`}
                strokeWidth={sw * 10}
                strokeLinecap="round"
                strokeOpacity={opacity * 0.08}
              />
              {/* Core line */}
              <path
                d={path}
                fill="none"
                stroke={`url(#${grad})`}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeOpacity={opacity}
              />
            </motion.g>
          ))}

          {/* Blue progress indicator */}
          <motion.path
            d={PATH_D}
            fill="none"
            stroke="rgba(59,130,246,1.0)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={pathLength}
            animate={{ strokeDashoffset: targetOffset }}
            transition={{ duration: 0.75, ease: "easeInOut" }}
          />
        </svg>

        {/* Glow blobs behind icons */}
        <div className="pointer-events-none absolute left-[12%] top-[132px] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200/30 blur-2xl" />
        <div className="pointer-events-none absolute left-1/2 top-[28px] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/30 blur-2xl" />
        <div className="pointer-events-none absolute right-[12%] top-[94px] h-16 w-16 translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-200/30 blur-2xl" />

        {/* Icon nodes */}
        {steps.map((step, i) => {
          const pos = iconPositions[i];
          const Icon = step.icon;
          const isActive = i === activeStep;
          return (
            <div key={step.title} className={`absolute ${pos.style} ${pos.translateClass}`}>
              {isActive && (
                <div className="absolute inset-0 animate-ping rounded-2xl bg-blue-400/30" />
              )}
              <motion.button
                onClick={() => handleStepClick(i)}
                animate={{
                  scale: isActive ? 1.15 : 1,
                  backgroundColor: isActive ? "rgb(37,99,235)" : "rgb(255,255,255)",
                  borderColor:     isActive ? "rgb(37,99,235)" : "rgb(226,232,240)",
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="relative rounded-2xl border p-3 shadow-sm"
                style={{ borderWidth: 1 }}
              >
                <Icon className="h-5 w-5" style={{ color: isActive ? "white" : "rgb(37,99,235)" }} />
              </motion.button>
            </div>
          );
        })}
      </div>

      {/* Step text carousel */}
      <div className="mt-6 lg:mt-4">
        <div className="mb-3 flex justify-center lg:hidden">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <ActiveIcon className="h-5 w-5 text-blue-600" />
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.article
            key={activeStep}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28 }}
            className="mx-auto max-w-lg text-center"
          >
            <p className="text-7xl font-semibold leading-none text-slate-200">
              {steps[activeStep].number}
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
              {steps[activeStep].title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              {steps[activeStep].description}
            </p>
          </motion.article>
        </AnimatePresence>
      </div>
    </section>
  );
};
