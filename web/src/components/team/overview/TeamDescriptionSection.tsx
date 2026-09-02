import { useEffect, useRef, useState } from "react";
import { InlineRichText } from "@/components/brief/InlineRichText";
import { RichBody } from "@/components/common/RichBody";
import { isRichTextEmpty, sanitizeRichHtml } from "@/lib/richText";
import { useTeamPatch } from "./useTeamPatch";

/**
 * The team description: prose until you click it, an editor while you are in
 * it, prose again when you click away.
 *
 * **Saving is on close, not on a debounce.** The editor emits `onChange` per
 * keystroke, so a 700ms autosave would PATCH the team every sentence — and each
 * PATCH invalidates the team's caches, which on this page includes one
 * curated-members query per attached project. One write per editing session is
 * the right trade for a field people touch rarely and read often. Nothing is
 * lost on navigation either: closing the block commits, and so does unmounting.
 */
export function TeamDescriptionSection({
	teamId,
	description,
	canEdit,
}: {
	teamId: string;
	description: string | null;
	canEdit: boolean;
}) {
	const patch = useTeamPatch(teamId);
	const sectionRef = useRef<HTMLElement>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(description ?? "");
	const committedRef = useRef(description ?? "");

	// Resync from the server only while closed, so a sibling field's refetch
	// cannot overwrite what is being typed.
	useEffect(() => {
		if (!editing) {
			setDraft(description ?? "");
			committedRef.current = description ?? "";
		}
	}, [description, editing]);

	const commit = () => {
		setEditing(false);
		// Empty is a real value — it is how a description gets cleared — but an
		// editor left holding only markup counts as empty, not as content.
		const next = isRichTextEmpty(draft) ? "" : sanitizeRichHtml(draft);
		if (next === committedRef.current) return;
		committedRef.current = next;
		patch.mutate({ description: next });
	};

	// A close that never happened still has to save: switching tabs or leaving
	// the page unmounts this without a click-away.
	const commitRef = useRef(commit);
	commitRef.current = commit;
	useEffect(() => {
		return () => {
			if (editing) commitRef.current();
		};
	}, [editing]);

	return (
		<section
			ref={sectionRef}
			className={`-mx-3 rounded-xl px-3 py-3 transition-colors ${
				editing ? "bg-muted/30" : canEdit ? "hover:bg-muted/20" : ""
			}`}
		>
			{/* No heading and no Done button: the field is the whole section. Its
			    own "Add a description…" placeholder says what it is, and clicking
			    away, pressing Escape, or leaving the page all commit — so an
			    explicit confirm was chrome for something already handled. */}
			{canEdit ? (
				<InlineRichText
					value={draft}
					onChange={setDraft}
					editing={editing}
					onEdit={() => setEditing(true)}
					onDone={commit}
					containerRef={sectionRef}
					minHeight="140px"
					emptyHint="Add a description…"
					placeholder="What does this team do, and how does it work?"
					editLabel="Edit the team description"
					// The stored value may be legacy plain text, and the API accepts
					// whatever a direct PATCH carries — so the closed state renders
					// through the both-formats, sanitizing renderer rather than
					// trusting the column.
					renderBody={(value) => <RichBody value={value} />}
				/>
			) : isRichTextEmpty(description ?? "") ? (
				<p className="text-[13.5px] text-muted-foreground">
					No description yet.
				</p>
			) : (
				<RichBody
					value={description ?? ""}
					className="text-[13.5px] leading-relaxed text-muted-foreground"
				/>
			)}
		</section>
	);
}
