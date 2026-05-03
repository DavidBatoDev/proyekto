import { PrimaryButton, SecondaryButton } from "./SignupButtons";

interface WizardNavProps {
  /** When provided, renders the Back button on the left */
  onBack?: () => void;
  /** Label for the back button. Defaults to "Back". */
  backLabel?: string;
  /** Label for the primary (Continue / Submit) button */
  primaryLabel: string;
  /** Loading state for the primary button (e.g. while submitting) */
  isLoading?: boolean;
  /** Label shown while loading. Defaults to "Loading…". */
  loadingLabel?: string;
  /** HTML button type. Use "submit" inside a `<form>`, "button" otherwise. */
  primaryType?: "button" | "submit";
  /** Optional click handler for the primary button. Omit when using "submit". */
  onPrimaryClick?: () => void;
  /** Disable the primary button (e.g. when validation hasn't passed) */
  primaryDisabled?: boolean;
}

/**
 * Shared Back + Continue/Submit row used across the signup wizard steps.
 *
 * Layout: Back pinned to the left, Primary pinned to the right, with space
 * between. Both buttons are auto-sized (no stretching) so each occupies just
 * enough room for its label. When `onBack` is omitted, the primary button is
 * pushed to the right alone (use `fullWidth` for the rare case it should
 * stretch — e.g. a single-action submit step).
 */
export function WizardNav({
  onBack,
  backLabel = "Back",
  primaryLabel,
  isLoading,
  loadingLabel,
  primaryType = "submit",
  onPrimaryClick,
  primaryDisabled,
}: WizardNavProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "stretch",
        gap: "12px",
        marginTop: "8px",
      }}
    >
      {onBack ? (
        <SecondaryButton
          type="button"
          onClick={onBack}
          style={{ width: "auto", flex: "0 0 auto", padding: "0 32px" }}
        >
          ← {backLabel}
        </SecondaryButton>
      ) : (
        // Spacer so primary stays on the right even without a Back button.
        <span aria-hidden style={{ flex: "0 0 auto" }} />
      )}
      <PrimaryButton
        type={primaryType}
        onClick={onPrimaryClick}
        isLoading={isLoading}
        loadingText={loadingLabel}
        disabled={primaryDisabled}
        style={{ width: "auto", flex: "0 0 auto", padding: "0 40px" }}
      >
        {primaryLabel} →
      </PrimaryButton>
    </div>
  );
}
