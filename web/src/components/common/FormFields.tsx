/**
 * Small, theme-token form primitives shared across the finance surfaces
 * (contract steps, invoice builder, rate calculator). These were duplicated
 * locally in each of those files; centralizing them keeps the inputs visually
 * identical and one place to restyle.
 */

const INPUT_CLASS =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

export function TextField({
	label,
	value,
	onChange,
	disabled,
	type = "text",
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	type?: string;
	placeholder?: string;
}) {
	return (
		<div>
			<span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
				{label}
			</span>
			<input
				type={type}
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={INPUT_CLASS}
			/>
		</div>
	);
}

export function SelectField({
	label,
	value,
	onChange,
	options,
	disabled,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	disabled?: boolean;
}) {
	return (
		<div>
			<span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
				{label}
			</span>
			<select
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className={INPUT_CLASS}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

export function SaveButton({
	onClick,
	isPending,
	disabled,
	label = "Save",
}: {
	onClick: () => void;
	isPending: boolean;
	disabled?: boolean;
	label?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={isPending || disabled}
			className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
		>
			{isPending ? "Saving…" : label}
		</button>
	);
}
