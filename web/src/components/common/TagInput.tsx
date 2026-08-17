/**
 * A freeform tag/chip input over a plain `string[]`.
 *
 * Built because three surfaces had each hand-rolled their own (the portfolio
 * modal being the closest), so the limits and the commit rules drifted. This is
 * purely presentational — no queries, no mutations — so it can sit inside a
 * modal, a settings page, or an onboarding slide without dragging state in.
 */

import { X } from "lucide-react";
import { useState } from "react";

const DEFAULT_MAX_TAGS = 20;
const DEFAULT_MAX_TAG_LENGTH = 40;

const BASE_INPUT_CLASS =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

/**
 * Canonicalize a tag list. Mirrors `normalizeTeamTags` on the backend exactly —
 * the server is still the authority, this just keeps the UI from showing a
 * value the API would silently rewrite.
 */
export function normalizeTags(
	list: string[],
	{
		maxTags = DEFAULT_MAX_TAGS,
		maxTagLength = DEFAULT_MAX_TAG_LENGTH,
	}: { maxTags?: number; maxTagLength?: number } = {},
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of list) {
		if (typeof raw !== "string") continue;
		const tag = raw.replace(/\s+/g, " ").trim().slice(0, maxTagLength);
		if (!tag) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
		if (out.length >= maxTags) break;
	}
	return out;
}

export function TagInput({
	value,
	onChange,
	disabled,
	placeholder = "Add a label and press Enter",
	maxTags = DEFAULT_MAX_TAGS,
	maxTagLength = DEFAULT_MAX_TAG_LENGTH,
	id,
	ariaLabel = "Tags",
	inputClassName,
}: {
	value: string[];
	onChange: (tags: string[]) => void;
	disabled?: boolean;
	placeholder?: string;
	maxTags?: number;
	maxTagLength?: number;
	id?: string;
	ariaLabel?: string;
	/** Overrides the input skin so a deck slide and a modal can differ in scale. */
	inputClassName?: string;
}) {
	const [pending, setPending] = useState("");
	const atCap = value.length >= maxTags;

	const commit = (raw: string) => {
		const next = normalizeTags([...value, ...raw.split(/[,\n]/)], {
			maxTags,
			maxTagLength,
		});
		setPending("");
		// Only notify on an actual change, so a stray blur doesn't dirty a form.
		if (next.length !== value.length || next.some((t, i) => t !== value[i])) {
			onChange(next);
		}
	};

	const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

	return (
		<div>
			<input
				id={id}
				aria-label={ariaLabel}
				value={pending}
				disabled={disabled || atCap}
				placeholder={atCap ? `Maximum of ${maxTags} labels` : placeholder}
				onChange={(e) => setPending(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === ",") {
						e.preventDefault();
						if (pending.trim()) commit(pending);
						return;
					}
					// Backspace on an empty field removes the last chip — the
					// convention every chip input people have used behaves this way.
					if (e.key === "Backspace" && !pending && value.length > 0) {
						e.preventDefault();
						remove(value[value.length - 1]);
					}
				}}
				// Commit on blur so a label that was typed but not Entered isn't
				// silently lost when the user clicks Save or Next.
				onBlur={() => {
					if (pending.trim()) commit(pending);
				}}
				onPaste={(e) => {
					const text = e.clipboardData.getData("text");
					if (!/[,\n]/.test(text)) return;
					e.preventDefault();
					commit(`${pending}${text}`);
				}}
				className={inputClassName ?? BASE_INPUT_CLASS}
			/>

			{value.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{value.map((tag) => (
						<span
							key={tag}
							className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
						>
							{tag}
							{!disabled && (
								<button
									type="button"
									aria-label={`Remove ${tag}`}
									onClick={() => remove(tag)}
									className="text-muted-foreground transition hover:text-foreground"
								>
									<X className="h-3 w-3" />
								</button>
							)}
						</span>
					))}
				</div>
			)}

			{value.length > 0 && (
				<p className="mt-1.5 text-xs text-muted-foreground">
					{value.length}/{maxTags}
				</p>
			)}
		</div>
	);
}
