import { ClipboardPen, Users, Gauge } from "lucide-react";

const steps = [
  {
    number: "1",
    title: "Plan free",
    description:
      "Sketch your project in your workspace. Use AI to draft the roadmap, share it with stakeholders, refine until it's right. No credit card needed.",
    icon: ClipboardPen,
  },
  {
    number: "2",
    title: "Bring in a consultant",
    description:
      "When you're ready, request a vetted consultant. They scope, price, and propose a team within 48 hours — so you skip the freelancer-vetting marathon.",
    icon: Users,
  },
  {
    number: "3",
    title: "Ship together",
    description:
      "Track progress, comment on deliverables, approve work — all on one canvas. Pay through escrow, only on milestones.",
    icon: Gauge,
  },
];

export const HowItWorks = () => {
  const FirstIcon = steps[0].icon;
  const SecondIcon = steps[1].icon;
  const ThirdIcon = steps[2].icon;

  return (
    <section id="how-it-works" className="relative mt-16 lg:mt-20">
      <div className="pointer-events-none absolute -left-16 top-12 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-44 w-44 -translate-x-1/2 rounded-full bg-sky-200/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-20 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="relative text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          How Proyekto works
        </h2>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          From idea to shipped — without the freelancer-management overhead.
        </p>
      </div>

      <div className="relative mt-10 hidden lg:block">
        <svg
          viewBox="0 0 1200 210"
          preserveAspectRatio="none"
          className="h-[165px] w-full"
          aria-hidden
        >
          <path
            d="M 0 130 C 150 190, 250 190, 390 105 C 495 35, 650 35, 760 104 C 880 180, 1000 180, 1200 108"
            fill="none"
            stroke="rgba(148, 163, 184, 0.28)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M 0 130 C 150 190, 250 190, 390 105 C 495 35, 650 35, 760 104 C 880 180, 1000 180, 1200 108"
            fill="none"
            stroke="rgba(59, 130, 246, 0.9)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        <div className="pointer-events-none absolute left-[12%] top-[132px] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200/30 blur-2xl" />
        <div className="pointer-events-none absolute left-1/2 top-[28px] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/30 blur-2xl" />
        <div className="pointer-events-none absolute right-[12%] top-[94px] h-16 w-16 translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-200/30 blur-2xl" />

        <div className="absolute left-[12%] top-[132px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <FirstIcon className="h-5 w-5 text-blue-600" />
        </div>
        <div className="absolute left-1/2 top-[28px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <SecondIcon className="h-5 w-5 text-blue-600" />
        </div>
        <div className="absolute right-[12%] top-[94px] translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <ThirdIcon className="h-5 w-5 text-blue-600" />
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        {steps.map((step, index) => (
          <article
            key={step.title}
            className={`text-left ${index === 1 ? "lg:pl-6" : ""} ${index === 2 ? "lg:pl-10" : ""}`}
          >
            <p className="text-6xl font-semibold leading-none text-slate-300">{step.number}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
              {step.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
};
