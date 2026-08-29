import { type RefObject, useRef } from "react";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { isRichTextEmpty } from "@/lib/richText";

const EDITOR_TOOLS = [
	"textFormat",
	"bold",
	"italic",
	"separator",
	"bulletList",
	"numberedList",
	"separator",
	"link",
] as const;

/**
 * Rich text that reads as prose until you click it.
 *
 * The brief is a document, so it should look like one: a finished paragraph,
 * not a form field with a toolbar bolted to it. Clicking turns that one block —
 * and only that one — into the editor, the way a notebook cell behaves, and
 * clicking away turns it back. **The editor is not mounted while the block is
 * closed**, which is the whole point: five sections would otherwise be five
 * toolbars competing for the same page.
 *
 * Editing state is the caller's, not this component's, because the caller
 * usually owns more of the block than the text — a section owns its heading
 * too, and that heading must not count as "outside".
 */
export function InlineRichText({
	value,
	onChange,
	editing,
	onEdit,
	onDone,
	disabled,
	placeholder,
	emptyHint,
	minHeight = "120px",
	maxHeight = "420px",
	autoFocus = true,
	containerRef,
	editLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	editing: boolean;
	onEdit: () => void;
	onDone: () => void;
	disabled?: boolean;
	placeholder?: string;
	/** Shown in place of the body when there is nothing written yet. */
	emptyHint: string;
	minHeight?: string;
	maxHeight?: string;
	autoFocus?: boolean;
	/**
	 * The region a click counts as "inside". Defaults to this block; a section
	 * passes its whole cell so its heading does not close the editor.
	 */
	containerRef?: RefObject<HTMLElement | null>;
	editLabel: string;
}) {
	const ownRef = useRef<HTMLDivElement>(null);

	// Clicking away closes the block, which is what makes this feel like a
	// document rather than a form. Shared with the service section editor —
	// see the hook for why it listens on the document rather than on blur.
	useDismissOnOutside(editing, containerRef ?? ownRef, onDone);

	if (editing) {
		return (
			<div ref={ownRef}>
				<RichTextEditor
					value={value}
					onChange={onChange}
					tools={[...EDITOR_TOOLS]}
					disabled={disabled}
					autoFocus={autoFocus}
					minHeight={minHeight}
					maxHeight={maxHeight}
					placeholder={placeholder}
				/>
			</div>
		);
	}

	return (
		<button
			ref={ownRef as unknown as RefObject<HTMLButtonElement>}
			type="button"
			onClick={onEdit}
			disabled={disabled}
			aria-label={editLabel}
			className="block w-full cursor-text text-left disabled:cursor-not-allowed disabled:opacity-60"
		>
			{isRichTextEmpty(value) ? (
				<span className="text-[13.5px] text-muted-foreground">{emptyHint}</span>
			) : (
				<span
					// Authored in this app's own rich-text editor and stored as its
					// sanitized output — the same trust boundary the project overview
					// uses for a brief.
					dangerouslySetInnerHTML={{ __html: value }}
					className="prose-brief block text-[13.5px] leading-relaxed text-muted-foreground"
				/>
			)}
		</button>
	);
}
