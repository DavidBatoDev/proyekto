interface BrandMarkProps {
  /**
   * `wordmark` — full "Proyekto" text (default; replaces legacy `logo1.svg`)
   * `mark` — square icon-only variant (replaces legacy `logovector.svg`)
   */
  variant?: "wordmark" | "mark";
  /**
   * Tailwind classes for sizing/positioning. Sizing is height-based to match
   * the legacy `<img className="h-N">` usage pattern.
   */
  className?: string;
  /**
   * Optional accessible label override. Defaults to "Proyekto".
   */
  ariaLabel?: string;
}

/**
 * Proyekto brand mark.
 *
 * Temporary text-based wordmark / icon-mark while proper SVG art is being
 * designed. Both variants inherit color from the parent via `currentColor`,
 * so they work on light AND dark backgrounds without prop juggling.
 *
 * Sizing: height-based (matches legacy `h-N` Tailwind classes used on the
 * old `<img>` tags). The `mark` variant is square; the `wordmark` flows to
 * the natural width of its text.
 */
export function BrandMark({
  variant = "wordmark",
  className,
  ariaLabel = "Proyekto",
}: BrandMarkProps) {
  if (variant === "mark") {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className={`inline-flex aspect-square items-center justify-center rounded-lg bg-primary font-extrabold leading-none text-white ${
          className ?? ""
        }`}
        style={{
          fontFamily: "'Sora', 'Manrope', sans-serif",
          letterSpacing: "-0.02em",
          // Letter sizes proportionally to container height. ~78% leaves a
          // small breathing margin while keeping the P visually dominant.
          fontSize: "78%",
        }}
      >
        P
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={`inline-flex items-center font-extrabold leading-none ${
        className ?? ""
      }`}
      style={{
        fontFamily: "'Sora', 'Manrope', sans-serif",
        // Wordmark text fills the container height (~95% accounts for the
        // cap-height vs em-square gap so the visible letters reach the
        // top/bottom of the allotted space).
        fontSize: "95%",
        letterSpacing: "-0.025em",
        color: "currentColor",
      }}
    >
      Proyekto
    </span>
  );
}
