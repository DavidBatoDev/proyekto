import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ProfileModal } from "./ProfileModal";
import { InlineField } from "./ProfileUi";

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: { headline: string }) => void;
	isSaving?: boolean;
	firstName: string;
	lastName: string;
	headline: string;
}

/**
 * The header's editor, as a modal.
 *
 * It used to expand in place, which pushed the name, badges and meta row out
 * from under the avatar and left the page reflowing around a form — and the
 * fields it shows are mostly read-only, so the reflow bought nothing. Every
 * other section on this page edits in a modal; this one now matches.
 */
export function HeaderModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	firstName,
	lastName,
	headline,
}: Props) {
	const [value, setValue] = useState(headline);

	// Re-seed on open rather than on every headline change, so a cancelled edit
	// does not survive into the next one.
	useEffect(() => {
		if (isOpen) setValue(headline);
	}, [isOpen, headline]);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		onSave({ headline: value });
	};

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title="Edit profile"
			width="md"
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<InlineField
						label="First Name"
						name="first_name"
						value={firstName}
						readOnly
					/>
					<InlineField
						label="Last Name"
						name="last_name"
						value={lastName}
						readOnly
					/>
				</div>

				<InlineField
					label="Headline"
					name="headline"
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>

				<p className="text-xs text-muted-foreground">
					First &amp; last name can only be changed by contacting support.
				</p>

				<div className="flex justify-end gap-3 border-t border-border pt-4">
					<button
						type="button"
						onClick={onClose}
						disabled={isSaving}
						className="rounded-lg border border-input px-5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving}
						className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
					>
						{isSaving ? (
							<>
								<Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
							</>
						) : (
							<>
								<Check className="h-3.5 w-3.5" /> Save changes
							</>
						)}
					</button>
				</div>
			</form>
		</ProfileModal>
	);
}
