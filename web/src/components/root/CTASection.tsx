import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { Sparkles } from "lucide-react";

export const CTASection = () => {
  return (
    <section className="mt-20">
      <div className="relative overflow-hidden rounded-3xl bg-[#2f5cff] p-6 [box-shadow:inset_0_0_140px_rgba(255,255,255,0.34),inset_0_0_56px_rgba(255,255,255,0.26),0_18px_40px_rgba(47,92,255,0.3)] sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_28%,rgba(255,255,255,0.52),transparent_35%),radial-gradient(circle_at_86%_70%,rgba(255,255,255,0.36),transparent_42%),linear-gradient(120deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_36%,rgba(255,255,255,0.12)_100%)]" />
        <div className="pointer-events-none absolute inset-[1px] rounded-[calc(theme(borderRadius.3xl)-1px)] border border-white/28" />
        <div className="pointer-events-none absolute left-28 top-0 h-6 w-24 border border-white/35 bg-white/10 backdrop-blur-[1px] [clip-path:polygon(8%_0,92%_0,84%_100%,16%_100%)]" />
        <div className="pointer-events-none absolute bottom-0 right-24 h-8 w-36 border border-white/35 bg-white/10 backdrop-blur-[1px] [clip-path:polygon(0_100%,14%_0,86%_0,100%_100%)]" />

        <div className="relative grid items-center gap-6 lg:grid-cols-[164px_1fr]">
          <div className="flex h-28 w-28 items-center justify-center rounded-3xl border border-white/40 bg-white/90 shadow-[0_10px_24px_rgba(15,23,42,0.15)] sm:h-32 sm:w-32">
            <Sparkles className="h-10 w-10 text-slate-700" />
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Ready to ship something real?
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-blue-50/95">
              Start your project free. Bring in a vetted consultant when you're ready to hire — they'll run the team so you don't have to.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to="/auth/signup"
                search={{ redirect: window.location.pathname }}
              >
                <Button
                  variant="contained"
                  colorScheme="primary"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800"
                >
                  Start your project — free
                </Button>
              </Link>

              <Link
                to="/consultant"
                className="inline-flex items-center justify-center rounded-xl border border-white/55 bg-white/95 px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:border-white hover:text-slate-900"
              >
                Apply to lead on Proyekto
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
