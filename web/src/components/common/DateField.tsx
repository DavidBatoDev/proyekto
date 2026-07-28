import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isSameDay,
	isSameMonth,
	isToday,
	parseISO,
	startOfMonth,
	startOfWeek,
	subMonths,
} from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FieldHint } from "./FormFields";

/**
 * A labelled date input backed by a custom calendar popover — replacing the
 * native `<input type="date">`, whose OS-drawn calendar doesn't match the app's
 * theme and reads as a foreign control. Emits an ISO `YYYY-MM-DD` string (same
 * contract as the native input it replaces), so callers are unchanged.
 */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseValue(value: string): Date | null {
	if (!value) return null;
	const parsed = parseISO(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function DateField({
	label,
	value,
	onChange,
	disabled,
	placeholder = "Select date",
	hint,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	placeholder?: string;
	/** Inline "what is this?" help, shown as an ⓘ beside the label. */
	hint?: string;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	const selected = useMemo(() => parseValue(value), [value]);
	const [viewMonth, setViewMonth] = useState<Date>(
		() => selected ?? new Date(),
	);

	// When the popover opens, jump the view to the selected month.
	useEffect(() => {
		if (open && selected) setViewMonth(selected);
	}, [open, selected]);

	useEffect(() => {
		if (!open) return;
		const onPointer = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);

	const days = useMemo(() => {
		const gridStart = startOfWeek(startOfMonth(viewMonth));
		const gridEnd = endOfWeek(endOfMonth(viewMonth));
		return eachDayOfInterval({ start: gridStart, end: gridEnd });
	}, [viewMonth]);

	const commit = (day: Date) => {
		onChange(format(day, "yyyy-MM-dd"));
		setOpen(false);
	};

	return (
		<div ref={rootRef} className="relative">
			<div className="mb-1.5 flex items-center gap-1">
				<span className="text-xs font-semibold text-muted-foreground">
					{label}
				</span>
				{hint && <FieldHint label={label} hint={hint} />}
			</div>
			<button
				type="button"
				id={id}
				disabled={disabled}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => !disabled && setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm text-card-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-70"
			>
				<span className={selected ? "" : "text-muted-foreground"}>
					{selected ? format(selected, "MMM d, yyyy") : placeholder}
				</span>
				<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						role="dialog"
						aria-label={`${label} calendar`}
						initial={{ opacity: 0, y: -4 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						transition={{ duration: 0.14, ease: "easeOut" }}
						className="absolute z-50 mt-1 w-72 rounded-xl border border-border bg-popover p-3 shadow-lg"
					>
						{/* Month nav */}
						<div className="mb-2 flex items-center justify-between">
							<button
								type="button"
								onClick={() => setViewMonth((m) => subMonths(m, 1))}
								className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
								aria-label="Previous month"
							>
								<ChevronLeft className="h-4 w-4" />
							</button>
							<span className="text-sm font-semibold text-foreground">
								{format(viewMonth, "MMMM yyyy")}
							</span>
							<button
								type="button"
								onClick={() => setViewMonth((m) => addMonths(m, 1))}
								className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
								aria-label="Next month"
							>
								<ChevronRight className="h-4 w-4" />
							</button>
						</div>

						{/* Weekday header */}
						<div className="grid grid-cols-7 gap-0.5">
							{WEEKDAYS.map((d) => (
								<div
									key={d}
									className="py-1 text-center text-[10px] font-semibold uppercase text-muted-foreground"
								>
									{d}
								</div>
							))}
						</div>

						{/* Day grid */}
						<div className="grid grid-cols-7 gap-0.5">
							{days.map((day) => {
								const isSelected = selected && isSameDay(day, selected);
								const inMonth = isSameMonth(day, viewMonth);
								const today = isToday(day);
								return (
									<button
										type="button"
										key={day.toISOString()}
										onClick={() => commit(day)}
										className={`flex h-8 items-center justify-center rounded-md text-xs transition ${
											isSelected
												? "bg-primary font-semibold text-primary-foreground"
												: today
													? "font-semibold text-primary hover:bg-muted"
													: inMonth
														? "text-foreground hover:bg-muted"
														: "text-muted-foreground/50 hover:bg-muted"
										}`}
									>
										{day.getDate()}
									</button>
								);
							})}
						</div>

						{/* Footer */}
						<div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
							<button
								type="button"
								onClick={() => {
									onChange("");
									setOpen(false);
								}}
								className="font-medium text-muted-foreground hover:text-foreground"
							>
								Clear
							</button>
							<button
								type="button"
								onClick={() => commit(new Date())}
								className="font-semibold text-primary hover:underline"
							>
								Today
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
