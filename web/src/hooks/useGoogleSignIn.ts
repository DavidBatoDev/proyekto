import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
	type AuthContinuationSource,
	clearAuthContinuation,
	rememberAuthContinuation,
} from "@/lib/authContinuation";
import { supabase } from "@/lib/supabase";
import {
	isNativeGoogleAuthAvailable,
	signInWithGoogleNative,
} from "@/services/googleAuth";
import { useToast } from "./useToast";

interface UseGoogleSignInOptions {
	source: AuthContinuationSource;
	/** Where to land after auth, if the caller has a specific destination. */
	redirectTo?: string;
	/** Called when the attempt ends without a session, so the caller can re-enable its button. */
	onSettled?: () => void;
}

/**
 * The "Continue with Google" handler, shared by the login and signup screens.
 *
 * Two paths that look identical to the user and completely different
 * underneath:
 *
 * - **Web** keeps `signInWithOAuth`, which navigates away to Google and returns
 *   to `/auth/callback` with the session already in the URL.
 * - **Native** opens the OS account sheet, gets a session synchronously, and
 *   then navigates to that same `/auth/callback` route by hand — reusing its
 *   profile upsert, `completeOnboarding`, and post-auth destination logic
 *   rather than duplicating any of it.
 *
 * `rememberAuthContinuation` runs first in both cases, because the callback
 * route reads it to decide where to send the user.
 */
export function useGoogleSignIn({
	source,
	redirectTo,
	onSettled,
}: UseGoogleSignInOptions) {
	const navigate = useNavigate();
	const toast = useToast();

	const signIn = useCallback(async () => {
		rememberAuthContinuation({ redirectTo, source, authMethod: "google" });

		if (isNativeGoogleAuthAvailable()) {
			const result = await signInWithGoogleNative();

			if (!result.ok) {
				clearAuthContinuation();
				// Dismissing the sheet is a deliberate action, not a failure — an
				// error toast for it reads as a bug the user just caused.
				if (!result.cancelled) toast.error(result.error);
				onSettled?.();
				return;
			}

			navigate({ to: "/auth/callback" });
			return;
		}

		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider: "google",
				options: { redirectTo: `${window.location.origin}/auth/callback` },
			});
			if (error) throw error;
			// On success the browser navigates away; nothing after this runs.
		} catch (error) {
			clearAuthContinuation();
			toast.error(
				error instanceof Error ? error.message : "Google sign-in failed",
			);
			onSettled?.();
		}
	}, [navigate, onSettled, redirectTo, source, toast]);

	return {
		signIn,
		/** Nothing redirects on native, so the loading label must not say it does. */
		isNative: isNativeGoogleAuthAvailable(),
	};
}
