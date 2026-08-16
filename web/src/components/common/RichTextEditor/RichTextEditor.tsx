import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MentionDropdown } from "./MentionDropdown";
import {
	buildMentionCandidates,
	type MentionTarget,
	matchMentionQuery,
} from "./mentionCandidates";
import { RichTextToolbar } from "./RichTextToolbar";
import type { RichTextEditorProps } from "./types";
import {
	cleanHTML,
	executeCommand,
	getActiveFormats,
	insertImage,
	insertLink,
} from "./utils/formatting";

const DEFAULT_TOOLS = [
	"textFormat",
	"bold",
	"italic",
	"more",
	"separator",
	"bulletList",
	"numberedList",
	"separator",
	"link",
	"image",
] as const;

interface MentionState {
	active: boolean;
	query: string;
	anchorNode: Node | null;
	anchorOffset: number;
	position: { top: number; left: number };
	activeIndex: number;
}

const INITIAL_MENTION: MentionState = {
	active: false,
	query: "",
	anchorNode: null,
	anchorOffset: 0,
	position: { top: 0, left: 0 },
	activeIndex: 0,
};

export function RichTextEditor({
	value,
	onChange,
	placeholder = "Start typing...",
	tools = [...DEFAULT_TOOLS],
	minHeight = "150px",
	maxHeight = "400px",
	className = "",
	disabled = false,
	autoFocus = false,
	mentionUsers,
	canInviteByEmail = false,
	compact = false,
}: RichTextEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null);
	const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
	const isUpdatingRef = useRef(false);
	const [mention, setMention] = useState<MentionState>(INITIAL_MENTION);

	// Initialize content
	useEffect(() => {
		if (editorRef.current && !isUpdatingRef.current) {
			if (editorRef.current.innerHTML !== value) {
				editorRef.current.innerHTML = value;
			}
		}
	}, [value]);

	// Auto focus
	useEffect(() => {
		if (autoFocus && editorRef.current) {
			editorRef.current.focus();
		}
	}, [autoFocus]);

	// Update active formats on selection change (scoped to editor focused selection)
	useEffect(() => {
		let rafId: number | null = null;
		const updateFormats = () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				const sel = window.getSelection();
				if (
					editorRef.current &&
					sel &&
					sel.anchorNode &&
					editorRef.current.contains(sel.anchorNode)
				) {
					setActiveFormats(getActiveFormats());
				}
			});
		};
		document.addEventListener("selectionchange", updateFormats);
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			document.removeEventListener("selectionchange", updateFormats);
		};
	}, []);

	const handleInput = useCallback(() => {
		if (editorRef.current && !isUpdatingRef.current) {
			isUpdatingRef.current = true;
			const html = cleanHTML(editorRef.current.innerHTML);
			onChange(html);
			requestAnimationFrame(() => {
				isUpdatingRef.current = false;
			});
		}
	}, [onChange]);

	const closeMention = useCallback(() => {
		setMention(INITIAL_MENTION);
	}, []);

	const insertMention = useCallback(
		(target: MentionTarget) => {
			if (!mention.anchorNode || !editorRef.current) {
				closeMention();
				return;
			}

			const sel = window.getSelection();
			if (!sel) {
				closeMention();
				return;
			}

			// Select from the @ sign to current cursor
			const range = document.createRange();
			range.setStart(mention.anchorNode, mention.anchorOffset);
			const cursorRange = sel.getRangeAt(0);
			range.setEnd(cursorRange.endContainer, cursorRange.endOffset);

			// Delete the @query text
			range.deleteContents();

			// Insert the mention span.
			//
			// The two kinds carry DIFFERENT attributes and must never be conflated:
			// `data-user-id` is read by extractMentionedUserIds and compared against
			// uuid columns, so an address there would throw 22P02 or silently match
			// nothing. Email mentions get their own attribute and their own extractor.
			const span = document.createElement("span");
			span.contentEditable = "false";
			if (target.kind === "user") {
				span.className = "mention";
				span.setAttribute("data-user-id", target.user.id);
				span.textContent = `@${target.user.display_name}`;
			} else {
				span.className = "mention mention-invite";
				span.setAttribute("data-invite-email", target.email);
				// The full address, not a shortened form: "@alice" would be ambiguous
				// with a real member called alice, and the author should see exactly
				// who is about to be emailed.
				span.textContent = `@${target.email}`;
			}
			range.insertNode(span);

			// Insert a trailing space after the mention
			const space = document.createTextNode(" ");
			span.after(space);

			// Move cursor after the space
			const newRange = document.createRange();
			newRange.setStartAfter(space);
			newRange.collapse(true);
			sel.removeAllRanges();
			sel.addRange(newRange);

			closeMention();
			editorRef.current.focus();
			handleInput();
		},
		[mention, closeMention, handleInput],
	);

	// ONE list. Keyboard navigation and the dropdown must index into the same
	// array — computing the filter separately per consumer is how Enter ends up
	// selecting a different entry than the one highlighted.
	const mentionCandidates = useMemo(
		() =>
			buildMentionCandidates(
				mentionUsers,
				mention.query,
				Boolean(canInviteByEmail),
			),
		[mentionUsers, mention.query, canInviteByEmail],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (mention.active) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setMention((prev) => ({
						...prev,
						activeIndex: Math.min(
							prev.activeIndex + 1,
							mentionCandidates.length - 1,
						),
					}));
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					setMention((prev) => ({
						...prev,
						activeIndex: Math.max(prev.activeIndex - 1, 0),
					}));
					return;
				}
				if (e.key === "Enter" || e.key === "Tab") {
					e.preventDefault();
					const selected = mentionCandidates[mention.activeIndex];
					if (selected) insertMention(selected);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					closeMention();
					return;
				}
				if (e.key === " " || e.key === "Backspace") {
					// If they backspace past the @, close mention
					if (e.key === "Backspace" && mention.query === "") {
						closeMention();
					}
				}
			}
		},
		[mention, mentionCandidates, insertMention, closeMention],
	);

	const handleInputWithMention = useCallback(
		(_e: React.FormEvent<HTMLDivElement>) => {
			handleInput();

			// Not `!mentionUsers?.length`: an admin in a project with no other
			// members must still be able to invite someone by address.
			if (!mentionUsers?.length && !canInviteByEmail) return;

			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return;

			const range = sel.getRangeAt(0);
			const node = range.startContainer;
			const offset = range.startOffset;

			if (node.nodeType !== Node.TEXT_NODE) {
				if (mention.active) closeMention();
				return;
			}

			const text = node.textContent ?? "";
			const beforeCursor = text.slice(0, offset);
			const atMatch = matchMentionQuery(beforeCursor);

			if (atMatch) {
				const { query, atOffset } = atMatch;

				// Get pixel position of the @ character
				const atRange = document.createRange();
				atRange.setStart(node, atOffset);
				atRange.setEnd(node, atOffset + 1);
				const rect = atRange.getBoundingClientRect();

				setMention({
					active: true,
					query,
					anchorNode: node,
					anchorOffset: atOffset,
					position: { top: rect.bottom + 4, left: rect.left },
					activeIndex: 0,
				});
			} else {
				if (mention.active) closeMention();
			}
		},
		[handleInput, mentionUsers, canInviteByEmail, mention.active, closeMention],
	);

	const handleCommand = useCallback(
		(command: string, commandValue?: string) => {
			if (!editorRef.current) return;
			editorRef.current.focus();
			switch (command) {
				case "createLink":
					if (commandValue) insertLink(commandValue);
					break;
				case "insertImage":
					if (commandValue) insertImage(commandValue);
					break;
				default:
					executeCommand(command as any, commandValue);
			}
			handleInput();
			setActiveFormats(getActiveFormats());
		},
		[handleInput],
	);

	const handlePaste = useCallback((e: React.ClipboardEvent) => {
		e.preventDefault();
		const text = e.clipboardData.getData("text/plain");
		document.execCommand("insertText", false, text);
	}, []);

	return (
		<div
			className={`border border-gray-200 rounded-lg overflow-hidden bg-white ${className}`}
		>
			<RichTextToolbar
				tools={tools}
				onCommand={handleCommand}
				activeFormats={activeFormats}
				compact={compact}
			/>
			<div
				ref={editorRef}
				contentEditable={!disabled}
				onInput={handleInputWithMention}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
				onBlur={() => {
					// Delay to allow mention click to register
					setTimeout(() => {
						if (mention.active) closeMention();
					}, 150);
				}}
				className={`px-4 py-3 outline-none prose prose-sm max-w-none ${maxHeight === "none" ? "" : "overflow-y-auto"}`}
				style={{
					minHeight,
					maxHeight: maxHeight === "none" ? undefined : maxHeight,
				}}
				data-placeholder={placeholder}
				suppressContentEditableWarning
			/>

			{mention.active && mentionCandidates.length > 0 && (
				<MentionDropdown
					candidates={mentionCandidates}
					position={mention.position}
					onSelect={insertMention}
					onClose={closeMention}
					activeIndex={mention.activeIndex}
					onActiveIndexChange={(idx) =>
						setMention((prev) => ({ ...prev, activeIndex: idx }))
					}
				/>
			)}

			<style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        [contenteditable] {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        [contenteditable] .mention {
          color: #f97316;
          font-weight: 600;
          border-radius: 3px;
          padding: 0 2px;
        }
        [contenteditable] h1 {
          font-size: 2em;
          font-weight: bold;
          margin: 0.67em 0;
        }
        [contenteditable] h2 {
          font-size: 1.5em;
          font-weight: bold;
          margin: 0.75em 0;
        }
        [contenteditable] h3 {
          font-size: 1.17em;
          font-weight: bold;
          margin: 0.83em 0;
        }
        [contenteditable] h4 {
          font-size: 1em;
          font-weight: bold;
          margin: 1.12em 0;
        }
        [contenteditable] h5 {
          font-size: 0.83em;
          font-weight: bold;
          margin: 1.5em 0;
        }
        [contenteditable] h6 {
          font-size: 0.75em;
          font-weight: bold;
          margin: 1.67em 0;
        }
        [contenteditable] p {
          margin: 1em 0;
        }
        [contenteditable] ul,
        [contenteditable] ol {
          margin: 1em 0;
          padding-left: 2em;
          list-style-position: outside;
        }
        [contenteditable] ul {
          list-style-type: disc;
        }
        [contenteditable] ol {
          list-style-type: decimal;
        }
        [contenteditable] li {
          margin: 0.5em 0;
        }
        [contenteditable] a {
          color: #3b82f6;
          text-decoration: underline;
        }
        [contenteditable] img {
          max-width: 100%;
          height: auto;
          margin: 1em 0;
        }
        [contenteditable] blockquote {
          border-left: 4px solid #e5e7eb;
          padding-left: 1em;
          margin: 1em 0;
          color: #6b7280;
        }
        [contenteditable] code {
          background-color: #f3f4f6;
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
        }
        [contenteditable] pre {
          background-color: #f3f4f6;
          padding: 1em;
          border-radius: 6px;
          overflow-x: auto;
        }
        [contenteditable] pre code {
          background-color: transparent;
          padding: 0;
        }
      `}</style>
		</div>
	);
}
