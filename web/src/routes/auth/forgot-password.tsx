import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SignupLayout } from "../../components/auth/signup/SignupLayout";
import { useToast } from "../../hooks/useToast";
import {
  confirmPasswordResetCode,
  requestPasswordResetCode,
} from "../../lib/email-otp-api";
import { BrandMark } from "@/components/brand/BrandMark";

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPasswordRoute,
});

function ForgotPasswordRoute() {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isEmailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const emailError =
    emailTouched && !isEmailValid
      ? "Enter a valid email address."
      : "";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "52px",
    padding: "0 16px",
    borderRadius: "10px",
    border: "1px solid #E5E5E5",
    fontSize: "0.95rem",
    color: "#2E2E2E",
    background: "white",
    outline: "none",
    fontFamily: "'Open Sans', sans-serif",
    boxSizing: "border-box",
    transition: "border 0.15s, box-shadow 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "#2E2E2E",
    marginBottom: "7px",
    fontFamily: "'Open Sans', sans-serif",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  function focusInput(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.border = "1px solid #FF962E";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,150,46,0.12)";
  }

  function blurInput(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.border = "1px solid #E5E5E5";
    e.currentTarget.style.boxShadow = "none";
  }

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();

    setEmailTouched(true);
    if (!isEmailValid) {
      return;
    }

    setIsLoading(true);
    try {
      await requestPasswordResetCode({ email });
      toast.success("Check your email for the reset code");
      setStep("verify");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send reset code",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function verifyAndReset(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (!code || code.length !== 6) {
        toast.error("Enter the 6-digit code");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }

      await confirmPasswordResetCode({ email, code, newPassword });

      toast.success("Password updated. Please log in.");
      navigate({ to: "/auth/login" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reset password",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SignupLayout>
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #EEEEEE",
          borderRadius: "16px",
          padding: "28px 24px",
          boxShadow: "0 6px 20px rgba(18, 18, 18, 0.06)",
          transition: "box-shadow 0.2s ease, transform 0.2s ease",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <BrandMark className="h-8 text-primary" />

        <div>
          <h1
            style={{
              fontFamily: "'Glacial Indifference', 'Open Sans', sans-serif",
              fontSize: "1.9rem",
              fontWeight: 700,
              color: "#2E2E2E",
              margin: "0 0 10px",
            }}
          >
            Forgot your password?
          </h1>
          <p
            style={{
              color: "#6B6B6B",
              fontSize: "0.95rem",
              margin: 0,
              lineHeight: 1.6,
              fontFamily: "'Open Sans', sans-serif",
            }}
          >
            {step === "request"
              ? "Enter your email and we’ll send you a verification code to reset your password."
              : "Enter the verification code from your email and set your new password."}
          </p>
        </div>

        {step === "request" ? (
          <form onSubmit={requestReset} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div>
              <label htmlFor="forgot-email" style={labelStyle}>
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => {
                  setEmailTouched(true);
                  blurInput(e);
                }}
                required
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? "forgot-email-error" : "forgot-email-help"}
                style={inputStyle}
                onFocus={focusInput}
              />
              <p
                id="forgot-email-help"
                style={{
                  margin: "8px 0 0",
                  fontSize: "0.82rem",
                  color: "#8A8A8A",
                  fontFamily: "'Open Sans', sans-serif",
                }}
              >
                Make sure this is the email associated with your account.
              </p>
              {emailError ? (
                <p
                  id="forgot-email-error"
                  role="alert"
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.82rem",
                    color: "#D14343",
                    fontFamily: "'Open Sans', sans-serif",
                  }}
                >
                  {emailError}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              aria-disabled={isLoading}
              style={{
                width: "100%",
                height: "52px",
                borderRadius: "10px",
                border: "none",
                marginTop: "6px",
                background:
                  "linear-gradient(135deg, #E11C84 0%, #FF2D75 40%, #FF962E 100%)",
                color: "white",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                fontFamily: "'Open Sans', sans-serif",
                transition: "opacity 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {isLoading ? "Sending..." : "Send Code"}
            </button>

            <Link
              to="/auth/login"
              style={{
                textAlign: "center",
                fontSize: "0.9rem",
                color: "#6B6B6B",
                marginTop: "2px",
                fontFamily: "'Open Sans', sans-serif",
                textDecoration: "none",
              }}
            >
              Back to login
            </Link>
          </form>
        ) : (
          <form onSubmit={verifyAndReset} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label htmlFor="forgot-code" style={labelStyle}>
                Verification Code
              </label>
              <input
                id="forgot-code"
                type="text"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                style={{
                  ...inputStyle,
                  textAlign: "center",
                  fontSize: "1.4rem",
                  letterSpacing: "0.3em",
                  fontWeight: 700,
                }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
            </div>

            <div>
              <label htmlFor="forgot-password" style={labelStyle}>
                New Password
              </label>
              <input
                id="forgot-password"
                type="password"
                placeholder="Enter your new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                style={inputStyle}
                onFocus={focusInput}
                onBlur={blurInput}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              aria-disabled={isLoading}
              style={{
                width: "100%",
                height: "52px",
                borderRadius: "10px",
                border: "none",
                marginTop: "6px",
                background:
                  "linear-gradient(135deg, #E11C84 0%, #FF2D75 40%, #FF962E 100%)",
                color: "white",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.7 : 1,
                fontFamily: "'Open Sans', sans-serif",
                transition: "opacity 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!isLoading) e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {isLoading ? "Resetting..." : "Reset Password"}
            </button>

            <button
              type="button"
              onClick={() => setStep("request")}
              style={{
                background: "none",
                border: "none",
                color: "#6B6B6B",
                fontSize: "0.9rem",
                cursor: "pointer",
                fontFamily: "'Open Sans', sans-serif",
                textDecoration: "underline",
              }}
            >
              Resend Code
            </button>
          </form>
        )}
      </div>
    </SignupLayout>
  );
}
