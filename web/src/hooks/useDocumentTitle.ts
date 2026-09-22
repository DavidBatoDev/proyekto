import { useEffect } from "react";

const SUFFIX = "Proyekto";

/**
 * Sets the page title, and restores the previous one on unmount.
 *
 * The app has no head manager — `index.html` carries one static title for the
 * whole SPA — which is survivable for an app behind a login and not survivable
 * for a docs site people arrive at from a search engine. This is the smallest
 * thing that fixes it without adding a dependency.
 *
 * Pass `null` to leave the title alone.
 */
export function useDocumentTitle(title: string | null): void {
	useEffect(() => {
		if (!title) return;
		const previous = document.title;
		document.title = title === SUFFIX ? title : `${title} · ${SUFFIX}`;
		return () => {
			document.title = previous;
		};
	}, [title]);
}
