// web/src/components/time/page/WeekNavigator.tsx
//
// The view week above the day strip (ux.md › Day strip and view week):
//
//   ‹  Sep 29 – Oct 5, 2026  ›   This week         Your time (Asia/Manila) ⓘ ⚙
//
// Below 640 px it takes two rows: "‹  Sep 29 – Oct 5, 2026  ›" and
// "This week … ⚙".
//
// - ‹ › step a week and "This week" jumps back; `j`/`k` move between weeks
//   and `t` goes to today (Google Calendar's keys: j next, k previous).
// - The zone label shows only when the caller passes one (see
//   `zoneLabel` in useTimePageData); below 640 px it moves under the day strip.
// - ⚙ is the person's own Time settings (timezone, week start).

import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { overlayOpen } from "@/lib/overlayOpen";
import { formatPeriodRange } from "@/lib/timeFormat";
import type { LocalRange } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { TIME_PREFS_COPY } from "./TimePrefsMenu";

export const WEEK_NAV_COPY = {
	previous: "Previous week",
	next: "Next week",
	thisWeek: "This week",
	region: "Week",
	/** ux.md's ⓘ tooltip. */
	zoneHint: TIME_PREFS_COPY.hint,
} as const;

export interface WeekNavigatorProps {
	week: LocalRange;
	isCurrentWeek: boolean;
	onPrevious: () => void;
	onNext: () => void;
	onThisWeek: () => void;
	/** "Your time (Asia/Manila)" / "Acme Corp time (America/New_York)"; null hides it. */
	zoneText?: string | null;
	/** The ⚙ menu (TimePrefsMenu), rendered at the end of the row. */
	settings?: ReactNode;
	/** `j` / `k` / `t` (default on). */
	shortcuts?: boolean;
	className?: string;
}

// 40 px targets on phones (`max-sm:`); desktop keeps the compact 32 px.
const ICON_BUTTON =
	"inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:h-10 max-sm:w-10";

/** The zone label with its ⓘ (also used under the day strip on phones). */
export function ZoneLabel({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground",
				className,
			)}
			data-testid="time-zone-label"
		>
			<span className="truncate">{text}</span>
			<span title={WEEK_NAV_COPY.zoneHint} className="inline-flex shrink-0">
				<Info className="h-3.5 w-3.5" aria-hidden="true" />
				<span className="sr-only">{WEEK_NAV_COPY.zoneHint}</span>
			</span>
		</span>
	);
}

export function WeekNavigator({
	week,
	isCurrentWeek,
	onPrevious,
	onNext,
	onThisWeek,
	zoneText,
	settings,
	shortcuts = true,
	className,
}: WeekNavigatorProps) {
	useWeekShortcuts(
		{ previous: onPrevious, next: onNext, today: onThisWeek },
		shortcuts,
	);
	const range = formatPeriodRange(week.start, week.end, {
		spaced: true,
		year: "always",
	});
	return (
		<nav
			aria-label={WEEK_NAV_COPY.region}
			className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
		>
			{/* Phones: ‹ range › fill the first row, and This week and ⚙ share the
			    second, so neither row is a band with one button in it. */}
			<div className="flex items-center gap-1.5 max-sm:basis-full max-sm:justify-between">
				<button
					type="button"
					className={ICON_BUTTON}
					onClick={onPrevious}
					aria-label={WEEK_NAV_COPY.previous}
					title={`${WEEK_NAV_COPY.previous} (k)`}
				>
					<ChevronLeft className="h-4 w-4" aria-hidden="true" />
				</button>
				<h2
					className="min-w-0 px-1 text-sm font-semibold tabular-nums text-foreground sm:text-base"
					aria-live="polite"
					data-testid="time-week-range"
				>
					{range}
				</h2>
				<button
					type="button"
					className={ICON_BUTTON}
					onClick={onNext}
					aria-label={WEEK_NAV_COPY.next}
					title={`${WEEK_NAV_COPY.next} (j)`}
				>
					<ChevronRight className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>
			<button
				type="button"
				onClick={onThisWeek}
				disabled={isCurrentWeek}
				title={`${WEEK_NAV_COPY.thisWeek} (t)`}
				className={cn(
					"rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:min-h-10 max-sm:px-3.5",
					isCurrentWeek
						? "cursor-default bg-muted text-muted-foreground"
						: "border border-border text-foreground hover:bg-muted",
				)}
			>
				{WEEK_NAV_COPY.thisWeek}
			</button>
			<div className="ml-auto flex min-w-0 items-center gap-2">
				{zoneText ? (
					<ZoneLabel text={zoneText} className="hidden sm:inline-flex" />
				) : null}
				{settings}
			</div>
		</nav>
	);
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.closest("[contenteditable='true']") !== null
	);
}

/**
 * `j` next week, `k` previous week, `t` this week. Ignored while typing,
 * with a modifier key held, or while a dialog, popover or menu is open.
 */
export function useWeekShortcuts(
	handlers: { previous: () => void; next: () => void; today: () => void },
	enabled = true,
): void {
	const ref = useRef(handlers);
	ref.current = handlers;
	useEffect(() => {
		if (!enabled) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (isTypingTarget(event.target) || overlayOpen()) return;
			const key = event.key.toLowerCase();
			if (key === "j") ref.current.next();
			else if (key === "k") ref.current.previous();
			else if (key === "t") ref.current.today();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled]);
}
