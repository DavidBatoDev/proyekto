/**
 * A token-styled date field: a button showing the selected date that opens an
 * anchored month calendar. Value/onChange use "yyyy-MM-dd". Modeled on the
 * roadmap DueDatePicker's calendar, but always-set (no clear) and built on the
 * shared AnchoredPopover so it works inside the scrolling meeting editor.
 */
import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	format,
	getDay,
	isSameDay,
	isValid,
	parseISO,
	startOfMonth,
	subMonths,
} from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";

const DOW_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface DatePickerFieldProps {
	/** "yyyy-MM-dd" */
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	ariaLabel?: string;
}

export function DatePickerField({
	value,
	onChange,
	disabled,
	ariaLabel = "Pick a date",
}: DatePickerFieldProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const selectedDate =
		value && isValid(parseISO(value)) ? parseISO(value) : null;
	const [viewDate, setViewDate] = useState<Date>(
		() => selectedDate ?? new Date(),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-centre only when opening.
	useEffect(() => {
		if (open) setViewDate(selectedDate ?? new Date());
	}, [open]);

	const days = eachDayOfInterval({
		start: startOfMonth(viewDate),
		end: endOfMonth(viewDate),
	});
	const firstDayOffset = getDay(startOfMonth(viewDate));
	const today = new Date();

	const selectDay = (day: Date) => {
		onChange(format(day, "yyyy-MM-dd"));
		setOpen(false);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((p) => !p)}
				className={`flex w-full items-center gap-2 rounded-xl border border-gray-300 px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
					disabled
						? "cursor-not-allowed opacity-50"
						: "cursor-pointer hover:bg-gray-50"
				}`}
			>
				<Calendar className="h-4 w-4 shrink-0 text-gray-400" />
				<span className={selectedDate ? "text-gray-800" : "text-gray-400"}>
					{selectedDate
						? format(selectedDate, "EEE, MMM d, yyyy")
						: "Select date"}
				</span>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={256}
				ariaLabel={ariaLabel}
			>
				<div className="p-3">
					<div className="mb-2 flex items-center justify-between">
						<button
							type="button"
							aria-label="Previous month"
							onClick={() => setViewDate((d) => subMonths(d, 1))}
							className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<span className="text-sm font-semibold text-gray-900">
							{format(viewDate, "MMMM yyyy")}
						</span>
						<button
							type="button"
							aria-label="Next month"
							onClick={() => setViewDate((d) => addMonths(d, 1))}
							className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>

					<div className="mb-1 grid grid-cols-7">
						{DOW_HEADERS.map((h) => (
							<div
								key={h}
								className="py-1 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400"
							>
								{h}
							</div>
						))}
					</div>

					<div className="grid grid-cols-7 gap-0.5">
						{DOW_HEADERS.slice(0, firstDayOffset).map((dow) => (
							<div key={`pad-${dow}`} aria-hidden="true" />
						))}
						{days.map((day) => {
							const isSelected = selectedDate
								? isSameDay(day, selectedDate)
								: false;
							const isToday = isSameDay(day, today);
							return (
								<button
									key={day.toISOString()}
									type="button"
									aria-label={format(day, "MMMM d, yyyy")}
									aria-pressed={isSelected}
									onClick={() => selectDay(day)}
									className={`flex h-8 items-center justify-center rounded-md text-xs transition-colors ${
										isSelected
											? "bg-primary font-semibold text-white"
											: isToday
												? "font-semibold text-primary hover:bg-gray-100"
												: "text-gray-700 hover:bg-gray-100"
									}`}
								>
									{day.getDate()}
								</button>
							);
						})}
					</div>

					<div className="mt-2 border-t border-gray-100 pt-2">
						<button
							type="button"
							onClick={() => selectDay(new Date())}
							className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-gray-100"
						>
							Today
						</button>
					</div>
				</div>
			</AnchoredPopover>
		</>
	);
}
