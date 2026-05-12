import { motion } from "framer-motion";
import { useState } from "react";
import { usePresentationContext } from "@/contexts/PresentationContext";

export function SectionNavDots() {
  const { activeSection, totalSections, goToSection, sectionLabels } = usePresentationContext();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 hidden md:flex flex-col items-center gap-2">
      {Array.from({ length: totalSections }, (_, i) => (
        <motion.button
          key={i}
          layout
          onClick={() => goToSection(i)}
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
          aria-label={`Go to ${sectionLabels[i]}`}
          className="rounded-full cursor-pointer"
          animate={{
            width: 8,
            height: activeSection === i ? 32 : hoveredIndex === i ? 16 : 8,
            backgroundColor:
              activeSection === i
                ? "#0f172a"
                : hoveredIndex === i
                  ? "#64748b"
                  : "#cbd5e1",
          }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      ))}
    </div>
  );
}
