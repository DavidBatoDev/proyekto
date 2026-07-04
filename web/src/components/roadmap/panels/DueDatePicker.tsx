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
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DOW_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const POPOVER_WIDTH = 256;
const POPOVER_MAX_HEIGHT = 340;
const VIEWPORT_MARGIN = 8;

interface DueDatePickerProps {
	/** ISO date string: YYYY-MM-DD, or empty/undefined when unset */
	value?: string;
	onChange: (value: string | undefined) => void;
	disabled?: boolean;
}

function formatPillDate(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function DueDatePicker({
	value,
	onChange,
	disabled,
}: DueDatePickerProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [coords, setCoords] = useState<{ top: number; left: number } | null>(
		null,
	);

	const selectedDate =
		value && isValid(parseISO(value)) ? parseISO(value) : null;
	const [viewDate, setViewDate] = useState<Date>(
		() => selectedDate ?? new Date(),
	);

	// Re-centre the calendar view on the selected date each time it opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only re-syncs on open, not on every value change.
	useEffect(() => {
		if (open) setViewDate(selectedDate ?? new Date());
	}, [open]);

	// Position the popover relative to the trigger, clamped to the viewport so
	// it never spills off the right sidebar or below the fold.
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const trigger = triggerRef.current;
			if (!trigger) return;
			const rect = trigger.getBoundingClientRect();
			// Right-align the popover to the trigger so it opens inward (leftward)
			// from the sidebar rather than off the right edge.
			let left = rect.right - POPOVER_WIDTH;
			left = Math.max(
				VIEWPORT_MARGIN,
				Math.min(left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
			);
			// Prefer opening below; flip above if there isn't room.
			const below = rect.bottom + 6;
			const spaceBelow = window.innerHeight - rect.bottom;
			const top =
				spaceBelow < POPOVER_MAX_HEIGHT + VIEWPORT_MARGIN
					? Math.max(VIEWPORT_MARGIN, rect.top - 6 - POPOVER_MAX_HEIGHT)
					: below;
			setCoords({ top, left });
		};
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [open]);

	// Close on outside click / Escape.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const path = e.composedPath();
			if (
				(popoverRef.current && path.includes(popoverRef.current)) ||
				(triggerRef.current && path.includes(triggerRef.current))
			) {
				return;
			}
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
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
				className={`relative flex items-center gap-1.5 pl-2 pr-2.5 h-7 text-xs font-medium rounded-full border border-gray-200 bg-white transition-colors ${
					disabled
						? "opacity-50 cursor-not-allowed"
						: "cursor-pointer hover:bg-gray-50"
				}`}
			>
				<Calendar className="w-3 h-3 text-gray-400 shrink-0" />
				<span className={value ? "text-gray-700" : "text-gray-400"}>
					{value ? formatPillDate(value) : "Due date"}
				</span>
			</button>

			{open &&
				coords &&
				createPortal(
					<div
						ref={popoverRef}
						role="dialog"
						aria-label="Pick a due date"
						style={{
							position: "fixed",
							top: coords.top,
							left: coords.left,
							width: POPOVER_WIDTH,
							zIndex: 1000,
						}}
						className="rounded-xl border border-gray-100 bg-white p-3 shadow-2xl"
					>
						{/* Nav row */}
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

						{/* Weekday headers */}
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

						{/* Day grid */}
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

						{/* Footer actions */}
						<div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
							<button
								type="button"
								onClick={() => selectDay(new Date())}
								className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-gray-100"
							>
								Today
							</button>
							{value && (
								<button
									type="button"
									onClick={() => {
										onChange(undefined);
										setOpen(false);
									}}
									className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
								>
									<X className="h-3 w-3" />
									Clear
								</button>
							)}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
