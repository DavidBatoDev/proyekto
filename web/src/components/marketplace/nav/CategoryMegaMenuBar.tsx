import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MarketplaceCategoryNav } from "@/types/marketplace-taxonomy";
import { CategoryMegaPanel } from "./CategoryMegaPanel";
import { MEGA_CLOSE_DELAY_MS, nextTriggerIndex } from "./categoryMegaMenu";

interface CategoryMegaMenuBarProps {
	categories: MarketplaceCategoryNav[];
	/**
	 * Categories the viewer named in the marketplace intake survey, marked with a
	 * dot. Purely a marker: every category stays present, in the same order, and
	 * equally clickable. The strip is the taxonomy, not a personalized list, and
	 * reordering or hiding entries here would make the product's own structure
	 * look different to different people.
	 */
	highlightSlugs?: readonly string[];
}

/**
 * The marketplace category strip, with a hover mega-menu.
 *
 * Hover is strictly additive: each trigger is a real `<Link>` to the category
 * page, so the whole taxonomy stays reachable if the panel never opens - on
 * touch, with a keyboard, or with JavaScript half-loaded.
 *
 * The open panel and its close timer are owned here rather than per-trigger, so
 * sliding from one category to the next swaps panels instead of closing one and
 * reopening another.
 */
export function CategoryMegaMenuBar({
	categories,
	highlightSlugs,
}: CategoryMegaMenuBarProps) {
	const baseId = useId();
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
	const [focusIndex, setFocusIndex] = useState(0);
	const [hoverCapable, setHoverCapable] = useState(false);

	const closeTimer = useRef<number | null>(null);
	const triggerRefs = useRef<(HTMLAnchorElement | null)[]>([]);
	/**
	 * Dismissing with Escape returns focus to the trigger, and focusing a trigger
	 * opens its panel - so without this the menu would reopen the instant it was
	 * dismissed. Only the restoring focus is suppressed; hovering still opens.
	 */
	const suppressOpenOnFocus = useRef(false);

	// Coarse pointers get no panel at all: a hover menu on touch either needs a
	// double-tap to follow the link or swallows the first tap entirely.
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const query = window.matchMedia("(hover: hover) and (pointer: fine)");
		const sync = () => setHoverCapable(query.matches);
		sync();
		query.addEventListener?.("change", sync);
		return () => query.removeEventListener?.("change", sync);
	}, []);

	const cancelClose = useCallback(() => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
	}, []);

	const close = useCallback(() => {
		cancelClose();
		setOpenIndex(null);
		setTriggerRect(null);
	}, [cancelClose]);

	const dismiss = useCallback(
		(index: number) => {
			suppressOpenOnFocus.current = true;
			close();
			triggerRefs.current[index]?.focus();
		},
		[close],
	);

	const scheduleClose = useCallback(() => {
		cancelClose();
		closeTimer.current = window.setTimeout(close, MEGA_CLOSE_DELAY_MS);
	}, [cancelClose, close]);

	const open = useCallback(
		(index: number) => {
			if (!hoverCapable) return;
			cancelClose();
			const element = triggerRefs.current[index];
			if (element) setTriggerRect(element.getBoundingClientRect());
			setOpenIndex(index);
		},
		[cancelClose, hoverCapable],
	);

	useEffect(() => cancelClose, [cancelClose]);

	const onKeyDown = (event: React.KeyboardEvent, index: number) => {
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			event.preventDefault();
			const next = nextTriggerIndex(
				index,
				event.key === "ArrowRight" ? 1 : -1,
				categories.length,
			);
			setFocusIndex(next);
			triggerRefs.current[next]?.focus();
			return;
		}
		if (event.key === "Escape") {
			dismiss(index);
			return;
		}
		if (event.key === "ArrowDown" && openIndex === index) {
			event.preventDefault();
			// Hand focus to the panel's first item so the menu is traversable
			// without a pointer.
			const panel = document.getElementById(`${baseId}-panel-${index}`);
			panel?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
		}
	};

	if (categories.length === 0) return null;

	return (
		<nav
			aria-label="Marketplace categories"
			className="border-b border-border bg-card"
			onMouseLeave={scheduleClose}
		>
			{/* Full-bleed and evenly distributed, rather than centred inside the
			    page's max-width. The strip is chrome attached to the header above
			    it, not page content, so inheriting the content column left it
			    inset from a header that runs edge to edge. `justify-between` only
			    applies once there is room for it — below `lg` the row keeps its
			    natural width and scrolls, because spreading six items across a
			    phone would strand them at the two edges. */}
			<div className="flex w-full gap-6 overflow-x-auto px-4 sm:px-6 lg:justify-between lg:px-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{categories.map((category, index) => {
					const triggerId = `${baseId}-trigger-${index}`;
					const panelId = `${baseId}-panel-${index}`;
					const isOpen = openIndex === index;

					return (
						<Link
							key={category.id}
							id={triggerId}
							ref={(element: HTMLAnchorElement | null) => {
								triggerRefs.current[index] = element;
							}}
							to="/marketplace/category/$categorySlug"
							params={{ categorySlug: category.slug }}
							preload="intent"
							aria-haspopup={hoverCapable ? "menu" : undefined}
							aria-expanded={hoverCapable ? isOpen : undefined}
							aria-controls={isOpen ? panelId : undefined}
							tabIndex={index === focusIndex ? 0 : -1}
							onMouseEnter={() => open(index)}
							onFocus={() => {
								setFocusIndex(index);
								if (suppressOpenOnFocus.current) {
									suppressOpenOnFocus.current = false;
									return;
								}
								open(index);
							}}
							onKeyDown={(event) => onKeyDown(event, index)}
							// The vertical padding lives on the link, not the row, so the
							// underline can sit on the bar's own bottom edge and the whole
							// strip height stays a click target rather than just the text.
							className="relative whitespace-nowrap py-3 text-[13px] text-muted-foreground transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors hover:text-foreground hover:after:bg-border aria-expanded:text-foreground"
							activeProps={{
								className:
									"font-semibold text-foreground after:bg-foreground hover:after:bg-foreground",
							}}
							// A sub-category page keeps its parent category marked, so the
							// strip says where you are rather than going blank one level in.
							activeOptions={{ exact: false }}
						>
							{highlightSlugs?.includes(category.slug) && (
								<span
									aria-hidden="true"
									className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
								/>
							)}
							{category.name}
						</Link>
					);
				})}
			</div>

			{openIndex !== null && triggerRect && (
				<CategoryMegaPanel
					category={categories[openIndex]}
					triggerRect={triggerRect}
					panelId={`${baseId}-panel-${openIndex}`}
					triggerId={`${baseId}-trigger-${openIndex}`}
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
					onRequestClose={() => dismiss(openIndex)}
				/>
			)}
		</nav>
	);
}
