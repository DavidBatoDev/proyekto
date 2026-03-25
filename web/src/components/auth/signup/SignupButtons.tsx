import { useState } from "react";

// ── PrimaryButton ─────────────────────────────────────────────────────────────
// Uses a gradient overlay that transitions opacity so we never repaint between
// a solid background-color and a background-image (which causes the white flash).

interface PrimaryButtonProps {
  children: React.ReactNode;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  style?: React.CSSProperties;
}

export function PrimaryButton({
  children,
  type = "button",
  onClick,
  disabled,
  isLoading,
  loadingText,
  style,
}: PrimaryButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      onMouseEnter={() => !isDisabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => !isDisabled && setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "50px",
        borderRadius: "14px",
        border: "none",
        background: "#0F172A",
        color: "white",
        fontFamily: "'Manrope', sans-serif",
        fontSize: "14px",
        fontWeight: 700,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.7 : 1,
        boxShadow: hovered && !isDisabled
          ? "0 10px 26px rgba(15, 23, 42, 0.35)"
          : "0 6px 18px rgba(15, 23, 42, 0.22)",
        transition: "box-shadow 0.22s ease, opacity 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {/* Gradient overlay — only opacity is animated, never background-color */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(135deg, #1E1B4B 0%, #312E81 55%, #4338CA 100%)",
          opacity: hovered && !isDisabled ? 1 : 0,
          transition: "opacity 0.22s ease",
          borderRadius: "inherit",
          pointerEvents: "none",
        }}
      />
      {/* Text content sits above the overlay */}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        {isLoading ? (loadingText ?? "Loading…") : children}
      </span>
    </button>
  );
}

// ── SecondaryButton ───────────────────────────────────────────────────────────
// Outlined/ghost button that uses the same state-based hover to avoid flicker.

interface SecondaryButtonProps {
  children: React.ReactNode;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function SecondaryButton({
  children,
  type = "button",
  onClick,
  disabled,
  style,
}: SecondaryButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => !disabled && setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        width: "100%",
        height: "50px",
        borderRadius: "14px",
        border: `1px solid ${hovered ? "#475569" : "#CBD5E1"}`,
        background: hovered ? "#F8FAFC" : "transparent",
        color: "#334155",
        fontFamily: "'Manrope', sans-serif",
        fontSize: "14px",
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background-color 0.2s ease, border-color 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── GoogleButton ──────────────────────────────────────────────────────────────

interface GoogleButtonProps {
  onClick: () => void;
  children: React.ReactNode;
}

export function GoogleButton({ onClick, children }: GoogleButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        width: "100%",
        height: "50px",
        borderRadius: "14px",
        border: `1px solid ${hovered ? "#475569" : "#CBD5E1"}`,
        background: hovered ? "#F8FAFC" : "white",
        color: "#0F172A",
        fontFamily: "'Manrope', sans-serif",
        fontSize: "14px",
        fontWeight: 700,
        cursor: "pointer",
        transition: "background-color 0.2s ease, border-color 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
      }}
    >
      {children}
    </button>
  );
}

