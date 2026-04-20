import { Layers3, Sparkles, TimerReset } from "lucide-react";

const cards = [
  {
    title: "You know the work — Proyekto helps you run it",
    description:
      "Turn your ideas into clear steps, align your team, and keep projects moving forward.",
    icon: Sparkles,
  },
  {
    title: "Everything stays in one place",
    description:
      "Your plan, your people, your tasks — all in one easy-to-use tool.",
    icon: Layers3,
  },
  {
    title: "Projects move forward, automatically",
    description:
      "Proyekto helps you track progress, send reminders, and keep everyone on the same page. No more falling behind.",
    icon: TimerReset,
  },
];

const loopCards = [...cards, ...cards];

export function WhyProyektoSection() {
  return (
    <section id="why-proyekto" className="relative mt-16 lg:mt-20">
      <div className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-12 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-8">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            WHY PROYEKTO
          </h2>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            The easiest way to get your project across the finish line
          </p>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-6">
          <div className="relative overflow-hidden">
            <div className="why-carousel-track flex w-max gap-4 pr-4">
              {loopCards.map((card, index) => {
                const Icon = card.icon;
                const tone = index % cards.length;

                return (
                  <article
                    key={`${card.title}-${index}`}
                    className={`w-[330px] shrink-0 rounded-2xl border p-5 shadow-[0_8px_18px_rgba(15,23,42,0.05)] md:w-[380px] ${
                      tone === 0
                        ? "border-blue-200 bg-linear-to-br from-blue-500 to-blue-600 text-white"
                        : tone === 1
                          ? "border-blue-200 bg-linear-to-br from-blue-300 to-blue-400 text-slate-900"
                          : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${
                        tone === 0
                          ? "border-blue-200/70 bg-white/15 text-white"
                          : tone === 1
                            ? "border-blue-200/80 bg-white/60 text-blue-700"
                            : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <h3
                      className={`mt-3 text-lg font-semibold ${
                        tone === 0 ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {card.title}
                    </h3>
                    <p
                      className={`mt-2 text-sm leading-relaxed ${
                        tone === 0
                          ? "text-blue-50"
                          : tone === 1
                            ? "text-blue-900/85"
                            : "text-slate-600"
                      }`}
                    >
                      {card.description}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-white to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-white to-transparent" />
          </div>
        </div>
      </div>

      <style>{`
        .why-carousel-track {
          animation: why-carousel-loop 26s linear infinite;
        }
        .why-carousel-track:hover {
          animation-play-state: paused;
        }
        @keyframes why-carousel-loop {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(calc(-50% - 0.5rem));
          }
        }
      `}</style>
    </section>
  );
}
