// web/src/components/time/page/TimeMobileFab.tsx
//
// Below 640 px the Time page's Start timer / Add time move to a floating
// action button (ux.md › The Time Page › Mobile): one round button in the
// bottom corner that opens a two-item menu.
//
// Keyboard: Enter/Space or ArrowUp/ArrowDown open the menu and focus an item;
// arrows move, Home/End jump, Escape closes and returns focus to the button,
// Tab closes. A click outside closes it too, and so does the Android back
// button (lib/backStack.ts), before it would leave the page.

import { Play, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useBackHandler } from "@/lib/backStack";
import { cn } from "@/lib/utils";

export const TIME_FAB_COPY = {
	trigger: "Track time",
	startTimer: "Start timer",
	addTime: "Add time",
} as const;

export interface TimeMobileFabProps {
	onStartTimer: () => void;
	onAddTime: () => void;
	/** Visible below 640 px only (default). Tests pass `""` to see it anyway. */
	visibilityClassName?: string;
	className?: string;
}

export function TimeMobileFab({
	onStartTimer,
	onAddTime,
	visibilityClassName = "sm:hidden",
	className,
}: TimeMobileFabProps) {
	const [open, setOpen] = useState(false);
	const menuId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const [focusIndex, setFocusIndex] = useState(0);

	// Focus the chosen item while open.
	useEffect(() => {
		if (open) itemRefs.current[focusIndex]?.focus();
	}, [open, focusIndex]);

	// A click outside closes the menu.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (
				target &&
				!menuRef.current?.contains(target) &&
				!triggerRef.current?.contains(target)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const close = (returnFocus: boolean) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	};
	useBackHandler(open, () => close(false));
	const openAt = (index: number) => {
		setFocusIndex(index);
		setOpen(true);
	};
	const choose = (action: () => void) => {
		setOpen(false);
		action();
	};

	const items = [
		{ label: TIME_FAB_COPY.startTimer, icon: Play, action: onStartTimer },
		{ label: TIME_FAB_COPY.addTime, icon: Plus, action: onAddTime },
	];

	return (
		<div
			className={cn(
				"fixed right-4 z-40 flex flex-col items-end gap-2",
				visibilityClassName,
				className,
			)}
			style={{ bottom: "calc(1.25rem + var(--safe-bottom, 0px))" }}
			data-testid="time-fab"
		>
			{open ? (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label={TIME_FAB_COPY.trigger}
					className="min-w-[11rem] overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg"
					onKeyDown={(event) => {
						const last = items.length - 1;
						if (event.key === "Escape") {
							event.preventDefault();
							close(true);
						} else if (event.key === "ArrowDown") {
							event.preventDefault();
							setFocusIndex((i) => (i >= last ? 0 : i + 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setFocusIndex((i) => (i <= 0 ? last : i - 1));
						} else if (event.key === "Home") {
							event.preventDefault();
							setFocusIndex(0);
						} else if (event.key === "End") {
							event.preventDefault();
							setFocusIndex(last);
						} else if (event.key === "Tab") {
							setOpen(false);
						}
					}}
				>
					{items.map((item, index) => (
						<button
							key={item.label}
							ref={(el) => {
								itemRefs.current[index] = el;
							}}
							type="button"
							role="menuitem"
							tabIndex={index === focusIndex ? 0 : -1}
							onClick={() => choose(item.action)}
							className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
						>
							<item.icon className="h-4 w-4 text-primary" aria-hidden="true" />
							{item.label}
						</button>
					))}
				</div>
			) : null}
			<button
				ref={triggerRef}
				type="button"
				aria-label={TIME_FAB_COPY.trigger}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => (open ? close(false) : openAt(0))}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						openAt(0);
					} else if (event.key === "ArrowUp") {
						event.preventDefault();
						openAt(items.length - 1);
					}
				}}
				className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
			>
				{open ? (
					<X className="h-6 w-6" aria-hidden="true" />
				) : (
					<Plus className="h-6 w-6" aria-hidden="true" />
				)}
			</button>
		</div>
	);
}
