export const THEME_IDS = [
	"light",
	"classic-dark",
	"magic-blue",
	"dark",
	"custom",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeColorMode = "light" | "dark";
export type HexColor = `#${string}`;

export interface CustomThemeValues {
	accent: HexColor;
	background: HexColor;
	contrast: number;
}

export interface CustomSidebarThemeValues extends CustomThemeValues {
	enabled: boolean;
}

export interface AppearancePreferencesV1 {
	version: 1;
	theme: ThemeId;
	custom: CustomThemeValues & {
		sidebar: CustomSidebarThemeValues;
	};
}

export interface ThemeTokens {
	background: string;
	backgroundLight: string;
	foreground: string;
	card: string;
	cardForeground: string;
	popover: string;
	popoverForeground: string;
	surface: string;
	surfaceStrong: string;
	mutedSurface: string;
	muted: string;
	mutedForeground: string;
	accent: string;
	accentForeground: string;
	primary: string;
	primaryHover: string;
	primarySoft: string;
	primaryForeground: string;
	secondary: string;
	secondaryForeground: string;
	border: string;
	borderStrong: string;
	canvasDot: string;
	canvasEdge: string;
	input: string;
	ring: string;
	overlay: string;
	shadowColor: string;
	destructive: string;
	destructiveForeground: string;
	success: string;
	warning: string;
	info: string;
	chart1: string;
	chart2: string;
	chart3: string;
	chart4: string;
	chart5: string;
	sidebar: string;
	sidebarForeground: string;
	sidebarPrimary: string;
	sidebarPrimaryForeground: string;
	sidebarAccent: string;
	sidebarAccentForeground: string;
	sidebarBorder: string;
	sidebarRing: string;
}

export interface ResolvedTheme {
	id: ThemeId;
	mode: ThemeColorMode;
	tokens: ThemeTokens;
}

export type ThemeShareV1 =
	| { version: 1; theme: Exclude<ThemeId, "custom"> }
	| { version: 1; theme: "custom"; custom: AppearancePreferencesV1["custom"] };
