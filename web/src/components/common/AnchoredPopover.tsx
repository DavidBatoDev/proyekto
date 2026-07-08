/**
 * A headless popover anchored to a trigger element and portaled to <body>, so
 * it escapes `overflow`/`backdrop-filter` containing blocks (e.g. a scrolling
 * modal). Positioning is clamped to the viewport and re-placed on scroll/resize;
 * it closes on outside-pointer or Escape. The positioning logic is lifted from
 * the roadmap DueDatePicker, generalized for reuse by the meeting date/time and
 * timezone pickers.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;

interface AnchoredPopoverProps {
	anchorRef: React.RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	children: React.ReactNode;
	/** Fixed width in px; defaults to matching the anchor's width. */
	width?: number;
	/** Max height used for flip-above decisions and as a CSS cap (default 340). */
	maxHeight?: number;
	/** Align the popover to the anchor's "left" (default) or "right" edge. */
	align?: "left" | "right";
	ariaLabel?: string;
	className?: string;
}

export function AnchoredPopover({
	anchorRef,
	open,
	onClose,
	children,
	width,
	maxHeight = 340,
	align = "left",
	ariaLabel,
	className,
}: AnchoredPopoverProps) {
	const popoverRef = useRef<HTMLDivElement>(null);
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);

	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const anchor = anchorRef.current;
			if (!anchor) return;
			const rect = anchor.getBoundingClientRect();
			const w = width ?? rect.width;
			let left = align === "right" ? rect.right - w : rect.left;
			left = Math.max(
				VIEWPORT_MARGIN,
				Math.min(left, window.innerWidth - w - VIEWPORT_MARGIN),
			);
			// Prefer opening below; flip above when there isn't room.
			const spaceBelow = window.innerHeight - rect.bottom;
			const top =
				spaceBelow < maxHeight + VIEWPORT_MARGIN
					? Math.max(VIEWPORT_MARGIN, rect.top - 6 - maxHeight)
					: rect.bottom + 6;
			setCoords({ top, left, width: w });
		};
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [open, anchorRef, width, maxHeight, align]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const path = e.composedPath();
			if (
				(popoverRef.current && path.includes(popoverRef.current)) ||
				(anchorRef.current && path.includes(anchorRef.current))
			) {
				return;
			}
			onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, onClose, anchorRef]);

	if (!open || !coords) return null;

	return createPortal(
		<div
			ref={popoverRef}
			role="dialog"
			aria-label={ariaLabel}
			style={{
				position: "fixed",
				top: coords.top,
				left: coords.left,
				width: coords.width,
				maxHeight,
				zIndex: 1100,
			}}
			className={
				className ??
				"overflow-auto rounded-xl border border-gray-100 bg-white shadow-2xl"
			}
		>
			{children}
		</div>,
		document.body,
	);
}
