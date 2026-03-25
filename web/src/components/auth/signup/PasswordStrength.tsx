interface PasswordStrengthProps {
  password: string;
}

const checks = [
  (p: string) => p.length >= 8,
  (p: string) => /[A-Z]/.test(p),
  (p: string) => /[a-z]/.test(p),
  (p: string) => /\d/.test(p),
  (p: string) => /[^A-Za-z0-9]/.test(p),
];

const LABELS = ["Too Weak", "Weak", "Fair", "Good", "Strong", "Very Strong"];
const COLORS = ["#94A3B8", "#DC2626", "#D97706", "#1E40AF", "#2563EB", "#15803D"];

export function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) return null;

  const score = checks.reduce((sum, check) => sum + (check(password) ? 1 : 0), 0);
  const color = COLORS[score];
  const label = LABELS[score];

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
        {checks.map((_, i) => (
          <div
            key={i}
            style={{
              height: "3px",
              flex: 1,
              borderRadius: "100px",
              backgroundColor: i < score ? color : "#CBD5E1",
              transition: "background-color 0.3s ease",
            }}
          />
        ))}
      </div>
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color,
          fontFamily: "'Manrope', sans-serif",
          margin: 0,
        }}
      >
        {label}
      </p>
    </div>
  );
}

