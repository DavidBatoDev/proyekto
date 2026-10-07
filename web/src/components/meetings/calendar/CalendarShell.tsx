/**
 * The calendar surface: a Google-style toolbar (Today, prev/next, title, view
 * toggle, timezone, Create) over Day / Week / Month / Year views plus a day
 * agenda panel. Owns view/anchor/selected-day/now state and fetches its own
 * window via useCalendarRange → useMeetingsRange. When the user has connected
 * Google Calendar, their own Google events are overlaid read-only (toggleable);
 * a Google failure never blocks the meetings themselves.
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
import { AgendaPanel } from "./AgendaPanel";
import { GoogleEventDetails } from "./GoogleEventDetails";
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

const NO_GOOGLE_EVENTS: GoogleCalendarEvent[] = [];
const OVERLAY_STORAGE_KEY = "meetings.showGoogleCalendar";

/** Show/hide the Google overlay; remembered per browser when storage allows. */
function useGoogleOverlayPreference(): [boolean, (next: boolean) => void] {
	const [show, setShow] = useState<boolean>(() => {
		try {
			return window.localStorage.getItem(OVERLAY_STORAGE_KEY) !== "off";
		} catch {
			return true;
		}
	});
	const update = (next: boolean) => {
		setShow(next);
		try {
			window.localStorage.setItem(OVERLAY_STORAGE_KEY, next ? "on" : "off");
		} catch {
			// Storage blocked (private mode): the choice lasts for this visit.
		}
	};
	return [show, update];
}

function useNow(): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(id);
	}, []);
	return now;
}

function titleFor(view: CalendarView, anchor: Date): string {
	if (view === "day") return format(anchor, "EEEE, MMMM d, yyyy");
	if (view === "month") return format(anchor, "MMMM yyyy");
	if (view === "year") return format(anchor, "yyyy");
	const { start, end } = visibleRange("week", anchor);
	return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
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
	const [view, setView] = useState<CalendarView>("week");
	const [anchor, setAnchor] = useState<Date>(() => new Date());
	const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
	const now = useNow();
	const timeZone = localTimeZone();

	const range = useCalendarRange(view, anchor);
	const meetingsQuery = useMeetingsRange(range);
	const meetings: Meeting[] = meetingsQuery.data ?? [];

	const { data: googleStatus } = useGoogleCalendarStatus();
	const [showGoogle, setShowGoogle] = useGoogleOverlayPreference();
	const googleConnected = Boolean(
		googleStatus?.enabled && googleStatus.connected,
	);
	// useCalendarRange always sets both ends; the shared params type is loose.
	const googleRange = useMemo(
		() => ({ from: range.from ?? "", to: range.to ?? "" }),
		[range],
	);
	// The year view only draws dots; skip the (wide) Google fetch there.
	const googleQuery = useGoogleCalendarEvents(
		googleRange,
		googleConnected && showGoogle && view !== "year" && Boolean(range.from),
	);
	const googleEvents =
		googleConnected && showGoogle && googleQuery.data?.connected
			? googleQuery.data.events
			: NO_GOOGLE_EVENTS;
	const [openGoogleEvent, setOpenGoogleEvent] =
		useState<GoogleCalendarEvent | null>(null);
	const googleConnect = useConnectGoogleCalendar("/meetings");

	const step = (dir: 1 | -1) => {
		const move = {
			day: dir === 1 ? addDays : subDays,
			week: dir === 1 ? addWeeks : subWeeks,
			month: dir === 1 ? addMonths : subMonths,
			year: dir === 1 ? addYears : subYears,
		}[view];
		setAnchor((a) => move(a, 1));
		// Keep the agenda's selected day in step with navigation — otherwise
		// paging (esp. in Day view) moves the grid but leaves the agenda on the
		// previously-selected day.
		setSelectedDay((d) => move(d, 1));
	};

	const goToday = () => {
		const today = new Date();
		setAnchor(today);
		setSelectedDay(today);
	};

	const openDay = (day: Date) => {
		setAnchor(day);
		setSelectedDay(day);
		setView("day");
	};

	const selectMeeting = (m: Meeting) => {
		setSelectedDay(new Date(m.scheduled_at));
		onEditMeeting?.(m);
	};

	const showAgenda = view !== "year";

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Toolbar */}
			<div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={goToday}
						className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Today
					</button>
					<div className="flex">
						<button
							type="button"
							aria-label="Previous"
							onClick={() => step(-1)}
							className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
						>
							<ChevronLeft className="h-5 w-5" />
						</button>
						<button
							type="button"
							aria-label="Next"
							onClick={() => step(1)}
							className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
						>
							<ChevronRight className="h-5 w-5" />
						</button>
					</div>
					<h2 className="text-lg font-semibold text-gray-900">
						{titleFor(view, anchor)}
					</h2>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					{googleStatus?.enabled && googleConnected && (
						<button
							type="button"
							onClick={() => setShowGoogle(!showGoogle)}
							aria-pressed={showGoogle}
							title={
								googleQuery.isError
									? "Couldn't load your Google Calendar events"
									: showGoogle
										? "Hide your Google Calendar events"
										: "Show your Google Calendar events"
							}
							className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
								showGoogle
									? "border-gray-300 text-gray-700 hover:bg-gray-50"
									: "border-dashed border-gray-300 text-gray-400 hover:bg-gray-50"
							}`}
						>
							{showGoogle && googleQuery.isFetching ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : showGoogle && googleQuery.isError ? (
								<AlertTriangle className="h-4 w-4 text-amber-500" />
							) : showGoogle ? (
								<Eye className="h-4 w-4" />
							) : (
								<EyeOff className="h-4 w-4" />
							)}
							Google Calendar
						</button>
					)}
					{googleStatus?.enabled && !googleConnected && !isNativeApp() && (
						<button
							type="button"
							onClick={() => void googleConnect.connect()}
							disabled={googleConnect.connecting}
							title={googleConnect.error ?? undefined}
							className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
						>
							{googleConnect.connecting && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Connect Google Calendar
						</button>
					)}
					<span className="hidden text-xs text-gray-400 sm:inline">
						{timeZoneOffsetLabel(timeZone)} · {timeZone.replace(/_/g, " ")}
					</span>
					<div className="flex rounded-lg border border-gray-200 p-0.5">
						{VIEWS.map((v) => (
							<button
								key={v.id}
								type="button"
								onClick={() => setView(v.id)}
								className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
									view === v.id
										? "bg-primary text-white"
										: "text-gray-600 hover:bg-gray-100"
								}`}
							>
								{v.label}
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={() => onCreate?.()}
						className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
					>
						<CalendarPlus className="h-4 w-4" /> Create
					</button>
				</div>
			</div>

			{/* Body */}
			{meetingsQuery.isPending ? (
				<div className="flex flex-1 items-center justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
				</div>
			) : meetingsQuery.isError ? (
				<div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					Failed to load meetings. Please try again.
				</div>
			) : (
				<div
					className={`grid min-h-0 flex-1 auto-rows-fr gap-4 ${
						showAgenda ? "grid-cols-1 lg:grid-cols-4" : "grid-cols-1"
					}`}
				>
					<div
						className={`min-h-0 ${showAgenda ? "lg:col-span-3" : ""} ${
							view === "year" ? "thin-scrollbar overflow-y-auto" : ""
						}`}
					>
						{view === "day" && (
							<DayView
								anchor={anchor}
								meetings={meetings}
								now={now}
								onSelectMeeting={selectMeeting}
								onCreateAt={(at) => onCreate?.(at)}
								googleEvents={googleEvents}
								onSelectGoogleEvent={setOpenGoogleEvent}
							/>
						)}
						{view === "week" && (
							<WeekView
								anchor={anchor}
								meetings={meetings}
								now={now}
								onSelectMeeting={selectMeeting}
								onCreateAt={(at) => onCreate?.(at)}
								googleEvents={googleEvents}
								onSelectGoogleEvent={setOpenGoogleEvent}
							/>
						)}
						{view === "month" && (
							<MonthView
								anchor={anchor}
								meetings={meetings}
								now={now}
								selectedDay={selectedDay}
								onSelectDay={setSelectedDay}
								onSelectMeeting={selectMeeting}
								googleEvents={googleEvents}
								onSelectGoogleEvent={setOpenGoogleEvent}
							/>
						)}
						{view === "year" && (
							<YearView
								anchor={anchor}
								meetings={meetings}
								now={now}
								onOpenDay={openDay}
							/>
						)}
					</div>

					{showAgenda && (
						<AgendaPanel
							selectedDay={selectedDay}
							meetings={meetings}
							currentUserId={currentUserId}
							onEdit={onEditMeeting}
							googleEvents={googleEvents}
							onSelectGoogleEvent={setOpenGoogleEvent}
						/>
					)}
				</div>
			)}

			<GoogleEventDetails
				event={openGoogleEvent}
				onClose={() => setOpenGoogleEvent(null)}
			/>
		</div>
	);
}
