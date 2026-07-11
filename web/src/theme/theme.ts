import { DEFAULT_APPEARANCE, PRESET_THEMES } from "./presets";
import type {
	AppearancePreferencesV1,
	HexColor,
	ResolvedTheme,
	ThemeColorMode,
	ThemeId,
	ThemeShareV1,
	ThemeTokens,
} from "./types";
import { THEME_IDS } from "./types";

export const APPEARANCE_STORAGE_KEY = "proyekto.appearance.v1";
export const MAX_THEME_IMPORT_LENGTH = 4096;

const HEX_PATTERN = /^#[0-9A-F]{6}$/;

export interface AppearanceCacheV1 {
	version: 1;
	preferences: AppearancePreferencesV1;
	dirty: boolean;
	ownerUserId: string | null;
}

function cloneDefault(): AppearancePreferencesV1 {
	return structuredClone(DEFAULT_APPEARANCE);
}

export function normalizeHex(value: unknown): HexColor | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toUpperCase();
	return HEX_PATTERN.test(normalized) ? (normalized as HexColor) : null;
}

function normalizeContrast(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= 0 && value <= 100 ? value : null;
}

export function normalizeAppearance(
	value: unknown,
): AppearancePreferencesV1 | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	if (
		candidate.version !== 1 ||
		!THEME_IDS.includes(candidate.theme as ThemeId)
	)
		return null;
	if (!candidate.custom || typeof candidate.custom !== "object") return null;
	const custom = candidate.custom as Record<string, unknown>;
	if (!custom.sidebar || typeof custom.sidebar !== "object") return null;
	const sidebar = custom.sidebar as Record<string, unknown>;
	const accent = normalizeHex(custom.accent);
	const background = normalizeHex(custom.background);
	const contrast = normalizeContrast(custom.contrast);
	const sidebarAccent = normalizeHex(sidebar.accent);
	const sidebarBackground = normalizeHex(sidebar.background);
	const sidebarContrast = normalizeContrast(sidebar.contrast);
	if (
		!accent ||
		!background ||
		contrast === null ||
		typeof sidebar.enabled !== "boolean" ||
		!sidebarAccent ||
		!sidebarBackground ||
		sidebarContrast === null
	)
		return null;
	return {
		version: 1,
		theme: candidate.theme as ThemeId,
		custom: {
			accent,
			background,
			contrast,
			sidebar: {
				enabled: sidebar.enabled,
				accent: sidebarAccent,
				background: sidebarBackground,
				contrast: sidebarContrast,
			},
		},
	};
}

function channelToLinear(value: number): number {
	const channel = value / 255;
	return channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: HexColor): number {
	const red = channelToLinear(Number.parseInt(hex.slice(1, 3), 16));
	const green = channelToLinear(Number.parseInt(hex.slice(3, 5), 16));
	const blue = channelToLinear(Number.parseInt(hex.slice(5, 7), 16));
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: HexColor, second: HexColor): number {
	const firstLuminance = relativeLuminance(first);
	const secondLuminance = relativeLuminance(second);
	const lighter = Math.max(firstLuminance, secondLuminance);
	const darker = Math.min(firstLuminance, secondLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(first: HexColor, second: HexColor, amount: number): HexColor {
	const channel = (offset: number) => {
		const start = Number.parseInt(first.slice(offset, offset + 2), 16);
		const end = Number.parseInt(second.slice(offset, offset + 2), 16);
		return Math.round(start + (end - start) * amount)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase() as HexColor;
}

export function accessibleAccent(
	accent: HexColor,
	background: HexColor,
): HexColor {
	if (contrastRatio(accent, background) >= 3) return accent;
	const target =
		colorModeForBackground(background) === "dark" ? "#FFFFFF" : "#000000";
	for (let step = 1; step <= 20; step += 1) {
		const candidate = mixHex(accent, target, step / 20);
		if (contrastRatio(candidate, background) >= 3) return candidate;
	}
	return target;
}

export function colorModeForBackground(background: HexColor): ThemeColorMode {
	return relativeLuminance(background) < 0.36 ? "dark" : "light";
}

function foregroundFor(background: HexColor): HexColor {
	return colorModeForBackground(background) === "dark" ? "#F4F4F5" : "#1F2024";
}

function foregroundOnAccent(accent: HexColor): HexColor {
	const blackContrast = (relativeLuminance(accent) + 0.05) / 0.05;
	return blackContrast >= 4.5 ? "#111111" : "#FFFFFF";
}

function mix(
	background: HexColor,
	foreground: HexColor,
	foregroundPercent: number,
): string {
	const percent = Math.max(0, Math.min(100, foregroundPercent)).toFixed(2);
	return `color-mix(in oklch, ${background} ${100 - Number(percent)}%, ${foreground} ${percent}%)`;
}

function customTokenSet(
	background: HexColor,
	accent: HexColor,
	contrast: number,
): ThemeTokens {
	const mode = colorModeForBackground(background);
	const foreground = foregroundFor(background);
	const actionAccent = accessibleAccent(accent, background);
	const factor = contrast / 100;
	const surfaceShift = 1.2 + factor * 3.8;
	const strongShift = 2.4 + factor * 7.2;
	const mutedShift = 3.2 + factor * 8.8;
	const borderShift = 7 + factor * 16;
	const mutedTextShift = mode === "dark" ? 58 : 62;
	const surface = mix(background, foreground, surfaceShift);
	const surfaceStrong = mix(background, foreground, strongShift);
	const muted = mix(background, foreground, mutedShift);
	const border = mix(background, foreground, borderShift);
	const primaryForeground = foregroundOnAccent(actionAccent);
	return {
		background,
		backgroundLight: background,
		foreground,
		card: surface,
		cardForeground: foreground,
		popover: surfaceStrong,
		popoverForeground: foreground,
		surface,
		surfaceStrong,
		mutedSurface: muted,
		muted,
		mutedForeground: mix(background, foreground, mutedTextShift),
		accent: muted,
		accentForeground: foreground,
		primary: actionAccent,
		primaryHover: mix(actionAccent, foregroundOnAccent(actionAccent), 12),
		primarySoft: mix(background, accent, 14 + factor * 8),
		primaryForeground,
		secondary: mix(background, foreground, mode === "dark" ? 18 : 88),
		secondaryForeground: mode === "dark" ? foreground : "#FFFFFF",
		border,
		borderStrong: mix(background, foreground, borderShift + 8),
		canvasDot: mix(background, foreground, borderShift + 16),
		canvasEdge: mix(background, foreground, borderShift + 26),
		input: mix(background, foreground, borderShift + 3),
		ring: actionAccent,
		overlay: mode === "dark" ? "rgba(0, 0, 0, 0.68)" : "rgba(15, 23, 42, 0.32)",
		shadowColor:
			mode === "dark" ? "rgba(0, 0, 0, 0.46)" : "rgba(15, 23, 42, 0.12)",
		destructive: mode === "dark" ? "#F87171" : "#DC2626",
		destructiveForeground: "#FFFFFF",
		success: mode === "dark" ? "#4ADE80" : "#15803D",
		warning: mode === "dark" ? "#FBBF24" : "#B45309",
		info: mode === "dark" ? "#60A5FA" : "#2563EB",
		chart1: accent,
		chart2: "#2DA44E",
		chart3: "#D97706",
		chart4: "#A855F7",
		chart5: "#E255A1",
		sidebar: surface,
		sidebarForeground: foreground,
		sidebarPrimary: actionAccent,
		sidebarPrimaryForeground: primaryForeground,
		sidebarAccent: muted,
		sidebarAccentForeground: foreground,
		sidebarBorder: border,
		sidebarRing: actionAccent,
	};
}

export function resolveTheme(
	preferences: AppearancePreferencesV1,
): ResolvedTheme {
	if (preferences.theme !== "custom") return PRESET_THEMES[preferences.theme];
	const { custom } = preferences;
	const tokens = customTokenSet(
		custom.background,
		custom.accent,
		custom.contrast,
	);
	if (custom.sidebar.enabled) {
		const sidebar = customTokenSet(
			custom.sidebar.background,
			custom.sidebar.accent,
			custom.sidebar.contrast,
		);
		tokens.sidebar = sidebar.background;
		tokens.sidebarForeground = sidebar.foreground;
		tokens.sidebarPrimary = sidebar.primary;
		tokens.sidebarPrimaryForeground = sidebar.primaryForeground;
		tokens.sidebarAccent = sidebar.muted;
		tokens.sidebarAccentForeground = sidebar.foreground;
		tokens.sidebarBorder = sidebar.border;
		tokens.sidebarRing = sidebar.ring;
	}
	return {
		id: "custom",
		mode: colorModeForBackground(custom.background),
		tokens,
	};
}

const TOKEN_PROPERTIES: Record<keyof ThemeTokens, string> = {
	background: "--background",
	backgroundLight: "--background-light",
	foreground: "--foreground",
	card: "--card",
	cardForeground: "--card-foreground",
	popover: "--popover",
	popoverForeground: "--popover-foreground",
	surface: "--app-surface",
	surfaceStrong: "--app-surface-strong",
	mutedSurface: "--app-muted-surface",
	muted: "--muted",
	mutedForeground: "--muted-foreground",
	accent: "--accent",
	accentForeground: "--accent-foreground",
	primary: "--primary",
	primaryHover: "--primary-dark",
	primarySoft: "--primary-light",
	primaryForeground: "--primary-foreground",
	secondary: "--secondary",
	secondaryForeground: "--secondary-foreground",
	border: "--border",
	borderStrong: "--app-border-strong",
	canvasDot: "--canvas-dot",
	canvasEdge: "--canvas-edge",
	input: "--input",
	ring: "--ring",
	overlay: "--app-overlay",
	shadowColor: "--app-shadow-color",
	destructive: "--destructive",
	destructiveForeground: "--destructive-foreground",
	success: "--success",
	warning: "--warning",
	info: "--info",
	chart1: "--chart-1",
	chart2: "--chart-2",
	chart3: "--chart-3",
	chart4: "--chart-4",
	chart5: "--chart-5",
	sidebar: "--sidebar",
	sidebarForeground: "--sidebar-foreground",
	sidebarPrimary: "--sidebar-primary",
	sidebarPrimaryForeground: "--sidebar-primary-foreground",
	sidebarAccent: "--sidebar-accent",
	sidebarAccentForeground: "--sidebar-accent-foreground",
	sidebarBorder: "--sidebar-border",
	sidebarRing: "--sidebar-ring",
};

export function applyAppearanceToDocument(
	preferences: AppearancePreferencesV1,
): ResolvedTheme {
	const resolved = resolveTheme(preferences);
	if (typeof document === "undefined") return resolved;
	const root = document.documentElement;
	root.dataset.uiTheme = resolved.id;
	root.dataset.uiColorMode = resolved.mode;
	root.classList.toggle("dark", resolved.mode === "dark");
	root.style.colorScheme = resolved.mode;
	for (const [key, property] of Object.entries(TOKEN_PROPERTIES)) {
		root.style.setProperty(property, resolved.tokens[key as keyof ThemeTokens]);
	}
	root.style.setProperty("--app-bg", resolved.tokens.background);
	root.style.setProperty("--app-bg-elevated", resolved.tokens.mutedSurface);
	root.style.setProperty("--app-border", resolved.tokens.border);
	root.style.setProperty("--app-text", resolved.tokens.foreground);
	root.style.setProperty("--app-text-muted", resolved.tokens.mutedForeground);
	root.style.setProperty("--app-accent", resolved.tokens.primary);
	root.style.setProperty("--app-accent-soft", resolved.tokens.primarySoft);
	root.style.setProperty("--app-cta", resolved.tokens.primary);
	root.style.setProperty("--app-cta-hover", resolved.tokens.primaryHover);
	root.style.setProperty(
		"--app-shadow-sm",
		`0 6px 18px ${resolved.tokens.shadowColor}`,
	);
	root.style.setProperty(
		"--app-shadow-md",
		`0 16px 36px ${resolved.tokens.shadowColor}`,
	);
	root.style.setProperty(
		"--app-shadow-lg",
		`0 24px 48px ${resolved.tokens.shadowColor}`,
	);
	const meta = document.querySelector<HTMLMetaElement>(
		'meta[name="theme-color"]',
	);
	meta?.setAttribute("content", resolved.tokens.background);
	return resolved;
}

export function readAppearanceCache(): AppearanceCacheV1 {
	if (typeof window === "undefined") {
		return {
			version: 1,
			preferences: cloneDefault(),
			dirty: false,
			ownerUserId: null,
		};
	}
	try {
		const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
		if (!raw) throw new Error("missing cache");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const preferences = normalizeAppearance(parsed.preferences);
		if (parsed.version !== 1 || !preferences) throw new Error("invalid cache");
		return {
			version: 1,
			preferences,
			dirty: parsed.dirty === true,
			ownerUserId:
				typeof parsed.ownerUserId === "string" ? parsed.ownerUserId : null,
		};
	} catch {
		return {
			version: 1,
			preferences: cloneDefault(),
			dirty: false,
			ownerUserId: null,
		};
	}
}

export function writeAppearanceCache(cache: AppearanceCacheV1): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(cache));
	} catch {
		// Storage can be disabled or full; the in-memory theme remains usable.
	}
}

export function serializeThemeShare(
	preferences: AppearancePreferencesV1,
): string {
	const share: ThemeShareV1 =
		preferences.theme === "custom"
			? { version: 1, theme: "custom", custom: preferences.custom }
			: { version: 1, theme: preferences.theme };
	return JSON.stringify(share);
}

export function parseThemeShare(raw: string): AppearancePreferencesV1 {
	if (raw.length > MAX_THEME_IMPORT_LENGTH)
		throw new Error("Theme data is larger than 4 KB.");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Theme data must be valid JSON.");
	}
	if (!parsed || typeof parsed !== "object")
		throw new Error("Theme data must be an object.");
	const candidate = parsed as Record<string, unknown>;
	const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
		Object.keys(value).every((key) => allowed.includes(key));
	if (candidate.version !== 1)
		throw new Error("This theme version is not supported.");
	if (!THEME_IDS.includes(candidate.theme as ThemeId))
		throw new Error("Theme name is not supported.");
	if (candidate.theme !== "custom") {
		if (!hasOnlyKeys(candidate, ["version", "theme"])) {
			throw new Error("Theme data contains unknown fields.");
		}
		return {
			...cloneDefault(),
			theme: candidate.theme as Exclude<ThemeId, "custom">,
		};
	}
	if (!hasOnlyKeys(candidate, ["version", "theme", "custom"])) {
		throw new Error("Theme data contains unknown fields.");
	}
	if (!candidate.custom || typeof candidate.custom !== "object") {
		throw new Error("Custom theme colors or contrast values are invalid.");
	}
	const custom = candidate.custom as Record<string, unknown>;
	if (
		!hasOnlyKeys(custom, ["accent", "background", "contrast", "sidebar"]) ||
		!custom.sidebar ||
		typeof custom.sidebar !== "object" ||
		!hasOnlyKeys(custom.sidebar as Record<string, unknown>, [
			"enabled",
			"accent",
			"background",
			"contrast",
		])
	) {
		throw new Error("Theme data contains unknown fields.");
	}
	const normalized = normalizeAppearance({
		version: 1,
		theme: "custom",
		custom: candidate.custom,
	});
	if (!normalized)
		throw new Error("Custom theme colors or contrast values are invalid.");
	return normalized;
}
