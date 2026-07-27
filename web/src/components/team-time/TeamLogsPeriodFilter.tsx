import {
	addMonths,
	eachDayOfInterval,
	endOfDay,
	endOfMonth,
	endOfWeek,
	format,
	isBefore,
	isSameDay,
	isSameMonth,
	isWithinInterval,
	startOfDay,
	startOfMonth,
	startOfWeek,
	subDays,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PayPeriodConfig } from "@/services/teams.service";
import {
	cutoffLabel,
	type LogPeriodPreset,
	payDateLabel,
	periodRangeLabel,
	resolvePayPeriods,
	type TeamLogResolvedPeriod,
} from "./log-period";

interface TeamLogsPeriodFilterProps {
	period: TeamLogResolvedPeriod;
	/** The team's cut-off schedule; falls back to the default when null. */
	payPeriodConfig?: PayPeriodConfig | null;
	onPresetChange: (preset: LogPeriodPreset) => void;
	onCutoffMonthChange: (month: string) => void;
	onCutoffPeriodChange: (periodId: string) => void;
	onApplyCustomRange: (fromDate: string, toDate: string) => void;
	/**
	 * Set of `yyyy-MM-dd` (local) day keys the viewer logged time on. Days in
	 * this set show a small dot in the calendar so you can see when you worked.
	 */
	workedDays?: Set<string>;
	/**
	 * Which edge to anchor the popover to. Use "right" when the trigger sits
	 * near the right of the page so the wide popover opens leftward on-screen.
	 */
	align?: "left" | "right";
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseYmd(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const d = new Date(`${value}T00:00:00`);
	return Number.isNaN(d.getTime()) ? null : d;
}

type PopoverMode = "range" | "cutoff";

export function TeamLogsPeriodFilter({
	period,
	payPeriodConfig,
	onPresetChange,
	onCutoffMonthChange,
	onCutoffPeriodChange,
	onApplyCustomRange,
	workedDays,
	align = "left",
}: TeamLogsPeriodFilterProps) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<PopoverMode>("range");
	const [draftStart, setDraftStart] = useState<Date | null>(null);
	const [draftEnd, setDraftEnd] = useState<Date | null>(null);
	const [hover, setHover] = useState<Date | null>(null);
	const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
	const wrapRef = useRef<HTMLDivElement | null>(null);

	const label = useMemo(() => periodRangeLabel(period), [period]);

	// Initialise the draft from the current period each time the popover opens.
	useEffect(() => {
		if (!open) return;
		const start = parseYmd(period.customFromDate);
		const end = parseYmd(period.customToDate);
		setDraftStart(start);
		setDraftEnd(end);
		setHover(null);
		setMode(period.preset === "cutoff" ? "cutoff" : "range");
		setViewMonth(startOfMonth(start ?? new Date()));
	}, [open, period.customFromDate, period.customToDate, period.preset]);

	// Close on outside click / Escape.
	useEffect(() => {
		if (!open) return;
		const onPointer = (e: MouseEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const pickDay = (day: Date) => {
		if (!draftStart || draftEnd) {
			setDraftStart(day);
			setDraftEnd(null);
			return;
		}
		if (isBefore(day, draftStart)) {
			setDraftStart(day);
			return;
		}
		setDraftEnd(day);
	};

	const applyRange = () => {
		if (!draftStart || !draftEnd) return;
		onApplyCustomRange(
			format(draftStart, "yyyy-MM-dd"),
			format(draftEnd, "yyyy-MM-dd"),
		);
		setOpen(false);
	};

	const applyQuickRange = (from: Date, to: Date) => {
		onApplyCustomRange(format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd"));
		setOpen(false);
	};

	const applyPreset = (preset: LogPeriodPreset) => {
		onPresetChange(preset);
		setOpen(false);
	};

	const today = startOfDay(new Date());

	const presetRail: {
		key: string;
		label: string;
		active: boolean;
		onSelect: () => void;
	}[] = [
		{
			key: "today",
			label: "Today",
			active: false,
			onSelect: () => applyQuickRange(today, today),
		},
		{
			key: "yesterday",
			label: "Yesterday",
			active: false,
			onSelect: () => applyQuickRange(subDays(today, 1), subDays(today, 1)),
		},
		{
			key: "this_week",
			label: "This week",
			active: period.preset === "this_week",
			onSelect: () => applyPreset("this_week"),
		},
		{
			key: "last_7",
			label: "Last 7 days",
			active: false,
			onSelect: () => applyQuickRange(subDays(today, 6), today),
		},
		{
			key: "this_month",
			label: "This month",
			active: period.preset === "this_month",
			onSelect: () => applyPreset("this_month"),
		},
		{
			key: "last_30",
			label: "Last 30 days",
			active: false,
			onSelect: () => applyQuickRange(subDays(today, 29), today),
		},
		{
			key: "this_year",
			label: "This year",
			active: period.preset === "this_year",
			onSelect: () => applyPreset("this_year"),
		},
		{
			key: "current_cutoff",
			label: "Current cut-off",
			active: period.preset === "current_cutoff",
			onSelect: () => applyPreset("current_cutoff"),
		},
		{
			key: "cutoff",
			label: "Cut-off…",
			active: period.preset === "cutoff",
			onSelect: () => setMode("cutoff"),
		},
		{
			key: "all_time",
			label: "All time",
			active: period.preset === "all_time",
			onSelect: () => applyPreset("all_time"),
		},
	];

	return (
		<div ref={wrapRef} className="relative">
			<div className="flex flex-wrap items-center gap-3">
				<span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
					Period
				</span>
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
				>
					<CalendarDays className="h-4 w-4 text-slate-400" />
					{label}
					<ChevronRight
						className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
					/>
				</button>
			</div>

			{open && (
				<div
					className={`absolute top-full z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ${
						align === "right" ? "right-0" : "left-0"
					}`}
				>
					<div className="flex flex-col sm:flex-row">
						{/* Preset rail */}
						<div className="shrink-0 border-b border-slate-100 p-2 sm:w-44 sm:border-b-0 sm:border-r">
							<div className="grid grid-cols-2 gap-1 sm:grid-cols-1">
								{presetRail.map((p) => (
									<button
										key={p.key}
										type="button"
										onClick={p.onSelect}
										className={`rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors ${
											p.active
												? "bg-sky-50 text-sky-700"
												: "text-slate-600 hover:bg-slate-50"
										}`}
									>
										{p.label}
									</button>
								))}
							</div>
						</div>

						{/* Calendar / cutoff area */}
						<div className="min-w-0 flex-1 p-3">
							{mode === "cutoff" ? (
								<CutoffControls
									period={period}
									payPeriodConfig={payPeriodConfig}
									onCutoffMonthChange={onCutoffMonthChange}
									onCutoffPeriodChange={onCutoffPeriodChange}
									onDone={() => setOpen(false)}
									onBackToRange={() => setMode("range")}
								/>
							) : (
								<>
									<div className="mb-3 flex items-center gap-2">
										<RangeChip
											label="From"
											value={
												draftStart ? format(draftStart, "MMM d, yyyy") : "—"
											}
										/>
										<span className="text-slate-300">→</span>
										<RangeChip
											label="To"
											value={draftEnd ? format(draftEnd, "MMM d, yyyy") : "—"}
										/>
									</div>

									<div className="flex items-start gap-4">
										<div className="relative">
											<button
												type="button"
												onClick={() => setViewMonth((m) => addMonths(m, -1))}
												className="absolute -left-1 top-0 rounded-md p-1 text-slate-400 hover:bg-slate-100"
												aria-label="Previous month"
											>
												<ChevronLeft className="h-4 w-4" />
											</button>
											<MonthGrid
												month={viewMonth}
												draftStart={draftStart}
												draftEnd={draftEnd}
												hover={hover}
												onHover={setHover}
												onPick={pickDay}
												workedDays={workedDays}
											/>
										</div>
										<div className="relative hidden md:block">
											<button
												type="button"
												onClick={() => setViewMonth((m) => addMonths(m, 1))}
												className="absolute -right-1 top-0 rounded-md p-1 text-slate-400 hover:bg-slate-100"
												aria-label="Next month"
											>
												<ChevronRight className="h-4 w-4" />
											</button>
											<MonthGrid
												month={addMonths(viewMonth, 1)}
												draftStart={draftStart}
												draftEnd={draftEnd}
												hover={hover}
												onHover={setHover}
												onPick={pickDay}
												workedDays={workedDays}
											/>
										</div>
										{/* Next-month arrow for single-calendar (mobile) layouts */}
										<button
											type="button"
											onClick={() => setViewMonth((m) => addMonths(m, 1))}
											className="rounded-md p-1 text-slate-400 hover:bg-slate-100 md:hidden"
											aria-label="Next month"
										>
											<ChevronRight className="h-4 w-4" />
										</button>
									</div>

									<div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
										<button
											type="button"
											onClick={() => setOpen(false)}
											className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
										>
											Cancel
										</button>
										<button
											type="button"
											onClick={applyRange}
											disabled={!draftStart || !draftEnd}
											className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
										>
											Apply
										</button>
									</div>
								</>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function RangeChip({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5">
			<div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
				{label}
			</div>
			<div className="text-xs font-medium tabular-nums text-slate-700">
				{value}
			</div>
		</div>
	);
}

function MonthGrid({
	month,
	draftStart,
	draftEnd,
	hover,
	onHover,
	onPick,
	workedDays,
}: {
	month: Date;
	draftStart: Date | null;
	draftEnd: Date | null;
	hover: Date | null;
	onHover: (d: Date | null) => void;
	onPick: (d: Date) => void;
	workedDays?: Set<string>;
}) {
	const days = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(month)),
				end: endOfWeek(endOfMonth(month)),
			}),
		[month],
	);

	// Effective range endpoints for highlighting (draftEnd, else the hovered day).
	const end = draftEnd ?? (draftStart && hover ? hover : null);
	let lo = draftStart;
	let hi = end;
	if (lo && hi && isBefore(hi, lo)) {
		[lo, hi] = [hi, lo];
	}

	return (
		<div className="w-56">
			<div className="mb-2 text-center text-xs font-semibold text-slate-700">
				{format(month, "MMMM yyyy")}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{WEEKDAYS.map((w) => (
					<div
						key={w}
						className="py-1 text-center text-[10px] font-semibold text-slate-400"
					>
						{w}
					</div>
				))}
				{days.map((day) => {
					const inMonth = isSameMonth(day, month);
					const isStart = draftStart && isSameDay(day, draftStart);
					const isEnd = draftEnd && isSameDay(day, draftEnd);
					const isEndpoint = isStart || isEnd;
					const inRange =
						lo &&
						hi &&
						isWithinInterval(day, { start: startOfDay(lo), end: endOfDay(hi) });
					const isToday = isSameDay(day, new Date());
					const worked = inMonth && workedDays?.has(format(day, "yyyy-MM-dd"));
					return (
						<button
							key={day.toISOString()}
							type="button"
							onMouseEnter={() => onHover(day)}
							onMouseLeave={() => onHover(null)}
							onClick={() => onPick(day)}
							title={worked ? "You logged time on this day" : undefined}
							className={`relative flex h-8 items-center justify-center text-xs transition-colors ${
								isEndpoint
									? "rounded-md bg-sky-600 font-semibold text-white"
									: inRange
										? "bg-sky-100 text-sky-800"
										: inMonth
											? "rounded-md text-slate-700 hover:bg-slate-100"
											: "rounded-md text-slate-300 hover:bg-slate-50"
							} ${inRange && !isEndpoint ? "" : "rounded-md"} ${
								isToday && !isEndpoint ? "ring-1 ring-inset ring-sky-300" : ""
							}`}
						>
							{format(day, "d")}
							{worked && (
								<span
									className={`absolute bottom-1 h-1 w-1 rounded-full ${
										isEndpoint ? "bg-white" : "bg-emerald-500"
									}`}
								/>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function CutoffMonthPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (month: string) => void;
}) {
	const parsed = /^\d{4}-\d{2}$/.test(value)
		? value
		: format(new Date(), "yyyy-MM");
	const [yearStr, monthStr] = parsed.split("-");
	const selectedYear = Number(yearStr);
	const selectedMonthIndex = Number(monthStr) - 1;
	const [viewYear, setViewYear] = useState(selectedYear);

	// Follow external changes to the selected month (e.g. preset reset).
	useEffect(() => {
		setViewYear(selectedYear);
	}, [selectedYear]);

	return (
		<div className="w-fit rounded-lg border border-slate-200 p-1.5">
			<div className="mb-1 flex items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => setViewYear((y) => y - 1)}
					className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
					aria-label="Previous year"
				>
					<ChevronLeft className="h-3.5 w-3.5" />
				</button>
				<span className="text-[11px] font-semibold tabular-nums text-slate-700">
					{viewYear}
				</span>
				<button
					type="button"
					onClick={() => setViewYear((y) => y + 1)}
					className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
					aria-label="Next year"
				>
					<ChevronRight className="h-3.5 w-3.5" />
				</button>
			</div>
			<div className="grid grid-cols-3 gap-0.5">
				{MONTH_LABELS.map((m, i) => {
					const active = i === selectedMonthIndex && viewYear === selectedYear;
					return (
						<button
							key={m}
							type="button"
							onClick={() =>
								onChange(`${viewYear}-${String(i + 1).padStart(2, "0")}`)
							}
							className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
								active
									? "bg-sky-600 font-semibold text-white"
									: "text-slate-600 hover:bg-slate-100"
							}`}
						>
							{m}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function CutoffControls({
	period,
	payPeriodConfig,
	onCutoffMonthChange,
	onCutoffPeriodChange,
	onDone,
	onBackToRange,
}: {
	period: TeamLogResolvedPeriod;
	payPeriodConfig?: PayPeriodConfig | null;
	onCutoffMonthChange: (month: string) => void;
	onCutoffPeriodChange: (periodId: string) => void;
	onDone: () => void;
	onBackToRange: () => void;
}) {
	const periods = useMemo(
		() => resolvePayPeriods(payPeriodConfig, period.cutoffMonth),
		[payPeriodConfig, period.cutoffMonth],
	);
	const selected =
		periods.find((p) => p.id === period.cutoffPeriodId) ?? periods[0];
	const payLabel = payDateLabel(selected?.payDate.toISOString());

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs font-semibold text-slate-700">
					Payroll cut-off
				</span>
				<button
					type="button"
					onClick={onBackToRange}
					className="text-[11px] font-medium text-sky-600 hover:underline"
				>
					Use calendar instead
				</button>
			</div>
			<div className="space-y-1.5">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
					Month
				</span>
				<CutoffMonthPicker
					value={period.cutoffMonth}
					onChange={onCutoffMonthChange}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				{periods.map((p) => {
					const active = selected?.id === p.id;
					return (
						<button
							key={p.id}
							type="button"
							onClick={() => onCutoffPeriodChange(p.id)}
							title={`${p.label} · ${p.dayRangeLabel}`}
							className={
								active
									? "rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200"
									: "rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
							}
						>
							{p.dayRangeLabel}
						</button>
					);
				})}
			</div>
			<div className="space-y-0.5">
				<div className="text-xs text-slate-500">
					{cutoffLabel(payPeriodConfig, period.cutoffMonth, period.cutoffPeriodId)}
				</div>
				{payLabel && (
					<div className="text-[11px] font-medium text-emerald-600">
						{payLabel}
					</div>
				)}
			</div>
			<div className="flex justify-end border-t border-slate-100 pt-3">
				<button
					type="button"
					onClick={onDone}
					className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
				>
					Done
				</button>
			</div>
		</div>
	);
}
