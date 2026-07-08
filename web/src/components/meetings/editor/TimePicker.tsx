/**
 * A time field with a Google-Calendar-style combobox: type a loose time
 * ("4pm", "16:00") or pick from 15-minute presets. Value/onChange use canonical
 * "HH:mm" (24h); the display is 12-hour. Optional `minTime` disables earlier
 * slots (used to keep an end time after its start).
 */

import { Clock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { formatTime12h, parseTimeInput, timeOptions } from "@/lib/datetime";

interface TimePickerProps {
	/** "HH:mm" (24h) */
	value: string;
	onChange: (value: string) => void;
	/** "HH:mm" — options at or before this are disabled. */
	minTime?: string;
	stepMin?: number;
	disabled?: boolean;
	ariaLabel?: string;
}

export function TimePicker({
	value,
	onChange,
	minTime,
	stepMin = 15,
	disabled,
	ariaLabel = "Pick a time",
}: TimePickerProps) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(() => formatTime12h(value));
	const triggerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Keep the visible text in sync with the value when not actively editing.
	useEffect(() => {
		if (!open) setDraft(formatTime12h(value));
	}, [value, open]);

	const options = useMemo(() => timeOptions(stepMin), [stepMin]);

	const commit = (raw: string) => {
		const parsed = parseTimeInput(raw);
		if (parsed && (!minTime || parsed > minTime)) {
			onChange(parsed);
			setDraft(formatTime12h(parsed));
		} else {
			setDraft(formatTime12h(value)); // revert invalid input
		}
		setOpen(false);
	};

	const select = (hhmm: string) => {
		onChange(hhmm);
		setDraft(formatTime12h(hhmm));
		setOpen(false);
	};

	return (
		<>
			<div
				ref={triggerRef}
				className={`flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus-within:ring-2 focus-within:ring-primary/50 ${
					disabled ? "opacity-50" : ""
				}`}
			>
				<Clock className="h-4 w-4 shrink-0 text-gray-400" />
				<input
					ref={inputRef}
					value={draft}
					disabled={disabled}
					aria-label={ariaLabel}
					onFocus={() => setOpen(true)}
					onClick={() => setOpen(true)}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit(draft);
						}
					}}
					onBlur={() => commit(draft)}
					className="w-full bg-transparent outline-none placeholder:text-gray-400"
					placeholder="e.g. 4:00 PM"
				/>
			</div>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => commit(draft)}
				width={180}
				maxHeight={260}
				ariaLabel={ariaLabel}
			>
				<div className="py-1">
					{options.map((opt) => {
						const isDisabled = minTime ? opt <= minTime : false;
						const isSelected = opt === value;
						return (
							<button
								key={opt}
								type="button"
								disabled={isDisabled}
								// Prevent the input's blur from firing before the click.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => select(opt)}
								className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
									isDisabled
										? "cursor-not-allowed text-gray-300"
										: isSelected
											? "bg-primary/10 font-medium text-primary"
											: "text-gray-700 hover:bg-gray-100"
								}`}
							>
								{formatTime12h(opt)}
							</button>
						);
					})}
				</div>
			</AnchoredPopover>
		</>
	);
}
