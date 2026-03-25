import { DatePickerField } from "./DatePickerField";
import { CountrySelect } from "./CountrySelect";
import { PhoneField } from "./PhoneField";
import { CitySelect } from "./CitySelect";
import { ZipInput } from "./ZipInput";
import { PrimaryButton, SecondaryButton } from "./SignupButtons";

interface SignupStepProfileProps {
  gender: string;
  setGender: (v: string) => void;
  phoneNumber: string;
  setPhoneNumber: (v: string) => void;
  dateOfBirth: string;
  setDateOfBirth: (v: string) => void;
  /** ISO country code, e.g. "PH" */
  country: string;
  setCountry: (code: string) => void;
  city: string;
  setCity: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  acceptedTerms: boolean;
  setAcceptedTerms: (v: boolean) => void;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}

const GENDERS = ["Male", "Female", "Other"];

export function SignupStepProfile({
  gender,
  setGender,
  phoneNumber,
  setPhoneNumber,
  dateOfBirth,
  setDateOfBirth,
  country,
  setCountry,
  city,
  setCity,
  zipCode,
  setZipCode,
  acceptedTerms,
  setAcceptedTerms,
  onBack,
  onSubmit,
  isLoading,
}: SignupStepProfileProps) {
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Gender */}
      <div>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#94A3B8",
            marginBottom: "8px",
            margin: "0 0 8px",
            fontFamily: "'Manrope', sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Gender
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          {GENDERS.map((g) => {
            const isSelected = gender.toLowerCase() === g.toLowerCase();
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g.toLowerCase())}
                style={{
                  flex: 1,
                  height: "48px",
                  borderRadius: "12px",
                  border: isSelected ? "1px solid #334155" : "1px solid #CBD5E1",
                  background: isSelected ? "rgba(51, 65, 85, 0.08)" : "white",
                  color: isSelected ? "#0F172A" : "#94A3B8",
                  fontFamily: "'Manrope', sans-serif",
                  fontSize: "14px",
                  fontWeight: isSelected ? 600 : 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: isSelected ? "0 0 0 3px rgba(51, 65, 85, 0.12)" : "none",
                }}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date of birth */}
      <DatePickerField
        label="Date of Birth"
        value={dateOfBirth}
        onChange={setDateOfBirth}
      />

      {/* Country — source of truth; changing it resets phone + city + zip */}
      <CountrySelect
        value={country}
        onChange={(code) => {
          setCountry(code);
          setPhoneNumber("");
          setCity("");
          setZipCode("");
        }}
      />

      {/* Phone — dial code is locked; derived from selected country */}
      <PhoneField
        country={country}
        value={phoneNumber}
        onChange={setPhoneNumber}
      />

      {/* City + Zip */}
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <CitySelect
          value={city}
          onChange={setCity}
          countryCode={country}
        />
        <ZipInput
          value={zipCode}
          onChange={setZipCode}
          countryCode={country}
        />
      </div>

      {/* Terms */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          cursor: "pointer",
        }}
      >
        <div style={{ position: "relative", flexShrink: 0, marginTop: "1px" }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
            style={{ opacity: 0, position: "absolute", width: "18px", height: "18px", cursor: "pointer", margin: 0 }}
          />
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "5px",
              border: acceptedTerms ? "2px solid #334155" : "2px solid #CBD5E1",
              background: acceptedTerms ? "#334155" : "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
          >
            {acceptedTerms && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1.5 5l2.5 2.5L8.5 2"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </div>
        <span
          style={{
            fontSize: "13px",
            color: "#0F172A",
            lineHeight: 1.5,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          I have read and accept the{" "}
          <a href="/terms" style={{ color: "#1E40AF", textDecoration: "none", fontWeight: 700 }}>
            Terms of Use
          </a>
          ,{" "}
          <a href="/privacy" style={{ color: "#1E40AF", textDecoration: "none", fontWeight: 700 }}>
            Privacy Policy
          </a>{" "}
          &{" "}
          <a href="/conditions" style={{ color: "#1E40AF", textDecoration: "none", fontWeight: 700 }}>
            Terms &amp; Conditions
          </a>
        </span>
      </label>

      {/* Submit */}
      <PrimaryButton
        type="submit"
        isLoading={isLoading}
        loadingText="Creating account…"
        style={{ marginTop: "4px" }}
      >
        Create Account
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

      {/* Back */}
      <SecondaryButton type="button" onClick={onBack}>
        ← Back
      </SecondaryButton>
    </form>
  );
}

