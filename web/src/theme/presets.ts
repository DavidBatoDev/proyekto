import type {
	AppearancePreferencesV1,
	ResolvedTheme,
	ThemeId,
	ThemeTokens,
} from "./types";

export const DEFAULT_APPEARANCE: AppearancePreferencesV1 = {
	version: 1,
	theme: "light",
	custom: {
		accent: "#6D78D5",
		background: "#FFFFFF",
		contrast: 30,
		sidebar: {
			enabled: false,
			accent: "#6D78D5",
			background: "#FFFFFF",
			contrast: 30,
		},
	},
};

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemeId; label: string }> = [
	{ id: "light", label: "Light" },
	{ id: "classic-dark", label: "Classic Dark" },
	{ id: "magic-blue", label: "Magic Blue" },
	{ id: "dark", label: "Dark" },
	{ id: "custom", label: "Custom" },
];

/**
 * Palette fixture sampled from the supplied reference screenshots. Samples are
 * taken from flat interior regions (never text/edges) so anti-aliasing does not
 * influence the stored RGB value. Roles not visible in the references are
 * derived from the same base palette.
 */
export const PRESET_SAMPLE_FIXTURE = {
	light: {
		source: "light-reference-1785x964",
		background: { value: "#F9FAFB", sample: [1600, 600] },
		surface: { value: "#FFFFFF", sample: [900, 400] },
		border: { value: "#EEEFF1", sample: [900, 454] },
		foreground: { value: "#242528", sample: [420, 386] },
		mutedForeground: { value: "#626367", sample: [430, 414] },
	},
	"classic-dark": {
		source: "classic-dark-reference-1684x953",
		background: { value: "#1E1F21", sample: [1500, 500] },
		surface: { value: "#252629", sample: [600, 360] },
		border: { value: "#313236", sample: [600, 429] },
		foreground: { value: "#F1F1F2", sample: [420, 355] },
		mutedForeground: { value: "#A5A6AA", sample: [440, 386] },
	},
	"magic-blue": {
		source: "magic-blue-reference-1864x1024",
		background: { value: "#171925", sample: [1600, 600] },
		surface: { value: "#20212D", sample: [700, 470] },
		border: { value: "#2D2E3B", sample: [700, 531] },
		foreground: { value: "#F2F2F4", sample: [430, 460] },
		mutedForeground: { value: "#A6A7B0", sample: [450, 493] },
	},
	dark: {
		source: "dark-reference-1785x960",
		background: { value: "#0E0F0F", sample: [1600, 600] },
		surface: { value: "#171717", sample: [700, 370] },
		border: { value: "#252525", sample: [700, 435] },
		foreground: { value: "#F4F4F4", sample: [430, 365] },
		mutedForeground: { value: "#9C9C9C", sample: [450, 397] },
	},
} as const;

function tokens(
	input: Partial<ThemeTokens> &
		Pick<
			ThemeTokens,
			| "background"
			| "foreground"
			| "card"
			| "border"
			| "mutedForeground"
			| "primary"
		>,
): ThemeTokens {
	const dark = input.background !== "#F9FAFB";
	const surfaceStrong = input.surfaceStrong ?? input.card;
	const muted = input.muted ?? (dark ? "#2C2D31" : "#F2F3F5");
	const primaryForeground = input.primaryForeground ?? "#FFFFFF";
	const borderStrong = input.borderStrong ?? (dark ? "#44454B" : "#D6D8DC");
	return {
		background: input.background,
		backgroundLight: input.backgroundLight ?? input.background,
		foreground: input.foreground,
		card: input.card,
		cardForeground: input.cardForeground ?? input.foreground,
		popover: input.popover ?? surfaceStrong,
		popoverForeground: input.popoverForeground ?? input.foreground,
		surface: input.surface ?? input.card,
		surfaceStrong,
		mutedSurface: input.mutedSurface ?? muted,
		muted,
		mutedForeground: input.mutedForeground,
		accent: input.accent ?? muted,
		accentForeground: input.accentForeground ?? input.foreground,
		primary: input.primary,
		primaryHover: input.primaryHover ?? input.primary,
		primarySoft: input.primarySoft ?? (dark ? "#343747" : "#EEF0FC"),
		primaryForeground,
		secondary: input.secondary ?? (dark ? "#34353A" : "#22242A"),
		secondaryForeground: input.secondaryForeground ?? "#FFFFFF",
		border: input.border,
		borderStrong,
		canvasDot: input.canvasDot ?? borderStrong,
		canvasEdge: input.canvasEdge ?? borderStrong,
		input: input.input ?? input.border,
		ring: input.ring ?? input.primary,
		overlay:
			input.overlay ??
			(dark ? "rgba(0, 0, 0, 0.68)" : "rgba(15, 23, 42, 0.32)"),
		shadowColor:
			input.shadowColor ??
			(dark ? "rgba(0, 0, 0, 0.42)" : "rgba(15, 23, 42, 0.12)"),
		destructive: input.destructive ?? (dark ? "#F87171" : "#DC2626"),
		destructiveForeground: input.destructiveForeground ?? "#FFFFFF",
		success: input.success ?? (dark ? "#4ADE80" : "#15803D"),
		warning: input.warning ?? (dark ? "#FBBF24" : "#B45309"),
		info: input.info ?? (dark ? "#60A5FA" : "#2563EB"),
		chart1: input.chart1 ?? "#5E6AD2",
		chart2: input.chart2 ?? "#2DA44E",
		chart3: input.chart3 ?? "#D97706",
		chart4: input.chart4 ?? "#A855F7",
		chart5: input.chart5 ?? "#E255A1",
		sidebar: input.sidebar ?? input.card,
		sidebarForeground: input.sidebarForeground ?? input.foreground,
		sidebarPrimary: input.sidebarPrimary ?? input.primary,
		sidebarPrimaryForeground:
			input.sidebarPrimaryForeground ?? primaryForeground,
		sidebarAccent: input.sidebarAccent ?? muted,
		sidebarAccentForeground: input.sidebarAccentForeground ?? input.foreground,
		sidebarBorder: input.sidebarBorder ?? input.border,
		sidebarRing: input.sidebarRing ?? input.primary,
	};
}

export const PRESET_THEMES: Record<
	Exclude<ThemeId, "custom">,
	ResolvedTheme
> = {
	light: {
		id: "light",
		mode: "light",
		tokens: tokens({
			background: "#F9FAFB",
			backgroundLight: "#F6F7F8",
			foreground: "#242528",
			card: "#FFFFFF",
			surfaceStrong: "#FFFFFF",
			mutedSurface: "#F7F8FA",
			muted: "#F1F2F4",
			mutedForeground: "#626367",
			border: "#EEEFF1",
			borderStrong: "#D8DADD",
			canvasDot: "#C3C6CC",
			canvasEdge: "#AEB3BC",
			primary: "#5E6AD2",
			primaryHover: "#4F5BC4",
			primarySoft: "#EEF0FC",
			input: "#D8DADD",
			sidebar: "#FFFFFF",
		}),
	},
	"classic-dark": {
		id: "classic-dark",
		mode: "dark",
		tokens: tokens({
			background: "#1E1F21",
			foreground: "#F1F1F2",
			card: "#252629",
			surfaceStrong: "#303136",
			mutedSurface: "#2B2C30",
			muted: "#303136",
			mutedForeground: "#A5A6AA",
			border: "#313236",
			borderStrong: "#45464C",
			canvasDot: "#4D4E54",
			canvasEdge: "#55575F",
			input: "#3A3B40",
			primary: "#6D78D5",
			primaryHover: "#7B86E3",
			primarySoft: "#343747",
			sidebar: "#202124",
		}),
	},
	"magic-blue": {
		id: "magic-blue",
		mode: "dark",
		tokens: tokens({
			background: "#171925",
			foreground: "#F2F2F4",
			card: "#20212D",
			surfaceStrong: "#2A2B39",
			mutedSurface: "#252633",
			muted: "#2B2D3A",
			mutedForeground: "#A6A7B0",
			border: "#2D2E3B",
			borderStrong: "#414353",
			canvasDot: "#494B5D",
			canvasEdge: "#53566A",
			input: "#343645",
			primary: "#6D78D5",
			primaryHover: "#7D87E0",
			primarySoft: "#31344A",
			sidebar: "#151722",
		}),
	},
	dark: {
		id: "dark",
		mode: "dark",
		tokens: tokens({
			background: "#0E0F0F",
			foreground: "#F4F4F4",
			card: "#171717",
			surfaceStrong: "#202020",
			mutedSurface: "#1C1C1C",
			muted: "#242424",
			mutedForeground: "#9C9C9C",
			border: "#252525",
			borderStrong: "#3A3A3A",
			canvasDot: "#424242",
			canvasEdge: "#494949",
			input: "#303030",
			primary: "#6D78D5",
			primaryHover: "#7D87E0",
			primarySoft: "#292B3B",
			sidebar: "#111111",
		}),
	},
};
