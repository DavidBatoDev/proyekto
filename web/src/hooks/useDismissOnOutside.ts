import { type RefObject, useEffect } from "react";

/**
 * Close an open inline editor when the pointer goes somewhere else, or on
 * Escape.
 *
 * On the document rather than via blur, because a toolbar button lives inside
 * the block but outside the editable node — a blur handler would close the
 * editor on every click of it. Extracted from the brief editor so the two
 * click-to-edit surfaces (a brief section, a service section) cannot drift
 * apart on the fiddly parts: the portal exception below took a bug to find.
 */
export function useDismissOnOutside(
	active: boolean,
	region: RefObject<HTMLElement | null>,
	onDismiss: () => void,
) {
	useEffect(() => {
		if (!active) return;

		const onPointerDown = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			// A dialog opened from the toolbar (link, image) renders in a portal,
			// outside this subtree; closing under it would throw away the selection
			// it is about to act on.
			if (target instanceof Element && target.closest("[role='dialog']"))
				return;
			if (!region.current?.contains(target)) onDismiss();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss();
		};

		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [active, onDismiss, region]);
}
