import { useEffect, useRef } from "react";

/**
 * The Android back button, done the way native apps do it: close what is open
 * on top first, and only navigate back when nothing is.
 *
 * Without this, Capacitor maps the hardware back button straight onto WebView
 * history, so backing out of an epic/feature/task modal left the whole page.
 * Overlays register a handler while they are open; the native listener
 * (installBackButtonHandler) asks the stack first.
 *
 * The stack is LIFO, so a confirm dialog opened over a panel closes before the
 * panel does. Handlers are identified by object, so re-renders never reorder.
 */
type Entry = { run: () => void };

const stack: Entry[] = [];

/** Register a back handler. Returns the unregister function. */
export function pushBackHandler(run: () => void): () => void {
	const entry: Entry = { run };
	stack.push(entry);
	return () => {
		const index = stack.lastIndexOf(entry);
		if (index !== -1) stack.splice(index, 1);
	};
}

/** Runs the topmost handler. Returns false when nothing is open. */
export function handleBackPress(): boolean {
	const top = stack[stack.length - 1];
	if (!top) return false;
	top.run();
	return true;
}

/** Test helper: how many overlays are currently registered. */
export function backStackDepth(): number {
	return stack.length;
}

/**
 * Close this overlay on the Android back button while `active`.
 *
 * `onBack` is read through a ref, so passing a fresh closure every render
 * neither re-registers the handler nor moves it in the stack.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
	const onBackRef = useRef(onBack);
	onBackRef.current = onBack;
	useEffect(() => {
		if (!active) return;
		return pushBackHandler(() => onBackRef.current());
	}, [active]);
}

/**
 * Wire the hardware back button (native only). Registering a Capacitor
 * `backButton` listener replaces Capacitor's default, so this also owns the
 * fallbacks: history back when there is somewhere to go, otherwise send the
 * app to the background, which is what Android does at a root screen.
 */
export async function installBackButtonHandler(): Promise<void> {
	const { App } = await import("@capacitor/app");
	await App.addListener("backButton", ({ canGoBack }) => {
		if (handleBackPress()) return;
		if (canGoBack) {
			window.history.back();
			return;
		}
		void App.minimizeApp();
	});
}
