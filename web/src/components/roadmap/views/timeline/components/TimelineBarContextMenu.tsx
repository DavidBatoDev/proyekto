import { CalendarCheck, CalendarX, Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TimelineRow } from "../model/rows";

export interface BarContextMenuState {
	row: TimelineRow;
	x: number;
	y: number;
}

interface TimelineBarContextMenuProps {
	state: BarContextMenuState;
	canEditDates: boolean;
	onEdit: (row: TimelineRow) => void;
	onClearDates: (row: TimelineRow) => void;
	onClose: () => void;
	/** Set only when this row starts before a predecessor allows. */
	conflictFixDate?: string | null;
	onFixSchedule?: (row: TimelineRow) => void;
}

const MENU_WIDTH = 200;

/**
 * Right-click menu for a bar. Positioned at the pointer and clamped to the
 * viewport so a bar near the right or bottom edge still gets a usable menu.
 */
export const TimelineBarContextMenu = ({
	state,
	canEditDates,
	onEdit,
	onClearDates,
	onClose,
	conflictFixDate,
	onFixSchedule,
}: TimelineBarContextMenuProps) => {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ x: state.x, y: state.y });

	useLayoutEffect(() => {
		const el = menuRef.current;
		const height = el?.offsetHeight ?? 0;
		setPosition({
			x: Math.min(state.x, window.innerWidth - MENU_WIDTH - 8),
			y: Math.min(state.y, window.innerHeight - height - 8),
		});
	}, [state.x, state.y]);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) onClose();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		// Any scroll moves the bar out from under the menu, so dismiss it.
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onClose, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onClose, true);
		};
	}, [onClose]);

	const label = state.row.kind === "epic" ? "epic" : "feature";

	return (
		<div
			ref={menuRef}
			data-no-pan="true"
			role="menu"
			className="fixed z-[60] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-(--app-shadow-lg)"
			style={{ left: position.x, top: position.y, width: MENU_WIDTH }}
		>
			<button
				type="button"
				role="menuitem"
				onClick={() => {
					onEdit(state.row);
					onClose();
				}}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-popover-foreground hover:bg-muted"
			>
				<Pencil className="h-3.5 w-3.5 text-muted-foreground" />
				Edit {label}
			</button>

			{canEditDates && conflictFixDate && onFixSchedule && (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						onFixSchedule(state.row);
						onClose();
					}}
					className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-warning hover:bg-warning/10"
				>
					<CalendarCheck className="h-3.5 w-3.5" />
					Fix schedule
				</button>
			)}

			{canEditDates && (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						onClearDates(state.row);
						onClose();
					}}
					className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10"
				>
					<CalendarX className="h-3.5 w-3.5" />
					Remove from timeline
				</button>
			)}
		</div>
	);
};
