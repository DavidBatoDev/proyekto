import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ModalPortal } from "@/components/common/ModalPortal";
import { SidebarContent } from "./sidebar/SidebarContent";

/**
 * Mobile slide-in navigation drawer (< lg). Triggered by the header
 * hamburger; renders the same `SidebarContent` as the desktop sidebar.
 *
 * Portaled to <body> via `ModalPortal` so backdrop-filter ancestors in the
 * layout chain can't clip the fixed overlay. Auto-closes on route change so
 * tapping any nav link both navigates and dismisses the drawer.
 */
export function MobileNavDrawer({
	isOpen,
	onClose,
}: {
	isOpen: boolean;
	onClose: () => void;
}) {
	// Only mount the (data-fetching) sidebar body once the drawer has first
	// been opened — keeps it off the desktop render path entirely.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		if (isOpen) setMounted(true);
	}, [isOpen]);

	// Lock body scroll while the drawer is open.
	useEffect(() => {
		if (!isOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [isOpen]);

	// Close on Escape.
	useEffect(() => {
		if (!isOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isOpen, onClose]);

	// Close on navigation (covers tapping any link inside the drawer).
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const prevPath = useRef(pathname);
	useEffect(() => {
		if (prevPath.current !== pathname) {
			prevPath.current = pathname;
			if (isOpen) onClose();
		}
	}, [pathname, isOpen, onClose]);

	return (
		<ModalPortal>
			<div
				aria-hidden="true"
				onClick={onClose}
				className={`fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
					isOpen ? "opacity-100" : "pointer-events-none opacity-0"
				}`}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Navigation"
				inert={!isOpen}
				className={`fixed inset-y-0 left-0 z-[61] flex w-[280px] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground pt-safe pb-safe shadow-xl transition-transform duration-200 ease-out lg:hidden ${
					isOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
					<div className="flex items-center gap-2">
						<BrandMark variant="mark" className="h-7" />
						<BrandMark variant="wordmark" className="h-4 text-slate-900" />
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close menu"
						className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
				{mounted ? <SidebarContent /> : null}
			</div>
		</ModalPortal>
	);
}
