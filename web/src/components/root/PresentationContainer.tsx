import { useCallback, useEffect, useRef, useState } from "react";
import React from "react";
import {
  PresentationContext,
  SECTION_IDS,
  SECTION_LABELS,
  type PresentationContextValue,
} from "@/contexts/PresentationContext";
import { Header } from "@/components/root/Header";
import { SectionNavDots } from "@/components/root/SectionNavDots";

const TOTAL = SECTION_IDS.length;

interface PresentationContainerProps {
  children: React.ReactNode;
}

export function PresentationContainer({ children }: PresentationContainerProps) {
  const [activeSection, setActiveSection] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const goToSection = useCallback((index: number) => {
    if (!scrollRef.current) return;
    const next = Math.max(0, Math.min(TOTAL - 1, index));
    const id = SECTION_IDS[next];
    const el = scrollRef.current.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    const containerRect = scrollRef.current.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollTop + (elRect.top - containerRect.top),
      behavior: "smooth",
    });
  }, []);

  const goNext = useCallback(() => goToSection(activeSection + 1), [activeSection, goToSection]);
  const goPrev = useCallback(() => goToSection(activeSection - 1), [activeSection, goToSection]);

  // Track active section via IntersectionObserver (no scroll hijacking)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const sectionEls = SECTION_IDS.map((id) => el.querySelector(`#${id}`)).filter(Boolean) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const index = sectionEls.indexOf(entry.target as HTMLElement);
            if (index !== -1) setActiveSection(index);
          }
        }
      },
      { root: el, threshold: 0.5 },
    );

    sectionEls.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // Keyboard section jumping (arrow keys / page keys)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Home") {
        e.preventDefault();
        goToSection(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goToSection(TOTAL - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, goToSection]);

  const ctxValue: PresentationContextValue = {
    activeSection,
    totalSections: TOTAL,
    goToSection,
    goNext,
    goPrev,
    isTransitioning: false,
    sectionIds: SECTION_IDS,
    sectionLabels: SECTION_LABELS,
  };

  const sections = React.Children.toArray(children);

  return (
    <PresentationContext.Provider value={ctxValue}>
      <div
        ref={scrollRef}
        className="h-screen overflow-y-scroll overflow-x-hidden presentation-scroll-container"
      >
        {sections.map((child, i) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ isActive?: boolean; sectionIndex?: number }>, {
                isActive: true,
                sectionIndex: i,
              })
            : child,
        )}
      </div>
      <Header />
      <SectionNavDots />
    </PresentationContext.Provider>
  );
}
