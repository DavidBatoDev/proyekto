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

export function SignupLayout({ children }: SignupLayoutProps) {
  const reducedMotion = useReducedMotion();

  function bubbleStyle(delaySec: number): React.CSSProperties {
    if (reducedMotion) return {};
    const dur = (8 + delaySec * 1.5).toFixed(1);
    const del = (delaySec * 0.8).toFixed(1);
    return { animation: `authPanelFloat ${dur}s ease-in-out infinite ${del}s` };
  }

  return (
    <>
      <style>{`
        @keyframes authPanelFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-13px); }
        }
        @keyframes authPanelFloatSlow {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
      <div style={{ minHeight: "100vh", display: "flex" }}>
      {/* ── Left: Form panel ──────────────────────────────────────── */}
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          background: "#F8FAFC",
          overflowY: "auto",
        }}
        className="lg:w-[40%]"
      >
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            style={{ width: "100%", maxWidth: "420px" }}
          >
            {children}
          </motion.div>
      </div>

      {/* ── Right: Brand panel (hidden on mobile) ─────────────────── */}
      <div
        className="hidden lg:flex"
        style={{
          width: "60%",
          position: "relative",
          overflow: "hidden",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #0F172A 0%, #1E1B4B 52%, #312E81 100%)",
          flexShrink: 0,
        }}
      >
        {/* Decorative bubbles */}
        <div
          style={{
            position: "absolute",
            top: "-128px",
            right: "-128px",
            width: "520px",
            height: "520px",
            borderRadius: "50%",
            background: "rgba(125, 211, 252, 0.11)",
            pointerEvents: "none",
            ...bubbleStyle(0),
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-150px",
            left: "-150px",
            width: "620px",
            height: "620px",
            borderRadius: "50%",
            background: "rgba(99, 102, 241, 0.16)",
            pointerEvents: "none",
            ...bubbleStyle(2),
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "15%",
            left: "10%",
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "rgba(148, 163, 184, 0.25)",
            pointerEvents: "none",
            ...bubbleStyle(1),
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "20%",
            right: "15%",
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "rgba(165, 180, 252, 0.3)",
            pointerEvents: "none",
            ...bubbleStyle(3),
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "calc(45% - 100px)",
            right: "8%",
            width: "200px",
            height: "200px",
            borderRadius: "50%",
            background: "rgba(30, 41, 59, 0.28)",
            pointerEvents: "none",
            ...bubbleStyle(1.5),
          }}
        />
        {/* Dot grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle, rgba(148, 163, 184, 0.22) 1px, transparent 1px)",
            backgroundSize: "30px 30px",
            pointerEvents: "none",
          }}
        />

        {/* ── Content ── */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            color: "white",
            maxWidth: "520px",
            padding: "0 64px",
          }}
        >
          {/* Logo */}
          <img
            src="/prodigylogos/light/logo1.svg"
            alt="Proyekto"
            style={{
              height: "36px",
              marginBottom: "56px",
              filter: "brightness(0) invert(1)",
            }}
          />

          {/* Headline */}
          <h2
            style={{
              fontFamily: "'Sora', 'Manrope', sans-serif",
              fontSize: "2.6rem",
              fontWeight: 700,
              lineHeight: 1.2,
              marginBottom: "20px",
              margin: "0 0 20px",
            }}
          >
            Turn ideas into structured execution.
          </h2>

          {/* Subline */}
          <p
            style={{
              color: "rgba(255,255,255,0.78)",
              fontSize: "1.05rem",
              lineHeight: 1.65,
              margin: "0 0 48px",
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            Start your roadmap, match with experts, and execute in one system.
          </p>

          {/* Product preview */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.4)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(148, 163, 184, 0.32)",
              borderRadius: "16px",
              padding: "24px",
              ...(reducedMotion
                ? {}
                : {
                    animation: "authPanelFloatSlow 8s ease-in-out infinite",
                    animationDelay: "1.2s",
                  }),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px",
              }}
            >
              <p style={{ margin: 0, color: "rgba(226,232,240,0.9)", fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, fontFamily: "'Manrope', sans-serif" }}>
                Roadmap Studio
              </p>
              <span
                style={{
                  fontSize: "11px",
                  color: "#A5B4FC",
                  border: "1px solid rgba(165,180,252,0.4)",
                  padding: "2px 8px",
                  borderRadius: "999px",
                }}
              >
                Live Preview
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", opacity: 0.8 }}>
              {[
                ["Project Framing", "Complete"],
                ["Consultant Match", "In Review"],
                ["Milestone Map", "Ready"],
                ["Freelancer Sprint", "Pending"],
              ].map(([title, status]) => (
                <div
                  key={title}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148,163,184,0.26)",
                    background: "rgba(15,23,42,0.28)",
                  }}
                >
                  <span style={{ color: "rgba(226,232,240,0.92)", fontSize: "13px", fontFamily: "'Manrope', sans-serif" }}>{title}</span>
                  <span style={{ color: "rgba(148,163,184,0.92)", fontSize: "12px", fontFamily: "'Manrope', sans-serif" }}>{status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

