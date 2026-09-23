import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ModalPortal } from "@/components/common/ModalPortal";
import { cn } from "@/lib/utils";

/**
 * The slide-in navigation drawer for the public pages.
 *
 * Same behaviour as the app shell's `MobileNavDrawer` — portaled to <body> so a
 * `backdrop-filter` ancestor cannot clip the fixed overlay, scroll-locked,
 * Escape-closable, and dismissed on navigation so tapping a link both moves and
 * closes. It is a separate component rather than a prop on that one because
 * that drawer is welded to `SidebarContent` and to the dark `sidebar-*` tokens;
 * this one takes children and is drawn in ordinary theme tokens, so it reads
 * correctly on a white marketing page.
 *
 * `children` mount only after the first open, so a drawer nobody taps costs
 * nothing on first paint — which matters most on the docs rail, where the
 * children are ten sections and forty-seven links.
 */
export function SiteDrawer({
	isOpen,
	onClose,
	title,
	children,
	side = "left",
	className,
}: {
	isOpen: boolean;
	onClose: () => void;
	/** Announced to screen readers, and shown beside the brand mark. */
	title: string;
	children: ReactNode;
	side?: "left" | "right";
	className?: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		if (isOpen) setMounted(true);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isOpen, onClose]);

	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const previousPath = useRef(pathname);
	useEffect(() => {
		if (previousPath.current !== pathname) {
			previousPath.current = pathname;
			if (isOpen) onClose();
		}
	}, [pathname, isOpen, onClose]);

	return (
		<ModalPortal>
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				onClick={onClose}
				className={cn(
					"fixed inset-0 z-[60] bg-foreground/30 backdrop-blur-sm transition-opacity duration-200",
					isOpen ? "opacity-100" : "pointer-events-none opacity-0",
				)}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				inert={!isOpen}
				className={cn(
					"fixed inset-y-0 z-[61] flex w-[310px] max-w-[88vw] flex-col bg-card pt-safe pb-safe shadow-2xl transition-transform duration-200 ease-out",
					side === "left" ? "left-0" : "right-0",
					isOpen
						? "translate-x-0"
						: side === "left"
							? "-translate-x-full"
							: "translate-x-full",
					className,
				)}
			>
				<div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
					<div className="flex items-center gap-2.5">
						<BrandMark variant="lockup" className="h-7" />
						<span className="text-sm font-semibold text-foreground">
							{title}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close menu"
						className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-5 w-5" aria-hidden />
					</button>
				</div>
				<div className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
					{mounted ? children : null}
				</div>
			</div>
		</ModalPortal>
	);
}
