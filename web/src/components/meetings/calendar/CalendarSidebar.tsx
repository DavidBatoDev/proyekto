/**
 * The left rail of the calendar, Google Calendar style: a Create button, a
 * navigable mini month (today circled, the shown date highlighted; clicking a
 * date moves the main view there), and "My calendars" — one checkbox per
 * calendar, in that calendar's color, to show or hide its events.
 */
import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	startOfMonth,
	startOfWeek,
	subMonths,
} from "date-fns";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CALENDAR_STYLES } from "./calendarStyles";
import type { CalendarSource } from "./items";
import { dayKey, sameLocalDay } from "./model";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export interface CalendarToggle {
	source: CalendarSource;
	visible: boolean;
	onToggle: () => void;
	/** Shown under the label, e.g. the connected Google account. */
	detail?: string | null;
	loading?: boolean;
	error?: boolean;
}

interface CalendarSidebarProps {
	anchor: Date;
	now: Date;
	onCreate: () => void;
	onSelectDate: (day: Date) => void;
	calendars: CalendarToggle[];
	/** Offer to connect Google Calendar (enabled but not connected). */
	onConnectGoogle?: () => void;
	connectingGoogle?: boolean;
}

export function CalendarSidebar({
	anchor,
	now,
	onCreate,
	onSelectDate,
	calendars,
	onConnectGoogle,
	connectingGoogle,
}: CalendarSidebarProps) {
	return (
		<aside className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto pb-4 pr-4">
			<button
				type="button"
				onClick={onCreate}
				className="inline-flex w-fit items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 text-sm font-medium text-foreground shadow-md transition-shadow hover:shadow-lg"
			>
				<Plus className="h-5 w-5" />
				Create
			</button>

			<SidebarMiniMonth anchor={anchor} now={now} onSelectDate={onSelectDate} />

			<div>
				<h3 className="mb-2 px-1 text-sm font-semibold text-foreground">
					My calendars
				</h3>
				<ul className="space-y-0.5">
					{calendars.map((cal) => {
						const style = CALENDAR_STYLES[cal.source];
						return (
							<li key={cal.source}>
								<button
									type="button"
									role="checkbox"
									aria-checked={cal.visible}
									onClick={cal.onToggle}
									className="flex w-full items-start gap-3 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-muted"
								>
									<span
										className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 ${
											cal.visible ? style.checkbox : "border-muted-foreground"
										}`}
									>
										{cal.visible && (
											<Check className="h-3 w-3" strokeWidth={3} />
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-1.5 text-sm text-foreground">
											{style.label}
											{cal.loading && (
												<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
											)}
										</span>
										{cal.error ? (
											<span className="block text-xs text-destructive">
												Couldn't load events
											</span>
										) : cal.detail ? (
											<span className="block truncate text-xs text-muted-foreground">
												{cal.detail}
											</span>
										) : null}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
				{onConnectGoogle && (
					<button
						type="button"
						onClick={onConnectGoogle}
						disabled={connectingGoogle}
						className="mt-2 inline-flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-60"
					>
						{connectingGoogle ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Plus className="h-4 w-4" />
						)}
						Connect Google Calendar
					</button>
				)}
			</div>
		</aside>
	);
}

function SidebarMiniMonth({
	anchor,
	now,
	onSelectDate,
}: {
	anchor: Date;
	now: Date;
	onSelectDate: (day: Date) => void;
}) {
	const [month, setMonth] = useState(() => startOfMonth(anchor));
	// Follow the main view when it moves to another month.
	useEffect(() => {
		setMonth(startOfMonth(anchor));
	}, [anchor.getFullYear(), anchor.getMonth()]);

	const cells = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(month)),
				end: endOfWeek(endOfMonth(month)),
			}),
		[month],
	);

	return (
		<div>
			<div className="mb-1 flex items-center justify-between px-1">
				<span className="text-sm font-medium text-foreground">
					{format(month, "MMMM yyyy")}
				</span>
				<div className="flex">
					<button
						type="button"
						aria-label="Previous month"
						onClick={() => setMonth((m) => subMonths(m, 1))}
						className="rounded-full p-1 text-muted-foreground hover:bg-muted"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						aria-label="Next month"
						onClick={() => setMonth((m) => addMonths(m, 1))}
						className="rounded-full p-1 text-muted-foreground hover:bg-muted"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>
			</div>
			<div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground">
				{DOW.map((d, i) => (
					<div key={i} className="py-1">
						{d}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7">
				{cells.map((day) => {
					const inMonth = day.getMonth() === month.getMonth();
					const isToday = sameLocalDay(day, now);
					const isSelected = sameLocalDay(day, anchor);
					return (
						<button
							type="button"
							key={dayKey(day)}
							onClick={() => onSelectDate(new Date(day))}
							className="flex items-center justify-center py-0.5"
						>
							<span
								className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors ${
									isToday
										? "bg-primary font-semibold text-primary-foreground"
										: isSelected
											? "bg-primary/15 font-semibold text-primary"
											: inMonth
												? "text-foreground hover:bg-muted"
												: "text-muted-foreground hover:bg-muted"
								}`}
							>
								{day.getDate()}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
