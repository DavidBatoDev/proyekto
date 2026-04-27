import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

const testimonials = [
  {
    quote:
      "Finally a project tool built for consultants, not enterprise teams. Setting up my first client roadmap took minutes.",
    name: "Alex R.",
    role: "Independent Web Consultant",
    badge: "Early Access",
    initials: "AR",
  },
  {
    quote:
      "I used to dread client onboarding. Now I share the roadmap link and clients can see exactly what's happening at every step.",
    name: "Maria S.",
    role: "Freelance UX Designer",
    badge: "Beta User",
    initials: "MS",
  },
  {
    quote:
      "The AI roadmap feature drafted a full delivery plan from a 3-sentence brief. Saved me hours on a new project.",
    name: "Chris T.",
    role: "Product Consultant",
    badge: "Early Access",
    initials: "CT",
  },
];

const trustSignals = [
  "50+ Project Templates",
  "AI-Powered Planning",
  "Client-Ready Sharing",
];

export function WhyProyektoSection() {
  return (
    <section id="why-proyekto" className="relative mt-16 lg:mt-20">
      <div className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-12 h-44 w-44 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            What Early Users Say
          </h2>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            Trusted by freelancers, consultants, and early-stage teams.
          </p>
        </div>

        {/* Testimonials — horizontal scroll strip */}
        <div className="-mx-6 mt-8 sm:-mx-8">
          <div
            className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory px-6 pb-3 sm:px-8 scroll-px-6 sm:scroll-px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {testimonials.map((t) => (
              <article
                key={t.name}
                className="flex w-[82%] min-w-[260px] shrink-0 snap-center flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:w-[46%] lg:w-[calc(33.333%-11px)]"
              >
                <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {t.badge}
                </span>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">
                  <span className="mr-0.5 font-serif text-2xl font-bold leading-none text-slate-200">
                    "
                  </span>
                  {t.quote}
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {t.name}
                    </p>
                    <p className="text-xs text-slate-500">{t.role}</p>
                  </div>
                </div>
              </article>
            ))}
            {/* Right breathing room so last card doesn't flush to edge on mobile */}
            <div className="w-2 shrink-0 lg:hidden" />
          </div>
        </div>

        {/* Trust signals */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {trustSignals.map((signal) => (
            <span
              key={signal}
              className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500"
            >
              {signal}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <p className="text-sm text-slate-500">Ready to try it?</p>
          <Link
            to="/auth/signup"
            search={{ redirect: undefined }}
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 transition-colors hover:text-blue-600"
          >
            Get Early Access
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
