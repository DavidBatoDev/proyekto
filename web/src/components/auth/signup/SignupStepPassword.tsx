import { useState } from "react";
import { FloatingInput } from "./FloatingInput";
import { PasswordStrength, getPasswordScore } from "./PasswordStrength";
import { WizardNav } from "./WizardNav";
import { useToast } from "../../../hooks/useToast";

interface SignupStepPasswordProps {
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
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

export function SignupStepPassword({
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  onNext,
  onBack,
}: SignupStepPasswordProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const toast = useToast();

  const score = getPasswordScore(password);
  // Require at least "Fair" (score >= 3: length + uppercase + lowercase)
  const isStrong = score >= 3;

  const canSubmit =
    password.length >= 8 &&
    isStrong &&
    confirmPassword !== "" &&
    password === confirmPassword;

  const handleConfirmChange = (value: string) => {
    setConfirmPassword(value);
    // Clear the mismatch error as soon as they match
    if (confirmError && value === password) setConfirmError("");
  };

  const handleConfirmBlur = () => {
    if (confirmPassword && password !== confirmPassword) {
      setConfirmError("Passwords do not match");
    } else {
      setConfirmError("");
    }
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) {
      toast.error("Please fill in both password fields");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!isStrong) {
      toast.error("Password is too weak — add uppercase letters, numbers, or special characters");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      toast.error("Passwords do not match");
      return;
    }
    onNext();
  };

  return (
    <form
      onSubmit={handleNext}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
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
          Set a password
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "#64748B",
            margin: 0,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          At least 8 characters with uppercase, lowercase, and a number or symbol.
        </p>
      </div>

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
        {password.length > 0 && !isStrong && (
          <p
            style={{
              fontSize: "11px",
              color: "#D97706",
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 500,
              margin: "4px 0 0 4px",
            }}
          >
            Add uppercase letters, numbers, or symbols to continue
          </p>
        )}
      </div>

      {/* Confirm password */}
      <FloatingInput
        label="Confirm Password"
        type={showConfirm ? "text" : "password"}
        value={confirmPassword}
        onChange={handleConfirmChange}
        onBlur={handleConfirmBlur}
        error={confirmError}
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

      <WizardNav
        onBack={onBack}
        primaryLabel="Continue"
        primaryDisabled={!canSubmit}
      />
    </form>
  );
}
