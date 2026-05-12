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
const COOLDOWN_MS = 720;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface PresentationContainerProps {
  children: React.ReactNode;
}

export function PresentationContainer({ children }: PresentationContainerProps) {
  const [activeSection, setActiveSection] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const touchStartYRef = useRef(0);

  const scrollToSection = useCallback((index: number) => {
    if (!scrollRef.current) return;
    const behavior = prefersReducedMotion() ? "instant" : "smooth";
    scrollRef.current.scrollTo({
      top: index * window.innerHeight,
      behavior: behavior as ScrollBehavior,
    });
  }, []);

  const goToSection = useCallback(
    (index: number) => {
      if (isScrollingRef.current) return;
      const next = Math.max(0, Math.min(TOTAL - 1, index));
      if (next === activeSection) return;
      isScrollingRef.current = true;
      setIsTransitioning(true);
      setActiveSection(next);
      scrollToSection(next);
      setTimeout(() => {
        isScrollingRef.current = false;
        setIsTransitioning(false);
      }, COOLDOWN_MS);
    },
    [activeSection, scrollToSection],
  );

  const goNext = useCallback(() => goToSection(activeSection + 1), [activeSection, goToSection]);
  const goPrev = useCallback(() => goToSection(activeSection - 1), [activeSection, goToSection]);

  // Non-passive wheel listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Let horizontal scroll pass through (for carousels)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      // When cursor is inside an inner-scrollable section, only scroll that
      // container — never trigger section navigation, even at the boundary
      const innerScroll = (e.target as HTMLElement).closest<HTMLElement>(".presentation-inner-scroll");
      if (innerScroll) {
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;
        if (e.deltaMode === 2) delta *= innerScroll.clientHeight;
        innerScroll.scrollTop += delta;
        return;
      }

      e.preventDefault();
      if (e.deltaY > 0) goNext();
      else goPrev();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [goNext, goPrev]);

  // Touch support
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const delta = touchStartYRef.current - e.changedTouches[0].clientY;
      if (Math.abs(delta) > 50) {
        if (delta > 0) goNext();
        else goPrev();
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [goNext, goPrev]);

  // Keyboard navigation
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

  // Body overflow lock
  useEffect(() => {
    document.body.classList.add("presentation-mode");
    return () => document.body.classList.remove("presentation-mode");
  }, []);

  const ctxValue: PresentationContextValue = {
    activeSection,
    totalSections: TOTAL,
    goToSection,
    goNext,
    goPrev,
    isTransitioning,
    sectionIds: SECTION_IDS,
    sectionLabels: SECTION_LABELS,
  };

  // Clone children, injecting isActive and sectionIndex props
  const sections = React.Children.toArray(children);

  return (
    <PresentationContext.Provider value={ctxValue}>
      <div
        ref={scrollRef}
        className="h-screen overflow-y-scroll overflow-x-hidden presentation-scroll-container"
        style={{ scrollSnapType: "y mandatory" }}
      >
        {sections.map((child, i) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ isActive?: boolean; sectionIndex?: number }>, {
                isActive: activeSection === i,
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
