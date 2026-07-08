/**
 * Google-Calendar-style repeat selector: Does not repeat / Daily / Weekly on
 * ‹day› / Monthly / Annually / Every weekday / Custom… Emits an RFC-5545 rule
 * body (or null for no repeat). "Custom…" opens the recurrence builder dialog.
 */
import { ChevronDown, Repeat } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { presetsFor, rruleToPresetId, summarizeRRule } from "@/lib/recurrence";
import { RecurrenceBuilderDialog } from "./RecurrenceBuilderDialog";

interface RepeatDropdownProps {
	startDate: Date;
	value: string | null;
	onChange: (rrule: string | null) => void;
	disabled?: boolean;
}

export function RepeatDropdown({
	startDate,
	value,
	onChange,
	disabled,
}: RepeatDropdownProps) {
	const [open, setOpen] = useState(false);
	const [builderOpen, setBuilderOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const presets = useMemo(() => presetsFor(startDate), [startDate]);
	const presetId = useMemo(
		() => rruleToPresetId(value, startDate),
		[value, startDate],
	);

	const label = useMemo(() => {
		if (!value) return "Does not repeat";
		if (presetId !== "custom") {
			return presets.find((p) => p.id === presetId)?.label ?? "Custom";
		}
		return summarizeRRule(value, startDate);
	}, [value, presetId, presets, startDate]);

	const choose = (rrule: string | null) => {
		onChange(rrule);
		setOpen(false);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((p) => !p)}
				className={`flex w-full items-center gap-2 border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-left text-sm transition-colors focus:border-primary focus:outline-none ${
					disabled ? "cursor-not-allowed opacity-50" : ""
				}`}
			>
				<Repeat className="h-4 w-4 shrink-0 text-gray-400" />
				<span className="text-gray-800">{label}</span>
				<ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-400" />
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				maxHeight={320}
				ariaLabel="Repeat options"
			>
				<div className="py-1">
					{presets.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => {
								if (p.id === "custom") {
									setOpen(false);
									setBuilderOpen(true);
								} else {
									choose(p.rrule);
								}
							}}
							className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
								(p.id === "none" && !value) || (value && p.id === presetId)
									? "bg-primary/10 font-medium text-primary"
									: "text-gray-700 hover:bg-gray-100"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
			</AnchoredPopover>

			<RecurrenceBuilderDialog
				open={builderOpen}
				startDate={startDate}
				initialRrule={presetId === "custom" ? value : null}
				onClose={() => setBuilderOpen(false)}
				onSave={(rrule) => {
					setBuilderOpen(false);
					onChange(rrule);
				}}
			/>
		</>
	);
}
