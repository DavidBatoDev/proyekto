import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface DropdownOption {
	value: string;
	label: string;
}

interface DropdownProps {
	value: string;
	onChange: (value: string) => void;
	options: DropdownOption[];
	disabled?: boolean;
	placeholder?: string;
	className?: string;
	id?: string;
	ariaLabel?: string;
}

/**
 * A custom select — a styled trigger button plus a popover listbox — replacing
 * the native `<select>` everywhere the finance surfaces render one. Native
 * selects render as a cramped OS control that reads as un-editable and truncates
 * long option labels ("Hourly (approved…"); this one owns its own chrome, so the
 * value is legible, the affordance is obviously clickable, and it matches the
 * app's other popovers (click-outside + AnimatePresence, theme tokens).
 */
export function Dropdown({
	value,
	onChange,
	options,
	disabled,
	placeholder = "Select…",
	className,
	id,
	ariaLabel,
}: DropdownProps) {
	const generatedId = useId();
	const listId = id ?? generatedId;
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState<number>(-1);
	const rootRef = useRef<HTMLDivElement>(null);

	const selected = options.find((o) => o.value === value) ?? null;
	const selectedIndex = options.findIndex((o) => o.value === value);

	// Close on outside click or Escape.
	useEffect(() => {
		if (!open) return;
		const onPointer = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);

	const openMenu = () => {
		if (disabled) return;
		setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
		setOpen(true);
	};

	const commit = (index: number) => {
		const option = options[index];
		if (!option) return;
		onChange(option.value);
		setOpen(false);
	};

	const onTriggerKeyDown = (e: React.KeyboardEvent) => {
		if (disabled) return;
		if (!open) {
			if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openMenu();
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((i) => Math.min(options.length - 1, i + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((i) => Math.max(0, i - 1));
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			commit(activeIndex);
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		} else if (e.key === "Home") {
			e.preventDefault();
			setActiveIndex(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setActiveIndex(options.length - 1);
		}
	};

	return (
		<div ref={rootRef} className={`relative ${className ?? ""}`}>
			<button
				type="button"
				id={listId}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={ariaLabel}
				onClick={() => (open ? setOpen(false) : openMenu())}
				onKeyDown={onTriggerKeyDown}
				className="flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm text-card-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-70"
			>
				<span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
					{selected ? selected.label : placeholder}
				</span>
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
						open ? "rotate-180" : ""
					}`}
				/>
			</button>

			<AnimatePresence>
				{open && (
					<motion.ul
						role="listbox"
						aria-activedescendant={
							activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
						}
						initial={{ opacity: 0, y: -4 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						transition={{ duration: 0.14, ease: "easeOut" }}
						className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
					>
						{options.map((option, index) => {
							const isSelected = option.value === value;
							const isActive = index === activeIndex;
							return (
								<li key={option.value}>
									<button
										type="button"
										id={`${listId}-opt-${index}`}
										role="option"
										aria-selected={isSelected}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => commit(index)}
										className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
											isActive
												? "bg-primary/10 text-foreground"
												: "text-foreground hover:bg-muted"
										}`}
									>
										<span className="truncate">{option.label}</span>
										{isSelected && (
											<Check className="h-3.5 w-3.5 shrink-0 text-primary" />
										)}
									</button>
								</li>
							);
						})}
					</motion.ul>
				)}
			</AnimatePresence>
		</div>
	);
}
