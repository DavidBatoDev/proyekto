import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { TrendingUp } from "lucide-react";

export const CTASection = () => {
  return (
    <section className="mt-20 text-center">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 p-10 text-white shadow-[0_22px_40px_rgba(15,23,42,0.28)] sm:p-14">
        <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-sky-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 right-0 h-44 w-44 rounded-full bg-amber-400/20 blur-3xl" />

        <TrendingUp className="mx-auto mb-4 h-12 w-12 text-amber-300" />
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Stop guessing. Start building.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
          Turn ideas into an execution-ready roadmap, align expert talent, and deliver faster with confidence.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth/signup"
            search={{ redirect: window.location.pathname }}
          >
            <Button variant="contained" colorScheme="primary" size="lg" className="rounded-xl bg-white text-slate-900 hover:bg-slate-100">
              Start Your Project
            </Button>
          </Link>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl border border-slate-500 px-6 py-3 text-lg font-semibold text-white transition-all hover:border-white hover:bg-white hover:text-slate-900"
          >
            Browse Templates
          </button>
        </div>
      </div>
    </section>
  );
};
