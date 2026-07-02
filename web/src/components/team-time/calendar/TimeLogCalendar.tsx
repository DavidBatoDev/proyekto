import { useQuery } from "@tanstack/react-query";
import {
	addDays,
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isSameDay,
	isSameMonth,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { TaskTimeLog } from "@/services/team-time.service";
import { teamTimeService } from "@/services/team-time.service";
import type { ReviewOnlyDecision } from "../TeamApprovalsInbox";
import { initialsFromName, statusBadgeClass } from "../time-utils";
import { DayLogsModal } from "./DayLogsModal";

type CalendarView = "month" | "week";

const DAY_MODAL_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
	year: "numeric",
});

interface TimeLogCalendarProps {
	teamId: string;
	/** "my" fetches the caller's logs; "team" fetches all members' logs. */
	mode: "my" | "team";
	currentUserId?: string | null;
	/** Log ids with a review/pay mutation in flight (drives spinners). */
	busyLogIds?: Set<string>;
	/** Team mode only — enables review actions and the bulk toolbar in the day modal. */
	onReviewLogs?: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember?: (memberId: string, logIds: string[], currency: string) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
}

function eventLabel(log: TaskTimeLog): string {
	return log.task?.title || log.project?.title || "Untitled";
}

/**
 * Google-Calendar-style view of time logs, with Month and Week layouts. Owns its
 * own range navigation and fetches logs for the visible range (so it works from
 * either My Logs or Team Logs without disturbing the list view's period).
 */
export function TimeLogCalendar({
	teamId,
	mode,
	currentUserId = null,
	busyLogIds,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: TimeLogCalendarProps) {
	const [view, setView] = useState<CalendarView>("month");
	// Anchor is any date within the focused month/week.
	const [anchor, setAnchor] = useState<Date>(() => new Date());
	const [dayModal, setDayModal] = useState<{
		date: Date;
		highlightLogId: string;
	} | null>(null);
	const openDayModal = (log: TaskTimeLog) =>
		setDayModal({ date: new Date(log.started_at), highlightLogId: log.id });

	// Visible range: the full weeks covering the month, or the single week.
	const range = useMemo(() => {
		if (view === "month") {
			return {
				start: startOfWeek(startOfMonth(anchor)),
				end: endOfWeek(endOfMonth(anchor)),
			};
		}
		return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
	}, [view, anchor]);

	const fromIso = useMemo(
		() =>
			new Date(
				range.start.getFullYear(),
				range.start.getMonth(),
				range.start.getDate(),
				0,
				0,
				0,
			).toISOString(),
		[range.start],
	);
	const toIso = useMemo(
		() =>
			new Date(
				range.end.getFullYear(),
				range.end.getMonth(),
				range.end.getDate(),
				23,
				59,
				59,
			).toISOString(),
		[range.end],
	);

	const logsQuery = useQuery({
		queryKey: ["team-time", teamId, "calendar", mode, { fromIso, toIso }],
		queryFn: () =>
			mode === "my"
				? teamTimeService.listMyTeamLogs(teamId, {
						from: fromIso,
						to: toIso,
						limit: 200,
					})
				: teamTimeService.listTeamLogs(teamId, {
						from: fromIso,
						to: toIso,
						limit: 200,
					}),
	});

	const logs = logsQuery.data?.items ?? [];
	const capped = (logsQuery.data?.total ?? 0) > logs.length;

	const logsByDay = useMemo(() => {
		const map = new Map<string, TaskTimeLog[]>();
		for (const log of logs) {
			const key = localDayKey(log.started_at);
			const bucket = map.get(key);
			if (bucket) bucket.push(log);
			else map.set(key, [log]);
		}
		// Earliest first within a day so chips read top-to-bottom chronologically.
		for (const bucket of map.values()) {
			bucket.sort(
				(a, b) =>
					new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
			);
		}
		return map;
	}, [logs]);

	const step = (dir: -1 | 1) =>
		setAnchor((prev) =>
			view === "month" ? addMonths(prev, dir) : addDays(prev, dir * 7),
		);

	const rangeLabel =
		view === "month"
			? format(anchor, "MMMM yyyy")
			: `${format(range.start, "MMM d")} – ${format(range.end, "MMM d, yyyy")}`;

	return (
		<div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
				<div className="inline-flex items-center gap-1">
					<button
						type="button"
						onClick={() => step(-1)}
						className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
						aria-label="Previous"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => setAnchor(new Date())}
						className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
					>
						Today
					</button>
					<button
						type="button"
						onClick={() => step(1)}
						className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
						aria-label="Next"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>
				<div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
					<CalendarDays className="h-4 w-4 text-slate-400" />
					{rangeLabel}
				</div>
				{logsQuery.isFetching && (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
				)}
				<div className="ml-auto inline-flex rounded-lg bg-slate-100 p-1">
					{(["month", "week"] as const).map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => setView(v)}
							className={
								view === v
									? "rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
									: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
							}
						>
							{v === "month" ? "Month" : "Week"}
						</button>
					))}
				</div>
			</div>

			{capped && (
				<p className="px-4 pt-2 text-[11px] text-slate-400">
					Showing the first 200 logs in this range.
				</p>
			)}

			{view === "month" ? (
				<MonthView
					anchor={anchor}
					logsByDay={logsByDay}
					mode={mode}
					onSelectLog={openDayModal}
				/>
			) : (
				<WeekView
					weekStart={range.start}
					logsByDay={logsByDay}
					mode={mode}
					onSelectLog={openDayModal}
				/>
			)}

			<DayLogsModal
				isOpen={dayModal !== null}
				dateLabel={
					dayModal ? DAY_MODAL_DATE_FORMATTER.format(dayModal.date) : ""
				}
				logs={
					dayModal
						? (logsByDay.get(localDayKey(dayModal.date.toISOString())) ?? [])
						: []
				}
				highlightLogId={dayModal?.highlightLogId}
				mode={mode}
				currentUserId={currentUserId}
				busyLogIds={busyLogIds}
				onClose={() => setDayModal(null)}
				onReviewLogs={mode === "team" ? onReviewLogs : undefined}
				onPayMember={mode === "team" ? onPayMember : undefined}
				onOpenTaskInRoadmap={onOpenTaskInRoadmap}
				canOpenTaskInRoadmap={canOpenTaskInRoadmap}
			/>
		</div>
	);
}

function EventChip({
	log,
	mode,
	onSelectLog,
}: {
	log: TaskTimeLog;
	mode: "my" | "team";
	onSelectLog?: (log: TaskTimeLog) => void;
}) {
	const running = !log.ended_at;
	const tone = running ? "running" : log.status;
	return (
		<button
			type="button"
			onClick={onSelectLog ? () => onSelectLog(log) : undefined}
			className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${statusBadgeClass(
				tone,
			)} ${onSelectLog ? "hover:brightness-95" : "cursor-default"}`}
		>
			{mode === "team" && log.member && (
				<MemberDot
					name={log.member.display_name || log.member.email || "?"}
					url={log.member.avatar_url}
				/>
			)}
			<span className="truncate">{eventLabel(log)}</span>
		</button>
	);
}

function MemberDot({ name, url }: { name: string; url: string | null }) {
	if (url) {
		return (
			<img
				src={url}
				alt={name}
				className="h-3 w-3 shrink-0 rounded-full object-cover"
			/>
		);
	}
	return (
		<span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-white/60 text-[7px] font-bold text-slate-600">
			{initialsFromName(name)}
		</span>
	);
}

function MonthView({
	anchor,
	logsByDay,
	mode,
	onSelectLog,
}: {
	anchor: Date;
	logsByDay: Map<string, TaskTimeLog[]>;
	mode: "my" | "team";
	onSelectLog?: (log: TaskTimeLog) => void;
}) {
	const days = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(anchor)),
				end: endOfWeek(endOfMonth(anchor)),
			}),
		[anchor],
	);
	const MAX_CHIPS = 3;

	return (
		<div>
			<div className="grid grid-cols-7 border-b border-slate-100">
				{WEEKDAYS.map((w) => (
					<div
						key={w}
						className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
					>
						{w}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7">
				{days.map((day) => {
					const key = localDayKey(day.toISOString());
					const dayLogs = logsByDay.get(key) ?? [];
					const inMonth = isSameMonth(day, anchor);
					const isToday = isSameDay(day, new Date());
					return (
						<div
							key={day.toISOString()}
							className={`min-h-24 border-b border-r border-slate-100 p-1.5 ${
								inMonth ? "bg-white" : "bg-slate-50/50"
							}`}
						>
							<div
								className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
									isToday
										? "bg-sky-600 font-semibold text-white"
										: inMonth
											? "text-slate-600"
											: "text-slate-300"
								}`}
							>
								{format(day, "d")}
							</div>
							<div className="space-y-0.5">
								{dayLogs.slice(0, MAX_CHIPS).map((log) => (
									<EventChip
										key={log.id}
										log={log}
										mode={mode}
										onSelectLog={onSelectLog}
									/>
								))}
								{dayLogs.length > MAX_CHIPS && (
									<button
										type="button"
										onClick={() => onSelectLog?.(dayLogs[0])}
										className="px-1.5 text-[10px] font-medium text-slate-400 hover:text-slate-600 hover:underline"
									>
										+{dayLogs.length - MAX_CHIPS} more
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function WeekView({
	weekStart,
	logsByDay,
	mode,
	onSelectLog,
}: {
	weekStart: Date;
	logsByDay: Map<string, TaskTimeLog[]>;
	mode: "my" | "team";
	onSelectLog?: (log: TaskTimeLog) => void;
}) {
	const days = useMemo(
		() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
		[weekStart],
	);

	// Dynamic hour window: fit the week's logs, default 8:00–18:00, clamped 0–24.
	const { startHour, endHour } = useMemo(() => {
		let min = 8;
		let max = 18;
		for (const day of days) {
			for (const log of logsByDay.get(localDayKey(day.toISOString())) ?? []) {
				const s = new Date(log.started_at);
				const e = log.ended_at ? new Date(log.ended_at) : s;
				min = Math.min(min, s.getHours());
				max = Math.max(max, e.getHours() + 1);
			}
		}
		return {
			startHour: Math.max(0, min),
			endHour: Math.min(24, Math.max(max, min + 1)),
		};
	}, [days, logsByDay]);

	const hours = endHour - startHour;
	const ROW_H = 44; // px per hour
	const gridHeight = hours * ROW_H;

	const posFor = (log: TaskTimeLog) => {
		const s = new Date(log.started_at);
		const e = log.ended_at ? new Date(log.ended_at) : s;
		const startMins = (s.getHours() - startHour) * 60 + s.getMinutes();
		const endMins = (e.getHours() - startHour) * 60 + e.getMinutes();
		const top = (startMins / 60) * ROW_H;
		const height = Math.max(16, ((endMins - startMins) / 60) * ROW_H);
		return { top, height };
	};

	return (
		<div className="overflow-x-auto">
			{/* Day headers */}
			<div
				className="grid"
				style={{ gridTemplateColumns: "48px repeat(7, minmax(90px, 1fr))" }}
			>
				<div className="border-b border-r border-slate-100" />
				{days.map((day) => {
					const isToday = isSameDay(day, new Date());
					return (
						<div
							key={day.toISOString()}
							className="border-b border-r border-slate-100 px-2 py-1.5 text-center"
						>
							<div className="text-[10px] uppercase tracking-wide text-slate-400">
								{format(day, "EEE")}
							</div>
							<div
								className={`text-sm font-semibold ${isToday ? "text-sky-600" : "text-slate-700"}`}
							>
								{format(day, "d")}
							</div>
						</div>
					);
				})}
			</div>
			{/* Time grid */}
			<div
				className="grid"
				style={{ gridTemplateColumns: "48px repeat(7, minmax(90px, 1fr))" }}
			>
				{/* Hour labels */}
				<div className="relative" style={{ height: gridHeight }}>
					{Array.from({ length: hours }, (_, i) => startHour + i).map(
						(hour, i) => (
							<div
								key={hour}
								className="absolute right-1 text-[10px] text-slate-400"
								style={{ top: i * ROW_H - 5 }}
							>
								{format(new Date(2000, 0, 1, hour), "h a")}
							</div>
						),
					)}
				</div>
				{/* Day columns */}
				{days.map((day) => {
					const dayLogs = logsByDay.get(localDayKey(day.toISOString())) ?? [];
					return (
						<div
							key={day.toISOString()}
							className="relative border-r border-slate-100"
							style={{ height: gridHeight }}
						>
							{/* Hour gridlines */}
							{Array.from({ length: hours }, (_, i) => startHour + i).map(
								(hour, i) => (
									<div
										key={hour}
										className="absolute inset-x-0 border-b border-slate-100"
										style={{ top: i * ROW_H, height: ROW_H }}
									/>
								),
							)}
							{/* Events */}
							{dayLogs
								.filter((l) => l.ended_at)
								.map((log) => {
									const { top, height } = posFor(log);
									return (
										<button
											key={log.id}
											type="button"
											onClick={onSelectLog ? () => onSelectLog(log) : undefined}
											className={`absolute inset-x-1 overflow-hidden rounded px-1 py-0.5 text-left text-[10px] font-medium ${statusBadgeClass(
												log.status,
											)} ${onSelectLog ? "hover:brightness-95" : "cursor-default"}`}
											style={{ top, height }}
										>
											<span className="flex items-center gap-1 truncate">
												{mode === "team" && log.member && (
													<MemberDot
														name={
															log.member.display_name || log.member.email || "?"
														}
														url={log.member.avatar_url}
													/>
												)}
												<span className="truncate">{eventLabel(log)}</span>
											</span>
										</button>
									);
								})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
