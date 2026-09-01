import { deviceTokensService } from "./deviceTokens.service";
import {
	checkPermission,
	ensureNotificationChannels,
	getAppBuild,
	getAppVersion,
	getPlatform,
	getToken,
	isNativePlatform,
	isPushSupported,
	listNotificationChannels,
	requestPermission,
} from "./pushNotifications";
import {
	getPushStatus,
	type PushPermission,
	type PushStatus,
	type PushTrigger,
	setPushStatus,
	tokenTail,
} from "./pushStatus";

/**
 * The one place a device registers for push.
 *
 * Called by `usePushNotifications` (on login, on resume, on token refresh) and
 * by the Retry button in Settings, so the button exercises the production path
 * rather than a parallel one that can drift from it.
 *
 * Never throws. Every outcome — including every failure, with its reason — is
 * written to `pushStatus`, which the settings screen renders.
 */

/** Full token, memory only. `pushStatus` persists the tail; a token is a credential. */
let lastRegisteredToken: string | null = null;
let lastRegisteredAt = 0;
let lastAttemptFailed = false;

/** Re-POST at least this often so `device_tokens.last_seen_at` stays meaningful. */
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Android 13+ shows the permission dialog ONCE per install. Spending it at an
 * arbitrary moment is most likely how this app's devices ended up permanently
 * denied, so we record that we have asked and never auto-ask again — later
 * prompts come from the user pressing Enable.
 */
const PROMPTED_KEY = "proyekto.push.promptedAt";

function hasPrompted(): boolean {
	try {
		return localStorage.getItem(PROMPTED_KEY) !== null;
	} catch {
		return false;
	}
}

function markPrompted(): void {
	try {
		localStorage.setItem(PROMPTED_KEY, new Date().toISOString());
	} catch {
		// Non-fatal: worst case we re-ask once, and Android no-ops it.
	}
}

/**
 * Forget what this session registered.
 *
 * Called on logout. `unregisterCurrentDeviceToken` deletes the row server-side,
 * so without this the throttle would still believe the token is registered and
 * skip the POST when the same user signs back in on the same device — leaving
 * them silently unregistered until the 12h refresh.
 */
export function resetPushRegistration(): void {
	lastRegisteredToken = null;
	lastRegisteredAt = 0;
	lastAttemptFailed = false;
}

export interface SyncOptions {
	trigger: PushTrigger;
	/** Allow showing the system prompt. True only for a deliberate user action. */
	allowPrompt?: boolean;
}

function axiosErrorText(err: unknown): string {
	const e = err as {
		response?: { status?: number; data?: { message?: string } };
		message?: string;
	};
	const status = e?.response?.status;
	const body = e?.response?.data?.message;
	const base = body || e?.message || String(err);
	return status ? `HTTP ${status}: ${base}` : base;
}

/** Whether we should hit the network again, or the last registration still stands. */
function shouldRegister(token: string, trigger: PushTrigger): boolean {
	if (trigger === "manual") return true;
	if (lastAttemptFailed) return true;
	if (token !== lastRegisteredToken) return true;
	return Date.now() - lastRegisteredAt > REFRESH_INTERVAL_MS;
}

export async function syncPushRegistration(
	options: SyncOptions,
): Promise<PushStatus> {
	const { trigger, allowPrompt = false } = options;
	const checkedAt = new Date().toISOString();

	if (!isNativePlatform()) {
		return setPushStatus({
			checkedAt,
			trigger,
			platform: "web",
			supported: false,
			permission: "unavailable",
		});
	}

	const platform = getPlatform();

	try {
		const [supported, appVersion, appBuild] = await Promise.all([
			isPushSupported(),
			getAppVersion(),
			getAppBuild(),
		]);

		let permission = await checkPermission();

		// Android: the token does not need the permission, so ask only when we
		// have never asked (or the user pressed Enable), and never block on it.
		// iOS: the token DOES need it, so an unauthorized device stops here.
		const askable =
			permission === "prompt" || permission === "prompt-with-rationale";
		if (askable && (allowPrompt || !hasPrompted())) {
			markPrompted();
			permission = await requestPermission();
		}

		setPushStatus({
			checkedAt,
			trigger,
			platform,
			appVersion: appVersion ?? null,
			appBuild: appBuild ?? null,
			supported,
			permission,
		});

		if (platform === "ios" && permission !== "granted") {
			return finish(
				permission,
				"iOS will not issue a token until notifications are allowed.",
			);
		}

		const result = await getToken();
		if (!result.ok) {
			lastAttemptFailed = true;
			return finish(permission, result.error);
		}

		void ensureNotificationChannels().then(refreshChannels);

		if (!shouldRegister(result.token, trigger)) {
			return getPushStatus();
		}

		try {
			await deviceTokensService.register({
				token: result.token,
				platform,
				appVersion,
			});
			lastRegisteredToken = result.token;
			lastRegisteredAt = Date.now();
			lastAttemptFailed = false;
			return setPushStatus({
				tokenTail: tokenTail(result.token),
				registered: true,
				registeredAt: new Date().toISOString(),
				lastError: null,
			});
		} catch (err) {
			lastAttemptFailed = true;
			return setPushStatus({
				tokenTail: tokenTail(result.token),
				registered: false,
				lastError: axiosErrorText(err),
			});
		}
	} catch (err) {
		lastAttemptFailed = true;
		return setPushStatus({
			checkedAt,
			trigger,
			lastError: axiosErrorText(err),
		});
	}
}

function finish(permission: PushPermission, error: string): PushStatus {
	return setPushStatus({ permission, registered: false, lastError: error });
}

/** Refresh only the locally-readable state. Cheap; safe to call on every resume. */
export async function refreshPushStatus(): Promise<PushStatus> {
	if (!isNativePlatform()) return getPushStatus();
	const [permission, channels] = await Promise.all([
		checkPermission(),
		listNotificationChannels(),
	]);
	return setPushStatus({ permission, channels });
}

async function refreshChannels(): Promise<void> {
	setPushStatus({ channels: await listNotificationChannels() });
}
