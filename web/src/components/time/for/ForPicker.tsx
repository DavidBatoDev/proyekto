// web/src/components/time/for/ForPicker.tsx
//
// The For picker (ux.md › For Chip, 2+ options differing in sheet scope or
// rate source):
//
// - First time: a radio list, agreements first, with "Use for new time on
//   this project" ticked (the write sends `remember: true`).
// - Afterwards: the remembered option is preselected but never applied
//   silently (L38); the primary button names it ("Start for Acme Corp" /
//   "Add for Acme Corp"), so one tap confirms.
// - Unavailable options are greyed with their reason.
//
// `ForPicker` is the controlled list; `ForPickerPanel` adds the title, the
// inline error and the buttons, for a popover or a dialog.

import { Loader2 } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type {
	LoggingForRequest,
	LoggingForResult,
	LoggingOption,
	UnavailableOption,
} from "@/services/time.types";
import { ForIcon, ForWorkspaceTag } from "./ForChip";
import {
	ADD_TIME_LABEL,
	CANCEL_BUTTON,
	goesToText,
	PICKER_TITLE,
	primaryActionLabel,
	REMEMBER_LABEL,
	START_TIMER_LABEL,
	unavailableReasonText,
} from "./forCopy";
import {
	CARD_LABEL_MAX,
	CHIP_LABEL_MAX,
	forOptionKey,
	isSameFor,
	sortForOptions,
	sortUnavailable,
	truncateLabel,
} from "./forOptions";

export interface ForPickerProps {
	/** A resolver answer (or one rebuilt from a 409/422 body). */
	result: Pick<LoggingForResult, "options" | "unavailable"> &
		Partial<LoggingForResult>;
	value: LoggingForRequest | null;
	onChange: (option: LoggingOption) => void;
	/** "Use for new time on this project". Hidden when no handler is given. */
	remember?: boolean;
	onRememberChange?: (remember: boolean) => void;
	disabled?: boolean;
	projectWorkspaceName?: string | null;
	className?: string;
}

export function ForPicker({
	result,
	value,
	onChange,
	remember = false,
	onRememberChange,
	disabled = false,
	projectWorkspaceName,
	className,
}: ForPickerProps) {
	const name = useId();
	const options = sortForOptions(result.options);
	const unavailable = sortUnavailable(result.unavailable);

	return (
		<fieldset
			className={cn("space-y-1.5", className)}
			disabled={disabled}
			aria-label={PICKER_TITLE}
		>
			{options.map((option) => {
				const key = forOptionKey(option);
				const checked = isSameFor(option, value);
				const { text, full } = truncateLabel(option.label, CARD_LABEL_MAX);
				return (
					<label
						key={key}
						className={cn(
							"flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
							checked
								? "border-primary bg-primary/5"
								: "border-border hover:bg-muted/60",
						)}
					>
						<input
							type="radio"
							name={name}
							value={key}
							checked={checked}
							onChange={() => onChange(option)}
							className="mt-0.5 accent-primary"
						/>
						<span className="min-w-0 flex-1">
							<span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
								<ForIcon kind={option.kind} />
								<span className="truncate" title={full}>
									{text}
								</span>
								<ForWorkspaceTag name={option.workspace_tag} />
							</span>
							<span className="mt-0.5 block text-xs text-muted-foreground">
								{goesToText(option, null, {
									projectWorkspaceName,
									personalReason: result.personal_reason,
								})}
							</span>
						</span>
					</label>
				);
			})}
			{unavailable.map((item) => (
				<UnavailableRow key={`off:${forOptionKey(item)}`} item={item} />
			))}
			{onRememberChange ? (
				<label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-foreground">
					<input
						type="checkbox"
						checked={remember}
						onChange={(event) => onRememberChange(event.target.checked)}
						className="accent-primary"
					/>
					{REMEMBER_LABEL}
				</label>
			) : null}
		</fieldset>
	);
}

function UnavailableRow({ item }: { item: UnavailableOption }) {
	const { text, full } = truncateLabel(item.label || "", CARD_LABEL_MAX);
	return (
		<div
			className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 opacity-60"
			aria-disabled="true"
			data-unavailable={item.reason}
		>
			<input
				type="radio"
				disabled
				aria-label={full || item.kind}
				className="mt-0.5"
			/>
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
					<ForIcon kind={item.kind} />
					{text ? (
						<span className="truncate" title={full}>
							{text}
						</span>
					) : null}
				</span>
				<span className="mt-0.5 block text-xs text-muted-foreground">
					{unavailableReasonText(item)}
				</span>
			</span>
		</div>
	);
}

export interface ForPickerPanelProps extends ForPickerProps {
	/** `start` → "Start for …"; `add` → "Add for …". */
	mode: "start" | "add";
	onConfirm: () => void;
	onCancel: () => void;
	busy?: boolean;
	/** An inline message ("That choice isn't available any more. Pick again."). */
	error?: string | null;
	title?: string;
}

/** The picker with its title, inline error and buttons. */
export function ForPickerPanel({
	mode,
	onConfirm,
	onCancel,
	busy = false,
	error,
	title = PICKER_TITLE,
	...picker
}: ForPickerPanelProps) {
	const chosen =
		picker.result.options.find((option) => isSameFor(option, picker.value)) ??
		null;
	const label = chosen
		? truncateLabel(chosen.label, CHIP_LABEL_MAX).text
		: null;
	return (
		<div className="space-y-3 p-3">
			<p className="text-sm font-semibold text-foreground">{title}</p>
			{error ? (
				<p
					role="alert"
					className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
				>
					{error}
				</p>
			) : null}
			<ForPicker {...picker} disabled={busy || picker.disabled} />
			<div className="flex justify-end gap-2 pt-1">
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
				>
					{CANCEL_BUTTON}
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy || !chosen}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{label
						? primaryActionLabel(mode, label)
						: mode === "start"
							? START_TIMER_LABEL
							: ADD_TIME_LABEL}
				</button>
			</div>
		</div>
	);
}
