import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { deviceTokensService } from "@/services/deviceTokens.service";
import {
  ensurePermission,
  getAppVersion,
  getPlatform,
  getToken,
  isNativePlatform,
  type PushDataPayload,
  type PushTeardown,
  registerListeners,
} from "@/services/pushNotifications";
import { useIsAuthenticated } from "@/stores/authStore";

/** Best-effort register of the current device token. Never throws. */
async function registerToken(token: string): Promise<void> {
  try {
    const appVersion = await getAppVersion();
    await deviceTokensService.register({
      token,
      platform: getPlatform(),
      appVersion,
    });
  } catch {
    // Push is best-effort; a registration failure must never break the app.
  }
}

/**
 * Wires native FCM push into the app. Mount ONCE inside the router tree (see
 * __root.tsx) so it can navigate on a notification tap.
 *
 * - Attaches listeners as early as possible to catch foreground, background, and
 *   cold-start notification taps.
 * - Registers the device token with the backend whenever the user is logged in,
 *   and re-registers on token refresh.
 * - Fully inert on the web (every call is gated on isNativePlatform()), so the
 *   existing browser notification experience is untouched.
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
      const link = data.link_url || "/notifications";
      try {
        router.history.push(link);
      } catch {
        router.history.push("/notifications");
      }
    };

    registerListeners({
      onTokenRefresh: (token) => {
        if (isAuthedRef.current) void registerToken(token);
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

  // Register the device token when the user becomes authenticated.
  useEffect(() => {
    if (!isNativePlatform() || !isAuthenticated) return;

    let active = true;
    void (async () => {
      const granted = await ensurePermission();
      if (!granted || !active) return;
      const token = await getToken();
      if (!token || !active) return;
      await registerToken(token);
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated]);
}
