/**
 * The calendar surface, laid out like Google Calendar: a toolbar (Today,
 * prev/next, the period title, a view picker), a left rail (Create, mini
 * month, "My calendars" toggles) and the Day / Week / Month / Year view in a
 * rounded card. Proyekto meetings and — when connected — the user's own Google
 * Calendar events are drawn together, each in its calendar's color; clicking
 * an event opens its details card. A Google failure never blocks the meetings.
 */
import {
	addDays,
	addMonths,
	addWeeks,
	addYears,
	format,
	subDays,
	subMonths,
	subWeeks,
	subYears,
} from "date-fns";
import {
	AlertTriangle,
	CalendarPlus,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Eye,
	EyeOff,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	useConnectGoogleCalendar,
	useGoogleCalendarEvents,
	useGoogleCalendarStatus,
	useMeetingsRange,
} from "@/hooks/useMeetings";
import { localTimeZone, timeZoneOffsetLabel } from "@/lib/datetime";
import { isNativeApp } from "@/lib/platform";
import type { GoogleCalendarEvent, Meeting } from "@/services/meetings.service";
import { CalendarSidebar } from "./CalendarSidebar";
import { EventPopover } from "./EventPopover";
import type { OpenItem } from "./ItemViews";
import { type CalendarItem, toCalendarItems } from "./items";
import {
	type CalendarView,
	useCalendarRange,
	visibleRange,
} from "./useCalendarRange";
import { DayView } from "./views/DayView";
import { MonthView } from "./views/MonthView";
import { WeekView } from "./views/WeekView";
import { YearView } from "./views/YearView";

const VIEWS: { id: CalendarView; label: string }[] = [
	{ id: "day", label: "Day" },
	{ id: "week", label: "Week" },
	{ id: "month", label: "Month" },
	{ id: "year", label: "Year" },
];

const NO_MEETINGS: Meeting[] = [];
const NO_GOOGLE_EVENTS: GoogleCalendarEvent[] = [];
// Show/hide per calendar, remembered per browser when storage allows. The
// Google key predates the sidebar (it backed the old toolbar toggle).
const VISIBILITY_KEYS = {
	proyekto: "meetings.showProyektoMeetings",
	google: "meetings.showGoogleCalendar",
} as const;

function readVisible(key: string): boolean {
	try {
		return window.localStorage.getItem(key) !== "off";
	} catch {
		return true;
	}
}

function useCalendarVisibility() {
	const [visible, setVisible] = useState(() => ({
		proyekto: readVisible(VISIBILITY_KEYS.proyekto),
		google: readVisible(VISIBILITY_KEYS.google),
	}));
	const toggle = (source: keyof typeof VISIBILITY_KEYS) => {
		setVisible((v) => {
			const next = { ...v, [source]: !v[source] };
			try {
				window.localStorage.setItem(
					VISIBILITY_KEYS[source],
					next[source] ? "on" : "off",
				);
			} catch {
				// Storage blocked (private mode): the choice lasts for this visit.
			}
			return next;
		});
	};
	return { visible, toggle };
}

function useNow(): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(id);
	}, []);
	return now;
}

/** Google's period titles: "October 2026", "Sep – Oct 2026", "October 7, 2026". */
function titleFor(view: CalendarView, anchor: Date): string {
	if (view === "day") return format(anchor, "MMMM d, yyyy");
	if (view === "year") return format(anchor, "yyyy");
	if (view === "month") return format(anchor, "MMMM yyyy");
	const { start, end } = visibleRange("week", anchor);
	if (start.getMonth() === end.getMonth()) return format(start, "MMMM yyyy");
	if (start.getFullYear() === end.getFullYear()) {
		return `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`;
	}
	return `${format(start, "MMM yyyy")} – ${format(end, "MMM yyyy")}`;
}

/** "GMT+08:00" → "GMT+08" (minutes kept when they matter, e.g. GMT+05:30). */
function shortOffset(timeZone: string): string {
	return timeZoneOffsetLabel(timeZone, new Date()).replace(/:00$/, "");
}

interface CalendarShellProps {
	currentUserId?: string;
	/** Open the create/editor flow, optionally prefilled to a slot. */
	onCreate?: (at?: Date) => void;
	/** Open an existing meeting in the editor. */
	onEditMeeting?: (meeting: Meeting) => void;
}

export function CalendarShell({
	currentUserId,
	onCreate,
	onEditMeeting,
}: CalendarShellProps) {
	// Phones open on a single day (seven columns are too narrow), like Google.
	const [view, setView] = useState<CalendarView>(() =>
		typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "week",
	);
	const [anchor, setAnchor] = useState<Date>(() => new Date());
	const [opened, setOpened] = useState<{
		item: CalendarItem;
		anchor: DOMRect;
	} | null>(null);
	const now = useNow();
	const timeZone = localTimeZone();

	const range = useCalendarRange(view, anchor);
	const meetingsQuery = useMeetingsRange(range);
	const { visible, toggle } = useCalendarVisibility();

	const { data: googleStatus } = useGoogleCalendarStatus();
	const googleEnabled = Boolean(googleStatus?.enabled);
	const googleConnected = Boolean(googleEnabled && googleStatus?.connected);
	// useCalendarRange always sets both ends; the shared params type is loose.
	const googleRange = useMemo(
		() => ({ from: range.from ?? "", to: range.to ?? "" }),
		[range],
	);
	// The year view only draws dots for meetings; skip the wide Google fetch.
	const googleQuery = useGoogleCalendarEvents(
		googleRange,
		googleConnected && visible.google && view !== "year" && Boolean(range.from),
	);
	const googleConnect = useConnectGoogleCalendar("/meetings");
	const canConnectGoogle = googleEnabled && !googleConnected && !isNativeApp();

	const meetings = visible.proyekto
		? (meetingsQuery.data ?? NO_MEETINGS)
		: NO_MEETINGS;
	const googleEvents =
		googleConnected && visible.google && googleQuery.data?.connected
			? googleQuery.data.events
			: NO_GOOGLE_EVENTS;
	const items = useMemo(
		() => toCalendarItems(meetings, googleEvents),
		[meetings, googleEvents],
	);

	const step = (dir: 1 | -1) => {
		const move = {
			day: dir === 1 ? addDays : subDays,
			week: dir === 1 ? addWeeks : subWeeks,
			month: dir === 1 ? addMonths : subMonths,
			year: dir === 1 ? addYears : subYears,
		}[view];
		setAnchor((a) => move(a, 1));
	};

	const openDay = (day: Date) => {
		setAnchor(day);
		setView("day");
	};

	const openItem: OpenItem = (item, rect) => setOpened({ item, anchor: rect });

	const calendars = [
		{
			source: "proyekto" as const,
			visible: visible.proyekto,
			onToggle: () => toggle("proyekto"),
			loading: meetingsQuery.isFetching,
			error: meetingsQuery.isError,
		},
		...(googleConnected
			? [
					{
						source: "google" as const,
						visible: visible.google,
						onToggle: () => toggle("google"),
						detail: googleStatus?.googleEmail ?? null,
						loading: visible.google && googleQuery.isFetching,
						error: visible.google && googleQuery.isError,
					},
				]
			: []),
	];

	const viewProps = {
		anchor,
		items,
		now,
		timeZoneLabel: shortOffset(timeZone),
		onOpenItem: openItem,
		onCreateAt: (at: Date) => onCreate?.(at),
		onOpenDay: openDay,
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Toolbar */}
			<div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
				<button
					type="button"
					onClick={() => setAnchor(new Date())}
					className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
				>
					Today
				</button>
				<div className="flex">
					<button
						type="button"
						aria-label="Previous"
						onClick={() => step(-1)}
						className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
					>
						<ChevronLeft className="h-5 w-5" />
					</button>
					<button
						type="button"
						aria-label="Next"
						onClick={() => step(1)}
						className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
					>
						<ChevronRight className="h-5 w-5" />
					</button>
				</div>
				<h2 className="text-xl font-normal text-foreground">
					{titleFor(view, anchor)}
				</h2>

				<div className="ml-auto flex flex-wrap items-center gap-2">
					{/* Small screens have no sidebar: its controls live here. */}
					{googleConnected && (
						<button
							type="button"
							onClick={() => toggle("google")}
							aria-pressed={visible.google}
							className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted lg:hidden"
						>
							{visible.google && googleQuery.isError ? (
								<AlertTriangle className="h-4 w-4 text-warning" />
							) : visible.google ? (
								<Eye className="h-4 w-4" />
							) : (
								<EyeOff className="h-4 w-4" />
							)}
							Google
						</button>
					)}
					{canConnectGoogle && (
						<button
							type="button"
							onClick={() => void googleConnect.connect()}
							disabled={googleConnect.connecting}
							className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-60 lg:hidden"
						>
							Connect Google Calendar
						</button>
					)}
					<label className="relative inline-flex items-center">
						<span className="sr-only">View</span>
						<select
							value={view}
							onChange={(e) => setView(e.target.value as CalendarView)}
							className="appearance-none rounded-full border border-border bg-card py-1.5 pl-4 pr-9 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
						>
							{VIEWS.map((v) => (
								<option key={v.id} value={v.id}>
									{v.label}
								</option>
							))}
						</select>
						<ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
					</label>
					<button
						type="button"
						onClick={() => onCreate?.()}
						className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 lg:hidden"
					>
						<CalendarPlus className="h-4 w-4" /> Create
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="flex min-h-0 flex-1">
				<div className="hidden lg:flex">
					<CalendarSidebar
						anchor={anchor}
						now={now}
						onCreate={() => onCreate?.()}
						onSelectDate={setAnchor}
						calendars={calendars}
						onConnectGoogle={
							canConnectGoogle ? () => void googleConnect.connect() : undefined
						}
						connectingGoogle={googleConnect.connecting}
					/>
				</div>

				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
					{meetingsQuery.isPending && visible.proyekto ? (
						<div className="flex flex-1 items-center justify-center p-12">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : meetingsQuery.isError ? (
						<div className="m-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
							Failed to load meetings. Please try again.
						</div>
					) : (
						<>
							{view === "day" && <DayView {...viewProps} />}
							{view === "week" && <WeekView {...viewProps} />}
							{view === "month" && <MonthView {...viewProps} />}
							{view === "year" && (
								<div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
									<YearView
										anchor={anchor}
										meetings={meetings}
										now={now}
										onOpenDay={openDay}
									/>
								</div>
							)}
						</>
					)}
				</div>
			</div>

			<EventPopover
				item={opened?.item ?? null}
				anchor={opened?.anchor ?? null}
				currentUserId={currentUserId}
				onClose={() => setOpened(null)}
				onEditMeeting={onEditMeeting}
			/>
		</div>
	);
}
