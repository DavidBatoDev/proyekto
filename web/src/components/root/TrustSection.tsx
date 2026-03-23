import { motion } from "framer-motion";
import { Sparkles, Users, Layers3, ShieldCheck } from "lucide-react";

const metrics = [
  { label: "Roadmaps generated", value: "12,400+" },
  { label: "Consultants matched", value: "1,150+" },
  { label: "Freelancers activated", value: "4,900+" },
];

const logos = ["Vertex Labs", "Northline", "Blueorbit", "Metrica", "Loftiq"];

export function TrustSection() {
  return (
    <section id="trust" className="relative mt-14 lg:mt-20">
      <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 sm:p-8 shadow-[0_12px_30px_rgba(16,24,40,0.06)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Trusted Ecosystem
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Used by builders, founders, and teams.
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
              Proyekto blends roadmap intelligence, consultant guidance, and freelancer execution in one coordinated system.
            </p>
          </div>

          <div className="flex -space-x-3">
            {[1, 2, 3, 4, 5].map((avatar) => (
              <img
                key={avatar}
                src={`https://i.pravatar.cc/100?img=${avatar + 10}`}
                alt="Community member"
                className="h-11 w-11 rounded-full border-2 border-white object-cover shadow-sm"
              />
            ))}
          </div>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {metrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.35, delay: index * 0.08 }}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <p className="text-xl font-semibold text-slate-900">{metric.value}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                {metric.label}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            <Users className="h-4 w-4 text-sky-600" />
            Human-matched experts
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            Structured milestones
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            <ShieldCheck className="h-4 w-4 text-violet-600" />
            Verified delivery workflow
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Teams building with Proyekto</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm font-semibold text-slate-400 sm:grid-cols-3 lg:grid-cols-5">
            {logos.map((logo) => (
              <div key={logo} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                {logo}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
