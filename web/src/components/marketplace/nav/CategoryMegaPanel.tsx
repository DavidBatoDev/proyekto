import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MarketplaceCategoryNav } from "@/types/marketplace-taxonomy";
import {
	clampPanelLeft,
	columnize,
	MEGA_PANEL_INSET,
	MEGA_VIEWPORT_MARGIN,
	resolvePanelWidth,
} from "./categoryMegaMenu";

interface CategoryMegaPanelProps {
	category: MarketplaceCategoryNav;
	triggerRect: DOMRect;
	panelId: string;
	triggerId: string;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
	onRequestClose: () => void;
}

const COLUMN_COUNT = 3;

export function CategoryMegaPanel({
	category,
	triggerRect,
	panelId,
	triggerId,
	onMouseEnter,
	onMouseLeave,
	onRequestClose,
}: CategoryMegaPanelProps) {
	const panelRef = useRef<HTMLDivElement | null>(null);
	const reduceMotion = useReducedMotion();
	const [position, setPosition] = useState(() => ({
		top: triggerRect.bottom,
		left: triggerRect.left,
		width: 0,
		maxHeight: 0,
	}));

	// Measure, then clamp - the same order ProjectSidebarLink uses. Reading the
	// viewport during layout avoids a frame where the panel sits off-screen.
	useLayoutEffect(() => {
		const width = resolvePanelWidth(window.innerWidth);
		setPosition({
			width,
			// No gap: a downward panel separated from its trigger leaves a dead
			// strip the pointer crosses on the way in. The close delay covers
			// diagonal travel, not a literal hole.
			top: triggerRect.bottom,
			left: clampPanelLeft(
				triggerRect.left - MEGA_PANEL_INSET,
				width,
				window.innerWidth,
			),
			maxHeight: window.innerHeight - triggerRect.bottom - MEGA_VIEWPORT_MARGIN,
		});
	}, [triggerRect]);

	// A fixed panel anchored to a captured rect detaches from its trigger as
	// soon as the page moves, so close instead of trying to track it.
	useEffect(() => {
		const close = () => onRequestClose();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onRequestClose();
		};
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onRequestClose]);

	if (typeof document === "undefined") return null;

	const columns = columnize(category.subcategories, COLUMN_COUNT);

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={panelRef}
				id={panelId}
				role="menu"
				aria-labelledby={triggerId}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
				initial={reduceMotion ? false : { opacity: 0, y: -4 }}
				animate={{ opacity: 1, y: 0 }}
				exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
				transition={{ duration: reduceMotion ? 0 : 0.15, ease: "easeOut" }}
				style={{
					top: position.top,
					left: position.left,
					width: position.width,
					maxHeight: position.maxHeight,
				}}
				// z-60 clears the fixed app header at z-50; without it the panel
				// renders underneath its own category bar.
				className="fixed z-[60] overflow-y-auto rounded-b-xl border border-border border-t-0 bg-card p-5 shadow-xl"
			>
				<div className="flex items-baseline justify-between gap-4">
					<div className="min-w-0">
						<p className="text-[14px] font-semibold text-foreground">
							{category.name}
						</p>
						{category.description && (
							<p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
								{category.description}
							</p>
						)}
					</div>
					<Link
						to="/marketplace/category/$categorySlug"
						params={{ categorySlug: category.slug }}
						role="menuitem"
						preload="intent"
						className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
					>
						View all
						<ArrowRight className="h-3.5 w-3.5" />
					</Link>
				</div>

				<div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
					{columns.map((column) => (
						<ul key={column[0]?.id ?? "empty"} className="min-w-0">
							{column.map((subcategory) => (
								<li key={subcategory.id}>
									<Link
										to="/marketplace/category/$categorySlug/$subcategorySlug"
										params={{
											categorySlug: category.slug,
											subcategorySlug: subcategory.slug,
										}}
										role="menuitem"
										preload="intent"
										className="block truncate rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									>
										{subcategory.name}
									</Link>
								</li>
							))}
						</ul>
					))}
				</div>
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}
