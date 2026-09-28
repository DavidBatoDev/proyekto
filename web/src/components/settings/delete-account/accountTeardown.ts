import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { resetPushRegistration } from "@/services/pushRegistration";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Everything the browser still remembers about an account that no longer
 * exists.
 *
 * THE ORDER MATTERS, AND SO DOES WHAT IS *NOT* HERE.
 *
 * We deliberately do NOT sign out in this document. `authStore.initialize`
 * registers an `onAuthStateChange` listener that flips `isAuthenticated` on any
 * sign-out, and `ProtectedRoute` reacts by navigating to `/auth/login`. Doing it
 * here means the user watches a login screen flash instead of the farewell page.
 * So: clear what only this document can clear, hard-navigate, and sign out in
 * the new document, which is public and cannot be bounced.
 *
 * Two keys deliberately SURVIVE. Each has a test, because both look like
 * oversights to anyone tidying this up later.
 */

/** Keys that hold this account's data and must go. */
const KEYS_TO_CLEAR = [
	// AI threads and composer drafts, current and legacy.
	"ai.threads.v1",
	"roadmap.ai.threads.v1",
	// Per-project view preferences, current and legacy.
	"proyekto-project-settings-storage",
	"prdigy-project-settings-storage",
	// Guest identity. Critical: the axios request interceptor falls back to the
	// guest header when there is no session, so a stale guest id would turn the
	// next page load into a guest session rather than a clean signed-out one.
	"proyekto_guest_session_id",
	"prdigy_guest_session_id",
	"proyekto_guest_user_id",
	"prdigy_guest_user_id",
] as const;

/** Set so `/goodbye` can tell a real farewell from someone typing the URL. */
export const ACCOUNT_DELETED_FLAG = "proyekto.account-deleted";

function forget(key: string): void {
	// Private mode throws on access, and a half-run teardown is worse than a
	// missed key, so every removal is independently guarded.
	try {
		localStorage.removeItem(key);
	} catch {
		/* storage unavailable — nothing to clear */
	}
}

export async function tearDownDeletedAccount(
	queryClient: QueryClient,
	userId: string,
): Promise<void> {
	// The backend deletes the device_tokens rows; this clears the module-level
	// memo of them. A WebView navigation does not restart the JS context, so on
	// native this cannot be left to the reload.
	try {
		resetPushRegistration();
	} catch {
		/* non-fatal */
	}

	// Cancel BEFORE clearing: an in-flight authed request that resolves after a
	// bare clear() repopulates the cache with the dead account's data.
	try {
		await queryClient.cancelQueries();
	} catch {
		/* non-fatal */
	}
	queryClient.clear();

	// Realtime channels otherwise keep sockets open against a revoked JWT.
	try {
		await supabase.removeAllChannels();
	} catch {
		/* non-fatal */
	}

	// setCurrentWorkspace(null, userId) is what actually removes the
	// `proyekto_current_workspace:<userId>` key; clear() alone only resets
	// in-memory state.
	try {
		useWorkspaceStore.getState().setCurrentWorkspace(null, userId);
		useWorkspaceStore.getState().clear();
	} catch {
		/* non-fatal */
	}

	// Theme is a DEVICE preference, not account data. Clearing it would flip the
	// browser from dark to light mid-farewell, which reads as a crash. Detach it
	// from the dead account instead so nothing tries to save preferences to it.
	try {
		useAppearanceStore.getState().setOwnerUserId(null);
	} catch {
		/* non-fatal */
	}

	// `proyekto.push.promptedAt` also survives on purpose: Android 13+ spends its
	// notification-permission prompt once per install, so clearing it would make
	// a different account on this device re-prompt at a bad moment.

	for (const key of KEYS_TO_CLEAR) forget(key);

	try {
		sessionStorage.setItem(ACCOUNT_DELETED_FLAG, "1");
	} catch {
		/* non-fatal */
	}
}

/**
 * A hard navigation, not a router navigate. Every module-level singleton — the
 * AI run controller, the push memo, the router cache, React state — dies with
 * the document. For an irreversible action, "the document is gone" beats "I am
 * fairly sure that store got cleared".
 */
export function leaveForGoodbye(): void {
	window.location.replace("/goodbye");
}
