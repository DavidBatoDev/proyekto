import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, PRESET_THEMES, THEME_OPTIONS } from "./presets";
import {
	accessibleAccent,
	colorModeForBackground,
	contrastRatio,
	normalizeAppearance,
	parseThemeShare,
	resolveTheme,
	serializeThemeShare,
} from "./theme";

describe("appearance theme contract", () => {
	it("keeps the required preset order and Light default", () => {
		expect(THEME_OPTIONS.map((option) => option.id)).toEqual([
			"light",
			"classic-dark",
			"magic-blue",
			"dark",
			"custom",
		]);
		expect(DEFAULT_APPEARANCE.theme).toBe("light");
	});

	it("resolves distinct preset backgrounds", () => {
		expect(PRESET_THEMES.light.tokens.background).toBe("#F9FAFB");
		expect(PRESET_THEMES["classic-dark"].tokens.background).toBe("#1E1F21");
		expect(PRESET_THEMES["magic-blue"].tokens.background).toBe("#171925");
		expect(PRESET_THEMES.dark.tokens.background).toBe("#0E0F0F");
	});

	it("keeps the roadmap dot grid visible in every preset", () => {
		for (const theme of Object.values(PRESET_THEMES)) {
			expect(theme.tokens.canvasDot).not.toBe(theme.tokens.background);
			expect(
				contrastRatio(
					theme.tokens.canvasDot as `#${string}`,
					theme.tokens.background as `#${string}`,
				),
			).toBeGreaterThanOrEqual(1.3);
			expect(
				contrastRatio(
					theme.tokens.canvasEdge as `#${string}`,
					theme.tokens.background as `#${string}`,
				),
			).toBeGreaterThanOrEqual(1.6);
		}
	});

	it("generates custom surfaces in OKLCH and detects dark backgrounds", () => {
		const preferences = structuredClone(DEFAULT_APPEARANCE);
		preferences.theme = "custom";
		preferences.custom.background = "#101218";
		preferences.custom.contrast = 100;
		const resolved = resolveTheme(preferences);
		expect(resolved.mode).toBe("dark");
		expect(resolved.tokens.card).toContain("color-mix(in oklch");
		expect(resolved.tokens.card).not.toBe(resolved.tokens.background);
		expect(colorModeForBackground("#FFFFFF")).toBe("light");
	});

	it("uses independent sidebar values only when enabled", () => {
		const preferences = structuredClone(DEFAULT_APPEARANCE);
		preferences.theme = "custom";
		preferences.custom.sidebar.background = "#101010";
		expect(resolveTheme(preferences).tokens.sidebar).not.toBe("#101010");
		preferences.custom.sidebar.enabled = true;
		expect(resolveTheme(preferences).tokens.sidebar).toBe("#101010");
	});

	it("derives an accessible action accent without changing safe colors", () => {
		expect(accessibleAccent("#6D78D5", "#FFFFFF")).toBe("#6D78D5");
		const adjusted = accessibleAccent("#FAFAFA", "#FFFFFF");
		expect(adjusted).not.toBe("#FAFAFA");
		expect(contrastRatio(adjusted, "#FFFFFF")).toBeGreaterThanOrEqual(3);
	});

	it("normalizes hex colors and rejects invalid values", () => {
		const valid = structuredClone(DEFAULT_APPEARANCE) as unknown as Record<
			string,
			unknown
		>;
		const custom = valid.custom as Record<string, unknown>;
		custom.accent = "#6d78d5";
		expect(normalizeAppearance(valid)?.custom.accent).toBe("#6D78D5");
		custom.contrast = 101;
		expect(normalizeAppearance(valid)).toBeNull();
	});

	it("round-trips custom sharing and rejects oversized imports", () => {
		const preferences = structuredClone(DEFAULT_APPEARANCE);
		preferences.theme = "custom";
		expect(parseThemeShare(serializeThemeShare(preferences))).toEqual(
			preferences,
		);
		expect(() => parseThemeShare("x".repeat(4097))).toThrow("4 KB");
		expect(() =>
			parseThemeShare('{"version":1,"theme":"light","unknown":true}'),
		).toThrow("unknown fields");
	});
});
