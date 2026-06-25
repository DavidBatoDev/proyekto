import { useEffect, useState } from "react";

/**
 * Returns true while the viewport is below the given breakpoint.
 *
 * Defaults to 768px so it matches Tailwind's `md` breakpoint — i.e. it is
 * `true` for the same screens that `md:hidden` hides. Unlike the CSS-only
 * pattern, this is a JS check so callers can conditionally *unmount* heavy
 * components (e.g. the XYFlow roadmap canvas) on small screens rather than
 * just hiding them with `display:none`.
 */
export function useIsMobile(maxWidth = 767): boolean {
	const query = `(max-width: ${maxWidth}px)`;
	const [isMobile, setIsMobile] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia(query);
		const handleChange = (event: MediaQueryListEvent) => {
			setIsMobile(event.matches);
		};
		// Sync immediately in case the query changed between render and effect.
		setIsMobile(mql.matches);
		mql.addEventListener("change", handleChange);
		return () => mql.removeEventListener("change", handleChange);
	}, [query]);

	return isMobile;
}
