/**
 * Per-calendar colors, Google Calendar style: each calendar has one color used
 * for its event blocks, bars, month-view dots and its sidebar checkbox.
 * Proyekto meetings use the theme's primary; Google Calendar uses sky.
 */
import type { CalendarSource } from "./items";

export interface CalendarStyle {
	label: string;
	/** Month-view dot. */
	dot: string;
	/** Hollow dot for "free" events. */
	hollowDot: string;
	/** Filled event block / bar. */
	solid: string;
	/** Outlined event block / bar (free events). */
	outline: string;
	/** Checked sidebar checkbox. */
	checkbox: string;
}

export const CALENDAR_STYLES: Record<CalendarSource, CalendarStyle> = {
	proyekto: {
		label: "Proyekto meetings",
		dot: "bg-primary",
		hollowDot: "border-2 border-primary",
		solid: "bg-primary text-primary-foreground hover:brightness-95",
		outline: "border border-primary bg-card text-primary hover:bg-primary/5",
		checkbox: "border-primary bg-primary text-primary-foreground",
	},
	// Sky reads as "Google Calendar" (close to its default Peacock color) and
	// stays distinct from every theme's primary.
	google: {
		label: "Google Calendar",
		dot: "bg-sky-600",
		hollowDot: "border-2 border-sky-600",
		solid: "bg-sky-600 text-white hover:brightness-95",
		outline:
			"border border-sky-600 bg-card text-sky-700 hover:bg-sky-600/5 dark:text-sky-400",
		checkbox: "border-sky-600 bg-sky-600 text-white",
	},
};
