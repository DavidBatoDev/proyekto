import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { PUSH_FALLBACK_PATH, resolvePushLink } from "@/lib/pushLink";
import {
	isNativePlatform,
	type PushDataPayload,
	type PushTeardown,
	registerListeners,
} from "@/services/pushNotifications";
import {
	refreshPushStatus,
	syncPushRegistration,
} from "@/services/pushRegistration";
import { useIsAuthenticated } from "@/stores/authStore";

/**
 * Wires native FCM push into the app. Mount ONCE inside the router tree (see
 * __root.tsx) so it can navigate on a notification tap.
 *
 * - Attaches listeners as early as possible to catch foreground, background, and
 *   cold-start notification taps.
 * - Registers the device token whenever the user is logged in, again on every
 *   resume, and again on token refresh. Registration used to run exactly once,
 *   on the login transition, with no retry of any kind — so a single failure
 *   there meant the device never registered again, which is precisely what
 *   happened in production for two months.
 * - Fully inert on the web (every call is gated on isNativePlatform()), so the
 *   existing browser notification experience is untouched.
 *
 * The registration itself lives in `services/pushRegistration.ts`, shared with
 * the Settings screen so both drive the same code.
 */
export function usePushNotifications(): void {
	const isAuthenticated = useIsAuthenticated();
	const router = useRouter();
	const queryClient = useQueryClient();

	// Keep the latest auth flag available to the long-lived listeners.
	const isAuthedRef = useRef(isAuthenticated);
	isAuthedRef.current = isAuthenticated;

	// Attach listeners once, immediately, so a cold-start tap (replayed by the
	// plugin when a listener exists) deep-links correctly.
	useEffect(() => {
		if (!isNativePlatform()) return;

		let teardown: PushTeardown | null = null;
		let cancelled = false;

		const goToLink = (data: PushDataPayload) => {
			// Same treatment as a persisted link in the notification bell: legacy
			// paths mapped, bare organizational paths left for their redirect
			// stubs, anything that is not an in-app path dropped.
			const link = resolvePushLink(data.link_url);
			try {
				router.history.push(link);
			} catch {
				router.history.push(PUSH_FALLBACK_PATH);
			}
		};

		registerListeners({
			onTokenRefresh: () => {
				// The new token comes from getToken() inside the sync, so the
				// throttle and the status record see it like any other run.
				if (isAuthedRef.current) {
					void syncPushRegistration({ trigger: "token-refresh" });
				}
			},
			onForeground: () => {
				// Mirror the realtime hook: refresh bell count + lists.
				void queryClient.invalidateQueries({ queryKey: ["notifications"] });
			},
			onActionPerformed: goToLink,
		}).then((fn) => {
			if (cancelled) fn();
			else teardown = fn;
		});

		return () => {
			cancelled = true;
			teardown?.();
		};
	}, [router, queryClient]);

	// Register on login, and retry on every resume.
	useEffect(() => {
		if (!isNativePlatform() || !isAuthenticated) return;

		let cancelled = false;
		let detach: (() => void) | undefined;
		// Resume can fire in bursts; one run at a time.
		let inFlight = false;

		const sync = async (trigger: "auth" | "resume") => {
			if (inFlight) return;
			inFlight = true;
			try {
				// A trip to system settings is the main reason a resume matters:
				// the permission may have changed under us, and refreshing it keeps
				// the Settings screen honest even when the POST is throttled.
				if (trigger === "resume") await refreshPushStatus();
				if (!cancelled) await syncPushRegistration({ trigger });
			} finally {
				inFlight = false;
			}
		};

		void sync("auth");

		void (async () => {
			const { App } = await import("@capacitor/app");
			const handle = await App.addListener("resume", () => {
				if (isAuthedRef.current) void sync("resume");
			});
			// The import can resolve after unmount; without this the listener is
			// attached and never removed.
			if (cancelled) void handle.remove();
			else detach = () => void handle.remove();
		})();

		return () => {
			cancelled = true;
			detach?.();
		};
	}, [isAuthenticated]);
}
