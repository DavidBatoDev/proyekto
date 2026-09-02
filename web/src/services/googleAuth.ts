import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

/**
 * Native Google sign-in for the mobile app.
 *
 * The web flow (`supabase.auth.signInWithOAuth`) cannot work inside the
 * Capacitor WebView. `window.location.origin` there is `https://localhost`,
 * which is not an allowlisted Supabase redirect, so Supabase falls back to the
 * project's Site URL and the user is dumped onto the marketing site in an
 * external browser. And even a valid redirect could not return: there is no
 * BROWSABLE intent-filter in AndroidManifest.xml, so nothing routes back in.
 *
 * So on native we skip the redirect dance entirely: Android's Credential
 * Manager draws the account sheet over the app, hands back a Google ID token,
 * and we trade that for a Supabase session with `signInWithIdToken`. The user
 * never leaves the app.
 */

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as
	| string
	| undefined;

/**
 * The plugin name as registered by the native bridge.
 *
 * Checked via `Capacitor.isPluginAvailable`, which reads the bridge's injected
 * PluginHeaders — so it answers correctly WITHOUT importing the module. Import
 * first and the web fallback registers itself, defeating the check.
 */
const PLUGIN_NAME = "SocialLogin";

export type GoogleAuthResult =
	| { ok: true }
	/** The user dismissed the sheet. Expected, not an error to surface. */
	| { ok: false; cancelled: true }
	| { ok: false; cancelled: false; error: string };

/**
 * Whether tapping "Continue with Google" should open the native sheet.
 *
 * False on web, and false on a native build that somehow lacks the client id —
 * in which case the caller falls back to the redirect flow rather than
 * presenting a button that cannot work.
 */
export function isNativeGoogleAuthAvailable(): boolean {
	return (
		Capacitor.isNativePlatform() &&
		Capacitor.isPluginAvailable(PLUGIN_NAME) &&
		typeof WEB_CLIENT_ID === "string" &&
		WEB_CLIENT_ID.length > 0
	);
}

let initialized: Promise<
	typeof import("@capgo/capacitor-social-login")
> | null = null;

function loadSocialLogin() {
	if (!initialized) {
		initialized = (async () => {
			const mod = await import("@capgo/capacitor-social-login");
			await mod.SocialLogin.initialize({
				google: { webClientId: WEB_CLIENT_ID },
			});
			return mod;
		})().catch((err) => {
			// Don't cache a failed init — a later attempt should be able to retry.
			initialized = null;
			throw err;
		});
	}
	return initialized;
}

const randomNonce = (): string => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const sha256Hex = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
};

/** Cancelling the account sheet is a normal outcome; the wording varies by OS. */
const isCancellation = (message: string): boolean =>
	/cancel|dismiss|closed by user|user_cancel|activity is cancelled/i.test(
		message,
	);

/**
 * Open the native account sheet and establish a Supabase session.
 *
 * Never throws: the caller decides what to show, and a thrown plugin error
 * would otherwise surface as an empty toast.
 */
export async function signInWithGoogleNative(): Promise<GoogleAuthResult> {
	try {
		const { SocialLogin } = await loadSocialLogin();

		// Google echoes the nonce it is given straight into the token's `nonce`
		// claim, and Supabase compares the SHA-256 of what WE pass it against that
		// claim. So Google gets the hash and Supabase gets the raw value; sending
		// the same string to both fails verification.
		const rawNonce = randomNonce();
		const hashedNonce = await sha256Hex(rawNonce);

		// No `scopes` here, deliberately. The Android provider rejects ANY scopes
		// array with "You CANNOT use scopes without modifying the main activity"
		// unless MainActivity is subclassed (GoogleProvider.java:314) — and it
		// already adds openid + userinfo.email + userinfo.profile unconditionally,
		// which is everything the ID token needs. Passing them was all cost.
		const response = await SocialLogin.login({
			provider: "google",
			options: { nonce: hashedNonce },
		});

		const idToken =
			response.provider === "google" && "idToken" in response.result
				? response.result.idToken
				: null;

		if (!idToken) {
			return {
				ok: false,
				cancelled: false,
				error: "Google did not return an identity token.",
			};
		}

		const { error } = await supabase.auth.signInWithIdToken({
			provider: "google",
			token: idToken,
			nonce: rawNonce,
		});
		if (error) {
			return { ok: false, cancelled: false, error: error.message };
		}

		return { ok: true };
	} catch (err) {
		const message = (err as Error)?.message || String(err);
		if (isCancellation(message)) return { ok: false, cancelled: true };
		return { ok: false, cancelled: false, error: message };
	}
}
