import { Plus, Send, X } from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AiMentionKindIcon,
	AiMentionPicker,
	aiMentionOptionId,
} from "./AiMentionPicker";
import {
	type AiContextChip,
	type AiMentionCandidate,
	type AiMentionPick,
	getMentionContext,
	renderHighlightBackdrop,
	resolveEntityMentions,
	toMentionPick,
} from "./aiMentions";

export const AI_COMPOSER_MAX_HEIGHT_PX = 160;
/** `w-80` on the picker; used to keep a caret-anchored picker inside the box. */
const PICKER_WIDTH_PX = 320;
/** Add-context popover footer when the search matches nothing. */
export const AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL = "No matching items";
/** Tooltip on an auto-attached chip. */
export const AI_COMPOSER_AUTO_CHIP_TITLE = "Attached automatically";

const EMPTY_CHIPS: readonly AiContextChip[] = [];

export interface AiComposerProps {
	value: string;
	/** Passed back through `onChange` untouched until a mention is picked. */
	picks: AiMentionPick[];
	onChange: (value: string, picks: AiMentionPick[]) => void;
	onSend: () => void;
	disabled?: boolean;
	placeholder: string;
	/** The flat array the picker renders and the keyboard indexes into. */
	candidates: readonly AiMentionCandidate[];
	candidatesLoading?: boolean;
	/**
	 * Reports the picker's state (the caret `@` picker or the add-context
	 * popover — only one is ever open) so the host can drive
	 * `useAiMentionCandidates({ active, query })`. Called with `(false, "")`
	 * when it closes and on unmount.
	 */
	onPickerActiveChange?: (active: boolean, query: string) => void;
	/** Field on top, controls on a row underneath (the fullscreen surface). */
	stacked?: boolean;
	autoFocus?: boolean;
	ariaLabel?: string;
	/**
	 * Chips in the context row above the field: the surface's auto refs plus
	 * the draft picks (`buildContextChips`).
	 */
	contextRefs?: readonly AiContextChip[];
	/**
	 * A pick from the add-context popover. The text is never touched; the
	 * host records it as a draft pick. Enables the "Add context" button.
	 */
	onAddRef?: (candidate: AiMentionCandidate) => void;
	/** A chip's remove button; receives the chip's `key`. */
	onRemoveRef?: (key: string) => void;
}

interface MentionContext {
	start: number;
	query: string;
}

/** rAF when the environment has one (jsdom without pretendToBeVisual lacks it). */
function sameContext(a: MentionContext | null, b: MentionContext | null) {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.start === b.start && a.query === b.query;
}

/**
 * The kit composer: a controlled textarea (value + mention picks live in the
 * host, which persists them per thread) with a transparent mirror backdrop
 * painting mention pills, an @-picker anchored at the caret column, and
 * Enter-to-send / Shift+Enter newline. Above the field sits the context row:
 * an "Add context" button (a search-driven popover over the SAME picker) and
 * one chip per attached ref. Keyboard navigation and the rendered rows index
 * into the same `candidates` array — the composer never filters.
 */
export function AiComposer({
	value,
	picks,
	onChange,
	onSend,
	disabled = false,
	placeholder,
	candidates,
	candidatesLoading = false,
	onPickerActiveChange,
	stacked = false,
	autoFocus = false,
	ariaLabel = "Message",
	contextRefs = EMPTY_CHIPS,
	onAddRef,
	onRemoveRef,
}: AiComposerProps) {
	const listboxId = useId();
	const contextListboxId = useId();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const mentionRef = useRef<MentionContext | null>(null);
	const [mention, setMention] = useState<MentionContext | null>(null);
	// The add-context popover's search text; null while the popover is closed.
	const [contextQuery, setContextQuery] = useState<string | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [pickerLeft, setPickerLeft] = useState(0);

	const pickerHasRows = candidates.length > 0;
	const pickerOpen = mention !== null && (pickerHasRows || candidatesLoading);
	const contextOpen = contextQuery !== null;
	const safeIndex = pickerHasRows
		? Math.min(activeIndex, candidates.length - 1)
		: 0;
	const canSend = !disabled && value.trim().length > 0;

	const spans = useMemo(
		() => resolveEntityMentions(value, picks),
		[value, picks],
	);

	// Report picker state to the host (which owns the candidate queries). The
	// caret picker and the popover never overlap (opening one closes the
	// other), so whichever is open supplies the query.
	const onPickerActiveChangeRef = useRef(onPickerActiveChange);
	onPickerActiveChangeRef.current = onPickerActiveChange;
	useEffect(() => {
		if (mention) {
			onPickerActiveChangeRef.current?.(true, mention.query);
		} else if (contextQuery !== null) {
			onPickerActiveChangeRef.current?.(true, contextQuery);
		} else {
			onPickerActiveChangeRef.current?.(false, "");
		}
	}, [mention, contextQuery]);
	useEffect(
		() => () => {
			onPickerActiveChangeRef.current?.(false, "");
		},
		[],
	);

	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "0px";
		const next = Math.min(textarea.scrollHeight, AI_COMPOSER_MAX_HEIGHT_PX);
		textarea.style.height = `${next}px`;
		textarea.style.overflowY =
			textarea.scrollHeight > AI_COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
	}, []);

	useEffect(() => {
		adjustTextareaHeight();
	}, [adjustTextareaHeight, value]);

	// Caret restore after a mention pick (see selectMention). Runs before the
	// browser can deliver the next keystroke, unlike requestAnimationFrame.
	const pendingCaretRef = useRef<{ value: string; caret: number } | null>(null);
	useLayoutEffect(() => {
		const pending = pendingCaretRef.current;
		const textarea = textareaRef.current;
		if (!pending || !textarea) return;
		if (textarea.value !== pending.value) return;
		pendingCaretRef.current = null;
		textarea.focus();
		textarea.setSelectionRange(pending.caret, pending.caret);
		adjustTextareaHeight();
	}, [value, adjustTextareaHeight]);

	useEffect(() => {
		if (autoFocus) textareaRef.current?.focus();
	}, [autoFocus]);

	// Anchor the picker at the caret column: the invisible mirror holds the
	// text up to the `@` and a marker span whose offsetLeft is the column.
	useLayoutEffect(() => {
		if (!mention) return;
		const anchor = anchorRef.current;
		const box = boxRef.current;
		if (!anchor || !box) return;
		const maxLeft = Math.max(0, box.clientWidth - PICKER_WIDTH_PX);
		setPickerLeft(Math.min(Math.max(0, anchor.offsetLeft), maxLeft));
	}, [mention]);

	const updateMention = useCallback((next: MentionContext | null) => {
		if (sameContext(mentionRef.current, next)) return;
		mentionRef.current = next;
		setMention(next);
		if (next) setActiveIndex(0);
	}, []);

	const closeMention = useCallback(() => updateMention(null), [updateMention]);

	const syncMention = useCallback(
		(nextValue: string, caret: number | null) => {
			updateMention(caret == null ? null : getMentionContext(nextValue, caret));
		},
		[updateMention],
	);

	const selectMention = (candidate: AiMentionCandidate) => {
		if (!mention) return;
		const textarea = textareaRef.current;
		const before = value.slice(0, mention.start);
		// Skip "@" + query.
		const after = value.slice(mention.start + 1 + mention.query.length);
		const insert = `@${candidate.label} `;
		const nextValue = `${before}${insert}${after}`;
		onChange(nextValue, [...picks, toMentionPick(candidate)]);
		closeMention();

		// Restore the caret right after the inserted mention once the DOM value
		// matches the spliced value. Done in a layout effect (below) rather than
		// a deferred frame: a deferred restore raced with the next keystroke and
		// moved a fast typist's first letter to the end of the text.
		pendingCaretRef.current = {
			value: nextValue,
			caret: before.length + insert.length,
		};
		if (textarea && textarea.value === nextValue) {
			textarea.focus();
			textarea.setSelectionRange(
				pendingCaretRef.current.caret,
				pendingCaretRef.current.caret,
			);
			pendingCaretRef.current = null;
			adjustTextareaHeight();
		}
	};

	// ---------------------------------------------------------------------------
	// Add-context popover: the same listbox, driven by a search input instead
	// of the caret. Selecting records a chip-only ref and never edits the text.
	// ---------------------------------------------------------------------------

	const openContext = () => {
		closeMention();
		setActiveIndex(0);
		setContextQuery("");
	};

	const closeContext = useCallback((refocusField: boolean) => {
		setContextQuery(null);
		if (refocusField) textareaRef.current?.focus();
	}, []);

	const selectContext = (candidate: AiMentionCandidate) => {
		onAddRef?.(candidate);
		closeContext(true);
	};

	const handleContextButtonMouseDown = (
		event: MouseEvent<HTMLButtonElement>,
	) => {
		// While open, keep focus on the search input so its blur does not close
		// the popover before the click can toggle it.
		if (contextOpen) event.preventDefault();
	};

	const handlePopoverMouseDown = (event: MouseEvent<HTMLDivElement>) => {
		// Clicks on the popover chrome (headers, scrollbar) must not blur the
		// search input; clicks on the input itself still place the caret.
		if (event.target !== searchRef.current) event.preventDefault();
	};

	const handleContextKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			closeContext(true);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const candidate = candidates[safeIndex] ?? candidates[0];
			if (pickerHasRows && candidate) selectContext(candidate);
			return;
		}
		if (!pickerHasRows) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((safeIndex + 1) % candidates.length);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((safeIndex - 1 + candidates.length) % candidates.length);
		}
	};

	const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		onChange(event.target.value, picks);
		syncMention(event.target.value, event.target.selectionStart);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (pickerOpen && pickerHasRows) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveIndex((safeIndex + 1) % candidates.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveIndex((safeIndex - 1 + candidates.length) % candidates.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const candidate = candidates[safeIndex] ?? candidates[0];
				if (candidate) selectMention(candidate);
				return;
			}
		}
		if (pickerOpen && event.key === "Escape") {
			event.preventDefault();
			closeMention();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			if (canSend) onSend();
		}
	};

	const sendButton = (
		<button
			type="button"
			onClick={() => {
				if (canSend) onSend();
			}}
			disabled={!canSend}
			className="ai-gradient-bg inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
			title="Send message"
			aria-label="Send message"
		>
			<Send className="h-4 w-4" aria-hidden />
		</button>
	);

	const popoverListboxPresent = pickerHasRows || candidatesLoading;

	// The row is a SIBLING above the field: the mirror backdrop inside the
	// field box is `absolute inset-0`, so anything placed inside would push
	// the textarea out from under its own highlight.
	const contextRow =
		onAddRef || contextRefs.length > 0 ? (
			<div
				className="flex flex-wrap items-center gap-1.5"
				data-testid="ai-context-row"
			>
				{onAddRef && (
					<div className="relative">
						<button
							type="button"
							onClick={() =>
								contextOpen ? closeContext(false) : openContext()
							}
							onMouseDown={handleContextButtonMouseDown}
							disabled={disabled}
							aria-label="Add context"
							aria-haspopup="listbox"
							aria-expanded={contextOpen}
							aria-controls={
								contextOpen && popoverListboxPresent
									? contextListboxId
									: undefined
							}
							className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Plus className="h-3 w-3" aria-hidden />
							<span>Add context</span>
						</button>
						{contextOpen && (
							<div
								onMouseDown={handlePopoverMouseDown}
								className="absolute bottom-full left-0 z-40 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
							>
								<div className="border-b border-border px-2 py-1.5">
									<input
										ref={searchRef}
										type="text"
										value={contextQuery}
										onChange={(event) => {
											setContextQuery(event.target.value);
											setActiveIndex(0);
										}}
										onKeyDown={handleContextKeyDown}
										onBlur={() => closeContext(false)}
										autoFocus
										placeholder="Search projects, roadmaps, items..."
										aria-label="Search context"
										aria-autocomplete="list"
										aria-controls={
											popoverListboxPresent ? contextListboxId : undefined
										}
										aria-activedescendant={
											pickerHasRows
												? aiMentionOptionId(contextListboxId, safeIndex)
												: undefined
										}
										className="w-full bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
									/>
								</div>
								<AiMentionPicker
									embedded
									id={contextListboxId}
									candidates={candidates}
									activeIndex={safeIndex}
									onActiveIndexChange={setActiveIndex}
									onSelect={selectContext}
									isLoading={candidatesLoading}
								/>
								{!popoverListboxPresent && (
									<div
										role="presentation"
										className="px-3 py-2 text-[11px] text-muted-foreground"
									>
										{AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL}
									</div>
								)}
							</div>
						)}
					</div>
				)}
				{contextRefs.map((chip) => {
					return (
						<span
							key={chip.key}
							data-context-source={chip.source}
							data-mention-kind={chip.kind}
							title={
								chip.source === "auto" ? AI_COMPOSER_AUTO_CHIP_TITLE : undefined
							}
							className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
						>
							<AiMentionKindIcon
								kind={chip.kind}
								size={12}
								className="text-muted-foreground"
							/>
							<span className="truncate">{chip.label}</span>
							{onRemoveRef && (
								<button
									type="button"
									onClick={() => onRemoveRef(chip.key)}
									disabled={disabled}
									aria-label={`Remove ${chip.label} from context`}
									className="shrink-0 text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
								>
									<X className="h-3 w-3" aria-hidden />
								</button>
							)}
						</span>
					);
				})}
			</div>
		) : null;

	const field = (
		<div
			ref={boxRef}
			className="relative min-w-0 flex-1 rounded-xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
		>
			{pickerOpen && (
				<AiMentionPicker
					id={listboxId}
					candidates={candidates}
					activeIndex={safeIndex}
					onActiveIndexChange={setActiveIndex}
					onSelect={selectMention}
					isLoading={candidatesLoading}
					style={{ left: pickerLeft }}
				/>
			)}
			{/* Mirror backdrop that paints mention pills behind the text. */}
			<div
				ref={backdropRef}
				aria-hidden
				className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-6 text-transparent"
			>
				{renderHighlightBackdrop(value, spans)}
			</div>
			{mention && (
				<div
					aria-hidden
					className="pointer-events-none invisible absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-6"
				>
					{value.slice(0, mention.start)}
					<span ref={anchorRef} />
				</div>
			)}
			<textarea
				ref={textareaRef}
				value={value}
				onChange={handleChange}
				onScroll={(event) => {
					if (backdropRef.current) {
						backdropRef.current.scrollTop = event.currentTarget.scrollTop;
					}
				}}
				onClick={(event) =>
					syncMention(
						event.currentTarget.value,
						event.currentTarget.selectionStart,
					)
				}
				onKeyUp={(event) => {
					// Caret moves that are not edits (Left/Right, Home/End).
					if (
						event.key === "ArrowLeft" ||
						event.key === "ArrowRight" ||
						event.key === "Home" ||
						event.key === "End"
					) {
						syncMention(
							event.currentTarget.value,
							event.currentTarget.selectionStart,
						);
					}
				}}
				onKeyDown={handleKeyDown}
				onBlur={closeMention}
				placeholder={placeholder}
				disabled={disabled}
				rows={stacked ? 2 : 1}
				aria-label={ariaLabel}
				aria-autocomplete="list"
				aria-controls={pickerOpen ? listboxId : undefined}
				aria-activedescendant={
					pickerOpen && pickerHasRows
						? aiMentionOptionId(listboxId, safeIndex)
						: undefined
				}
				className="no-scrollbar relative block w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				style={{ maxHeight: AI_COMPOSER_MAX_HEIGHT_PX }}
			/>
		</div>
	);

	if (stacked) {
		return (
			<div className="flex flex-col gap-2">
				{contextRow}
				{field}
				<div className="flex items-center justify-end gap-2">{sendButton}</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			{contextRow}
			<div className="flex items-end gap-2">
				{field}
				{sendButton}
			</div>
		</div>
	);
}
