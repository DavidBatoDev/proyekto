import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FloatingInput } from "./FloatingInput";
import { PasswordStrength } from "./PasswordStrength";
import { PrimaryButton, GoogleButton } from "./SignupButtons";
import { supabase } from "../../../lib/supabase";
import { useToast } from "../../../hooks/useToast";

interface SignupStepAccountProps {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  onNext: () => void;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20C7 20 2.73 16.39 1 12a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c5 0 9.27 3.61 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function SignupStepAccount({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  onNext,
}: SignupStepAccountProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const toast = useToast();

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Google sign-in failed",
      );
    }
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password || !confirmPassword) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    onNext();
  };

  return (
    <form onSubmit={handleNext} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Google button */}
      <GoogleButton onClick={handleGoogleSignIn}>
        <GoogleIcon />
        Continue with Google
      </GoogleButton>

      {/* Or divider */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ flex: 1, height: "1px", background: "#CBD5E1" }} />
        <span
          style={{
            fontSize: "12px",
            color: "#94A3B8",
            fontWeight: 500,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          or continue with email
        </span>
        <div style={{ flex: 1, height: "1px", background: "#CBD5E1" }} />
      </div>

      {/* Name row */}
      <div style={{ display: "flex", gap: "12px" }}>
        <FloatingInput
          label="First Name"
          value={firstName}
          onChange={setFirstName}
          required
          autoComplete="given-name"
        />
        <FloatingInput
          label="Last Name"
          value={lastName}
          onChange={setLastName}
          required
          autoComplete="family-name"
        />
      </div>

      {/* Email */}
      <FloatingInput
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
      />

      {/* Password */}
      <div>
        <FloatingInput
          label="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={setPassword}
          required
          autoComplete="new-password"
          rightElement={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                color: "#94A3B8",
                display: "flex",
                alignItems: "center",
              }}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon visible={showPassword} />
            </button>
          }
        />
        <PasswordStrength password={password} />
      </div>

      {/* Confirm password */}
      <FloatingInput
        label="Confirm Password"
        type={showConfirm ? "text" : "password"}
        value={confirmPassword}
        onChange={setConfirmPassword}
        required
        autoComplete="new-password"
        rightElement={
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px",
              color: "#94A3B8",
              display: "flex",
              alignItems: "center",
            }}
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            <EyeIcon visible={showConfirm} />
          </button>
        }
      />

      {/* Continue button */}
      <PrimaryButton type="submit" style={{ marginTop: "4px" }}>
        Continue →
      </PrimaryButton>
      <p
        style={{
          textAlign: "center",
          fontSize: "12px",
          color: "#64748B",
          margin: "-2px 0 0",
          fontFamily: "'Manrope', sans-serif",
          fontWeight: 600,
        }}
      >
        Takes less than 3 minutes
      </p>

      {/* Login link */}
      <p
        style={{
          textAlign: "center",
          fontSize: "13px",
          color: "#94A3B8",
          margin: 0,
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        Already have an account?{" "}
        <Link
          to="/auth/login"
          style={{ color: "#1E293B", fontWeight: 700, textDecoration: "none" }}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

