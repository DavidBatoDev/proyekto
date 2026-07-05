import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { usePresentationContext } from "@/contexts/PresentationContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { HeroChatInput } from "./HeroChatInput";

// Full-screen hero background video: a real in-app highlight (roadmap canvas →
// milestones timeline → AI assistant), recorded with Playwright and served from
// web/public/. A dark gradient overlays it so reduced-motion users (for whom the
// video is hidden) still see an intentional hero. To refresh the footage, re-run
// `node playwright/record-highlight.mjs` and re-encode to web/public/hero-highlight.mp4.
// Bump the ?v= query whenever a clip is re-recorded — the filename is stable
// and served with a 4h browser cache, so the version param forces a refetch.
// There are two cuts of the same tour: a 16:9 landscape clip for desktop and a
// 9:19.5 portrait clip for phones (re-run `record-highlight-mobile.mjs`).
const HERO_VIDEO_SRC = "/hero-highlight.mp4?v=2";
const HERO_VIDEO_SRC_MOBILE = "/hero-highlight-mobile.mp4?v=1";

export const HeroSection = ({ isActive: _isActive }: { isActive?: boolean } = {}) => {
  const { goToSection } = usePresentationContext();
  // Serve the portrait clip on phones and the landscape clip on desktop —
  // object-cover would otherwise crop the 16:9 footage to a narrow vertical
  // slice on a phone screen. `key` forces the <video> to reload its source when
  // the breakpoint flips.
  const isMobile = useIsMobile();
  const videoSrc = isMobile ? HERO_VIDEO_SRC_MOBILE : HERO_VIDEO_SRC;

  return (
    <section className="relative -mt-20 flex min-h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* Background video — hidden for users who prefer reduced motion */}
      <video
        key={videoSrc}
        className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src={videoSrc} type="video/mp4" />
      </video>

      {/* Ambient glow (visible through the video and when it is absent) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_600px_at_50%_-10%,rgba(34,211,238,0.18),transparent_60%)]"
      />

      {/* Legibility overlay so the white copy always reads over the footage */}
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-b from-slate-950/80 via-slate-950/55 to-slate-950/90"
      />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pt-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-white/90 backdrop-blur"
        >
          <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
          Simple. Flexible. Powerful.
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06 }}
          className="mt-6 text-balance text-5xl font-bold leading-[1.03] tracking-tight text-white sm:text-6xl lg:text-7xl font-['Space_Grotesk']"
        >
          Turn ideas into action
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg"
        >
          Plan your project step-by-step, invite your team, and let expert
          consultants and AI-architected roadmaps turn your vision into shipped
          software.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-8 flex w-full flex-col items-center"
        >
          <HeroChatInput />
        </motion.div>

        <motion.button
          type="button"
          onClick={() => goToSection(2)}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.26 }}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 transition-colors hover:text-white"
        >
          See How It Works
          <ArrowRight className="h-4 w-4" />
        </motion.button>
      </div>
    </section>
  );
};
