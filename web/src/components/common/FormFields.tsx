/**
 * Small, theme-token form primitives shared across the finance surfaces
 * (contract steps, invoice builder, rate calculator). These were duplicated
 * locally in each of those files; centralizing them keeps the inputs visually
 * identical and one place to restyle.
 */

import { Check, Info, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { AutosaveStatus } from "@/hooks/useAutosave";
import { Dropdown } from "./Dropdown";

const INPUT_CLASS =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

/**
 * The little ⓘ beside a field label. Hover or click to read the hint.
 *
 * The finance surfaces are full of trade vocabulary — cadence, retainer, net
 * terms, invoice delay — that a consultant shouldn't have to look up. The hint
 * says both what the field means and what it actually does downstream.
 */
export function FieldHint({ label, hint }: { label: string; hint: string }) {
	const [open, setOpen] = useState(false);
	return (
		<span className="relative inline-flex">
			<button
				type="button"
				aria-label={`What is "${label}"?`}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				onBlur={() => setOpen(false)}
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
			>
				<Info className="h-3.5 w-3.5" />
			</button>
			{open && (
				<span
					role="tooltip"
					className="absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg"
				>
					{hint}
				</span>
			)}
		</span>
	);
}

/** A field label with optional inline help and an "(optional)" marker. */
export function FieldLabel({
	label,
	hint,
	optional,
	children,
	className = "",
}: {
	label: string;
	hint?: string;
	optional?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={className}>
			<div className="mb-1.5 flex items-center gap-1">
				<span className="text-xs font-semibold text-muted-foreground">
					{label}
				</span>
				{optional && (
					<span className="text-[11px] font-normal text-muted-foreground/70">
						optional
					</span>
				)}
				{hint && <FieldHint label={label} hint={hint} />}
			</div>
			{children}
		</div>
	);
}

export function TextField({
	label,
	value,
	onChange,
	disabled,
	type = "text",
	placeholder,
	hint,
	optional,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	type?: string;
	placeholder?: string;
	hint?: string;
	optional?: boolean;
}) {
	return (
		<FieldLabel label={label} hint={hint} optional={optional}>
			<input
				type={type}
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={INPUT_CLASS}
			/>
		</FieldLabel>
	);
}

export function SelectField({
	label,
	value,
	onChange,
	options,
	disabled,
	hint,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	disabled?: boolean;
	hint?: string;
}) {
	return (
		<FieldLabel label={label} hint={hint}>
			<Dropdown
				value={value}
				onChange={onChange}
				options={options}
				disabled={disabled}
				ariaLabel={label}
			/>
		</FieldLabel>
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
