import { useEffect, useState } from "react";
import { motion } from "framer-motion";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined"
        ? matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

interface SignupLayoutProps {
  children: React.ReactNode;
}

/**
 * Full-screen centered-card signup shell.
 *
 * Background is a soft brand-tinted gradient with a couple of slow-floating
 * blurred orbs for warmth. The form lives in a single centered card with a
 * generous max width so multi-column step content (e.g. the lane picker) has
 * room to breathe. Mobile collapses to a full-bleed card with reduced padding.
 */
export function SignupLayout({ children }: SignupLayoutProps) {
  const reducedMotion = useReducedMotion();

  return (
    <>
      <style>{`
        @keyframes signupOrbFloat {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(20px, -20px); }
        }
      `}</style>

      <div className="relative min-h-screen overflow-hidden bg-[#fcfcfd]">
        {/* Soft brand background + orbs */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(circle at 18% 20%, rgba(125, 211, 252, 0.18), transparent 42%), radial-gradient(circle at 82% 78%, rgba(165, 180, 252, 0.22), transparent 48%), linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute -left-24 top-32 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl"
          aria-hidden
          style={
            reducedMotion
              ? undefined
              : { animation: "signupOrbFloat 12s ease-in-out infinite" }
          }
        />
        <div
          className="pointer-events-none absolute -right-20 bottom-32 h-80 w-80 rounded-full bg-indigo-200/40 blur-3xl"
          aria-hidden
          style={
            reducedMotion
              ? undefined
              : { animation: "signupOrbFloat 14s ease-in-out infinite 2s" }
          }
        />

        <div className="relative mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="w-full"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </>
  );
}
