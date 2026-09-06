/**
 * The team-time settings switch.
 *
 * Lives here rather than in the route that first needed it because the payout
 * cut-off section renders one too, and importing it from the route file would
 * put a cycle between the route and its own child component.
 */
export function SettingSwitch({
	checked,
	disabled,
	onChange,
	label,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-primary" : "bg-muted-foreground/30"
			}`}
		>
			<span
				className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow ring-0 transition ${
					checked ? "translate-x-5" : "translate-x-0"
				}`}
			/>
		</button>
	);
}
