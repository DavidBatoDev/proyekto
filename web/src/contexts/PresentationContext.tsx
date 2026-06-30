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

// Safe no-op fallback for when the landing Header/Footer are rendered OUTSIDE a
// PresentationContainer (e.g. the /consultant marketing page reuses <Header />).
// Returning this instead of throwing keeps those pages from crashing to the
// error boundary; the section-scroll actions simply become no-ops there.
const FALLBACK_PRESENTATION_CONTEXT: PresentationContextValue = {
  activeSection: 0,
  totalSections: SECTION_IDS.length,
  goToSection: () => {},
  goNext: () => {},
  goPrev: () => {},
  isTransitioning: false,
  sectionIds: SECTION_IDS,
  sectionLabels: SECTION_LABELS,
};

export function usePresentationContext(): PresentationContextValue {
  const ctx = useContext(PresentationContext);
  return ctx ?? FALLBACK_PRESENTATION_CONTEXT;
}
