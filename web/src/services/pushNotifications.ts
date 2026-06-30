import { Capacitor } from "@capacitor/core";
import type { DevicePlatform } from "./deviceTokens.service";

/**
 * Thin, Capacitor-gated wrapper around @capacitor-firebase/messaging.
 *
 * Every function is a no-op (or returns null/[]) on the web, so the browser app
 * and its existing in-app + Supabase-realtime notifications are completely
 * unaffected. The Firebase plugin is dynamic-imported only on native, keeping it
 * out of the web bundle entirely.
 */

export interface PushDataPayload {
  link_url?: string;
  type?: string;
  notification_id?: string;
  [key: string]: string | undefined;
}

export interface PushListeners {
  /** New/refreshed FCM token — re-register with the backend. */
  onTokenRefresh?: (token: string) => void;
  /** Notification received while the app is in the FOREGROUND. */
  onForeground?: (data: PushDataPayload) => void;
  /** User tapped a notification (foreground, background, or cold start). */
  onActionPerformed?: (data: PushDataPayload) => void;
}

/** Handle returned by registerListeners(); call to detach all listeners. */
export type PushTeardown = () => void;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): DevicePlatform {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : "web";
}

async function loadMessaging() {
  if (!isNativePlatform()) return null;
  const mod = await import("@capacitor-firebase/messaging");
  return mod.FirebaseMessaging;
}

/** Request notification permission. Returns true if granted. No-op on web. */
export async function ensurePermission(): Promise<boolean> {
  const FirebaseMessaging = await loadMessaging();
  if (!FirebaseMessaging) return false;
  try {
    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive !== "granted") {
      perm = await FirebaseMessaging.requestPermissions();
    }
    return perm.receive === "granted";
  } catch {
    return false;
  }
}

/** Current FCM registration token, or null. No-op on web. */
export async function getToken(): Promise<string | null> {
  const FirebaseMessaging = await loadMessaging();
  if (!FirebaseMessaging) return null;
  try {
    const { token } = await FirebaseMessaging.getToken();
    return token ?? null;
  } catch {
    return null;
  }
}

/** App version (for telemetry on the token row). undefined on web/error. */
export async function getAppVersion(): Promise<string | undefined> {
  if (!isNativePlatform()) return undefined;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return info.version;
  } catch {
    return undefined;
  }
}

function extractData(event: unknown): PushDataPayload {
  const notification = (event as { notification?: { data?: unknown } })
    ?.notification;
  const data = (notification?.data ?? {}) as Record<string, unknown>;
  const out: PushDataPayload = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") out[k] = v;
    else if (v != null) out[k] = String(v);
  }
  return out;
}

/**
 * Attach FCM listeners. Returns a teardown that removes them. No-op on web.
 * Call this as EARLY as possible so a cold-start tap (which the plugin replays
 * once a listener is attached) is caught.
 */
export async function registerListeners(
  listeners: PushListeners,
): Promise<PushTeardown> {
  const FirebaseMessaging = await loadMessaging();
  if (!FirebaseMessaging) return () => {};

  const handles = await Promise.all([
    FirebaseMessaging.addListener("tokenReceived", (event) => {
      if (event?.token) listeners.onTokenRefresh?.(event.token);
    }),
    FirebaseMessaging.addListener("notificationReceived", (event) => {
      listeners.onForeground?.(extractData(event));
    }),
    FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
      listeners.onActionPerformed?.(extractData(event));
    }),
  ]);

  return () => {
    for (const h of handles) {
      try {
        void h.remove();
      } catch {
        // best-effort
      }
    }
  };
}
