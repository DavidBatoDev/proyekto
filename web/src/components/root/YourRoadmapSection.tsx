import { Compass, PlusCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";

export function YourRoadmapSection() {
  return (
    <section id="your-roadmap" className="mt-16 lg:mt-20">
      <div className="relative overflow-hidden rounded-3xl border border-dashed border-slate-300 bg-linear-to-br from-slate-50 to-white p-6 sm:p-9">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-sky-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-amber-100/70 blur-3xl" />

        <div className="relative z-10 grid gap-6 lg:grid-cols-[0.6fr_1fr] lg:items-center">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-3xl border border-slate-200 bg-white shadow-sm lg:mx-0">
            <Compass className="h-10 w-10 text-slate-700" />
          </div>

          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Your roadmap workspace is ready.
            </h2>
            <p className="mt-2 text-sm text-slate-600 sm:text-base">
              Start your first roadmap to generate milestones, see consultant matches, and unlock execution with freelancers in one flow.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link to="/auth/signup" search={{ redirect: window.location.pathname }}>
                <Button variant="contained" colorScheme="primary" className="rounded-xl px-5 py-2.5 text-sm">
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                  Start your first roadmap
                </Button>
              </Link>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                Takes less than 3 minutes
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
