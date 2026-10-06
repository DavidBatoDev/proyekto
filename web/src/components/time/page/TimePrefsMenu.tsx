// web/src/components/time/page/TimePrefsMenu.tsx
//
// The Time page's ⚙ menu (ux.md › API Surface: "PUT /time/me/preferences
// {timezone, week_start?} (self) edits it from the Time page's ⚙ menu ('Your
// time: Asia/Manila · weeks start Monday')"). Under the "All" filter the day
// strip and view week use these (L29); a filtered context uses its own policy.
//
//   [⚙]
//   ┌ Your time: Asia/Manila · weeks start Monday ─────────┐
//   │ Timezone        [Asia/Manila                 ▾]      │
//   │                 Use this device's timezone (UTC)     │
//   │ Weeks start on  [Monday ▾]                           │
//   │ Timesheets count days in their own timezone.         │
//   │                                  [Cancel] [Save]     │
//   └──────────────────────────────────────────────────────┘
//
// Before a row exists (the overview seeds one from the browser), the person's
// time reads in the device timezone with weeks from Monday.
//
// `useTimePreferences()` is the same answer for the page: `{timezone,
// weekStart}` with those fallbacks applied.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { listTimeZones } from "@/lib/datetime";
import { timeErrorMessage } from "@/lib/timeErrors";
import { deviceTimeZone, weekdayName } from "@/lib/timeFormat";
import { isValidTimezone } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { timeService } from "@/services/time.service";
import type { UserTimePreferences } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

export const TIME_PREFS_COPY = {
	/** The ⚙ button's accessible name. */
	trigger: "Your time settings",
	timezone: "Timezone",
	weekStart: "Weeks start on",
	useDevice: (tz: string) => `Use this device's timezone (${tz})`,
	/** ux.md's day-strip tooltip, said here too. */
	hint: "Timesheets count days in their own timezone.",
	save: "Save",
	cancel: "Cancel",
} as const;

export interface ResolvedTimePreferences {
	timezone: string;
	/** ISO weekday, 1 = Monday. */
	weekStart: number;
	/** False while no preferences row exists (the fallbacks are in use). */
	stored: boolean;
}

/** The stored preferences with ux.md's fallbacks: the device timezone and Monday. */
export function resolveTimePreferences(
	prefs:
		| Pick<UserTimePreferences, "timezone" | "week_start">
		| null
		| undefined,
	deviceTz: string = deviceTimeZone(),
): ResolvedTimePreferences {
	const timezone =
		prefs?.timezone && isValidTimezone(prefs.timezone)
			? prefs.timezone
			: deviceTz;
	const week = prefs?.week_start;
	const weekStart =
		typeof week === "number" && Number.isInteger(week) && week >= 1 && week <= 7
			? week
			: 1;
	return { timezone, weekStart, stored: Boolean(prefs) };
}

/** "Your time: Asia/Manila · weeks start Monday". */
export function prefsSummaryLine(
	prefs: Pick<ResolvedTimePreferences, "timezone" | "weekStart">,
): string {
	return `Your time: ${prefs.timezone} · weeks start ${weekdayName(prefs.weekStart) || "Monday"}`;
}

/** The signed-in person's Time preferences, with the fallbacks applied. */
export function useTimePreferences(): ResolvedTimePreferences & {
	isLoading: boolean;
} {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const query = useQuery(timeQueries.preferences(userId));
	return useMemo(
		() => ({
			...resolveTimePreferences(query.data ?? null),
			isLoading: query.isLoading,
		}),
		[query.data, query.isLoading],
	);
}

/**
 * Every zone the runtime knows, with `current` kept even if it isn't listed,
 * and UTC always offered (some runtimes list only regional zones).
 */
function zoneOptions(current: string): string[] {
	const zones = listTimeZones();
	const out = zones.includes(current) ? [...zones] : [current, ...zones];
	if (!out.includes("UTC")) out.push("UTC");
	return out;
}

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const FIELD =
	"w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

const BUTTON =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-60";

export interface TimePrefsMenuProps {
	/** Raise above AppDialog (1200) when used inside one. */
	zIndex?: number;
	className?: string;
}

export function TimePrefsMenu({ zIndex, className }: TimePrefsMenuProps) {
	const queryClient = useQueryClient();
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const prefs = useTimePreferences();
	const device = deviceTimeZone();
	const [open, setOpen] = useState(false);
	const [timezone, setTimezone] = useState(prefs.timezone);
	const [weekStart, setWeekStart] = useState(prefs.weekStart);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const fieldId = useId();
	const timezoneId = `${fieldId}-timezone`;
	const weekStartId = `${fieldId}-week-start`;

	// Each opening starts from what is saved.
	useEffect(() => {
		if (open) {
			setTimezone(prefs.timezone);
			setWeekStart(prefs.weekStart);
		}
	}, [open, prefs.timezone, prefs.weekStart]);

	// The popover is portaled to <body>, so Tab from the ⚙ never reaches it:
	// move focus to the first field once it opens, and back to the ⚙ when it
	// closes with focus inside it (or lost to <body>).
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open) {
			wasOpen.current = true;
			const frame = requestAnimationFrame(() => {
				document.getElementById(timezoneId)?.focus();
			});
			return () => cancelAnimationFrame(frame);
		}
		if (!wasOpen.current) return;
		wasOpen.current = false;
		const active = document.activeElement;
		if (!active || active === document.body) triggerRef.current?.focus();
	}, [open, timezoneId]);

	const save = useMutation({
		mutationFn: () =>
			timeService.setPreferences({ timezone, week_start: weekStart }),
		onSuccess: (saved) => {
			queryClient.setQueryData(timeKeys.preferences(userId), saved);
			void invalidateTime(queryClient, "preferences");
			setOpen(false);
		},
	});

	const zones = useMemo(() => zoneOptions(timezone), [timezone]);
	const summary = prefsSummaryLine(prefs);
	const changed =
		timezone !== prefs.timezone ||
		weekStart !== prefs.weekStart ||
		!prefs.stored;
	const error = save.error
		? timeErrorMessage(save.error, { operation: "write" })
		: null;

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-label={TIME_PREFS_COPY.trigger}
				aria-expanded={open}
				aria-haspopup="dialog"
				title={summary}
				onClick={() => {
					save.reset();
					setOpen((value) => !value);
				}}
				className={cn(
					"inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
					className,
				)}
			>
				<Settings2 className="h-4 w-4" aria-hidden="true" />
			</button>
			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={320}
				maxHeight={360}
				align="right"
				zIndex={zIndex}
				ariaLabel={TIME_PREFS_COPY.trigger}
			>
				<form
					className="space-y-3 p-3 text-sm text-popover-foreground"
					onSubmit={(event) => {
						event.preventDefault();
						if (changed && !save.isPending) save.mutate();
					}}
				>
					<p className="font-semibold text-foreground">{summary}</p>
					<div className="space-y-1">
						<label
							htmlFor={timezoneId}
							className="text-xs font-medium text-muted-foreground"
						>
							{TIME_PREFS_COPY.timezone}
						</label>
						<select
							id={timezoneId}
							value={timezone}
							disabled={save.isPending}
							onChange={(event) => setTimezone(event.target.value)}
							className={FIELD}
						>
							{zones.map((zone) => (
								<option key={zone} value={zone}>
									{zone.replace(/_/g, " ")}
								</option>
							))}
						</select>
						{device !== timezone ? (
							<button
								type="button"
								disabled={save.isPending}
								onClick={() => setTimezone(device)}
								className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
							>
								{TIME_PREFS_COPY.useDevice(device)}
							</button>
						) : null}
					</div>
					<div className="space-y-1">
						<label
							htmlFor={weekStartId}
							className="text-xs font-medium text-muted-foreground"
						>
							{TIME_PREFS_COPY.weekStart}
						</label>
						<select
							id={weekStartId}
							value={weekStart}
							disabled={save.isPending}
							onChange={(event) => setWeekStart(Number(event.target.value))}
							className={FIELD}
						>
							{WEEK_DAYS.map((day) => (
								<option key={day} value={day}>
									{weekdayName(day)}
								</option>
							))}
						</select>
					</div>
					<p className="text-xs text-muted-foreground">
						{TIME_PREFS_COPY.hint}
					</p>
					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setOpen(false)}
							className={cn(
								BUTTON,
								"border-border bg-background text-foreground hover:bg-muted",
							)}
						>
							{TIME_PREFS_COPY.cancel}
						</button>
						<button
							type="submit"
							disabled={!changed || save.isPending}
							className={cn(
								BUTTON,
								"border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
							)}
						>
							{save.isPending ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : null}
							{TIME_PREFS_COPY.save}
						</button>
					</div>
				</form>
			</AnchoredPopover>
		</>
	);
}
