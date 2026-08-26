import { Crosshair, Sparkles } from "lucide-react";

export interface FieldEvidence {
	page: number;
	value_text?: string;
}

/**
 * One recorded figure, beside the button that arms snipping for it.
 *
 * The three states a value can be in are visible rather than implied, because
 * they carry different weight: read off the document (a snip, with the page it
 * came from), suggested by the reader and not yet confirmed (a draft), or typed
 * by hand (evidence is on the person who typed it).
 */
export function SnipField({
	label,
	value,
	onChange,
	fieldKey,
	activeField,
	onArm,
	evidence,
	suggested,
	type = "text",
	placeholder,
	required,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	fieldKey: string;
	activeField: string | null;
	onArm: (fieldKey: string | null) => void;
	evidence?: FieldEvidence;
	/** True while the value is the reader's guess and nobody has confirmed it. */
	suggested?: boolean;
	type?: "text" | "number" | "date";
	placeholder?: string;
	required?: boolean;
}) {
	const armed = activeField === fieldKey;

	return (
		<div>
			<div className="mb-1 flex items-center justify-between gap-2">
				<label
					htmlFor={`field-${fieldKey}`}
					className="text-xs font-medium text-muted-foreground"
				>
					{label}
					{required && (
						<span className="ml-0.5 text-destructive-foreground">*</span>
					)}
				</label>
				<button
					type="button"
					onClick={() => onArm(armed ? null : fieldKey)}
					aria-pressed={armed}
					className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
						armed
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:bg-muted hover:text-foreground"
					}`}
				>
					<Crosshair className="h-3 w-3" />
					{armed ? "Drag on the document" : "Snip"}
				</button>
			</div>

			<input
				id={`field-${fieldKey}`}
				type={type}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				className={`w-full rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 ${
					armed ? "border-primary" : "border-input"
				}`}
			/>

			<p className="mt-1 flex min-h-4 items-center gap-1 text-[11px] text-muted-foreground">
				{evidence ? (
					<>
						<Crosshair className="h-3 w-3 text-primary" />
						Snipped from page {evidence.page}
					</>
				) : suggested && value ? (
					<>
						<Sparkles className="h-3 w-3 text-warning-foreground" />
						Suggested — snip it to evidence the figure
					</>
				) : null}
			</p>
		</div>
	);
}
