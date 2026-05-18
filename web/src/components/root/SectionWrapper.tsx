import { motion, type Variants } from "framer-motion";
import React from "react";

export type SectionAnimationKey =
  | "hero"
  | "use-it-your-way"
  | "how-it-works"
  | "ai-demo"
  | "why-proyekto"
  | "templates"
  | "features"
  | "cta-footer";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];

const SECTION_VARIANTS: Record<SectionAnimationKey, Variants> = {
  hero: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.4, ease: EASE_OUT } },
  },
  "use-it-your-way": {
    hidden: { opacity: 0, y: 48, scale: 0.98 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.55, ease: EASE_OUT },
    },
  },
  "how-it-works": {
    hidden: { opacity: 0, scale: 0.96 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.5, ease: EASE_OUT },
    },
  },
  "ai-demo": {
    hidden: { opacity: 0, filter: "blur(12px)", scale: 0.97 },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      scale: 1,
      transition: { duration: 0.52, ease: EASE_OUT },
    },
  },
  "why-proyekto": {
    hidden: { opacity: 0, x: -48 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.5, ease: EASE_OUT },
    },
  },
  templates: {
    hidden: { opacity: 0, y: 44, scale: 0.97 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.52, ease: EASE_OUT },
    },
  },
  features: {
    hidden: { opacity: 0, y: -36 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: EASE_IN_OUT },
    },
  },
  "cta-footer": {
    hidden: { opacity: 0, y: 64 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: EASE_OUT },
    },
  },
};

interface SectionWrapperProps {
  animationKey: SectionAnimationKey;
  children: React.ReactNode;
  // Injected by PresentationContainer via React.cloneElement
  isActive?: boolean;
  sectionIndex?: number;
  id?: string;
}

export function SectionWrapper({
  animationKey,
  children,
  isActive = false,
  sectionIndex: _sectionIndex,
  id,
}: SectionWrapperProps) {
  const variants = SECTION_VARIANTS[animationKey];

  // Clone children to pass isActive down to the section component
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(
        child as React.ReactElement<{ isActive?: boolean }>,
        { isActive },
      );
    }
    return child;
  });

  return (
    <div id={id} className="relative pt-20">
      <motion.div
        variants={variants}
        initial="hidden"
        animate={isActive ? "visible" : "hidden"}
      >
        {childrenWithProps}
      </motion.div>
    </div>
  );
}
