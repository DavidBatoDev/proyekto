import { useEffect, useId, useRef, useState } from "react";
import { PH_CITIES } from "./countries";

// ── Props ────────────────────────────────────────────────────────────────────

interface CitySelectProps {
  value: string;
  onChange: (city: string) => void;
  /** ISO country code — narrows suggestions for Philippines */
  countryCode?: string;
  required?: boolean;
  disabled?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CitySelect({
  value,
  onChange,
  countryCode,
  required,
  disabled,
}: CitySelectProps) {
  const id = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPhilippines = countryCode === "PH";
  const suggestions = isPhilippines ? PH_CITIES : [];

  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const filtered = value.trim()
    ? suggestions.filter((c) =>
        c.toLowerCase().startsWith(value.toLowerCase()),
      )
    : suggestions.slice(0, 20);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const path = e.composedPath();
      if (containerRef.current && !path.includes(containerRef.current)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function selectCity(city: string) {
    onChange(city);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) selectCity(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const isActive = focused || open;
  const floated = focused || value.length > 0 || open;
  const showDropdown = open && filtered.length > 0;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", flex: 1 }}
    >
      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <input
        ref={inputRef}
        id={id}
        role={suggestions.length > 0 ? "combobox" : "textbox"}
        aria-autocomplete={suggestions.length > 0 ? "list" : undefined}
        aria-expanded={suggestions.length > 0 ? open : undefined}
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={
          open && filtered[highlighted]
            ? `city-opt-${highlighted}`
            : undefined
        }
        aria-required={required}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          if (suggestions.length > 0) setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => {
          setFocused(true);
          if (suggestions.length > 0) setOpen(true);
          setHighlighted(0);
        }}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
            setFocused(false);
          }
        }}
        onKeyDown={handleKeyDown}
        style={{
          padding: "22px 16px 10px",
          height: "52px",
          borderRadius: "10px",
          border: isActive ? "1px solid #334155" : "1px solid #CBD5E1",
          boxShadow: isActive ? "0 0 0 3px rgba(255, 150, 46, 0.12)" : "none",
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

      {/* ── Floating label ────────────────────────────────────────────────── */}
      <label
        htmlFor={id}
        style={{
          position: "absolute",
          left: "16px",
          top: floated ? "7px" : "50%",
          transform: floated ? "none" : "translateY(-50%)",
          fontSize: floated ? "10px" : "14px",
          fontWeight: 500,
          color: isActive ? "#334155" : "#94A3B8",
          transition: "all 0.2s ease",
          pointerEvents: "none",
          lineHeight: 1,
          fontFamily: "'Manrope', sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        City
        {required && (
          <span style={{ color: "#DC2626", marginLeft: "2px" }}>*</span>
        )}
      </label>

      {/* ── Suggestions dropdown ──────────────────────────────────────────── */}
      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          aria-label="City suggestions"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "white",
            borderRadius: "10px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.11)",
            border: "1px solid #F0F0F0",
            maxHeight: "192px",
            overflowY: "auto",
            margin: 0,
            padding: "4px",
            listStyle: "none",
            scrollbarWidth: "thin",
          }}
        >
          {filtered.map((city, i) => (
            <li
              key={city}
              id={`city-opt-${i}`}
              role="option"
              aria-selected={city === value}
              onPointerDown={(e) => {
                e.preventDefault();
                selectCity(city);
              }}
              onMouseOver={() => setHighlighted(i)}
              style={{
                padding: "9px 12px",
                borderRadius: "7px",
                cursor: "pointer",
                fontSize: "14px",
                fontFamily: "'Manrope', sans-serif",
                color: "#0F172A",
                background:
                  i === highlighted
                    ? "rgba(255,150,46,0.09)"
                    : city === value
                      ? "rgba(255,150,46,0.05)"
                      : "transparent",
                fontWeight: city === value ? 600 : 400,
              }}
            >
              {city}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

