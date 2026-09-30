import { type PointerEvent, useCallback, useEffect, useRef } from "react";

const DEFAULT_DELAY_MS = 450;
/** A finger that drifts further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Touch long-press, the phone equivalent of hovering a message for its menu.
 *
 * Touch only (`pointerType === "touch"`): a mouse keeps its hover menu and
 * right-click. Cancels on movement past a small tolerance, lift, cancel or any
 * scroll, so scrolling a thread never opens the sheet. `onContextMenu` is
 * returned so the OS text-selection callout doesn't fire on the same press.
 */
export function useLongPress(
	onLongPress: (() => void) | undefined,
	delayMs = DEFAULT_DELAY_MS,
) {
	const timer = useRef<number | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const fired = useRef(false);

	const clear = useCallback(() => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		origin.current = null;
	}, []);

	useEffect(() => {
		if (!onLongPress) return;
		window.addEventListener("scroll", clear, true);
		return () => {
			window.removeEventListener("scroll", clear, true);
			clear();
		};
	}, [onLongPress, clear]);

	const onPointerDown = useCallback(
		(event: PointerEvent) => {
			if (!onLongPress || event.pointerType !== "touch") return;
			fired.current = false;
			origin.current = { x: event.clientX, y: event.clientY };
			timer.current = window.setTimeout(() => {
				timer.current = null;
				fired.current = true;
				navigator.vibrate?.(10);
				onLongPress();
			}, delayMs);
		},
		[onLongPress, delayMs],
	);

	const onPointerMove = useCallback(
		(event: PointerEvent) => {
			if (!origin.current) return;
			const dx = event.clientX - origin.current.x;
			const dy = event.clientY - origin.current.y;
			if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) clear();
		},
		[clear],
	);

	const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
		if (fired.current || timer.current !== null) event.preventDefault();
	}, []);

	if (!onLongPress) return {};
	return {
		onPointerDown,
		onPointerMove,
		onPointerUp: clear,
		onPointerCancel: clear,
		onPointerLeave: clear,
		onContextMenu,
	};
}
