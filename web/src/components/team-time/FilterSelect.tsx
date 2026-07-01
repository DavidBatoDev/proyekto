import { Check, ChevronDown } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

export interface FilterSelectOption {
	value: string;
	label: string;
}

interface FilterSelectProps {
	value: string;
	options: FilterSelectOption[];
	onChange: (value: string) => void;
	icon?: ReactNode;
	placeholder?: string;
	/** Rough max height for the dropdown list before it scrolls. */
	menuMaxHeight?: number;
}

/**
 * Lightweight custom dropdown to replace native <select> in the team-time
 * filters. Renders its menu in a portal so it escapes overflow/clipping, and
 * mirrors the app's rounded/bordered control styling.
 */
export function FilterSelect({
	value,
	options,
	onChange,
	icon,
	placeholder = "Select",
	menuMaxHeight = 288,
}: FilterSelectProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuStyle, setMenuStyle] = useState<{
		left: number;
		top: number;
		width: number;
	} | null>(null);

	const selected = options.find((o) => o.value === value);
	const label = selected?.label ?? placeholder;

	const positionMenu = () => {
		const el = triggerRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setMenuStyle({
			left: rect.left,
			top: rect.bottom + 4,
			width: Math.max(rect.width, 200),
		});
	};

	useLayoutEffect(() => {
		if (open) positionMenu();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDocPointer = (e: MouseEvent) => {
			if (
				!triggerRef.current?.contains(e.target as Node) &&
				!menuRef.current?.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const onReflow = () => positionMenu();
		document.addEventListener("mousedown", onDocPointer);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", onReflow);
		window.addEventListener("scroll", onReflow, true);
		return () => {
			document.removeEventListener("mousedown", onDocPointer);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", onReflow);
			window.removeEventListener("scroll", onReflow, true);
		};
	}, [open]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={`inline-flex items-center gap-2 rounded-lg border bg-white py-1.5 pl-2.5 pr-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 ${
					open
						? "border-sky-400 ring-1 ring-sky-200"
						: "border-slate-200"
				}`}
			>
				{icon && <span className="text-slate-400">{icon}</span>}
				<span className="max-w-40 truncate">{label}</span>
				<ChevronDown
					className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
						open ? "rotate-180" : ""
					}`}
				/>
			</button>

			{open &&
				menuStyle &&
				createPortal(
					<div
						ref={menuRef}
						role="listbox"
						style={{
							position: "fixed",
							left: menuStyle.left,
							top: menuStyle.top,
							width: menuStyle.width,
							maxHeight: menuMaxHeight,
						}}
						className="hide-scrollbar z-50 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
					>
						{options.map((opt) => {
							const active = opt.value === value;
							return (
								<button
									key={opt.value}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => {
										onChange(opt.value);
										setOpen(false);
									}}
									className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
										active
											? "bg-sky-50 font-semibold text-sky-700"
											: "text-slate-700 hover:bg-slate-50"
									}`}
								>
									<Check
										className={`h-3.5 w-3.5 shrink-0 ${
											active ? "text-sky-600" : "text-transparent"
										}`}
									/>
									<span className="truncate">{opt.label}</span>
								</button>
							);
						})}
						{options.length === 0 && (
							<div className="px-3 py-2 text-xs italic text-slate-400">
								No options
							</div>
						)}
					</div>,
					document.body,
				)}
		</>
	);
}
