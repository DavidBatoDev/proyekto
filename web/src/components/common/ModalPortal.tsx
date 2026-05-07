import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a fullscreen modal escape-hatched to document.body.
 *
 * Why: some ancestors in our layout chain (e.g. AppSurfaceCard) apply
 * `backdrop-filter` / `filter`, which per the CSS spec creates a
 * containing block for `position: fixed` descendants. A naive modal
 * with `inset-0` would then be clipped to the card edges instead of
 * the viewport. Portaling to body sidesteps the trap.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
	if (typeof document === "undefined") return null;
	return createPortal(children, document.body);
}
