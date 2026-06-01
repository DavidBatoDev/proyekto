import {
  createFileRoute,
  Link,
  useNavigate,
  redirect,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import {
  confirmEmailVerificationCode,
  requestEmailVerificationCode,
} from "../../lib/email-otp-api";
import { Eye, EyeOff } from "lucide-react";
import { SignupLayout } from "../../components/auth/signup/SignupLayout";
import { BrandMark } from "@/components/brand/BrandMark";

export const Route = createFileRoute("/auth/login")({
  // Return an OPTIONAL `redirect` key (omit it entirely when absent) so that
  // navigating to /auth/login does not require a `search` param at call sites.
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string } => {
    const r = search.redirect;
    return typeof r === "string" && r.length > 0 ? { redirect: r } : {};
  },
  beforeLoad: ({ search }) => {
    const { isAuthenticated, isLoading } = useAuthStore.getState();

    // Only redirect if auth is loaded and user is authenticated
    if (!isLoading && isAuthenticated) {
      throw redirect({ to: (search.redirect as string) || "/dashboard" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { redirect: redirectTo } = Route.useSearch();
  const signIn = useAuthStore((state) => state.signIn);
  const signOut = useAuthStore((state) => state.signOut);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthLoading = useAuthStore((state) => state.isLoading);
  const navigate = useNavigate();
  const toast = useToast();

  const isInviteFlow = !!redirectTo?.includes("invites");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate({ to: redirectTo || "/dashboard" });
    }
  }, [isAuthenticated, isAuthLoading, navigate, redirectTo]);

  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyStep, setIsVerifyStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "52px",
    padding: "0 16px",
    borderRadius: "12px",
    border: "1px solid #CBD5E1",
    fontSize: "0.95rem",
    color: "#0F172A",
    background: "white",
    outline: "none",
    fontFamily: "'Manrope', sans-serif",
    boxSizing: "border-box",
    transition: "border 0.15s, box-shadow 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "#334155",
    marginBottom: "7px",
    fontFamily: "'Manrope', sans-serif",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  function focusInput(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.border = "1px solid #334155";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(51,65,85,0.15)";
  }

  function blurInput(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.border = "1px solid #CBD5E1";
    e.currentTarget.style.boxShadow = "none";
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error) {
      setIsLoading(false);
      toast.error(
        error instanceof Error ? error.message : "Google sign-in failed",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Ensure any previous session is cleared before attempting login
      try {
        await signOut();
      } catch {
        // ignore sign out errors
      }

      await signIn(email, password);

      // Check profile verification status and onboarding
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select(
            "is_email_verified, first_name, last_name, has_completed_onboarding, settings",
          )
          .eq("id", userId)
          .maybeSingle();

        if (profile && profile.is_email_verified === false) {
          // Store profile names for verification email
          setFirstName(profile.first_name || "");
          setLastName(profile.last_name || "");

          // Force local sign out before verification flow.
          await signOut();

          // Request verification code from backend and show verification UI
          setVerificationCode("");
          try {
            await requestEmailVerificationCode({
              email,
              firstName: profile.first_name || "",
              lastName: profile.last_name || "",
              purpose: "login",
            });
            toast.success("Check your email for the verification code");
          } catch (sendError) {
            toast.error(
              sendError instanceof Error
                ? sendError.message
                : "Verification email could not be sent. You can resend the code.",
            );
          }
          setIsVerifyStep(true);
          setIsLoading(false);
          return;
        }

        if (!profile?.has_completed_onboarding) {
          // Must complete onboarding first; invite will still be waiting after.
          navigate({ to: "/welcome" });
        } else {
          navigate({ to: redirectTo || "/dashboard" });
        }
      } else {
        navigate({ to: redirectTo || "/dashboard" });
      }
    } catch (err) {
      console.error("Login error:", err);

      // Provide user-friendly error messages
      const error = err as any;
      let errorMessage = "Login failed";

      if (error?.message) {
        const msg = error.message.toLowerCase();

        if (
          msg.includes("invalid login credentials") ||
          msg.includes("invalid email or password")
        ) {
          errorMessage = "Invalid email or password. Please try again.";
        } else if (msg.includes("email not confirmed")) {
          errorMessage = "Please verify your email before logging in.";
        } else if (msg.includes("user not found")) {
          errorMessage = "No account found with this email.";
        } else if (msg.includes("too many requests")) {
          errorMessage = "Too many login attempts. Please try again later.";
        } else {
          errorMessage = error.message;
        }
      }

      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (isVerifyStep) {
    return (
      <SignupLayout>
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          <BrandMark className="h-8 text-slate-900" />

          <div>
            <h1
              style={{
                fontFamily: "'Sora', 'Manrope', sans-serif",
                fontSize: "1.9rem",
                fontWeight: 700,
                color: "#0F172A",
                margin: "0 0 10px",
              }}
            >
              Verify your email
            </h1>
            <p
              style={{
                color: "#6B6B6B",
                fontSize: "0.95rem",
                margin: 0,
                lineHeight: 1.6,
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              We sent a 6-digit code to{" "}
              <strong style={{ color: "#0F172A" }}>{email}</strong>. Enter it
              below to finish signing in.
            </p>
          </div>

          <form
            onSubmit={async (evt) => {
              evt.preventDefault();
              if (!verificationCode) {
                toast.error("Please enter the verification code");
                return;
              }
              setVerifyLoading(true);
              try {
                await confirmEmailVerificationCode({
                  email,
                  code: verificationCode,
                });

                const { error: signInError } =
                  await supabase.auth.signInWithPassword({ email, password });
                if (signInError) throw signInError;
                toast.success("Email verified successfully!");
                navigate({ to: "/onboarding" });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Verification failed",
                );
              } finally {
                setVerifyLoading(false);
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
            <div>
              <label style={labelStyle}>Verification Code</label>
              <input
                type="text"
                placeholder="000000"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(
                    e.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                required
                maxLength={6}
                style={{
                  ...inputStyle,
                  textAlign: "center",
                  fontSize: "1.6rem",
                  letterSpacing: "0.3em",
                  fontWeight: 700,
                }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
            </div>

            <button
              type="submit"
              disabled={verifyLoading}
              style={{
                width: "100%",
                height: "52px",
                borderRadius: "12px",
                border: "none",
                background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 52%, #312E81 100%)",
                color: "white",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: verifyLoading ? "not-allowed" : "pointer",
                opacity: verifyLoading ? 0.7 : 1,
                fontFamily: "'Manrope', sans-serif",
                transition: "opacity 0.2s",
                boxShadow: "0 8px 20px rgba(15,23,42,0.25)",
              }}
            >
              {verifyLoading ? "Verifying..." : "Verify & Sign In"}
            </button>
            <p
              style={{
                textAlign: "center",
                fontSize: "12px",
                color: "#64748B",
                margin: "-6px 0 0",
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 600,
              }}
            >
              Takes less than 3 minutes
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <button
                type="button"
                disabled={isResending}
                onClick={async () => {
                  setIsResending(true);
                  try {
                    setVerificationCode("");
                    await requestEmailVerificationCode({
                      email,
                      firstName: firstName || "",
                      lastName: lastName || "",
                      purpose: "login",
                    });
                    toast.success("Verification code resent to your email");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to resend code",
                    );
                  } finally {
                    setIsResending(false);
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#1E293B",
                  fontSize: "0.9rem",
                  cursor: isResending ? "not-allowed" : "pointer",
                  fontFamily: "'Manrope', sans-serif",
                  opacity: isResending ? 0.6 : 1,
                  fontWeight: 700,
                }}
              >
                {isResending ? "Resending..." : "Resend Code"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsVerifyStep(false);
                  setVerificationCode("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#94A3B8",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  fontFamily: "'Manrope', sans-serif",
                }}
              >
                ? Back to login
              </button>
            </div>
          </form>
        </div>
      </SignupLayout>
    );
  }

  return (
    <SignupLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
        {/* Logo */}
        <BrandMark className="h-8 text-slate-900" />

        {/* Invite context banner */}
        {isInviteFlow && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #86EFAC",
              borderRadius: "12px",
              padding: "12px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>✉️</span>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#166534", lineHeight: 1.5 }}>
              <strong>You've been invited to join a project.</strong>{" "}
              Please create an account or sign in first to join.
            </p>
          </div>
        )}

        {/* Header */}
        <div>
          <h1
            style={{
              fontFamily: "'Sora', 'Manrope', sans-serif",
              fontSize: "1.9rem",
              fontWeight: 700,
              color: "#0F172A",
              margin: "0 0 8px",
            }}
          >
            Turn ideas into structured execution.
          </h1>
          <p
            style={{
              color: "#475569",
              fontSize: "0.95rem",
              margin: 0,
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            Start your roadmap, match with experts, and execute in one system.
          </p>
        </div>

        {/* Google Sign-In */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          style={{
            width: "100%",
            height: "52px",
            borderRadius: "12px",
            border: "1px solid #CBD5E1",
            background: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontSize: "0.95rem",
            fontWeight: 700,
            color: "#0F172A",
            fontFamily: "'Manrope', sans-serif",
            transition: "box-shadow 0.2s",
            opacity: isLoading ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <img
            src="/images/logos/google.png"
            alt="Google"
            style={{ width: "20px", height: "20px", objectFit: "contain" }}
          />
          {isLoading ? "Redirecting to Google..." : "Continue with Google"}
        </button>

        {/* OR divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1, height: "1px", background: "#CBD5E1" }} />
          <span
            style={{
              fontSize: "0.78rem",
              color: "#94A3B8",
              fontWeight: 600,
              fontFamily: "'Manrope', sans-serif",
              letterSpacing: "0.05em",
            }}
          >
            OR
          </span>
          <div style={{ flex: 1, height: "1px", background: "#CBD5E1" }} />
        </div>

        {/* Login form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {/* Email */}
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              onFocus={focusInput}
              onBlur={blurInput}
            />
          </div>

          {/* Password */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "7px",
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>Password</label>
              <button
                type="button"
                onClick={() => navigate({ to: "/auth/forgot-password" })}
                style={{
                  background: "none",
                  border: "none",
                  color: "#1E293B",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  fontFamily: "'Manrope', sans-serif",
                  padding: 0,
                  fontWeight: 700,
                }}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ ...inputStyle, paddingRight: "48px" }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  right: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#94A3B8",
                  display: "flex",
                  alignItems: "center",
                  padding: 0,
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Keep me logged in */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              style={{
                width: "16px",
                height: "16px",
                accentColor: "#1E293B",
                cursor: "pointer",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "0.9rem",
                color: "#475569",
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              Keep me logged in
            </span>
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            aria-busy={isLoading}
            aria-disabled={isLoading}
            style={{
              width: "100%",
              height: "52px",
              borderRadius: "12px",
              border: "none",
              marginTop: "4px",
              background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 52%, #312E81 100%)",
              color: "white",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.7 : 1,
              fontFamily: "'Manrope', sans-serif",
              transition: "opacity 0.2s, transform 0.15s",
              boxShadow: "0 8px 20px rgba(15,23,42,0.25)",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {isLoading ? "Signing in..." : "Log In"}
          </button>
          <p
            style={{
              textAlign: "center",
              fontSize: "12px",
              color: "#64748B",
              margin: "-4px 0 0",
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 600,
            }}
          >
            Takes less than 3 minutes
          </p>
        </form>

        {/* Sign up link */}
        <p
          style={{
            textAlign: "center",
            fontSize: "0.9rem",
            color: "#64748B",
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          New to Proyekto?{" "}
          <Link
            to="/auth/signup"
            search={redirectTo ? { redirect: redirectTo } : {}}
            style={{ color: "#1E293B", fontWeight: 700, textDecoration: "none" }}
          >
            Create an account
          </Link>
        </p>
      </div>
    </SignupLayout>
  );
}

