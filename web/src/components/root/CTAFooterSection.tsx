import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { motion } from "framer-motion";
import { usePresentationContext } from "@/contexts/PresentationContext";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

function colVariants(i: number) {
  return {
    hidden: { opacity: 0, y: -18 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, delay: 0.45 + i * 0.08, ease: EASE_OUT },
    },
  };
}

export function CTAFooterSection({ isActive = false }: { isActive?: boolean }) {
  const { goToSection } = usePresentationContext();
  const animate = isActive ? "visible" : "hidden";

  return (
    <section className="flex flex-col py-6">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10 flex flex-col">
      <div className="flex flex-col">
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 72 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
        }}
        initial="hidden"
        animate={animate}
      >
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
                Ready to get started?
              </h2>
              <p className="mt-3 max-w-3xl text-base leading-relaxed text-blue-50/95">
                Create your project plan in minutes and start moving forward.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link to="/auth/signup" search={{ redirect: undefined }}>
                  <Button
                    variant="contained"
                    colorScheme="primary"
                    className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800"
                  >
                    Create Your Project Plan
                  </Button>
                </Link>

                <button
                  type="button"
                  onClick={() => goToSection(5)}
                  className="inline-flex items-center justify-center rounded-xl border border-white/55 bg-white/95 px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:border-white hover:text-slate-900"
                >
                  Explore Templates
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      </div>

      {/* Footer */}
      <div className="mt-16 border-t border-slate-200">
        <div className="grid grid-cols-1 gap-8 pt-8 md:grid-cols-5">
          <motion.div className="md:col-span-2" variants={colVariants(0)} initial="hidden" animate={animate}>
            <BrandMark className="mb-4 h-10 text-primary" />
            <p className="max-w-sm text-sm text-slate-600">Turn your ideas into action, with Proyekto.</p>
          </motion.div>

          <motion.div variants={colVariants(1)} initial="hidden" animate={animate}>
            <h4 className="mb-4 font-semibold text-slate-900">For clients</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/auth/signup" search={{ redirect: undefined }} className="transition-colors hover:text-slate-900">
                  Start a project
                </Link>
              </li>
              <li>
                <button type="button" onClick={() => goToSection(2)} className="text-left transition-colors hover:text-slate-900">
                  How it works
                </button>
              </li>
              <li>
                <button type="button" onClick={() => goToSection(4)} className="text-left transition-colors hover:text-slate-900">
                  Why Proyekto
                </button>
              </li>
            </ul>
          </motion.div>

          <motion.div variants={colVariants(2)} initial="hidden" animate={animate}>
            <h4 className="mb-4 font-semibold text-slate-900">For consultants</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/consultant" preload="intent" className="font-semibold text-slate-700 transition-colors hover:text-slate-900">
                  Apply to lead
                </Link>
              </li>
              <li>
                <button type="button" onClick={() => goToSection(2)} className="text-left transition-colors hover:text-slate-900">
                  How it works
                </button>
              </li>
              <li>
                <button type="button" className="text-left transition-colors hover:text-slate-900">
                  Pricing
                </button>
              </li>
            </ul>
          </motion.div>

          <motion.div variants={colVariants(3)} initial="hidden" animate={animate}>
            <h4 className="mb-4 font-semibold text-slate-900">Company</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><button type="button" className="text-left transition-colors hover:text-slate-900">About</button></li>
              <li><button type="button" className="text-left transition-colors hover:text-slate-900">Security</button></li>
              <li><button type="button" className="text-left transition-colors hover:text-slate-900">Privacy</button></li>
            </ul>
          </motion.div>
        </div>

        <motion.div
          className="mt-8 border-t border-slate-200 pt-6 text-center"
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.6, delay: 0.8 } } }}
          initial="hidden"
          animate={animate}
        >
          <p className="text-sm text-slate-500">© 2026 Proyekto. All rights reserved.</p>
        </motion.div>
      </div>
      </div>
    </section>
  );
}
