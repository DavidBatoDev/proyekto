import { useEffect, useRef, useState } from "react";
import { AutoTextarea } from "@/components/common/InlineEditable";
import { useToast } from "@/hooks/useToast";
import { useTeamPatch } from "./useTeamPatch";

/**
 * The team name, edited where it is displayed.
 *
 * An always-editable borderless field rather than a click-to-swap input: the
 * swap version flashes a layout shift as a heading is replaced by a control,
 * and the point of this page is that the title *is* the field. When the viewer
 * cannot edit, it renders a real `<h1>` — not a disabled textarea, which still
 * announces itself as a form control to a screen reader.
 */
export function TeamTitleField({
	teamId,
	name,
	canEdit,
}: {
	teamId: string;
	name: string;
	canEdit: boolean;
}) {
	const toast = useToast();
	const patch = useTeamPatch(teamId);
	const [draft, setDraft] = useState(name);
	const [editing, setEditing] = useState(false);
	const committedRef = useRef(name);

	// Resync from props only while not editing. Without the guard, a refetch
	// mid-keystroke — and every sibling field's patch triggers one — would yank
	// the caret back to the server's copy.
	useEffect(() => {
		if (!editing) {
			setDraft(name);
			committedRef.current = name;
		}
	}, [name, editing]);

	const commit = () => {
		setEditing(false);
		const trimmed = draft.trim();
		if (!trimmed) {
			toast.error("Team name cannot be empty.");
			setDraft(committedRef.current);
			return;
		}
		if (trimmed === committedRef.current) return;
		committedRef.current = trimmed;
		patch.mutate({ name: trimmed });
	};

	if (!canEdit) {
		return (
			<h1 className="text-[30px] font-bold leading-tight tracking-tight text-foreground">
				{name}
			</h1>
		);
	}

	return (
		<AutoTextarea
			aria-label="Team name"
			value={draft}
			// A team name is one line; strip pasted newlines rather than growing
			// the field into a paragraph.
			onChange={(event) => setDraft(event.target.value.replace(/\r?\n/g, " "))}
			onFocus={() => setEditing(true)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				}
				if (event.key === "Escape") {
					setDraft(committedRef.current);
					setEditing(false);
					event.currentTarget.blur();
				}
			}}
			disabled={patch.isPending}
			// A team name is a proper noun, and this field is always editable
			// rather than click-to-edit — so without this the browser draws a red
			// spellcheck squiggle under any name that is not a dictionary word,
			// even when nobody is editing it.
			spellCheck={false}
			autoCorrect="off"
			autoCapitalize="off"
			placeholder="Name this team"
			className="w-full resize-none border-0 bg-transparent p-0 text-[30px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
		/>
	);
}
