import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircularProgress } from "@mui/material";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useToast } from "../../hooks/useToast";
import { completeOnboarding, type OnboardingLane } from "../../lib/auth-api";
import { fetchProfile, profileKeys } from "../../queries/profile";
import {
	clearAuthContinuation,
	getAuthContinuation,
	resolvePostAuthDestination,
} from "@/lib/authContinuation";

export const Route = createFileRoute("/auth/callback")({
	component: AuthCallbackPage,
});

function AuthCallbackPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const queryClient = useQueryClient();

	useEffect(() => {
		const finalizeOAuth = async () => {
			try {
				const continuation = getAuthContinuation();
				const callbackRedirect =
					typeof window === "undefined"
						? null
						: new URLSearchParams(window.location.search).get("redirect");

				const {
					data: { session },
					error: sessionError,
				} = await supabase.auth.getSession();
				if (sessionError) {
					throw sessionError;
				}
				if (!session?.user) {
					throw new Error("No authenticated session returned from Google.");
				}

				const user = session.user;
				const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
				const email = user.email ?? null;
				if (!email) {
					throw new Error("Google account did not provide an email address.");
				}
				const firstName =
					typeof metadata.given_name === "string"
						? metadata.given_name
						: typeof metadata.first_name === "string"
							? metadata.first_name
							: null;
				const lastName =
					typeof metadata.family_name === "string"
						? metadata.family_name
						: typeof metadata.last_name === "string"
							? metadata.last_name
							: null;
				const fullName =
					typeof metadata.full_name === "string"
						? metadata.full_name
						: typeof metadata.name === "string"
							? metadata.name
							: null;
				const derivedName = [firstName, lastName]
					.filter(Boolean)
					.join(" ")
					.trim();
				const displayName = fullName ?? (derivedName || email.split("@")[0]);
				const avatarUrl =
					typeof metadata.avatar_url === "string"
						? metadata.avatar_url
						: typeof metadata.picture === "string"
							? metadata.picture
							: null;

				const { error: profileError } = await supabase.from("profiles").upsert(
					{
						id: user.id,
						email,
						first_name: firstName,
						last_name: lastName,
						display_name: displayName,
						avatar_url: avatarUrl,
						is_email_verified: true,
					},
					{ onConflict: "id" },
				);

				if (profileError) {
					throw profileError;
				}

				const { data: profile, error: fetchProfileError } = await supabase
					.from("profiles")
					.select("has_completed_onboarding, settings")
					.eq("id", user.id)
					.maybeSingle();
				if (fetchProfileError) {
					throw fetchProfileError;
				}

				useAuthStore.setState({
					session,
					user,
					isAuthenticated: true,
					isLoading: false,
					profile: null,
				});

				sessionStorage.removeItem("isInSignupFlow");
				sessionStorage.removeItem("signupStep");

				const hadCompletedOnboarding = Boolean(
					profile?.has_completed_onboarding,
				);

				if (hadCompletedOnboarding) {
					const destination = resolvePostAuthDestination({
						explicitRedirect: callbackRedirect,
						hasCompletedOnboarding: true,
					});
					if (destination !== "/welcome") {
						clearAuthContinuation();
					}
					navigate({ to: destination, replace: true });
				} else {
					// Google users never ran the signup-time onboarding step that the
					// password flow runs. Complete it idempotently, then show Welcome once.
					// If signup started from a specific lane, the continuation preserves it.
					const lane: OnboardingLane =
						continuation?.lane === "consultant"
							? "consultant"
							: "client_freelancer";

					try {
						await completeOnboarding({
							lane,
							intent:
								lane === "consultant"
									? { client: false, freelancer: false }
									: {
											client: continuation?.intent !== "freelancer",
											freelancer: continuation?.intent === "freelancer",
										},
						});
					} catch (err) {
						// Non-fatal: the welcome deck re-attempts completion as a backstop.
						console.error("OAuth onboarding completion failed:", err);
					}
					// Seed the profile the same way the password signup flow does
					// (SignupForm.tsx), so /welcome renders immediately instead of hanging
					// on a null profile until a manual refresh.
					try {
						const fresh = await fetchProfile(user.id);
						queryClient.setQueryData(profileKeys.byUser(user.id), fresh);
						useAuthStore.setState({ profile: fresh });
					} catch (refetchErr) {
						console.error(
							"Profile refetch after OAuth onboarding failed:",
							refetchErr,
						);
					}
					const destination = resolvePostAuthDestination({
						explicitRedirect: callbackRedirect,
						hasCompletedOnboarding: false,
					});
					if (destination !== "/welcome") {
						clearAuthContinuation();
					}
					navigate({ to: destination, replace: true });
				}
			} catch (error) {
				clearAuthContinuation();
				console.error("OAuth callback error:", error);
				toast.error(
					error instanceof Error ? error.message : "Google sign-in failed",
				);
				navigate({ to: "/auth/login", replace: true });
			}
		};

		finalizeOAuth();
	}, [navigate, toast, queryClient]);

	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--background)",
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "14px",
				}}
			>
				<CircularProgress size={42} sx={{ color: "#FF962E" }} />
				<p
					style={{
						margin: 0,
						color: "var(--muted-foreground)",
						fontFamily: "'Open Sans', sans-serif",
						fontSize: "14px",
					}}
				>
					Finishing Google sign-in...
				</p>
			</div>
		</div>
	);
}
