import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CircularProgress } from "@mui/material";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useToast } from "../../hooks/useToast";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const finalizeOAuth = async () => {
      try {
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
        const derivedName = [firstName, lastName].filter(Boolean).join(" ").trim();
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

        if (profile?.has_completed_onboarding) {
          navigate({ to: "/dashboard", replace: true });
        } else {
          // Both lanes route through /welcome — the welcome route renders
          // a lane-specific deck. OAuth users default to client_freelancer
          // since the lane query param doesn't survive Google's roundtrip.
          navigate({ to: "/welcome", replace: true });
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
        toast.error(
          error instanceof Error ? error.message : "Google sign-in failed",
        );
        navigate({ to: "/auth/login", replace: true });
      }
    };

    finalizeOAuth();
  }, [navigate, toast]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
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
            color: "#6B6B6B",
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
