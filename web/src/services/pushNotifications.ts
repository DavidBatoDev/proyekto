import { Capacitor } from "@capacitor/core";
import type { DevicePlatform } from "./deviceTokens.service";
import type { PushPermission } from "./pushStatus";

/**
 * Thin, Capacitor-gated wrapper around @capacitor-firebase/messaging.
 *
 * Every function is a no-op (or returns a typed failure) on the web, so the
 * browser app and its existing in-app + realtime notifications are completely
 * unaffected. The Firebase plugin is dynamic-imported only on native, keeping it
 * out of the web bundle entirely.
 *
 * Nothing here swallows an error into `false`/`null` any more. Callers get the
 * reason, because the reason is the only thing that makes a push failure
 * diagnosable — see `pushStatus.ts`.
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

export type TokenResult =
	| { ok: true; token: string }
	| { ok: false; error: string };

/**
 * Android notification channels.
 *
 * Two, not one. With only a chat channel every other push falls into Android's
 * auto-created "Miscellaneous", which is exactly the ungrouped tray this exists
 * to fix — and users could not mute chat without muting invoices.
 *
 * Channel properties other than name and description are IMMUTABLE once
 * created. Changing importance later needs a new id plus a deleteChannel of the
 * old one, and users lose any customisation they made. Get these right here.
 */
export const CHANNEL_GENERAL = "proyekto_general";
export const CHANNEL_CHAT = "proyekto_chat";

const LIGHT_COLOR = "#5E6AD2";

export function isNativePlatform(): boolean {
	return Capacitor.isNativePlatform();
}

export function getPlatform(): DevicePlatform {
	const p = Capacitor.getPlatform();
	return p === "ios" || p === "android" ? p : "web";
}

async function loadMessaging() {
	if (!isNativePlatform()) return null;
	return await import("@capacitor-firebase/messaging");
}

const errorText = (err: unknown): string =>
	(err as Error)?.message || String(err);

/** Whether FCM is usable on this device at all (no Play Services, etc.). */
export async function isPushSupported(): Promise<boolean> {
	const mod = await loadMessaging();
	if (!mod) return false;
	try {
		const { isSupported } = await mod.FirebaseMessaging.isSupported();
		return isSupported;
	} catch {
		return false;
	}
}

/** Current permission, without prompting. `unavailable` means the plugin threw. */
export async function checkPermission(): Promise<PushPermission> {
	const mod = await loadMessaging();
	if (!mod) return "unavailable";
	try {
		const { receive } = await mod.FirebaseMessaging.checkPermissions();
		return receive as PushPermission;
	} catch {
		return "unavailable";
	}
}

/**
 * Show the system permission prompt.
 *
 * On Android 13+ the OS shows this ONCE per install. If the user dismisses it,
 * every later call returns `denied` immediately without showing anything — so a
 * caller must treat a `denied` result as final and route the user to system
 * settings rather than asking again.
 */
export async function requestPermission(): Promise<PushPermission> {
	const mod = await loadMessaging();
	if (!mod) return "unavailable";
	try {
		const { receive } = await mod.FirebaseMessaging.requestPermissions();
		return receive as PushPermission;
	} catch {
		return "unavailable";
	}
}

/**
 * Current FCM registration token.
 *
 * On ANDROID this does not require the notification permission — the plugin
 * calls straight through to Firebase (FirebaseMessagingPlugin.java:127), and
 * the permission only gates *displaying* a notification. Registering the token
 * regardless is what lets push start working the instant a user flips the
 * switch in system settings, with no re-registration.
 *
 * On iOS it does require authorization: the token comes from APNs, and
 * Messaging.token() fails with "No APNS token specified" until the user has
 * allowed notifications.
 */
export async function getToken(): Promise<TokenResult> {
	const mod = await loadMessaging();
	if (!mod) return { ok: false, error: "not a native platform" };
	try {
		const { token } = await mod.FirebaseMessaging.getToken();
		if (!token) return { ok: false, error: "plugin returned an empty token" };
		return { ok: true, token };
	} catch (err) {
		return { ok: false, error: errorText(err) };
	}
}

/** Legacy shape, for the logout path in authStore. */
export async function getTokenOrNull(): Promise<string | null> {
	const result = await getToken();
	return result.ok ? result.token : null;
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

/**
 * Native build number (Android versionCode / iOS CFBundleVersion).
 *
 * Distinct from the version: it is what tells you whether a device is running
 * the store binary or an OTA web bundle on top of an older shell.
 */
export async function getAppBuild(): Promise<string | undefined> {
	if (!isNativePlatform()) return undefined;
	try {
		const { App } = await import("@capacitor/app");
		const info = await App.getInfo();
		return info.build;
	} catch {
		return undefined;
	}
}

/**
 * Create the Android notification channels. Idempotent, Android-only, non-fatal.
 *
 * Creating an existing channel is a no-op, so this is safe to call on every
 * launch. `createChannel` is unimplemented on iOS, which groups by `thread-id`
 * instead.
 */
export async function ensureNotificationChannels(): Promise<void> {
	if (getPlatform() !== "android") return;
	const mod = await loadMessaging();
	if (!mod) return;

	const { FirebaseMessaging, Importance, Visibility } = mod;
	try {
		await FirebaseMessaging.createChannel({
			id: CHANNEL_GENERAL,
			name: "General",
			description: "Invitations, tasks, invoices and account updates.",
			importance: Importance.Default,
			visibility: Visibility.Private,
		});
		await FirebaseMessaging.createChannel({
			id: CHANNEL_CHAT,
			name: "Chat messages",
			description: "Direct messages and project channel activity.",
			importance: Importance.High,
			lights: true,
			lightColor: LIGHT_COLOR,
			// `vibration` is the documented field, but the Android helper reads
			// `vibrate` (FirebaseMessagingHelper.java:100) and silently drops the
			// typed one. Send both keys, or the channel ships without vibration.
			vibration: true,
			...({ vibrate: true } as Record<string, boolean>),
			// The helper defaults to VISIBILITY_PUBLIC, which would put message
			// previews on the lock screen.
			visibility: Visibility.Private,
		});
	} catch (err) {
		console.warn("[push] createChannel failed:", errorText(err));
	}
}

/** Channel names that currently exist. Diagnostic only; [] off Android. */
export async function listNotificationChannels(): Promise<string[]> {
	if (getPlatform() !== "android") return [];
	const mod = await loadMessaging();
	if (!mod) return [];
	try {
		const { channels } = await mod.FirebaseMessaging.listChannels();
		return channels.map((c) => c.name || c.id);
	} catch {
		return [];
	}
}

/**
 * Whether this shell can deep-link into the OS notification settings.
 *
 * False on a native build that predates the plugin — which is the point. The
 * OTA bundle carrying this code has to run on the build-3000 shells that are
 * currently broken, so the button is hidden there and the UI falls back to
 * written instructions instead of failing on a missing bridge.
 *
 * This answers correctly WITHOUT importing the plugin first: `isPluginAvailable`
 * falls through to the bridge's injected `PluginHeaders`, which lists what the
 * native shell was compiled with. Importing the module to "make it available"
 * would defeat the check — it registers a web fallback and turns every shell
 * into a true.
 */
export function canOpenSystemNotificationSettings(): boolean {
	try {
		return isNativePlatform() && Capacitor.isPluginAvailable("NativeSettings");
	} catch {
		return false;
	}
}

/** Open this app's notification settings. Returns false if it could not. */
export async function openSystemNotificationSettings(): Promise<boolean> {
	if (!canOpenSystemNotificationSettings()) return false;
	try {
		const { NativeSettings, AndroidSettings, IOSSettings } = await import(
			"capacitor-native-settings"
		);
		await NativeSettings.open({
			optionAndroid: AndroidSettings.AppNotification,
			optionIOS: IOSSettings.AppNotification,
		});
		return true;
	} catch (err) {
		console.warn("[push] could not open settings:", errorText(err));
		return false;
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
	const mod = await loadMessaging();
	if (!mod) return () => {};
	const FirebaseMessaging = mod.FirebaseMessaging;

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
