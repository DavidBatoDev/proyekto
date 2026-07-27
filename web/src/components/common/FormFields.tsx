/**
 * Small, theme-token form primitives shared across the finance surfaces
 * (contract steps, invoice builder, rate calculator). These were duplicated
 * locally in each of those files; centralizing them keeps the inputs visually
 * identical and one place to restyle.
 */

import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/useAutosave";
import { Dropdown } from "./Dropdown";

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
			<Dropdown
				value={value}
				onChange={onChange}
				options={options}
				disabled={disabled}
				ariaLabel={label}
			/>
		</div>
	);
}

/**
 * Passive status line for an auto-saving form — replaces the Save button on
 * surfaces that persist edits automatically. Stays out of the way when idle and
 * only speaks up while saving, once saved, or on failure.
 */
export function AutosaveIndicator({
	status,
	className = "",
}: {
	status: AutosaveStatus;
	className?: string;
}) {
	if (status === "idle") return null;
	const map = {
		saving: {
			icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
			text: "Saving…",
			tone: "text-muted-foreground",
		},
		saved: {
			icon: <Check className="h-3.5 w-3.5" />,
			text: "Saved",
			tone: "text-emerald-600",
		},
		error: {
			icon: <TriangleAlert className="h-3.5 w-3.5" />,
			text: "Couldn't save — change a field to retry",
			tone: "text-destructive",
		},
	} as const;
	const { icon, text, tone } = map[status];
	return (
		<div
			className={`mt-5 inline-flex items-center gap-1.5 text-xs font-medium ${tone} ${className}`}
			aria-live="polite"
		>
			{icon}
			{text}
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
