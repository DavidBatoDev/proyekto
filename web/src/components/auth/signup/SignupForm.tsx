import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuthStore } from "../../../stores/authStore";
import { supabase } from "../../../lib/supabase";
import { useToast } from "../../../hooks/useToast";
import { fetchProfile, profileKeys } from "../../../queries/profile";
import { completeOnboarding, type OnboardingLane } from "../../../lib/auth-api";
import {
  confirmEmailVerificationCode,
  requestEmailVerificationCode,
} from "../../../lib/email-otp-api";
import { SignupStepLane } from "./SignupStepLane";
import { SignupStepAccount } from "./SignupStepAccount";
import { SignupStepPassword } from "./SignupStepPassword";
import { SignupStepProfile } from "./SignupStepProfile";
import { BrandMark } from "@/components/brand/BrandMark";

interface SignupFormProps {
  redirectUrl?: string;
}

// ── Motion variants ────────────────────────────────────────────────────────
const slideIn = {
  initial: { x: 24, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: -24, opacity: 0 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};
const slideInReverse = {
  initial: { x: -24, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 24, opacity: 0 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};

export function SignupForm(_props: SignupFormProps) {
  const signUp = useAuthStore((state) => state.signUp);
  const signOut = useAuthStore((state) => state.signOut);
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth/signup" }) as {
    redirect?: string;
    intent?: "client" | "freelancer";
    lane?: OnboardingLane;
  };
  const toast = useToast();
  const queryClient = useQueryClient();

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getStored = (key: string, fallback = "") =>
    sessionStorage.getItem(key) ?? fallback;

  // ── Lane resolution ──────────────────────────────────────────────────────
  // Priority: explicit ?lane= search param wins (homepage CTA pre-selects),
  // then sessionStorage (carried across multi-step wizard reloads), then
  // default. Lane is editable from Step 1 (the lane picker); whatever the
  // user lands on is persisted to sessionStorage so the wizard survives
  // refreshes without losing the choice.
  const resolveLane = (): OnboardingLane => {
    if (search.lane) {
      sessionStorage.setItem("signup_lane", search.lane);
      return search.lane;
    }
    const stored = sessionStorage.getItem("signup_lane");
    if (stored === "client_freelancer" || stored === "consultant") {
      return stored;
    }
    sessionStorage.setItem("signup_lane", "client_freelancer");
    return "client_freelancer";
  };
  const [lane, setLaneState] = useState<OnboardingLane>(() => resolveLane());
  const setLane = (next: OnboardingLane) => {
    sessionStorage.setItem("signup_lane", next);
    setLaneState(next);
  };

  // ── Step state (1=Lane, 2=Account, 3=Password, 4=Profile, 5=Verify) ─────
  const [step, setStepState] = useState<1 | 2 | 3 | 4 | 5>(() => {
    const saved = parseInt(sessionStorage.getItem("signupStep") ?? "1");
    return (saved as 1 | 2 | 3 | 4 | 5) || 1;
  });
  const [prevStep, setPrevStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const setStep = (n: 1 | 2 | 3 | 4 | 5) => {
    setPrevStep(step);
    sessionStorage.setItem("signupStep", n.toString());
    setStepState(n);
  };

  // ── Form fields ──────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState(() => getStored("signup_firstName"));
  const [lastName, setLastName] = useState(() => getStored("signup_lastName"));
  const [email, setEmail] = useState(() => getStored("signup_email"));
  const [password, setPassword] = useState(() => getStored("signup_password"));
  const [confirmPassword, setConfirmPassword] = useState(() =>
    getStored("signup_confirmPassword"),
  );
  const [gender, setGender] = useState(() => getStored("signup_gender"));
  const [phoneNumber, setPhoneNumber] = useState(() => getStored("signup_phoneNumber"));
  const [dateOfBirth, setDateOfBirth] = useState(() => getStored("signup_dateOfBirth"));
  const [country, setCountry] = useState(() => getStored("signup_country"));
  const [city, setCity] = useState(() => getStored("signup_city"));
  const [zipCode, setZipCode] = useState(() => getStored("signup_zipCode"));
  const [acceptedTerms, setAcceptedTerms] = useState(
    () => getStored("signup_acceptedTerms", "false") === "true",
  );

  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // ── Utilities ────────────────────────────────────────────────────────────

  const clearSignupData = () => {
    [
      "signupStep",
      "isInSignupFlow",
      "signup_firstName",
      "signup_lastName",
      "signup_gender",
      "signup_phoneNumber",
      "signup_email",
      "signup_dateOfBirth",
      "signup_country",
      "signup_city",
      "signup_zipCode",
      "signup_password",
      "signup_confirmPassword",
      "signup_acceptedTerms",
      "signup_redirect",
      "signup_lane",
    ].forEach((k) => sessionStorage.removeItem(k));
  };

  // ── Step 1 → 2 (lane picked, advance to account) ────────────────────────
  const handleLaneNext = () => {
    // Lane is already persisted by setLane(); just advance.
    setStep(2);
  };

  // ── Step 2 → 3 (name + email captured, advance to password) ─────────────
  const handleAccountNext = () => {
    sessionStorage.setItem("signup_firstName", firstName);
    sessionStorage.setItem("signup_lastName", lastName);
    sessionStorage.setItem("signup_email", email);
    setStep(3);
  };

  // ── Step 3 → 4 (password validated, advance to profile) ─────────────────
  const handlePasswordNext = () => {
    sessionStorage.setItem("signup_password", password);
    sessionStorage.setItem("signup_confirmPassword", confirmPassword);
    setStep(4);
  };

  // ── Step 2 submit (profile → create account + verify) ───────────────────
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) {
      toast.error("Please accept the terms and conditions");
      return;
    }

    setIsLoading(true);
    try {
      // Persist all data
      sessionStorage.setItem("signup_firstName", firstName);
      sessionStorage.setItem("signup_lastName", lastName);
      sessionStorage.setItem("signup_gender", gender);
      sessionStorage.setItem("signup_phoneNumber", phoneNumber);
      sessionStorage.setItem("signup_email", email);
      sessionStorage.setItem("signup_dateOfBirth", dateOfBirth);
      sessionStorage.setItem("signup_country", country);
      sessionStorage.setItem("signup_city", city);
      sessionStorage.setItem("signup_zipCode", zipCode);
      sessionStorage.setItem("signup_password", password);
      sessionStorage.setItem("signup_confirmPassword", confirmPassword);
      sessionStorage.setItem("signup_acceptedTerms", acceptedTerms.toString());
      sessionStorage.setItem("isInSignupFlow", "true");

      // 1. Create the Supabase auth user
      await signUp(email, password);

      // 2. Upsert profile directly — do not rely on DB trigger alone.
      //    Trigger may silently fail; upsert ensures data is saved regardless.
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { error: upsertError } = await supabase.from("profiles").upsert(
          {
            id: authData.user.id,
            email,
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            gender: gender || null,
            phone_number: phoneNumber?.trim() || null,
            country: country || null,
            date_of_birth: dateOfBirth || null,
            city: city || null,
            zip_code: zipCode || null,
          },
          { onConflict: "id" },
        );
        if (upsertError) {
          // Non-fatal: log but continue — DB trigger may have already created the row
          console.warn("Profile upsert warning:", upsertError.message);
        }
      }

      // 3. Sign out so the session is clean before the user verifies their email
      await signOut();

      // 4. Advance to email verification step (only after account is created)
      setStep(5);

      // 5. Send verification email — errors handled inside; user can resend
      try {
        await requestEmailVerificationCode({
          email,
          firstName,
          lastName,
          purpose: "signup",
        });
        toast.success("Check your email for the verification code");
      } catch (sendErr) {
        toast.error(
          sendErr instanceof Error
            ? sendErr.message
            : "Verification email could not be sent. You can resend the code.",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      sessionStorage.removeItem("isInSignupFlow");
      sessionStorage.removeItem("signupStep");

      if (
        msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("duplicate")
      ) {
        toast.error("Email already exists. Try logging in instead.");
      } else {
        toast.error(msg || "Signup failed");
      }
      setStep(4);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 3: verify code ──────────────────────────────────────────────────
  const handleVerificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) {
      toast.error("Please enter the verification code");
      return;
    }
    setIsLoading(true);
    try {
      await confirmEmailVerificationCode({ email, code: verificationCode });

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const { data: authData } = await supabase.auth.getUser();

      toast.success("Email verified successfully!");

      // Sync session + user to the auth store NOW — route guards
      // (beforeLoad) need isAuthenticated:true immediately. Profile is set
      // below, after completeOnboarding has written the lane.
      if (authData.user) {
        const { data: sessionData } = await supabase.auth.getSession();
        useAuthStore.setState({
          session: sessionData.session,
          user: authData.user,
          isAuthenticated: true,
          isLoading: false,
        });
      }

      // Lane-aware completion. Server writes settings.onboarding.lane,
      // sets active_persona, and provisions the personal workspace.
      const intent =
        lane === "client_freelancer"
          ? {
              client: search.intent !== "freelancer",
              freelancer: search.intent === "freelancer",
            }
          : { client: false, freelancer: false };

      try {
        await completeOnboarding({ lane, intent });
      } catch (onboardingErr) {
        // Non-fatal — settings can be retried from /welcome on next visit.
        // Still log it so we notice if it's a recurring failure.
        console.error("completeOnboarding failed after signup:", onboardingErr);
      }

      // Refetch profile AFTER completeOnboarding so the auth store carries
      // the lane the welcome page will read. Doing it before is the race
      // that caused /welcome to render the wrong deck on first visit.
      if (authData.user) {
        try {
          const fresh = await fetchProfile(authData.user.id);
          queryClient.setQueryData(
            profileKeys.byUser(authData.user.id),
            fresh,
          );
          useAuthStore.setState({ profile: fresh });
        } catch (refetchErr) {
          console.error("Profile refetch after onboarding failed:", refetchErr);
        }
      }

      clearSignupData();

      // Both lanes route through /welcome — the route renders a lane-specific
      // deck (3 slides for consultants → /consultant/apply, 4 slides for
      // client/freelancer → /dashboard).
      navigate({ to: "/welcome" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    try {
      setVerificationCode("");
      await requestEmailVerificationCode({
        email,
        firstName,
        lastName,
        purpose: "signup",
      });
      toast.success("Verification code resent to your email");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setIsResending(false);
    }
  };

  // ── Derived motion variant direction ─────────────────────────────────────
  const isForward = step >= prevStep;
  const motionProps = isForward ? slideIn : slideInReverse;

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: "100%" }}>
      {/* Logo */}
      <div style={{ marginBottom: "24px" }}>
        <BrandMark className="h-8 text-slate-900" />
      </div>

      {/* Each step renders its own header (Lane, Account, Password, Profile).
          The Verify step has its own self-contained UI below. */}

      {/* Animated step panels */}
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step-lane" {...motionProps}>
            <SignupStepLane
              lane={lane}
              setLane={setLane}
              onNext={handleLaneNext}
            />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step-account" {...motionProps}>
            <SignupStepAccount
              firstName={firstName}
              setFirstName={setFirstName}
              lastName={lastName}
              setLastName={setLastName}
              email={email}
              setEmail={setEmail}
              onNext={handleAccountNext}
              onBack={() => setStep(1)}
            />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step-password" {...motionProps}>
            <SignupStepPassword
              password={password}
              setPassword={setPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              onNext={handlePasswordNext}
              onBack={() => setStep(2)}
            />
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="step-profile" {...motionProps}>
            <SignupStepProfile
              gender={gender}
              setGender={setGender}
              phoneNumber={phoneNumber}
              setPhoneNumber={setPhoneNumber}
              dateOfBirth={dateOfBirth}
              setDateOfBirth={setDateOfBirth}
              country={country}
              setCountry={setCountry}
              city={city}
              setCity={setCity}
              zipCode={zipCode}
              setZipCode={setZipCode}
              acceptedTerms={acceptedTerms}
              setAcceptedTerms={setAcceptedTerms}
              onBack={() => setStep(3)}
              onSubmit={handleProfileSubmit}
              isLoading={isLoading}
            />
          </motion.div>
        )}

        {step === 5 && (
          <motion.div key="step-verify" {...motionProps}>
            {/* ── Verification screen ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Icon */}
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "rgba(51,65,85,0.1)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                      stroke="#334155"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <polyline
                      points="22,6 12,13 2,6"
                      stroke="#334155"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h2
                  style={{
                    fontFamily: "'Sora', 'Manrope', sans-serif",
                    fontSize: "1.4rem",
                    fontWeight: 700,
                    color: "#0F172A",
                    margin: "0 0 8px",
                  }}
                >
                  Verify your email
                </h2>
                <p
                  style={{
                    fontSize: "13px",
                    color: "#64748B",
                    margin: 0,
                    fontFamily: "'Manrope', sans-serif",
                  }}
                >
                  We sent a 6-digit code to{" "}
                  <strong style={{ color: "#0F172A" }}>{email}</strong>
                </p>
              </div>

              {/* Code input */}
              <form onSubmit={handleVerificationSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  style={{
                    width: "100%",
                    height: "64px",
                    borderRadius: "12px",
                    border: "2px solid #CBD5E1",
                    textAlign: "center",
                    fontSize: "28px",
                    fontWeight: 700,
                    letterSpacing: "8px",
                    color: "#0F172A",
                    outline: "none",
                    fontFamily: "monospace",
                    transition: "border-color 0.2s",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "#334155";
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,150,46,0.12)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#CBD5E1";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />

                <button
                  type="submit"
                  disabled={isLoading}
                  style={{
                    width: "100%",
                    height: "50px",
                    borderRadius: "14px",
                    border: "none",
                    background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 52%, #312E81 100%)",
                    color: "white",
                    fontFamily: "'Manrope', sans-serif",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: isLoading ? "not-allowed" : "pointer",
                    opacity: isLoading ? 0.7 : 1,
                    boxShadow: "0 8px 20px rgba(15,23,42,0.24)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {isLoading ? "Verifying…" : "Verify Code"}
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
              </form>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "16px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setVerificationCode("");
                    setStep(4);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: "#94A3B8",
                    fontFamily: "'Manrope', sans-serif",
                    padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#1E293B";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#94A3B8";
                  }}
                >
                  ← Back
                </button>
                <div style={{ width: "1px", height: "14px", background: "#CBD5E1" }} />
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={isResending}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: isResending ? "not-allowed" : "pointer",
                    fontSize: "13px",
                    color: "#94A3B8",
                    fontFamily: "'Manrope', sans-serif",
                    padding: 0,
                    opacity: isResending ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isResending) {
                      (e.currentTarget as HTMLButtonElement).style.color = "#1E293B";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#94A3B8";
                  }}
                >
                  {isResending ? "Resending…" : "Resend Code"}
                </button>
              </div>

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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

