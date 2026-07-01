import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock3, GitBranchPlus, Layers2 } from "lucide-react";

export type TemplateEntry = {
  id: string;
  name: string;
  category: "SaaS" | "AI" | "Web Apps" | "E-commerce";
  timeline: string;
  complexity: "Beginner" | "Intermediate" | "Advanced";
  description: string;
  milestones: string[];
  image: string;
};

const complexityStyles: Record<TemplateEntry["complexity"], string> = {
  Beginner: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700",
  Intermediate: "border-blue-500/25 bg-blue-500/10 text-blue-700",
  Advanced: "border-violet-500/25 bg-violet-500/10 text-violet-700",
};

type Props = {
  template: TemplateEntry;
  index: number;
};

export function TemplateEntryCard({ template, index }: Props) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.26, delay: index * 0.04 }}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow] duration-200 hover:border-blue-400 hover:shadow-[0_8px_24px_rgba(37,99,235,0.18)]"
    >
      <div className="h-32 w-full overflow-hidden bg-slate-100">
        <img
          src={template.image}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{template.category}</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{template.name}</h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${complexityStyles[template.complexity]}`}>
          {template.complexity}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-slate-600">{template.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            Timeline
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{template.timeline}</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            <Layers2 className="h-3.5 w-3.5" />
            Complexity
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{template.complexity}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <p className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          <GitBranchPlus className="h-3.5 w-3.5" />
          Milestones
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {template.milestones.map((milestone) => (
            <div
              key={`${template.id}-${milestone}`}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {milestone}
            </div>
          ))}
        </div>
      </div>

      <Link to="/auth/signup" search={{ redirect: window.location.pathname }} className="group mt-4 block">
        <span className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:border-slate-700 hover:bg-slate-700">
          Use Template
          <ArrowUpRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </Link>
      </div>
    </motion.article>
  );
}
