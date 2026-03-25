import { useEffect, useId, useRef, useState } from "react";
import { COUNTRIES, type Country } from "./countries";

// ── Helpers ────────────────────────────────────────────────────────────────────────────

/** Renders a flag <img> from flagcdn.com for a given ISO 3166-1 alpha-2 code. */
function FlagImg({ code, style }: { code: string; style?: React.CSSProperties }) {
  const lc = code.toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/20x15/${lc}.png`}
      srcSet={`https://flagcdn.com/40x30/${lc}.png 2x`}
      width={20}
      height={15}
      alt={code}
      style={{
        borderRadius: "2px",
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CountrySelectProps {
  /** ISO country code, e.g. "PH" */
  value: string;
  onChange: (code: string, name: string) => void;
  required?: boolean;
  disabled?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CountrySelect({
  value,
  onChange,
  required,
  disabled,
}: CountrySelectProps) {
  const id = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guard: set to true when the user picks an option via mouse/touch so the
  // blur handler that fires synchronously afterwards does NOT call commitOrReset
  // with stale query state (which would revert the selection back to the
  // previously-selected country).
  const justSelectedRef = useRef(false);

  const selectedCountry = COUNTRIES.find((c) => c.code === value) ?? null;

  // query = what the user is typing; when closed it shows the selected name
  const [query, setQuery] = useState(selectedCountry?.name ?? "");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const filtered = query.trim()
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.code.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 60)
    : COUNTRIES.slice(0, 60);

  // Keep query in sync when value changes externally
  useEffect(() => {
    if (!open) {
      setQuery(selectedCountry?.name ?? "");
    }
  }, [value, open, selectedCountry]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const path = e.composedPath();
      if (containerRef.current && !path.includes(containerRef.current)) {
        commitOrReset();
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, query, value]);

  function commitOrReset() {
    // If a dropdown item was just selected via pointer, the query state is
    // stale (React hasn't flushed it yet), so skip the revert logic entirely.
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    // If the user typed something that exactly matches a country, commit it
    const exact = COUNTRIES.find(
      (c) => c.name.toLowerCase() === query.toLowerCase(),
    );
    if (exact) {
      onChange(exact.code, exact.name);
      setQuery(exact.name);
    } else if (!query.trim()) {
      onChange("", "");
      setQuery("");
    } else {
      // Revert to previously selected
      setQuery(selectedCountry?.name ?? "");
    }
  }

  function selectCountry(c: Country) {
    justSelectedRef.current = true;
    onChange(c.code, c.name);
    setQuery(c.name);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlighted]) {
        selectCountry(filtered[highlighted]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      commitOrReset();
      setOpen(false);
      setFocused(false);
    } else if (e.key === "Tab") {
      commitOrReset();
      setOpen(false);
    }
  }

  const isActive = focused || open;
  const floated = focused || query.length > 0 || open;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>      {/* ── Flag overlay for selected country (only when collapsed) ──────────── */}
      {selectedCountry && !open && (
        <FlagImg
          code={selectedCountry.code}
          style={{
            position: "absolute",
            left: "14px",
            bottom: "12px",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && filtered[highlighted]
            ? `country-opt-${filtered[highlighted].code}`
            : undefined
        }
        aria-required={required}
        value={query}
        disabled={disabled}
        autoComplete="off"
        placeholder=""
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
          setHighlighted(0);
          // Select all text so user can type immediately
          inputRef.current?.select();
        }}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            commitOrReset();
            setOpen(false);
            setFocused(false);
          }
        }}
        onKeyDown={handleKeyDown}
        style={{
          padding: `22px 42px 10px ${!open && selectedCountry ? "42px" : "16px"}`,
          height: "52px",
          borderRadius: "10px",
          border: isActive ? "1px solid #334155" : "1px solid #CBD5E1",
          boxShadow: isActive ? "0 0 0 3px rgba(255, 150, 46, 0.12)" : "none",
          background: disabled ? "#F9F9F9" : "white",
          color: "#0F172A",
          fontSize: "14px",
          fontFamily: "'Manrope', sans-serif",
          transition: "border-color 0.2s, box-shadow 0.2s, padding-left 0.15s",
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
        Country
        {required && (
          <span style={{ color: "#DC2626", marginLeft: "2px" }}>*</span>
        )}
      </label>

      {/* ── Chevron icon ──────────────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          right: "14px",
          top: "50%",
          transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
          pointerEvents: "none",
          color: isActive ? "#334155" : "#94A3B8",
          transition: "transform 0.2s, color 0.2s",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </div>

      {/* ── Dropdown list ─────────────────────────────────────────────────── */}
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Countries"
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
            maxHeight: "224px",
            overflowY: "auto",
            margin: 0,
            padding: "4px",
            listStyle: "none",
            scrollbarWidth: "thin",
          }}
        >
          {filtered.map((c, i) => (
            <li
              key={c.code}
              id={`country-opt-${c.code}`}
              role="option"
              aria-selected={c.code === value}
              onPointerDown={(e) => {
                e.preventDefault();
                selectCountry(c);
              }}
              style={{
                padding: "9px 12px",
                borderRadius: "7px",
                cursor: "pointer",
                fontSize: "14px",
                fontFamily: "'Manrope', sans-serif",
                color: "#0F172A",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background:
                  i === highlighted
                    ? "rgba(255,150,46,0.09)"
                    : c.code === value
                      ? "rgba(255,150,46,0.05)"
                      : "transparent",
                fontWeight: c.code === value ? 600 : 400,
              }}
              onMouseOver={() => setHighlighted(i)}
            >
              <FlagImg code={c.code} />
              <span style={{ flex: 1 }}>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

