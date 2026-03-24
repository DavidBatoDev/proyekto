import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { HeroLivePreview } from "./HeroLivePreview";

export const HeroSection = () => {
  return (
    <section className="relative overflow-hidden pt-6 sm:pt-10">
      <div className="pointer-events-none absolute -top-20 left-[14%] h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-14 top-1/3 h-72 w-72 rounded-full bg-indigo-200/50 blur-3xl" />

      <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.06fr]">
        <div className="flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-300/70 bg-white/85 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-600" />
            Product Operating System
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06 }}
            className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
          >
            Turn ideas into
            <span className="block bg-linear-to-r from-slate-900 via-slate-700 to-slate-400 bg-clip-text text-transparent">
              structured execution.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.12 }}
            className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base"
          >
            Plan your project, match with experts, and execute in one system.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2 }}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <Link to="/auth/signup" search={{ redirect: window.location.pathname }}>
              <Button
                variant="contained"
                colorScheme="primary"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800"
              >
                Create Your Roadmap
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>

            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
            >
              See How It Works
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.26 }}
            className="mt-7 max-w-xl rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
          >
            Built for immediate clarity: frame scope, validate milestones, and start execution without switching tools.
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.18 }}
          className="relative"
        >
          <HeroLivePreview />
        </motion.div>
      </div>
    </section>
  );
};
