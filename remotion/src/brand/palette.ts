/**
 * Every colour in both stories, in one place.
 *
 * These are raw hex on purpose. `web/`'s theme tokens (`--primary`,
 * `--muted-foreground`, `border-border`…) are declared in `web/src/styles.css`
 * and simply do not exist in this project — `remotion/src/index.css` is one
 * `@import "tailwindcss"` line and nothing else — so a `bg-primary` here would
 * silently render nothing. Animated values cannot be Tailwind classes anyway,
 * since a class cannot be interpolated per frame.
 *
 * The values mirror the web brand: `blue600` is the `--primary` from
 * styles.css (blue-600 #2563eb) and `blue500` is what dark mode swaps to,
 * which is also what reads best against this navy ground.
 */
export const PALETTE = {
	blue700: "#1d4ed8",
	blue600: "#2563eb",
	blue500: "#3b82f6",
	blue400: "#60a5fa",
	blue100: "#dbeafe",

	/**
	 * The panel ground. Baked into the MP4, so it cannot follow the page theme —
	 * see the note in AudienceVideo.tsx for why the wrapper's border is what
	 * makes this read as a deliberate inset on dark themes.
	 */
	ground: "#0F1A2E",
	groundLift: "#142238",

	surface: "#16233C",
	surfaceHi: "#1D2C48",

	hairline: "rgba(148,163,184,0.18)",
	rim: "rgba(96,165,250,0.16)",
	topHighlight: "rgba(255,255,255,0.05)",

	ink: "#E7EDF7",
	inkMuted: "rgba(203,213,225,0.62)",
	bar: "rgba(148,163,184,0.26)",

	/** One use only: the acceptance tick, where "accepted" needs to not be blue. */
	ok: "#34d399",
} as const;
