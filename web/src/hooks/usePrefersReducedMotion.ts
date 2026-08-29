import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the viewer has asked for reduced motion.
 *
 * The CSS side of this is already handled by `motion-reduce:` utilities; this
 * is for the cases CSS cannot reach — a JS timer that would move the page on
 * its own, like the hero carousel's auto-advance.
 *
 * Starts `false` and corrects in an effect rather than reading the query during
 * render, so the first client render matches what the markup would have been
 * anywhere it is prerendered.
 */
export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const list = window.matchMedia(QUERY);
		setReduced(list.matches);
		const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
		list.addEventListener("change", onChange);
		return () => list.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
