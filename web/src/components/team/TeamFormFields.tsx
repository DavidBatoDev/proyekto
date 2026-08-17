/**
 * The name / description / tags trio shared by every surface that CREATES a
 * team — the modal on /teams and the onboarding slide in the welcome deck.
 *
 * Fields only: no <form>, no submit button, no mutation. The two callers
 * differ in how they persist and what they do on success, so sharing the whole
 * form would mean threading callbacks for less benefit than keeping the field
 * limits (120 / 500 / tag caps) in one place.
 *
 * Not used by team settings, which is a per-field inline-edit surface rather
 * than a form.
 */

import { TagInput } from "@/components/common/TagInput";

export interface TeamDraft {
	name: string;
	description: string;
	tags: string[];
}

export const EMPTY_TEAM_DRAFT: TeamDraft = {
	name: "",
	description: "",
	tags: [],
};

/** Deck inputs are larger than modal inputs; nothing else differs. */
const INPUT_CLASS = {
	modal:
		"mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25",
	deck: "mt-1 w-full rounded-xl border border-input bg-card px-4 py-3 text-base text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25",
} as const;

const LABEL_CLASS = "text-sm font-medium text-foreground";

export function TeamFormFields({
	draft,
	onChange,
	disabled,
	autoFocus,
	variant = "modal",
}: {
	draft: TeamDraft;
	onChange: (next: TeamDraft) => void;
	disabled?: boolean;
	autoFocus?: boolean;
	variant?: "modal" | "deck";
}) {
	const inputClass = INPUT_CLASS[variant];
	const set = <K extends keyof TeamDraft>(key: K, value: TeamDraft[K]) =>
		onChange({ ...draft, [key]: value });

	return (
		<div className={variant === "deck" ? "space-y-5" : "space-y-4"}>
			<label className="block">
				<span className={LABEL_CLASS}>Name</span>
				<input
					// The deck slide and the modal both open with this as the only
					// actionable field, so focusing it is what a user expects.
					autoFocus={autoFocus}
					value={draft.name}
					disabled={disabled}
					onChange={(e) => set("name", e.target.value)}
					maxLength={120}
					className={inputClass}
					placeholder="e.g. Engineering Squad"
				/>
			</label>

			<label className="block">
				<span className={LABEL_CLASS}>Description (optional)</span>
				<textarea
					value={draft.description}
					disabled={disabled}
					onChange={(e) => set("description", e.target.value)}
					maxLength={500}
					rows={3}
					className={inputClass}
				/>
			</label>

			<div>
				<span className={LABEL_CLASS}>Labels (optional)</span>
				<p className="mt-0.5 mb-1 text-xs text-muted-foreground">
					Descriptive only — labels don't affect who can see or do anything.
				</p>
				<TagInput
					value={draft.tags}
					disabled={disabled}
					onChange={(tags) => set("tags", tags)}
					ariaLabel="Team labels"
					inputClassName={inputClass}
				/>
			</div>
		</div>
	);
}
