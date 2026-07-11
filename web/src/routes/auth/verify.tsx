import {
  createFileRoute,
  useNavigate,
  useSearch,
  Link,
} from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import { CircularProgress, Button } from "@mui/material";

export const Route = createFileRoute("/auth/verify")({
  component: VerifyEmailComponent,
});

interface VerifySearch {
  email?: string;
  code?: string;
}

function VerifyEmailComponent() {
  const search = useSearch({ from: "/auth/verify" });
  const { email = "", code = "" } = (search || {}) as VerifySearch;
  const navigate = useNavigate();
  const toast = useToast();
  const [isVerifying, setIsVerifying] = useState(true);
  const [success, setSuccess] = useState(false);

  const assets = useMemo(
    () => ({
      ellipse28:
        "https://www.figma.com/api/mcp/asset/40e62b5c-fc97-410f-b33c-d2e8283b208d",
      ellipse29:
        "https://www.figma.com/api/mcp/asset/01ff7abc-8e87-4c32-9f9b-5a384b30af5d",
      accent:
        "https://www.figma.com/api/mcp/asset/1a713252-c509-4cef-8a26-4ab7db43b0cb",
    }),
    []
  );

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        if (!email || !code) {
          throw new Error("Invalid verification link");
        }

        // Get current user
        const { data: authData, error: authError } =
          await supabase.auth.getUser();
        if (authError || !authData.user) {
          throw new Error("User not found. Please sign up again.");
        }

        // Update is_email_verified in profiles
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ is_email_verified: true })
          .eq("id", authData.user.id);

        if (updateError) throw updateError;

        setSuccess(true);
        setIsVerifying(false);
        toast.success("Email verified successfully!");
        setTimeout(() => navigate({ to: "/" }), 3000);
      } catch (err) {
        setIsVerifying(false);
        const errorMsg =
          err instanceof Error ? err.message : "Verification failed";
        toast.error(errorMsg);
      }
    };

    verifyEmail();
  }, [email, code, navigate, toast]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Background Elements */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_60%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_65%)]" />
      <img
        src={assets.ellipse28}
        alt=""
        className="pointer-events-none absolute -left-40 top-1/2 h-[414px] w-[414px] -translate-y-1/2 opacity-50"
      />
      <img
        src={assets.accent}
        alt=""
        className="pointer-events-none absolute right-0 top-0 h-full max-w-[50%] object-cover"
      />

      {/* Content */}
      <div className="relative w-full max-w-md">
        <div className="rounded-lg border border-border bg-card p-8 text-center text-card-foreground shadow-xl">
          {isVerifying ? (
            <>
              <div className="mb-6 flex justify-center">
                <CircularProgress size={64} sx={{ color: "#ff9900" }} />
              </div>
              <h2 className="mb-3 text-2xl font-bold text-foreground">
                Verifying Your Email
              </h2>
              <p className="text-muted-foreground">
                Please wait while we verify your email address. This should only
                take a moment.
              </p>
            </>
          ) : success ? (
            <>
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                  <svg
                    className="h-8 w-8 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <h2 className="mb-3 text-2xl font-bold text-foreground">
                Email Verified Successfully
              </h2>
              <p className="mb-6 text-muted-foreground">
                Thank you for verifying your email. Your account is now fully
                activated and ready to use.
              </p>
              <Button
                component={Link}
                to="/"
                variant="contained"
                sx={{
                  backgroundColor: "#ff9900",
                  color: "white",
                  textTransform: "none",
                  fontSize: "16px",
                  fontWeight: 600,
                  padding: "10px 32px",
                  borderRadius: "6px",
                  "&:hover": {
                    backgroundColor: "#e68a00",
                  },
                }}
              >
                Go to Dashboard
              </Button>
            </>
          ) : (
            <>
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <svg
                    className="h-8 w-8 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              </div>
              <h2 className="mb-3 text-2xl font-bold text-[#1f2937]">
                Verification Failed
              </h2>
              <p className="mb-6 text-[#6b7280]">
                We were unable to verify your email. The link may have expired
                or been invalid.
              </p>
              <Button
                component={Link}
                to="/auth/signup"
                variant="contained"
                sx={{
                  backgroundColor: "#ff9900",
                  color: "white",
                  textTransform: "none",
                  fontSize: "16px",
                  fontWeight: 600,
                  padding: "10px 32px",
                  borderRadius: "6px",
                  "&:hover": {
                    backgroundColor: "#e68a00",
                  },
                }}
              >
                Back to Sign Up
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
