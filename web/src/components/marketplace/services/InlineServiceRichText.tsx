import { type RefObject, useRef } from "react";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { isRichTextEmpty } from "@/lib/richText";
import { ServiceRichBody } from "./ServiceRichBody";

/** Formatting a service pitch actually uses. No images: the gallery owns those. */
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
 * A section body that reads as the finished page until you click it.
 *
 * The service editor is the public page with the pieces made editable, so a
 * body sitting in a textarea was the one place the illusion broke: markdown
 * source at editor sizes, next to a preview button you had to press to learn
 * what you had written. Now the closed state IS the buyer's view — the same
 * `ServiceRichBody` the public page renders — and clicking one section, and
 * only that one, turns it into the editor.
 *
 * The editor is not mounted while closed, which is the point: six sections
 * would otherwise be six toolbars stacked down the page.
 *
 * Open/closed is the caller's state because a section owns more than its body
 * — its heading must count as "inside", or typing a heading would close the
 * body underneath it.
 */
export function InlineServiceRichText({
	value,
	onChange,
	editing,
	onEdit,
	onDone,
	containerRef,
	autoFocus = true,
	placeholder,
	emptyHint,
	editLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	editing: boolean;
	onEdit: () => void;
	onDone: () => void;
	/** The region a click counts as "inside"; defaults to this block. */
	containerRef?: RefObject<HTMLElement | null>;
	autoFocus?: boolean;
	placeholder?: string;
	/** Shown in place of the body while there is nothing written yet. */
	emptyHint: string;
	editLabel: string;
}) {
	const ownRef = useRef<HTMLDivElement>(null);
	useDismissOnOutside(editing, containerRef ?? ownRef, onDone);

	if (editing) {
		return (
			<div ref={ownRef} className="mt-3">
				<RichTextEditor
					value={value}
					onChange={onChange}
					tools={[...EDITOR_TOOLS]}
					autoFocus={autoFocus}
					minHeight="120px"
					maxHeight="480px"
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
			aria-label={editLabel}
			className="-mx-2 mt-1 block w-[calc(100%+1rem)] cursor-text rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
		>
			{isRichTextEmpty(value) ? (
				<span className="text-[15px] text-muted-foreground/70">
					{emptyHint}
				</span>
			) : (
				<ServiceRichBody body={value} />
			)}
		</button>
	);
}
