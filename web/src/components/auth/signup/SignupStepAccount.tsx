import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FloatingInput } from "./FloatingInput";
import { GoogleButton } from "./SignupButtons";
import { WizardNav } from "./WizardNav";
import { supabase } from "../../../lib/supabase";
import { useToast } from "../../../hooks/useToast";
import {
  clearAuthContinuation,
  rememberAuthContinuation,
  type AuthContinuationIntent,
  type AuthContinuationLane,
} from "@/lib/authContinuation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignupStepAccountProps {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  onNext: () => void;
  onBack?: () => void;
  authRedirect?: string;
  authLane?: AuthContinuationLane;
  authIntent?: AuthContinuationIntent;
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

type FieldErrors = { firstName: string; lastName: string; email: string };

export function SignupStepAccount({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  onNext,
  onBack,
  authRedirect,
  authLane,
  authIntent,
}: SignupStepAccountProps) {
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({
    firstName: "",
    lastName: "",
    email: "",
  });

  const handleGoogleSignIn = async () => {
    try {
      rememberAuthContinuation({
        redirectTo: authRedirect,
        source: "signup",
        authMethod: "google",
        lane: authLane,
        intent: authIntent,
      });

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (error) {
      clearAuthContinuation();
      toast.error(
        error instanceof Error ? error.message : "Google sign-in failed",
      );
    }
  };

  const validateField = (field: keyof FieldErrors, value: string): string => {
    if (field === "firstName") return !value.trim() ? "First name is required" : "";
    if (field === "lastName") return !value.trim() ? "Last name is required" : "";
    if (!value.trim()) return "Email is required";
    if (!EMAIL_RE.test(value.trim())) return "Enter a valid email address";
    return "";
  };

  const handleBlur = (field: keyof FieldErrors, value: string) => {
    setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
  };

  // Clear the error for a field as soon as the new value passes validation.
  const handleChange = (
    field: keyof FieldErrors,
    value: string,
    setter: (v: string) => void,
  ) => {
    setter(value);
    if (errors[field] && !validateField(field, value)) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const isFormValid =
    !!firstName.trim() &&
    !!lastName.trim() &&
    EMAIL_RE.test(email.trim());

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FieldErrors = {
      firstName: validateField("firstName", firstName),
      lastName: validateField("lastName", lastName),
      email: validateField("email", email),
    };
    if (Object.values(newErrors).some(Boolean)) {
      setErrors(newErrors);
      return;
    }
    onNext();
  };

  return (
    <form onSubmit={handleNext} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h2
          style={{
            fontFamily: "'Sora', 'Manrope', sans-serif",
            fontSize: "1.4rem",
            fontWeight: 700,
            color: "#0F172A",
            margin: "0 0 4px",
            lineHeight: 1.25,
          }}
        >
          Create your account
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "#64748B",
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          We'll send a verification code to your email.
        </p>
      </div>

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
          onChange={(v) => handleChange("firstName", v, setFirstName)}
          onBlur={() => handleBlur("firstName", firstName)}
          error={errors.firstName}
          required
          autoComplete="given-name"
        />
        <FloatingInput
          label="Last Name"
          value={lastName}
          onChange={(v) => handleChange("lastName", v, setLastName)}
          onBlur={() => handleBlur("lastName", lastName)}
          error={errors.lastName}
          required
          autoComplete="family-name"
        />
      </div>

      {/* Email */}
      <FloatingInput
        label="Email"
        type="email"
        value={email}
        onChange={(v) => handleChange("email", v, setEmail)}
        onBlur={() => handleBlur("email", email)}
        error={errors.email}
        required
        autoComplete="email"
      />

      <WizardNav
        onBack={onBack}
        primaryLabel="Continue"
        primaryDisabled={!isFormValid}
      />
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
          search={authRedirect ? { redirect: authRedirect } : {}}
          style={{ color: "#1E293B", fontWeight: 700, textDecoration: "none" }}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
