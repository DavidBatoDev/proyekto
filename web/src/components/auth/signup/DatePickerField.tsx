import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isBefore,
  isSameDay,
  isValid,
  parse,
  parseISO,
  setMonth,
  setYear,
  startOfMonth,
  subMonths,
} from "date-fns";
import { useEffect, useId, useRef, useState } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MIN_YEAR = 1900;

function getMaxDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return d;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  label: string;
  /** ISO date string: YYYY-MM-DD */
  value: string;
  onChange: (isoDate: string) => void;
  required?: boolean;
  disabled?: boolean;
}

// ── Masked input helpers ─────────────────────────────────────────────────────

/**
 * Applies a MM/DD/YYYY mask to raw digit input.
 * Returns a string like "03/01/2013" progressively as the user types.
 */
function applyDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += "/";
    out += digits[i];
  }
  return out;
}

/** Parse "MM/DD/YYYY" → ISO string, or null if incomplete/invalid. */
function parseDisplay(display: string): string | null {
  if (display.replace(/\D/g, "").length < 8) return null;
  const parsed = parse(display, "MM/dd/yyyy", new Date());
  if (!isValid(parsed)) return null;
  const maxDate = getMaxDate();
  if (isBefore(parsed, new Date(MIN_YEAR, 0, 1)) || isAfter(parsed, maxDate)) return null;
  return format(parsed, "yyyy-MM-dd");
}

// ── Component ────────────────────────────────────────────────────────────────

export function DatePickerField({
  label,
  value,
  onChange,
  required,
  disabled,
}: DatePickerFieldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxDate = getMaxDate();
  const selectedDate = value && isValid(parseISO(value)) ? parseISO(value) : null;
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate ?? maxDate);

  // The raw text the user is typing — initialised from the ISO value
  const [inputText, setInputText] = useState<string>(
    () => (selectedDate ? format(selectedDate, "MM/dd/yyyy") : ""),
  );

  // Keep inputText in sync when parent changes value externally (e.g. clear)
  useEffect(() => {
    const display = selectedDate ? format(selectedDate, "MM/dd/yyyy") : "";
    setInputText((prev) => {
      // Only overwrite if the stored ISO doesn't match what the user typed
      const parsedCurrent = parseDisplay(prev);
      if (parsedCurrent !== value) return display;
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const floated = focused || inputText.length > 0 || open;
  const isActive = focused || open;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      // Use composedPath() instead of contains(e.target) because by the time
      // this document listener fires, React may have already re-rendered and
      // removed the clicked node from the DOM (e.g. after selecting a month/year
      // which triggers setViewDate). composedPath() is captured at dispatch time
      // and remains valid even after DOM mutations.
      const path = e.composedPath();
      if (containerRef.current && !path.includes(containerRef.current)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const days = eachDayOfInterval({
    start: startOfMonth(viewDate),
    end: endOfMonth(viewDate),
  });
  const firstDayOffset = getDay(startOfMonth(viewDate));

  const years = Array.from(
    { length: maxDate.getFullYear() - MIN_YEAR + 1 },
    (_, i) => MIN_YEAR + i,
  ).reverse();

  function isDayDisabled(day: Date) {
    return isBefore(day, new Date(MIN_YEAR, 0, 1)) || isAfter(day, maxDate);
  }

  function selectDay(day: Date) {
    if (isDayDisabled(day)) return;
    const iso = format(day, "yyyy-MM-dd");
    onChange(iso);
    setInputText(format(day, "MM/dd/yyyy"));
    setOpen(false);
    setFocused(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = applyDateMask(e.target.value);
    setInputText(masked);
    const iso = parseDisplay(masked);
    if (iso) {
      onChange(iso);
      // sync calendar view
      const parsed = parseISO(iso);
      setViewDate(parsed);
    } else if (masked.length === 0) {
      onChange("");
    }
  }

  function handleCalendarIconClick(e: React.MouseEvent) {
    e.preventDefault();
    if (disabled) return;
    setOpen((prev) => !prev);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* ── Text input ──────────────────────────────────────────────────── */}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder={focused ? "MM/DD/YYYY" : ""}
        value={inputText}
        disabled={disabled}
        required={required}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        autoComplete="off"
        onChange={handleInputChange}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          // Do not close the calendar on blur; blur also happens during
          // internal interactions (month/year controls). Outside-click and
          // Escape handlers control popover dismissal.
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        style={{
          padding: "22px 42px 10px 16px",
          height: "52px",
          borderRadius: "10px",
          border: isActive ? "1px solid #334155" : "1px solid #CBD5E1",
          boxShadow: isActive ? "0 0 0 3px rgba(255, 150, 46, 0.12)" : "none",
          background: disabled ? "#F9F9F9" : "white",
          color: "#0F172A",
          fontSize: "14px",
          fontFamily: "'Manrope', sans-serif",
          transition: "border-color 0.2s, box-shadow 0.2s",
          cursor: disabled ? "not-allowed" : "text",
          boxSizing: "border-box",
          width: "100%",
          outline: "none",
        }}
      />

      {/* ── Floating label ──────────────────────────────────────────────── */}
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
        {label}
        {required && <span style={{ color: "#DC2626", marginLeft: "2px" }}>*</span>}
      </label>

      {/* ── Calendar icon button ─────────────────────────────────────────── */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        onMouseDown={handleCalendarIconClick}
        style={{
          position: "absolute",
          right: "10px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: "4px",
          borderRadius: "6px",
          color: isActive ? "#334155" : "#94A3B8",
          display: "flex",
          alignItems: "center",
          transition: "color 0.2s",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {/* ── Calendar popover ────────────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          aria-label="Pick a date"
          aria-modal="true"
          onMouseDown={(e) => {
            // Prevent the text input from losing focus when the user
            // interacts with the calendar, but allow focusable elements
            // (buttons, inputs in sub-dropdowns) to work normally.
            const tag = (e.target as HTMLElement).tagName;
            if (!(["BUTTON", "INPUT", "SELECT", "OPTION"] as string[]).includes(tag)) {
              e.preventDefault();
            }
          }}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            background: "white",
            borderRadius: "14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.13)",
            border: "1px solid #F0F0F0",
            padding: "14px",
            width: "272px",
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          {/* ── Nav row: ‹ [Month] [Year] › ─────────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
              gap: "4px",
            }}
          >
            <NavButton
              label="Previous month"
              onClick={() => setViewDate((d) => subMonths(d, 1))}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="15,18 9,12 15,6" />
              </svg>
            </NavButton>

            {/* Month + Year custom dropdowns */}
            <div style={{ display: "flex", gap: "4px", flex: 1, justifyContent: "center" }}>
              <MonthDropdown
                month={viewDate.getMonth()}
                onChange={(m) => setViewDate((d) => setMonth(d, m))}
              />
              <YearDropdown
                year={viewDate.getFullYear()}
                years={years}
                onChange={(y) => setViewDate((d) => setYear(d, y))}
              />
            </div>

            <NavButton
              label="Next month"
              onClick={() => setViewDate((d) => addMonths(d, 1))}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </NavButton>
          </div>

          {/* Day-of-week headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              marginBottom: "2px",
            }}
            aria-hidden="true"
          >
            {DOW_HEADERS.map((h) => (
              <div
                key={h}
                style={{
                  textAlign: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#94A3B8",
                  padding: "3px 0",
                  letterSpacing: "0.03em",
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div
            role="grid"
            aria-label={`${MONTHS_FULL[viewDate.getMonth()]} ${viewDate.getFullYear()}`}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "1px",
            }}
          >
            {/* Empty offset cells */}
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`pad-${i}`} role="gridcell" aria-hidden="true" />
            ))}

            {days.map((day) => {
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const isDisabled = isDayDisabled(day);
              return (
                <DayCell
                  key={day.toISOString()}
                  day={day}
                  isSelected={isSelected}
                  isDisabled={isDisabled}
                  onClick={() => selectDay(day)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "5px",
        borderRadius: "6px",
        color: "#0F172A",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        transition: "background 0.15s",
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#F5F5F5";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "none";
      }}
    >
      {children}
    </button>
  );
}

function DayCell({
  day,
  isSelected,
  isDisabled,
  onClick,
}: {
  day: Date;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="gridcell"
      type="button"
      disabled={isDisabled}
      aria-label={format(day, "MMMM d, yyyy")}
      aria-pressed={isSelected}
      aria-disabled={isDisabled}
      onClick={onClick}
      style={{
        height: "32px",
        borderRadius: "7px",
        border: "none",
        background: isSelected ? "#334155" : "transparent",
        color: isDisabled ? "#D0D0D0" : isSelected ? "white" : "#0F172A",
        fontSize: "12px",
        fontWeight: isSelected ? 700 : 400,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
        fontFamily: "'Manrope', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
      }}
      onMouseOver={(e) => {
        if (!isDisabled && !isSelected) {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,150,46,0.12)";
        }
      }}
      onMouseOut={(e) => {
        if (!isDisabled && !isSelected) {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }
      }}
    >
      {day.getDate()}
    </button>
  );
}

// ── Calendar header: custom Month & Year dropdowns ─────────────────────────

function MonthDropdown({
  month,
  onChange,
}: {
  month: number;
  onChange: (m: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    setOpen((p) => !p);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Select month"
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleOpen();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          border: open ? "1px solid #334155" : "1px solid #CBD5E1",
          borderRadius: "8px",
          padding: "4px 10px",
          background: open ? "rgba(255,150,46,0.06)" : "white",
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: 600,
          color: open ? "#334155" : "#0F172A",
          fontFamily: "'Manrope', sans-serif",
          minWidth: "108px",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px rgba(255,150,46,0.10)" : "none",
          transition: "all 0.15s",
        }}
        onMouseOver={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.borderColor = "#334155";
        }}
        onMouseOut={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.borderColor = "#CBD5E1";
        }}
      >
        <span>{MONTHS_FULL[month]}</span>
        <svg
          width="10"
          height="7"
          viewBox="0 0 10 7"
          fill="none"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="#94A3B8"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Month"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 300,
            background: "white",
            borderRadius: "10px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.13)",
            border: "1px solid #F0F0F0",
            padding: "6px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "3px",
            width: "174px",
          }}
        >
          {MONTHS_SHORT.map((m, i) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={i === month}
              onPointerDown={(e) => {
                e.preventDefault();
                onChange(i);
                setOpen(false);
              }}
              style={{
                padding: "7px 4px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: i === month ? 700 : 500,
                background: i === month ? "#334155" : "transparent",
                color: i === month ? "white" : "#0F172A",
                fontFamily: "'Manrope', sans-serif",
                textAlign: "center",
                transition: "background 0.12s",
              }}
              onMouseOver={(e) => {
                if (i !== month)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,150,46,0.09)";
              }}
              onMouseOut={(e) => {
                if (i !== month)
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function YearDropdown({
  year,
  years,
  onChange,
}: {
  year: number;
  years: number[];
  onChange: (y: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [yearInput, setYearInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    setOpen((p) => !p);
    setYearInput("");
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current)) {
        setOpen(false);
        setYearInput("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Scroll selected year into view when dropdown opens
  useEffect(() => {
    if (!open || !listRef.current) return;
    const sel = listRef.current.querySelector(
      '[aria-selected="true"]',
    ) as HTMLElement | null;
    sel?.scrollIntoView({ block: "center" });
  }, [open]);

  const filteredYears = yearInput
    ? years.filter((y) => y.toString().startsWith(yearInput))
    : years;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Select year"
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleOpen();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          border: open ? "1px solid #334155" : "1px solid #CBD5E1",
          borderRadius: "8px",
          padding: "4px 10px",
          background: open ? "rgba(255,150,46,0.06)" : "white",
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: 600,
          color: open ? "#334155" : "#0F172A",
          fontFamily: "'Manrope', sans-serif",
          minWidth: "72px",
          justifyContent: "space-between",
          boxShadow: open ? "0 0 0 3px rgba(255,150,46,0.10)" : "none",
          transition: "all 0.15s",
        }}
        onMouseOver={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.borderColor = "#334155";
        }}
        onMouseOut={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.borderColor = "#CBD5E1";
        }}
      >
        <span>{year}</span>
        <svg
          width="10"
          height="7"
          viewBox="0 0 10 7"
          fill="none"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="#94A3B8"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 300,
            background: "white",
            borderRadius: "10px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.13)",
            border: "1px solid #F0F0F0",
            width: "104px",
          }}
        >
          <div style={{ padding: "6px 6px 0" }}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Search year…"
              value={yearInput}
              // biome-ignore lint/a11y/noAutofocus: intentional — opens a small dropdown
              autoFocus
              onChange={(e) =>
                setYearInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredYears.length > 0) {
                  onChange(filteredYears[0]);
                  setOpen(false);
                  setYearInput("");
                }
                e.stopPropagation();
              }}
              style={{
                width: "100%",
                padding: "5px 8px",
                border: "1px solid #CBD5E1",
                borderRadius: "6px",
                fontSize: "12px",
                fontFamily: "'Manrope', sans-serif",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Year"
            style={{
              maxHeight: "168px",
              overflowY: "auto",
              padding: "4px 6px 6px",
              scrollbarWidth: "thin",
            }}
          >
            {filteredYears.map((y) => (
              <div
                key={y}
                role="option"
                aria-selected={y === year}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onChange(y);
                  setOpen(false);
                  setYearInput("");
                }}
                style={{
                  padding: "5px 8px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: y === year ? 700 : 400,
                  background: y === year ? "#334155" : "transparent",
                  color: y === year ? "white" : "#0F172A",
                  fontFamily: "'Manrope', sans-serif",
                  transition: "background 0.12s",
                }}
                onMouseOver={(e) => {
                  if (y !== year)
                    (e.currentTarget as HTMLDivElement).style.background =
                      "rgba(255,150,46,0.09)";
                }}
                onMouseOut={(e) => {
                  if (y !== year)
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                {y}
              </div>
            ))}
            {filteredYears.length === 0 && (
              <div
                style={{
                  padding: "8px",
                  fontSize: "12px",
                  color: "#94A3B8",
                  textAlign: "center",
                }}
              >
                No match
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

