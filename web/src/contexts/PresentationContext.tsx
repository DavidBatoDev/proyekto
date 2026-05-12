import { createContext, useContext } from "react";

export const SECTION_IDS = [
  "hero",
  "use-it-your-way",
  "how-it-works",
  "ai-demo",
  "why-proyekto",
  "templates",
  "features",
  "cta-footer",
] as const;

export const SECTION_LABELS = [
  "Hero",
  "Use It Your Way",
  "How It Works",
  "Use It With AI",
  "Why Proyekto",
  "Templates",
  "Features",
  "Get Started",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface PresentationContextValue {
  activeSection: number;
  totalSections: number;
  goToSection: (i: number) => void;
  goNext: () => void;
  goPrev: () => void;
  isTransitioning: boolean;
  sectionIds: typeof SECTION_IDS;
  sectionLabels: typeof SECTION_LABELS;
}

export const PresentationContext = createContext<PresentationContextValue>(null!);

export function usePresentationContext(): PresentationContextValue {
  const ctx = useContext(PresentationContext);
  if (!ctx) {
    throw new Error("usePresentationContext must be used within PresentationContainer");
  }
  return ctx;
}
