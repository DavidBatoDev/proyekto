import { useId, useState } from "react";
import { getCountryCallingCode, isValidPhoneNumber } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

// ── Flag image ────────────────────────────────────────────────────────────────

function FlagImg({ code }: { code: string }) {
  const lc = code.toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/20x15/${lc}.png`}
      srcSet={`https://flagcdn.com/40x30/${lc}.png 2x`}
      width={20}
      height={15}
      alt=""
      aria-hidden="true"
      style={{
        borderRadius: "2px",
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PhoneFieldProps {
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "PH", "US").
   * This drives the locked dial-code prefix.
   */
  country: string;
  /**
   * Full phone number in E.164 format (e.g. "+639123456789"), or "" when empty.
   * The field derives the displayed national number from this value.
   */
  value: string;
  /** Called with the E.164 string on every keystroke, or "" when cleared. */
  onChange: (e164: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDialCode(country: string): string {
  if (!country) return "";
  try {
    return `+${getCountryCallingCode(country.toUpperCase() as CountryCode)}`;
  } catch {
    return "";
  }
}

function extractNational(e164: string, dialCode: string): string {
  if (!e164 || !dialCode) return "";
  if (e164.startsWith(dialCode)) return e164.slice(dialCode.length);
  return "";
}

// ── Max national-number lengths ───────────────────────────────────────────────
// Covers ~80 countries. For unlisted codes the fallback is
// (E.164 max 15) − (length of the calling code digits).
const NATIONAL_MAX_LENGTH: Record<string, number> = {
  AF: 9,  AL: 9,  DZ: 9,  AD: 9,  AO: 9,  AR: 10, AM: 8,  AU: 9,
  AT: 11, AZ: 9,  BH: 8,  BD: 10, BB: 7,  BY: 9,  BE: 9,  BZ: 7,
  BJ: 8,  BR: 11, BN: 7,  BG: 9,  BF: 8,  BI: 8,  KH: 9,  CM: 9,
  CA: 10, CF: 8,  TD: 8,  CL: 9,  CN: 11, CO: 10, CG: 9,  CR: 8,
  HR: 9,  CU: 8,  CY: 8,  CZ: 9,  DK: 8,  DO: 10, EC: 9,  EG: 10,
  SV: 8,  ET: 9,  FI: 10, FR: 9,  GA: 7,  GH: 9,  GR: 10, GT: 8,
  GN: 9,  HN: 8,  HK: 8,  HU: 9,  IN: 10, ID: 12, IR: 10, IQ: 10,
  IE: 9,  IL: 9,  IT: 10, JM: 10, JP: 11, JO: 9,  KZ: 10, KE: 9,
  KW: 8,  KG: 9,  LA: 9,  LB: 7,  LY: 9,  LI: 9,  LT: 8,  LU: 9,
  MO: 8,  MG: 9,  MW: 9,  MY: 11, MV: 7,  ML: 8,  MT: 8,  MR: 8,
  MX: 10, MC: 8,  MN: 8,  ME: 8,  MA: 9,  MZ: 9,  MM: 9,  NA: 9,
  NP: 10, NL: 9,  NZ: 9,  NI: 8,  NE: 8,  NG: 10, MK: 8,  NO: 8,
  OM: 8,  PK: 10, PA: 8,  PG: 8,  PY: 9,  PE: 9,  PH: 10, PL: 9,
  PT: 9,  QA: 8,  RO: 9,  RU: 10, RW: 9,  SA: 9,  SN: 9,  RS: 9,
  SL: 8,  SG: 8,  SK: 9,  SI: 8,  SO: 8,  ZA: 9,  KR: 11, ES: 9,
  LK: 9,  SD: 9,  SR: 7,  SE: 9,  CH: 9,  SY: 9,  TW: 9,  TZ: 9,
  TH: 9,  TG: 8,  TT: 10, TN: 8,  TR: 10, TM: 8,  UG: 9,  UA: 9,
  AE: 9,  GB: 10, US: 10, UY: 9,  UZ: 9,  VE: 10, VN: 10, YE: 9,
  ZM: 9,  ZW: 9,
};

function getNationalMaxLength(country: string, dialCode: string): number {
  return (
    NATIONAL_MAX_LENGTH[country.toUpperCase()] ??
    Math.max(0, 15 - dialCode.replace(/\D/g, "").length)
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PhoneField({ country, value, onChange }: PhoneFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");

  const dialCode = getDialCode(country);
  const nationalNumber = extractNational(value, dialCode);
  const hasCountry = !!country && !!dialCode;
  const maxLength = getNationalMaxLength(country, dialCode);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const digits = e.target.value.replace(/\D/g, "");
    // Hard-stop: ignore input once the national number is at max length
    if (digits.length > maxLength) return;
    onChange(digits ? `${dialCode}${digits}` : "");
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    const available = maxLength - nationalNumber.length;
    if (pasted.length > available) {
      e.preventDefault();
      // Apply only the digits that fit
      const allowed = pasted.slice(0, available);
      if (allowed) onChange(`${dialCode}${nationalNumber}${allowed}`);
    }
  }

  function handleBlur() {
    setFocused(false);
    setTouched(true);
    if (!hasCountry) {
      setError("");
      return;
    }
    if (!nationalNumber) {
      setError("Phone number is required.");
      return;
    }
    try {
      const valid = isValidPhoneNumber(value, country.toUpperCase() as CountryCode);
      setError(valid ? "" : "Please enter a valid phone number for this country.");
    } catch {
      setError("");
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const hasError = touched && !!error;
  const borderColor = hasError ? "#DC2626" : focused ? "#334155" : "#CBD5E1";
  const boxShadow = hasError
    ? "0 0 0 3px rgba(225,28,132,0.10)"
    : focused
      ? "0 0 0 3px rgba(255,150,46,0.12)"
      : "none";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Label */}
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "#94A3B8",
          margin: "0 0 8px",
          fontFamily: "'Manrope', sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Phone
      </p>

      {/* Input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "52px",
          borderRadius: "10px",
          border: `1px solid ${borderColor}`,
          boxShadow,
          background: "white",
          overflow: "hidden",
          transition: "border 0.15s, box-shadow 0.15s",
        }}
      >
        {/* Locked dial-code prefix */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "0 10px 0 14px",
            borderRight: "1px solid #CBD5E1",
            height: "100%",
            flexShrink: 0,
            userSelect: "none",
            background: "#FAFAFA",
          }}
        >
          {hasCountry ? (
            <FlagImg code={country} />
          ) : (
            // Placeholder space when no country selected
            <span
              style={{
                display: "inline-block",
                width: "20px",
                height: "15px",
                borderRadius: "2px",
                background: "#CBD5E1",
              }}
            />
          )}
          <span
            style={{
              fontSize: "14px",
              fontFamily: "'Manrope', sans-serif",
              color: hasCountry ? "#0F172A" : "#94A3B8",
              fontWeight: 500,
              minWidth: "30px",
            }}
          >
            {dialCode || "—"}
          </span>
        </div>

        {/* National number input */}
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="tel-national"
          disabled={!hasCountry}
          placeholder={hasCountry ? "Enter phone number" : "Select a country first"}
          value={nationalNumber}
          onChange={handleChange}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          aria-label="Phone number"
          aria-describedby={hasError ? errorId : undefined}
          aria-invalid={hasError ? "true" : undefined}
          style={{
            flex: 1,
            height: "100%",
            border: "none",
            outline: "none",
            padding: "0 14px",
            fontSize: "14px",
            fontFamily: "'Manrope', sans-serif",
            color: "#0F172A",
            background: "transparent",
            cursor: hasCountry ? "text" : "not-allowed",
          }}
        />
      </div>

      {/* Inline error */}
      {hasError && (
        <p
          id={errorId}
          role="alert"
          style={{
            margin: "5px 0 0",
            fontSize: "12px",
            color: "#DC2626",
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

