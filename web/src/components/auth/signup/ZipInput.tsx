import { useId, useState } from "react";
import { COUNTRY_BY_CODE } from "./countries";

// ── Props ────────────────────────────────────────────────────────────────────

interface ZipInputProps {
  value: string;
  onChange: (value: string) => void;
  /** ISO country code — used to determine max length */
  countryCode?: string;
  required?: boolean;
  disabled?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ZipInput({
  value,
  onChange,
  countryCode,
  required,
  disabled,
}: ZipInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  const country = countryCode ? COUNTRY_BY_CODE.get(countryCode) : undefined;
  const maxLength = country?.zipLength ?? 10;

  const isActive = focused;
  const floated = focused || value.length > 0;
  const hasError = value.length > 0 && value.length < maxLength && !focused;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip non-digit characters, enforce maxLength
    const digits = e.target.value.replace(/\D/g, "").slice(0, maxLength);
    onChange(digits);
  }

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Zip / Postal code"
        aria-required={required}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        autoComplete="postal-code"
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          padding: "22px 16px 10px",
          height: "52px",
          borderRadius: "10px",
          border: hasError
            ? "1px solid #DC2626"
            : isActive
              ? "1px solid #334155"
              : "1px solid #CBD5E1",
          boxShadow: hasError
            ? "0 0 0 3px rgba(255,45,117,0.10)"
            : isActive
              ? "0 0 0 3px rgba(255, 150, 46, 0.12)"
              : "none",
          background: disabled ? "#F9F9F9" : "white",
          color: "#0F172A",
          fontSize: "14px",
          fontFamily: "'Manrope', sans-serif",
          transition: "border-color 0.2s, box-shadow 0.2s",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          cursor: disabled ? "not-allowed" : "text",
        }}
      />

      {/* Floating label */}
      <label
        htmlFor={id}
        style={{
          position: "absolute",
          left: "16px",
          top: floated ? "7px" : "50%",
          transform: floated ? "none" : "translateY(-50%)",
          fontSize: floated ? "10px" : "14px",
          fontWeight: 500,
          color: hasError ? "#DC2626" : isActive ? "#334155" : "#94A3B8",
          transition: "all 0.2s ease",
          pointerEvents: "none",
          lineHeight: 1,
          fontFamily: "'Manrope', sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        Zip Code
        {required && (
          <span style={{ color: "#DC2626", marginLeft: "2px" }}>*</span>
        )}
      </label>

      {/* Inline format hint */}
      {floated && !isActive && value.length > 0 && value.length < maxLength && (
        <p
          style={{
            position: "absolute",
            bottom: "-18px",
            left: "2px",
            fontSize: "10px",
            color: "#DC2626",
            fontFamily: "'Manrope', sans-serif",
            margin: 0,
          }}
        >
          {maxLength} digits required
        </p>
      )}
    </div>
  );
}

