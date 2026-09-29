import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
	type AuthContinuationSource,
	clearAuthContinuation,
	rememberAuthContinuation,
} from "@/lib/authContinuation";
import {
	isNativeAppleAuthAvailable,
	signInWithAppleNative,
} from "@/services/appleAuth";
import { useToast } from "./useToast";

interface UseAppleSignInOptions {
	source: AuthContinuationSource;
	redirectTo?: string;
	/** Called when the attempt ends without a session, so the caller can re-enable its buttons. */
	onSettled?: () => void;
}

/**
 * "Continue with Apple" for the login and signup screens (iOS app only).
 *
 * Mirrors the native half of useGoogleSignIn: the system sheet gives a session
 * directly, then /auth/callback does the profile upsert, onboarding and the
 * post-auth destination, so none of that is duplicated here.
 */
export function useAppleSignIn({
	source,
	redirectTo,
	onSettled,
}: UseAppleSignInOptions) {
	const navigate = useNavigate();
	const toast = useToast();

	const signIn = useCallback(async () => {
		rememberAuthContinuation({ redirectTo, source, authMethod: "apple" });
		const result = await signInWithAppleNative();
		if (!result.ok) {
			clearAuthContinuation();
			// Closing the sheet is a choice, not a failure.
			if (!result.cancelled) toast.error(result.error);
			onSettled?.();
			return;
		}
		navigate({ to: "/auth/callback" });
	}, [navigate, onSettled, redirectTo, source, toast]);

	return { signIn, isAvailable: isNativeAppleAuthAvailable() };
}
