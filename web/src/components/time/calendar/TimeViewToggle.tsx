// web/src/components/time/calendar/TimeViewToggle.tsx
//
// The Time page's `[List | Month]` switch (ux.md › The Time Page mockup;
// ported from team-time's List | Calendar toggle). The choice is remembered
// per browser under one key for the person's own time (the old per-team
// scope becomes `me`), with every storage read and write in try/catch: a
// private window or blocked storage just falls back to List.

import { CalendarDays, List, type LucideIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

export type TimeViewMode = "list" | "month";

/** localStorage key for the person's own Time view (`me` scope). */
export const TIME_VIEW_STORAGE_KEY = "timeView:me";

export const TIME_VIEW_LABELS: Record<TimeViewMode, string> = {
	list: "List",
	month: "Month",
};

const MODES: readonly { mode: TimeViewMode; icon: LucideIcon }[] = [
	{ mode: "list", icon: List },
	{ mode: "month", icon: CalendarDays },
];

/** The remembered view, or List when nothing (or nothing readable) is stored. */
export function loadTimeView(): TimeViewMode {
	try {
		return globalThis.localStorage?.getItem(TIME_VIEW_STORAGE_KEY) === "month"
			? "month"
			: "list";
	} catch {
		return "list";
	}
}

/** Remembers the view; storage that can't be written is ignored. */
export function storeTimeView(mode: TimeViewMode): void {
	try {
		globalThis.localStorage?.setItem(TIME_VIEW_STORAGE_KEY, mode);
	} catch {
		// Unavailable storage: the choice lasts for this page only.
	}
}

/** `[mode, setMode]`, seeded from storage and written back on change. */
export function useTimeViewMode(): [
	TimeViewMode,
	(mode: TimeViewMode) => void,
] {
	const [mode, setModeState] = useState<TimeViewMode>(() => loadTimeView());
	const setMode = useCallback((next: TimeViewMode) => {
		setModeState(next);
		storeTimeView(next);
	}, []);
	return [mode, setMode];
}

export interface TimeViewToggleProps {
	value: TimeViewMode;
	onChange: (mode: TimeViewMode) => void;
	disabled?: boolean;
	className?: string;
}

/** Segmented `List | Month` switch. */
export function TimeViewToggle({
	value,
	onChange,
	disabled = false,
	className,
}: TimeViewToggleProps) {
	return (
		<div
			role="group"
			className={cn(
				"inline-flex shrink-0 rounded-lg bg-muted p-1 max-sm:p-0.5",
				className,
			)}
			aria-label="View"
		>
			{MODES.map(({ mode, icon: Icon }) => {
				const active = value === mode;
				return (
					<button
						key={mode}
						type="button"
						aria-pressed={active}
						disabled={disabled}
						onClick={() => {
							if (!active) onChange(mode);
						}}
						className={cn(
							// 40 px tall on phones, the compact segment from sm up.
							"inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors disabled:opacity-50 max-sm:min-h-10",
							active
								? "bg-card font-semibold text-foreground shadow-sm"
								: "font-medium text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="h-3.5 w-3.5" aria-hidden="true" />
						{TIME_VIEW_LABELS[mode]}
					</button>
				);
			})}
		</div>
	);
}
