/**
 * A dialog or menu is open: its keys belong to it. Used by the page-wide
 * keyboard shortcuts (the header search's "/", the Time week keys).
 *
 * Closed overlays that stay mounted don't count: the app header's mobile nav
 * drawer is always in the DOM as an `inert` `role="dialog"`, and anything
 * `hidden` or `aria-hidden` isn't open either.
 *
 * It lives in `lib/` so the header (on every page) doesn't pull the Time page's
 * components into the main bundle.
 */
export function overlayOpen(): boolean {
	if (typeof document === "undefined") return false;
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			"[role='dialog'], [role='alertdialog'], [role='menu']",
		),
	).some(
		// `closest` checks the element itself too.
		(el) => el.closest("[inert], [hidden], [aria-hidden='true']") === null,
	);
}
