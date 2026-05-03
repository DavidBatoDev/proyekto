interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
}

const STEPS = [
  { id: 1 as const, label: "Lane" },
  { id: 2 as const, label: "Account" },
  { id: 3 as const, label: "Profile" },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0" }}>
      {STEPS.map((step, index) => {
        const isActive = currentStep === step.id;
        const isDone = currentStep > step.id;

        return (
          <div
            key={step.id}
            style={{ display: "flex", alignItems: "center", flex: index < STEPS.length - 1 ? 1 : "none" }}
          >
            {/* Pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "100px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "'Manrope', sans-serif",
                whiteSpace: "nowrap",
                transition: "all 0.3s ease",
                background: isActive
                  ? "#0F172A"
                  : isDone
                  ? "rgba(51, 65, 85, 0.12)"
                  : "#F8FAFC",
                color: isActive
                  ? "white"
                  : isDone
                  ? "#334155"
                  : "#94A3B8",
                border: isActive
                  ? "1px solid #0F172A"
                  : isDone
                  ? "1px solid rgba(51, 65, 85, 0.45)"
                  : "1px solid #E2E8F0",
                boxShadow: isActive
                  ? "0 4px 14px rgba(15, 23, 42, 0.22)"
                  : "none",
              }}
            >
              <span
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: 700,
                  background: isActive ? "rgba(255,255,255,0.2)" : "transparent",
                  flexShrink: 0,
                }}
              >
                {isDone ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 5l2.5 2.5L8.5 2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  step.id
                )}
              </span>
              {step.label}
            </div>

            {/* Connector line - between steps */}
            {index < STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: "1px",
                  margin: "0 8px",
                  backgroundColor: isDone ? "#334155" : "#E2E8F0",
                  transition: "background-color 0.4s ease",
                  minWidth: "40px",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

