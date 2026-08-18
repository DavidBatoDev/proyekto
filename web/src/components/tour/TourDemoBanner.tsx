/**
 * Safety rails for demo mode, mounted together.
 *
 * 1. A fixed bar pinned to the top of the viewport, so fixture projects are
 *    never mistaken for the user's real portfolio no matter how far down the
 *    dashboard they have scrolled.
 * 2. An always-available "Exit tour" button. Joyride's own controls can leave
 *    a replay half-open (ESC maps to "close", which in continuous mode just
 *    hides the tooltip and drops a beacon), so the way out cannot depend on
 *    Joyride's state.
 * 3. A capture-phase click guard, so a spotlit demo card can't navigate to a
 *    project id that doesn't exist. Joyride's overlay blocks stray clicks, but
 *    the highlighted element itself stays interactive by design.
 *
 * The bar renders through a portal on document.body: it has to clear the fixed
 * app header AND Joyride's overlay, and any transformed ancestor in the
 * dashboard tree would otherwise become its containing block and clip it.
 *
 * It does not overlay the app. Its measured height is published as
 * --tour-banner-h and the `tour-demo-active` body class shifts the fixed
 * header, the sticky sidebar and the shell padding down by exactly that much
 * (see styles.css), so the whole page moves instead of being covered.
 */

import { Info, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTourDemoControls } from "@/lib/tours/demo/TourDemoContext";
import { exitProductTour } from "./tourEvents";

/** One above the tour's own z-index, so the exit is never covered. */
const BANNER_Z_INDEX = 10_001;

export function TourDemoBanner() {
	const { active } = useTourDemoControls();
	const barRef = useRef<HTMLDivElement>(null);

	// Publish the bar's real height rather than a hardcoded one: the copy wraps
	// to two lines on narrow screens, and a stale constant would leave the
	// header either overlapped or floating.
	useLayoutEffect(() => {
		const { body } = document;
		if (!active) {
			body.classList.remove("tour-demo-active");
			body.style.removeProperty("--tour-banner-h");
			return;
		}

		body.classList.add("tour-demo-active");

		const bar = barRef.current;
		if (!bar) return;

		const publish = () =>
			body.style.setProperty("--tour-banner-h", `${bar.offsetHeight}px`);
		publish();

		const observer = new ResizeObserver(publish);
		observer.observe(bar);

		return () => {
			observer.disconnect();
			body.classList.remove("tour-demo-active");
			body.style.removeProperty("--tour-banner-h");
		};
	}, [active]);

	useEffect(() => {
		if (!active) return;

		const guard = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			// Let the tooltip's own controls through — it is rendered in a portal
			// outside the demo surface.
			if (target.closest(".react-joyride__tooltip")) return;
			// Same for this bar, which is portalled to the body.
			if (target.closest("[data-tour-exit]")) return;
			if (!target.closest("[data-tour-demo-root]")) return;
			event.preventDefault();
			event.stopPropagation();
		};

		// A second ESC affordance: Joyride consumes the first press to close the
		// step, so this listens on the surface and treats the key as "get me out".
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") exitProductTour();
		};

		document.addEventListener("click", guard, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("click", guard, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [active]);

	if (!active || typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={barRef}
			data-tour-exit
			style={{ zIndex: BANNER_Z_INDEX }}
			className="fixed inset-x-0 top-0 border-b border-primary/30 bg-primary text-primary-foreground shadow-md"
		>
			<div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
				<Info className="h-4 w-4 shrink-0" />
				<span className="min-w-0 flex-1 text-sm font-medium">
					Showing example data for this tour — your real workspace is untouched.
				</span>
				<button
					type="button"
					onClick={exitProductTour}
					className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-primary-foreground/40 px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/15"
				>
					<X className="h-3.5 w-3.5" />
					Exit tour
				</button>
			</div>
		</div>,
		document.body,
	);
}
