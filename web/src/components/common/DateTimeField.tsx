/**
 * A date + time field backed by custom popovers, replacing
 * `<input type="datetime-local">`.
 *
 * The native control draws an OS calendar/spinner that ignores the app's theme
 * and, inside a modal, renders as a foreign panel bolted to the input. This
 * splits the value into a calendar button and a typeable time combobox — the
 * same pattern the meeting editor already uses — while keeping the native
 * input's exact string contract (`yyyy-MM-ddTHH:mm`, local wall clock), so
 * callers using `toLocalDateTimeInput` / `fromLocalDateTimeInput` are unchanged.
 *
 * Both popovers portal through `AnchoredPopover`, so they escape a scrolling
 * dialog's overflow. `zIndex` defaults above `AppDialog` (1200) for that reason
 * — see the z-index ladder in AppDialog.
 */
import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isSameDay,
	isSameMonth,
	isToday,
	isValid,
	parseISO,
	startOfMonth,
	startOfWeek,
	subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { formatTime12h, parseTimeInput, timeOptions } from "@/lib/datetime";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** Used when a date is picked before any time has been set. */
const FALLBACK_TIME = "09:00";

interface DateTimeParts {
	date: string;
	time: string;
}

/** "2026-08-24T23:08" → { date: "2026-08-24", time: "23:08" } */
function splitValue(value: string): DateTimeParts {
	const [date = "", rest = ""] = value.split("T");
	return { date, time: rest.slice(0, 5) };
}

function parseDatePart(date: string): Date | null {
	if (!date) return null;
	const parsed = parseISO(date);
	return isValid(parsed) ? parsed : null;
}

export interface DateTimeFieldProps {
	label?: ReactNode;
	/** "yyyy-MM-ddTHH:mm" — the same value a datetime-local input emits. */
	value: string;
	onChange: (value: string) => void;
	/** Earliest allowed value, same format. Earlier days and slots are disabled. */
	min?: string;
	disabled?: boolean;
	/** Granularity of the time list. Typing accepts any minute regardless. */
	stepMin?: number;
	zIndex?: number;
	ariaLabel?: string;
}

export function DateTimeField({
	label,
	value,
	onChange,
	min,
	disabled,
	stepMin = 15,
	zIndex = 1300,
	ariaLabel,
}: DateTimeFieldProps) {
	const { date, time } = useMemo(() => splitValue(value), [value]);
	const minParts = useMemo(() => (min ? splitValue(min) : null), [min]);

	const [dateOpen, setDateOpen] = useState(false);
	const [timeOpen, setTimeOpen] = useState(false);
	const dateRef = useRef<HTMLButtonElement>(null);
	const timeRef = useRef<HTMLDivElement>(null);
	const selectedOptRef = useRef<HTMLButtonElement>(null);

	const [draft, setDraft] = useState(() => (time ? formatTime12h(time) : ""));
	// Keep the visible text in sync with the value except while being edited.
	useEffect(() => {
		if (!timeOpen) setDraft(time ? formatTime12h(time) : "");
	}, [time, timeOpen]);

	const selected = useMemo(() => parseDatePart(date), [date]);
	const [viewMonth, setViewMonth] = useState<Date>(
		() => selected ?? new Date(),
	);
	// Re-centre the grid only when opening, not on every value change.
	useEffect(() => {
		if (dateOpen) setViewMonth(selected ?? new Date());
	}, [dateOpen]);

	/**
	 * Escape belongs to the popover while one is open — without this the host
	 * AppDialog's own Escape handler (also on `document`) closes the whole modal
	 * out from under the picker. Capture phase runs first, so stopping
	 * propagation here keeps the dialog open.
	 */
	useEffect(() => {
		if (!dateOpen && !timeOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setDateOpen(false);
			setTimeOpen(false);
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [dateOpen, timeOpen]);

	const days = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(viewMonth)),
				end: endOfWeek(endOfMonth(viewMonth)),
			}),
		[viewMonth],
	);

	const options = useMemo(() => timeOptions(stepMin), [stepMin]);
	// Slots are only bounded on the boundary day itself; any later day is free.
	const minTimeToday =
		minParts && date && date === minParts.date ? minParts.time : null;

	/**
	 * The slot to scroll to on open. A time typed off the step grid (11:08 PM)
	 * matches no option, so fall back to the nearest one — otherwise the list
	 * opens at midnight, miles from where the user is working.
	 */
	const anchorOption = useMemo(() => {
		if (!time) return null;
		const [h, m] = time.split(":").map(Number);
		if (Number.isNaN(h) || Number.isNaN(m)) return null;
		const target = h * 60 + m;
		let best = options[0] ?? null;
		let bestDelta = Number.POSITIVE_INFINITY;
		for (const opt of options) {
			const [oh, om] = opt.split(":").map(Number);
			const delta = Math.abs(oh * 60 + om - target);
			if (delta < bestDelta) {
				bestDelta = delta;
				best = opt;
			}
		}
		return best;
	}, [time, options]);

	// Centre the current time in the list rather than opening at midnight.
	useEffect(() => {
		if (!timeOpen) return;
		const frame = requestAnimationFrame(() => {
			const el = selectedOptRef.current;
			const scroller = el?.offsetParent as HTMLElement | null;
			if (!el || !scroller) return;
			scroller.scrollTop =
				el.offsetTop - scroller.clientHeight / 2 + el.clientHeight / 2;
		});
		return () => cancelAnimationFrame(frame);
	}, [timeOpen]);

	const emit = (nextDate: string, nextTime: string) => {
		if (!nextDate) return;
		onChange(`${nextDate}T${nextTime || FALLBACK_TIME}`);
	};

	const selectDay = (day: Date) => {
		emit(format(day, "yyyy-MM-dd"), time);
		setDateOpen(false);
	};

	const commitTime = (raw: string) => {
		const parsed = parseTimeInput(raw);
		if (parsed) {
			emit(date || format(new Date(), "yyyy-MM-dd"), parsed);
			setDraft(formatTime12h(parsed));
		} else {
			setDraft(time ? formatTime12h(time) : ""); // revert unparseable input
		}
		setTimeOpen(false);
	};

	const fieldTone = disabled
		? "cursor-not-allowed opacity-60"
		: "hover:bg-muted/40";

	return (
		<div className="space-y-1.5">
			{label && (
				<span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{label}
				</span>
			)}
			<div className="flex items-stretch overflow-hidden rounded-lg border border-input bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
				<button
					ref={dateRef}
					type="button"
					disabled={disabled}
					aria-haspopup="dialog"
					aria-expanded={dateOpen}
					aria-label={ariaLabel ? `${ariaLabel} date` : "Pick a date"}
					onClick={() => setDateOpen((v) => !v)}
					className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-card-foreground outline-none transition ${fieldTone}`}
				>
					<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
					<span
						className={`truncate ${selected ? "" : "text-muted-foreground"}`}
					>
						{selected ? format(selected, "EEE, MMM d, yyyy") : "Select date"}
					</span>
				</button>

				<div className="my-1.5 w-px shrink-0 bg-border" />

				<div
					ref={timeRef}
					className={`flex w-[7.5rem] shrink-0 items-center gap-1.5 px-3 py-2 text-sm ${
						disabled ? "opacity-60" : ""
					}`}
				>
					<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
					<input
						value={draft}
						disabled={disabled}
						aria-label={ariaLabel ? `${ariaLabel} time` : "Pick a time"}
						placeholder="9:00 AM"
						onFocus={() => setTimeOpen(true)}
						onClick={() => setTimeOpen(true)}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								commitTime(draft);
							}
						}}
						onBlur={() => commitTime(draft)}
						className="w-full min-w-0 bg-transparent text-card-foreground outline-none placeholder:text-muted-foreground"
					/>
				</div>
			</div>

			<AnchoredPopover
				anchorRef={dateRef}
				open={dateOpen}
				onClose={() => setDateOpen(false)}
				width={272}
				maxHeight={340}
				zIndex={zIndex}
				ariaLabel="Calendar"
			>
				<div className="p-3">
					<div className="mb-2 flex items-center justify-between">
						<button
							type="button"
							aria-label="Previous month"
							onClick={() => setViewMonth((m) => subMonths(m, 1))}
							className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<span className="text-sm font-semibold text-foreground">
							{format(viewMonth, "MMMM yyyy")}
						</span>
						<button
							type="button"
							aria-label="Next month"
							onClick={() => setViewMonth((m) => addMonths(m, 1))}
							className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>

					<div className="grid grid-cols-7">
						{WEEKDAYS.map((d) => (
							<div
								key={d}
								className="py-1 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
							>
								{d}
							</div>
						))}
					</div>

					<div className="grid grid-cols-7 gap-0.5">
						{days.map((day) => {
							const key = format(day, "yyyy-MM-dd");
							const isSelected = selected ? isSameDay(day, selected) : false;
							const outOfRange = minParts ? key < minParts.date : false;
							return (
								<button
									key={key}
									type="button"
									disabled={outOfRange}
									aria-pressed={isSelected}
									aria-label={format(day, "MMMM d, yyyy")}
									onClick={() => selectDay(day)}
									className={`flex h-8 items-center justify-center rounded-md text-xs transition ${
										outOfRange
											? "cursor-not-allowed text-muted-foreground/35"
											: isSelected
												? "bg-primary font-semibold text-primary-foreground"
												: isToday(day)
													? "font-semibold text-primary hover:bg-muted"
													: isSameMonth(day, viewMonth)
														? "text-foreground hover:bg-muted"
														: "text-muted-foreground/60 hover:bg-muted"
									}`}
								>
									{day.getDate()}
								</button>
							);
						})}
					</div>

					<div className="mt-2 border-t border-border pt-2">
						<button
							type="button"
							onClick={() => selectDay(new Date())}
							className="rounded-md px-2 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
						>
							Today
						</button>
					</div>
				</div>
			</AnchoredPopover>

			<AnchoredPopover
				anchorRef={timeRef}
				open={timeOpen}
				onClose={() => commitTime(draft)}
				width={150}
				maxHeight={260}
				zIndex={zIndex}
				align="right"
				ariaLabel="Time options"
			>
				<div className="py-1">
					{options.map((opt) => {
						const isDisabled = minTimeToday ? opt < minTimeToday : false;
						const isSelected = opt === time;
						return (
							<button
								key={opt}
								ref={opt === anchorOption ? selectedOptRef : undefined}
								type="button"
								disabled={isDisabled}
								// Beat the input's blur, which would commit and close first.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									emit(date || format(new Date(), "yyyy-MM-dd"), opt);
									setDraft(formatTime12h(opt));
									setTimeOpen(false);
								}}
								className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition ${
									isDisabled
										? "cursor-not-allowed text-muted-foreground/40"
										: isSelected
											? "bg-primary/10 font-semibold text-primary"
											: "text-foreground hover:bg-muted"
								}`}
							>
								{formatTime12h(opt)}
							</button>
						);
					})}
				</div>
			</AnchoredPopover>
		</div>
	);
}
