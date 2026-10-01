import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";
import {
	isCancellation,
	loadSocialLogin,
	PLUGIN_NAME,
	randomNonce,
	sha256Hex,
} from "@/services/googleAuth";

/**
 * Native Sign in with Apple — iOS only.
 *
 * App Store guideline 4.8: an iOS app that offers a third-party login (we offer
 * Google) must also offer Sign in with Apple. It is required only in the iOS
 * app, so Android and the web keep email and Google.
 *
 * Same shape as signInWithGoogleNative: the system sheet returns an identity
 * token, Supabase trades it for a session with `signInWithIdToken`, and the
 * caller then routes through /auth/callback for the profile upsert and
 * onboarding.
 *
 * Needs, outside this file: the Sign in with Apple capability on the App ID and
 * the `com.apple.developer.applesignin` entitlement (ios/App/App/App.entitlements),
 * `apple: true` in capacitor.config.ts, and the Apple provider enabled in
 * Supabase Auth with the bundle id `tech.proyekto.app` as an authorized client.
 */

export type AppleAuthResult =
	| { ok: true }
	| { ok: false; cancelled: true }
	| { ok: false; cancelled: false; error: string };

/** Shown only in the installed iOS app. */
export function isNativeAppleAuthAvailable(): boolean {
	return (
		Capacitor.getPlatform() === "ios" &&
		Capacitor.isPluginAvailable(PLUGIN_NAME)
	);
}

/** Apple's cancel is error 1001 ("The operation couldn't be completed"). */
const isAppleCancellation = (message: string): boolean =>
	isCancellation(message) || /1001|canceled/i.test(message);

export async function signInWithAppleNative(): Promise<AppleAuthResult> {
	try {
		const { SocialLogin } = await loadSocialLogin();

		// Apple echoes the nonce into the token's `nonce` claim unchanged (the
		// plugin sets ASAuthorizationAppleIDRequest.nonce as-is), and Supabase
		// compares the SHA-256 of what we pass it against that claim. So Apple
		// gets the hash, Supabase gets the raw value — same as Google.
		const rawNonce = randomNonce();
		const hashedNonce = await sha256Hex(rawNonce);

		const response = await SocialLogin.login({
			provider: "apple",
			options: { scopes: ["name", "email"], nonce: hashedNonce },
		});

		if (response.provider !== "apple" || !response.result.idToken) {
			return {
				ok: false,
				cancelled: false,
				error: "Apple did not return an identity token.",
			};
		}

		const { error } = await supabase.auth.signInWithIdToken({
			provider: "apple",
			token: response.result.idToken,
			nonce: rawNonce,
		});
		if (error) {
			return { ok: false, cancelled: false, error: error.message };
		}

		// Apple sends the name on the FIRST authorization only, and never inside
		// the identity token. Save it to the user's metadata now, where
		// /auth/callback reads given_name/family_name for the profile; later
		// sign-ins return null and must not wipe it.
		const { givenName, familyName } = response.result.profile ?? {};
		if (givenName || familyName) {
			const fullName = [givenName, familyName].filter(Boolean).join(" ");
			await supabase.auth
				.updateUser({
					data: {
						given_name: givenName ?? undefined,
						family_name: familyName ?? undefined,
						full_name: fullName || undefined,
					},
				})
				.catch(() => undefined);
		}

		return { ok: true };
	} catch (err) {
		const message = (err as Error)?.message || String(err);
		if (isAppleCancellation(message)) return { ok: false, cancelled: true };
		return { ok: false, cancelled: false, error: message };
	}
}
