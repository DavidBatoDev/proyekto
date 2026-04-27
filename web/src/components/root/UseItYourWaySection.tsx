import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BriefcaseBusiness,
  RefreshCw,
  Repeat,
  LayoutList,
  Clock,
  CheckSquare,
  TrendingUp,
  Users,
  Building2,
  Layers,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

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
    examples: "Examples: Agency work · Design retainers · Product handoffs",
  },
  {
    title: "Projects that grow over time",
    description:
      "Start simple, then expand as needed. Add new goals, tasks, or deliverables anytime.",
    examples: "Examples: SaaS builds · Content programs · Brand projects",
  },
  {
    title: "Internal projects",
    description:
      "Use it to manage your own team and operations. Keep everything organized without needing another tool.",
    examples: "Examples: Hiring process · Internal systems · Product builds",
  },
];

const modePills = [
  { icon: BriefcaseBusiness, label: "One-time" },
  { icon: RefreshCw, label: "Ongoing" },
  { icon: Repeat, label: "Repeatable" },
  { icon: LayoutList, label: "Phased" },
  { icon: Clock, label: "Long-term" },
];

type LeftCard = {
  Icon: LucideIcon;
  tagline: string;
  bullets: string[];
};

const leftPanelCards: LeftCard[] = [
  {
    Icon: CheckSquare,
    tagline: "Defined scope. Clean delivery.",
    bullets: ["Plan everything upfront", "Hit milestones one by one", "Close it out with confidence"],
  },
  {
    Icon: RefreshCw,
    tagline: "Always in motion. Always organized.",
    bullets: ["Add tasks as work evolves", "Keep pace without losing track", "Update your plan in seconds"],
  },
  {
    Icon: Repeat,
    tagline: "Build once. Reuse forever.",
    bullets: ["Create your structure once", "Duplicate for any new client", "Save time on every new project"],
  },
  {
    Icon: Layers,
    tagline: "Phase it. Ship it.",
    bullets: ["Break the big picture into parts", "Focus on one phase at a time", "Never lose sight of the end goal"],
  },
  {
    Icon: Users,
    tagline: "Client-ready from day one.",
    bullets: ["Share a live plan with clients", "No more status update emails", "Everyone sees the same page"],
  },
  {
    Icon: TrendingUp,
    tagline: "Start small. Scale freely.",
    bullets: ["Begin with what you have", "Add goals and tasks anytime", "Your plan grows with your work"],
  },
  {
    Icon: Building2,
    tagline: "Your ops. One place.",
    bullets: ["No more juggling multiple tools", "Manage team workflows clearly", "Stay aligned across your team"],
  },
];

const TOTAL = useCases.length;
const AUTO_SCROLL_MS = 3500;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 340 : -340, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir < 0 ? 340 : -340, opacity: 0 }),
};

export function UseItYourWaySection() {
  // Desktop: hover overrides auto-scroll
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [desktopIndex, setDesktopIndex] = useState(0);
  const desktopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHoveringRef = useRef(false);

  const startDesktopScroll = useCallback(() => {
    if (desktopTimerRef.current) clearInterval(desktopTimerRef.current);
    desktopTimerRef.current = setInterval(() => {
      if (!isHoveringRef.current) {
        setDesktopIndex((prev) => (prev + 1) % TOTAL);
      }
    }, AUTO_SCROLL_MS);
  }, []);

  useEffect(() => {
    startDesktopScroll();
    return () => { if (desktopTimerRef.current) clearInterval(desktopTimerRef.current); };
  }, [startDesktopScroll]);

  // Mobile: swipeable infinite carousel
  const [mobileIndex, setMobileIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const navigate = useCallback((next: number, dir: number) => {
    setDirection(dir);
    setMobileIndex(next);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDirection(1);
      setMobileIndex((prev) => (prev + 1) % TOTAL);
    }, AUTO_SCROLL_MS);
  }, []);

  useEffect(() => {
    startAutoScroll();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startAutoScroll]);

  const goNext = () => {
    navigate((mobileIndex + 1) % TOTAL, 1);
    startAutoScroll();
  };
  const goPrev = () => {
    navigate((mobileIndex - 1 + TOTAL) % TOTAL, -1);
    startAutoScroll();
  };
  const jumpTo = (i: number) => {
    navigate(i, i > mobileIndex ? 1 : -1);
    startAutoScroll();
  };

  const effectiveDesktopIndex = hoveredIndex ?? desktopIndex;
  const activeCard = leftPanelCards[effectiveDesktopIndex];
  const activeUseCase = useCases[effectiveDesktopIndex];
  const mobileCard = leftPanelCards[mobileIndex];
  const mobileUseCase = useCases[mobileIndex];

  return (
    <section id="use-it-your-way" className="mt-16 lg:mt-20">

      {/* ── Mobile carousel (hidden on lg+) ── */}
      <div className="lg:hidden">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-5">

          {/* Fixed-size slide viewport */}
          <div className="relative h-[420px] overflow-hidden rounded-2xl">
            <AnimatePresence custom={direction} mode="wait" initial={false}>
              <motion.div
                key={mobileIndex}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.18}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -50) goNext();
                  else if (info.offset.x > 50) goPrev();
                }}
                style={{ touchAction: "pan-y" }}
                className="absolute inset-0 select-none overflow-hidden rounded-2xl bg-linear-to-br from-slate-100 to-slate-200 p-6"
              >
                {/* Decorative blurs */}
                <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-100/80 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-14 -left-14 h-40 w-40 rounded-full bg-indigo-100/70 blur-3xl" />

                <div className="relative z-10 flex h-full flex-col">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-xs font-bold text-slate-700">
                      {String(mobileIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-medium text-slate-400">
                      {mobileIndex + 1} / {TOTAL}
                    </span>
                  </div>

                  {/* Icon */}
                  <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 shadow-sm">
                    <mobileCard.Icon className="h-6 w-6 text-slate-700" />
                  </div>

                  {/* Title + tagline */}
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 leading-snug">
                    {mobileUseCase.title}
                  </h2>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    {mobileCard.tagline}
                  </p>

                  {/* Description */}
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    {mobileUseCase.description}
                  </p>

                  {/* Bullets */}
                  <ul className="mt-3 space-y-2">
                    {mobileCard.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white/80">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>

                  {/* Examples — pushed to bottom */}
                  <p className="mt-auto pt-3 text-xs text-slate-400 leading-relaxed">
                    {mobileUseCase.examples}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Controls: prev · dots · next */}
          <div className="mt-4 flex items-center justify-between px-1">
            <button
              onClick={goPrev}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 active:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5">
              {useCases.map((_, i) => (
                <button
                  key={i}
                  onClick={() => jumpTo(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === mobileIndex ? "w-6 bg-slate-700" : "w-1.5 bg-slate-300"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={goNext}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 active:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Desktop grid (hidden below lg) ── */}
      <div className="hidden lg:block">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_12px_30px_rgba(16,24,40,0.06)] lg:h-[calc(100vh-8rem)]">
          <div className="grid h-full grid-cols-[0.55fr_1fr] gap-8">

            {/* Left panel — flips via auto-scroll or hover */}
            <div className="relative h-full overflow-hidden rounded-3xl border border-slate-200/70 bg-linear-to-br from-slate-100 to-slate-200 p-6">
              <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-100/80 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-14 -left-14 h-40 w-40 rounded-full bg-indigo-100/70 blur-3xl" />

              <div className="relative z-10 h-full" style={{ perspective: "1200px" }}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={effectiveDesktopIndex}
                    initial={{ rotateY: 90, opacity: 0 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: -90, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    style={{ backfaceVisibility: "hidden" }}
                    className="flex h-full flex-col"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-xs font-bold text-slate-700">
                      {String(effectiveDesktopIndex + 1).padStart(2, "0")}
                    </span>

                    <div className="mt-6 flex flex-1 flex-col">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm">
                        <activeCard.Icon className="h-6 w-6 text-slate-700" />
                      </div>

                      <h3 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl">
                        {activeCard.tagline}
                      </h3>

                      <ul className="mt-5 space-y-3">
                        {activeCard.bullets.map((bullet) => (
                          <li key={bullet} className="flex items-center gap-2.5 text-sm text-slate-600">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white/80">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                            </span>
                            {bullet}
                          </li>
                        ))}
                      </ul>

                      <div className="mt-auto pt-6">
                        <p className="text-xs text-slate-400">{activeUseCase.examples}</p>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Right panel — flex column so items fill height with no gap below #7 */}
            <div
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white"
              onMouseEnter={() => { isHoveringRef.current = true; }}
              onMouseLeave={() => { isHoveringRef.current = false; setHoveredIndex(null); }}
            >
              {useCases.map((useCase, index) => {
                const isActive = effectiveDesktopIndex === index;
                return (
                  <article
                    key={useCase.title}
                    onMouseEnter={() => setHoveredIndex(index)}
                    className={`relative flex flex-1 items-center px-4 sm:px-5 transition-colors duration-200 ${
                      isActive ? "bg-slate-50" : ""
                    } ${index < useCases.length - 1 ? "border-b border-slate-200" : ""}`}
                  >
                    <span className={`absolute left-0 inset-y-2 w-0.5 rounded-full bg-slate-600 transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-0"}`} />
                    <motion.div
                      animate={{ x: isActive ? 6 : 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="flex w-full items-start gap-3"
                    >
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-200 ${
                        isActive
                          ? "border-slate-500 bg-white text-slate-900"
                          : "border-slate-300 bg-slate-50 text-slate-700"
                      }`}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{useCase.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{useCase.description}</p>
                      </div>
                    </motion.div>
                  </article>
                );
              })}
            </div>

          </div>
        </div>
      </div>

    </section>
  );
}
