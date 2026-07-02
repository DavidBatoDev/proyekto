import { CalendarDays, List } from "lucide-react";

export type TimeViewMode = "list" | "calendar";

/** Segmented List | Calendar switch shared by My Logs and Team Logs. */
export function TimeViewToggle({
	value,
	onChange,
}: {
	value: TimeViewMode;
	onChange: (mode: TimeViewMode) => void;
}) {
	return (
		<div className="inline-flex rounded-lg bg-slate-100 p-1">
			<button
				type="button"
				onClick={() => onChange("list")}
				className={
					value === "list"
						? "inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
						: "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
				}
			>
				<List className="h-3.5 w-3.5" />
				List
			</button>
			<button
				type="button"
				onClick={() => onChange("calendar")}
				className={
					value === "calendar"
						? "inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
						: "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
				}
			>
				<CalendarDays className="h-3.5 w-3.5" />
				Calendar
			</button>
		</div>
	);
}

/** Read/persist the view mode per team + scope (my|team) in localStorage. */
export function loadTimeView(
	teamId: string,
	scope: "my" | "team",
): TimeViewMode {
	try {
		return localStorage.getItem(`timeView:${teamId}:${scope}`) === "calendar"
			? "calendar"
			: "list";
	} catch {
		return "list";
	}
}

export function storeTimeView(
	teamId: string,
	scope: "my" | "team",
	mode: TimeViewMode,
): void {
	try {
		localStorage.setItem(`timeView:${teamId}:${scope}`, mode);
	} catch {
		// ignore unavailable storage
	}
}
