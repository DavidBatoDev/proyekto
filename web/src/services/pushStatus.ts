import type { DevicePlatform } from "./deviceTokens.service";

/**
 * Raw permission state, kept verbatim from the plugin.
 *
 * Collapsing this to a boolean is the bug this whole module exists to undo:
 * `denied` (the user said no, and Android will never ask again) and
 * `unavailable` (the plugin threw) are wildly different problems that were
 * indistinguishable for two months.
 */
export type PushPermission =
	| "prompt"
	| "prompt-with-rationale"
	| "granted"
	| "denied"
	| "unavailable";

export type PushTrigger = "auth" | "resume" | "token-refresh" | "manual";

export interface PushStatus {
	/** When the last sync ran, ISO. */
	checkedAt: string | null;
	trigger: PushTrigger | null;
	platform: DevicePlatform;
	appVersion: string | null;
	appBuild: string | null;
	/** False on web, and on a native device where FCM is unavailable. */
	supported: boolean;
	permission: PushPermission;
	/** Last 6 characters only — see the note on persistence below. */
	tokenTail: string | null;
	registered: boolean;
	registeredAt: string | null;
	/** Verbatim failure text, including an HTTP status when the POST rejected. */
	lastError: string | null;
	/** Android notification channels that exist right now. */
	channels: string[];
}

const EMPTY: PushStatus = {
	checkedAt: null,
	trigger: null,
	platform: "web",
	appVersion: null,
	appBuild: null,
	supported: false,
	permission: "prompt",
	tokenTail: null,
	registered: false,
	registeredAt: null,
	lastError: null,
	channels: [],
};

const STORAGE_KEY = "proyekto.push.status";

/**
 * Diagnostic record for native push registration.
 *
 * A module-level store rather than Zustand: this is not application state, it is
 * a log of what the last registration attempt did, and it has to be writable
 * from a plain service with no React context in scope.
 *
 * The app has no telemetry sink of any kind, so this — surfaced by
 * `PushNotificationsSection` — is the only way a push failure is ever
 * observable, on a developer's machine or a user's phone.
 *
 * NEVER persist the full FCM token. A token is a credential: anyone holding it
 * can push to that device. Only the tail is stored, which is enough to tell two
 * registrations apart.
 */
let current: PushStatus = load();
const listeners = new Set<() => void>();

function load(): PushStatus {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY;
		return { ...EMPTY, ...(JSON.parse(raw) as Partial<PushStatus>) };
	} catch {
		// Private-mode webview, cleared storage, or corrupt JSON. In-memory only.
		return EMPTY;
	}
}

function persist(status: PushStatus): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
	} catch {
		// Non-fatal; the in-memory copy still drives the UI this session.
	}
}

export function getPushStatus(): PushStatus {
	return current;
}

export function setPushStatus(patch: Partial<PushStatus>): PushStatus {
	current = { ...current, ...patch };
	persist(current);
	for (const listener of listeners) listener();
	return current;
}

export function subscribePushStatus(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Mask a token for display. The full value never leaves memory. */
export function tokenTail(token: string): string {
	return token.slice(-6);
}
