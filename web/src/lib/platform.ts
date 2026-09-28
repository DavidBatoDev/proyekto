import { Capacitor } from "@capacitor/core";

/**
 * Am I running inside the installed Android/iOS shell?
 *
 * A routing-safe home for the question. `services/pushNotifications.ts` has
 * re-exported the same predicate for a while, but routing must not depend on
 * the push service, so the shared answer lives here and that module keeps its
 * own export for its own callers.
 *
 * Deliberately not memoized. Capacitor resolves the platform once at bundle
 * init, so there is nothing to cache, and a live read is what lets a test flip
 * it between cases.
 *
 * NOTE the neighbouring vocabulary: `hooks/useIsMobile.ts` and
 * `components/layout/MobileNavDrawer.tsx` mean a SMALL SCREEN — a narrow
 * browser window counts. This means the native container, which a phone-sized
 * browser is not. `components/mobile/` follows this sense, not that one.
 */
export function isNativeApp(): boolean {
	return Capacitor.isNativePlatform();
}
