import { createContext, useContext } from "react";

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
export const DARK_PALETTE = {
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

	/** Chip and connector fills that were literals before the light theme. */
	chipMuted: "rgba(148,163,184,0.14)",
	wireMuted: "rgba(148,163,184,0.42)",
	/** The primary as bare channels, for the fills that need a per-frame alpha. */
	glowRgb: "37,99,235",
} as const;

/**
 * Widened to `string` on purpose: `as const` above types every value as its own
 * literal, which would make a second palette unassignable to the first.
 */
export type Palette = Record<keyof typeof DARK_PALETTE, string>;

/**
 * The light palette, lifted from the shipped `html[data-ui-theme="light"]`
 * block in `web/src/styles.css` rather than invented: ground is `--card`
 * (#ffffff), ink is `--foreground`, and the blues are `--primary` (#5e6ad2)
 * and its dark/light companions. That preset is what the app actually renders
 * — the `:root` default in styles.css is still blue-600, and matching it would
 * put a video on the page in a blue nothing else on screen uses.
 *
 * Note the ground: a light clip cannot separate itself from the page by
 * luminance the way the navy one does (#ffffff against a #f9fafb page is ~1.03:1),
 * so it reads as a CARD instead — which is why the `border border-border` on
 * the embed wrapper stops being a nicety and becomes the only thing drawing
 * its edge. See ExplainerVideo.tsx.
 */
export const LIGHT_PALETTE: Palette = {
	blue700: "#4f5bc4",
	blue600: "#5e6ad2",
	blue500: "#6f79d9",
	blue400: "#8f97e3",
	blue100: "#eef0fc",

	ground: "#ffffff",
	groundLift: "#fbfbfe",

	surface: "#f7f8fa",
	surfaceHi: "#f1f2f4",

	hairline: "#eeeff1",
	rim: "rgba(36,37,40,0.06)",
	topHighlight: "rgba(36,37,40,0.03)",

	ink: "#242528",
	inkMuted: "#626367",
	bar: "#d8dadd",

	ok: "#16a34a",

	chipMuted: "#f1f2f4",
	wireMuted: "rgba(98,99,103,0.38)",
	glowRgb: "94,106,210",
};

/**
 * The palette in force, so one composition can be light while the others stay
 * navy. `Stage` is the only provider; everything below it reads the context, so
 * a primitive cannot accidentally hard-code the dark value.
 */
const PaletteContext = createContext<Palette>(DARK_PALETTE);
export const PaletteProvider = PaletteContext.Provider;
export const usePalette = (): Palette => useContext(PaletteContext);

/**
 * The default (navy) palette, kept as a plain export for the two
 * `/start-selling` stories, which are dark and have no reason to pay for a
 * context read.
 */
export const PALETTE = DARK_PALETTE;
