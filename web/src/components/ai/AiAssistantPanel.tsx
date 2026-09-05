import { TriangleAlert } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	useAiDraftAutoExcluded,
	useAiDraftInput,
	useAiDraftPicks,
	useAiThreadsStore,
} from "@/stores/aiThreadsStore";
import type { AiCommitLinkView } from "./AiCommitCard";
import { AiComposer } from "./AiComposer";
import type { AiSendOptions } from "./AiMessage";
import { AiRunBanner } from "./AiRunBanner";
import { AiThreadMenuButton } from "./AiThreadMenuButton";
import { AiThreadView } from "./AiThreadView";
import {
	type AiMentionCandidate,
	buildContextChips,
	buildSendRefs,
	mentionRefKey,
	toMentionPick,
} from "./aiMentions";
import { shouldAutoSendInitialMessage } from "./aiRunGating";
import { aiRunController, type RunHooks } from "./runController";
import { type AiSessionScope, aiScopeKey } from "./scope";
import type { AiMentionPick, AiMentionSpan } from "./types";
import { useAiAssistantRun } from "./useAiAssistantRun";
import { useAiMentionCandidates } from "./useAiMentionCandidates";
import { useAiThreadMessages } from "./useAiThreadMessages";
import { useAiThreads } from "./useAiThreads";

// =============================================================================
// The shared assistant panel: threads -> messages -> run state, composed for
// three surfaces (`panel` = roadmap side panel, `rail` = dashboard rail,
// `fullscreen` = dashboard overlay). Everything roadmap-specific (canvas
// refresh, primary mention candidates, link view) arrives through props from
// the thin roadmap wrapper; the kit never imports the roadmap store.
// =============================================================================

export type AiAssistantPanelVariant = "panel" | "rail" | "fullscreen";

/**
 * Handed to a function-valued `emptyState` so a surface can render its own
 * quick-question cards that send through the panel: same guards and the
 * same auto context refs as the composer, without touching the draft.
 */
export interface AiEmptyStateContext {
	send: (content: string) => void;
	/** True while there is no scope or a send is in flight. */
	disabled: boolean;
}

export interface AiAssistantPanelProps {
	/** null -> loading/empty shell with a disabled composer + `unavailableHint`. */
	scope: AiSessionScope | null;
	variant: AiAssistantPanelVariant;
	/** "AI Assistant Panel" (roadmap, Playwright) | "Proyekto assistant" (dashboard). */
	ariaLabel: string;
	/** Header-left slot. */
	title: ReactNode;
	/** Expand / collapse buttons (dashboard). */
	headerActions?: ReactNode;
	emptyState: ReactNode | ((context: AiEmptyStateContext) => ReactNode);
	placeholder: string;
	/** Shown when `scope` is null ("Choose a workspace to start"). */
	unavailableHint?: string;
	isVisible?: boolean;
	/**
	 * One-shot message auto-sent as the first turn once the panel is visible
	 * and the sessions list has loaded (homepage hero handoff).
	 */
	initialMessage?: string | null;
	/** Called after `initialMessage` has been dispatched exactly once. */
	onInitialMessageConsumed?: () => void;
	baseRevision?: number;
	primaryMentionCandidates?: readonly AiMentionCandidate[];
	/**
	 * Refs the surface attaches to every message (the roadmap page's roadmap
	 * + project). Shown as removable chips; a removal lasts one message.
	 */
	autoContextRefs?: readonly AiMentionPick[];
	commitLinkView?: AiCommitLinkView;
	onCommits?: RunHooks["onCommits"];
	onTraceEvents?: RunHooks["onTraceEvents"];
	/** Accessible name of the composer field. */
	composerAriaLabel?: string;
	className?: string;
}

const EMPTY_PICKS: AiMentionPick[] = [];
const EMPTY_AUTO_REFS: readonly AiMentionPick[] = [];

interface VariantClasses {
	section: string;
	header: string;
	footer: string;
	menuTrigger?: string;
}

const VARIANT_CLASSES: Record<AiAssistantPanelVariant, VariantClasses> = {
	panel: {
		section:
			"flex h-full w-full flex-col overflow-hidden border-l border-border bg-background text-foreground",
		header:
			"flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3",
		footer: "border-t border-border bg-background px-3 py-3",
	},
	rail: {
		section:
			"flex h-full w-full flex-col overflow-hidden bg-transparent text-sidebar-foreground",
		header:
			"flex h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3",
		footer: "border-t border-sidebar-border px-3 py-3",
		menuTrigger:
			"flex items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-60",
	},
	fullscreen: {
		section: "flex h-full w-full flex-col overflow-hidden text-foreground",
		header:
			"flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4",
		footer: "px-4 pb-4 pt-2",
	},
};

export function AiAssistantPanel({
	scope,
	variant,
	ariaLabel,
	title,
	headerActions,
	emptyState,
	placeholder,
	unavailableHint,
	isVisible = true,
	initialMessage,
	onInitialMessageConsumed,
	baseRevision,
	primaryMentionCandidates,
	autoContextRefs = EMPTY_AUTO_REFS,
	commitLinkView,
	onCommits,
	onTraceEvents,
	composerAriaLabel,
	className,
}: AiAssistantPanelProps) {
	const scopeKey = scope ? aiScopeKey(scope) : null;
	const threads = useAiThreads(scope, { baseRevision });
	const { activeThreadId, threadsList } = threads;
	const thread = useAiThreadMessages(scope, activeThreadId);
	const { run, send, cancel, resume } = useAiAssistantRun({
		scope,
		threadId: activeThreadId,
		ensureThread: threads.ensureThread,
		ensureAgentSession: threads.ensureAgentSession,
		persistTurn: thread.persistTurn,
		rehydrateAgentSession: thread.rehydrateAgentSession,
		baseRevision,
		onCommits,
		onTraceEvents,
	});

	// Drafts live in the threads store (the rail and fullscreen dashboard
	// panels are mounted at the same time on the same thread). Before the
	// first thread exists the draft is keyed by scope.
	const draftKey = activeThreadId ?? (scopeKey ? `scope:${scopeKey}` : null);
	const draftInput = useAiDraftInput(draftKey);
	const draftPicks = useAiDraftPicks(draftKey);
	const draftAutoExcluded = useAiDraftAutoExcluded(draftKey);
	const setDraft = useAiThreadsStore((s) => s.setDraft);
	const clearDraft = useAiThreadsStore((s) => s.clearDraft);
	const excludeAutoRef = useAiThreadsStore((s) => s.excludeAutoRef);

	// The auto refs still attached to this draft (removals last one message:
	// `clearDraft` on send drops the exclusions too).
	const visibleAutoRefs = useMemo(
		() =>
			draftAutoExcluded.length === 0
				? autoContextRefs
				: autoContextRefs.filter(
						(ref) => !draftAutoExcluded.includes(mentionRefKey(ref)),
					),
		[autoContextRefs, draftAutoExcluded],
	);
	const contextChips = useMemo(
		() => buildContextChips(visibleAutoRefs, draftPicks),
		[visibleAutoRefs, draftPicks],
	);

	const [picker, setPicker] = useState<{ active: boolean; query: string }>({
		active: false,
		query: "",
	});
	const { candidates, isLoading: candidatesLoading } = useAiMentionCandidates({
		scope,
		primary: primaryMentionCandidates,
		query: picker.query,
		active: picker.active,
	});
	const [panelError, setPanelError] = useState<string | null>(null);

	const composerDisabled = !scope || run.isSending;

	const handleComposerChange = useCallback(
		(value: string, picks: AiMentionPick[]) => {
			if (!draftKey) return;
			setDraft(draftKey, value, picks === draftPicks ? undefined : picks);
		},
		[draftKey, draftPicks, setDraft],
	);

	// Add-context popover pick: recorded as a draft pick (a NEW array, which is
	// how `handleComposerChange` tells picks apart) without touching the text.
	const handleAddRef = useCallback(
		(candidate: AiMentionCandidate) => {
			if (!draftKey) return;
			const key = mentionRefKey(candidate);
			if (contextChips.some((chip) => chip.key === key)) return;
			setDraft(draftKey, draftInput, [...draftPicks, toMentionPick(candidate)]);
		},
		[contextChips, draftInput, draftKey, draftPicks, setDraft],
	);

	// Chip removal: an auto ref is excluded for this message; a pick is
	// dropped (its `@Label` stays in the text as plain words).
	const handleRemoveRef = useCallback(
		(key: string) => {
			if (!draftKey) return;
			if (visibleAutoRefs.some((ref) => mentionRefKey(ref) === key)) {
				excludeAutoRef(draftKey, key);
			}
			if (draftPicks.some((pick) => mentionRefKey(pick) === key)) {
				setDraft(
					draftKey,
					draftInput,
					draftPicks.filter((pick) => mentionRefKey(pick) !== key),
				);
			}
		},
		[
			draftInput,
			draftKey,
			draftPicks,
			excludeAutoRef,
			setDraft,
			visibleAutoRefs,
		],
	);

	const dispatch = useCallback(
		(content: string, options?: AiSendOptions & { refs?: AiMentionSpan[] }) => {
			setPanelError(null);
			void send(content, {
				displayLabel: options?.displayLabel,
				refs: options?.refs ?? [],
			}).catch((error: unknown) => {
				setPanelError(
					error instanceof Error ? error.message : "Failed to send message.",
				);
			});
		},
		[send],
	);

	const handleSend = useCallback(() => {
		const trimmed = draftInput.trim();
		if (!trimmed || composerDisabled || !draftKey) return;
		const refs = buildSendRefs(trimmed, draftPicks, visibleAutoRefs);
		clearDraft(draftKey);
		dispatch(trimmed, { refs });
	}, [
		draftInput,
		draftPicks,
		visibleAutoRefs,
		draftKey,
		composerDisabled,
		clearDraft,
		dispatch,
	]);

	// Programmatic sends from the cards (sentinel content + friendly label).
	const handleCardSend = useCallback(
		(content: string, options?: AiSendOptions) => {
			if (run.isSending) return;
			dispatch(content, options);
		},
		[dispatch, run.isSending],
	);

	// Quick-question cards in the empty state: a plain prompt sent with the
	// composer's guards and auto refs, leaving any typed draft alone.
	const handleQuickSend = useCallback(
		(content: string) => {
			const trimmed = content.trim();
			if (!trimmed || composerDisabled) return;
			dispatch(trimmed, { refs: buildSendRefs(trimmed, [], visibleAutoRefs) });
		},
		[composerDisabled, dispatch, visibleAutoRefs],
	);
	const resolvedEmptyState =
		typeof emptyState === "function"
			? emptyState({ send: handleQuickSend, disabled: composerDisabled })
			: emptyState;

	// One-shot auto-send for the homepage hero handoff: the parent passes the
	// pending prompt via `initialMessage` after opening the panel. Latched by
	// `hasAutoSentInitialRef` (plus the parent's consume callback and the
	// upstream sessionStorage read-and-clear) so the turn can never dispatch
	// twice. Waits for the sessions list so thread hydration can't race the
	// send — for a fresh roadmap the list resolves empty and the controller's
	// ensureThread creates the DB row + agent session.
	const hasAutoSentInitialRef = useRef(false);
	const onInitialMessageConsumedRef = useRef(onInitialMessageConsumed);
	onInitialMessageConsumedRef.current = onInitialMessageConsumed;
	useEffect(() => {
		if (!initialMessage || !scope) return;
		if (
			!shouldAutoSendInitialMessage({
				isVisible,
				initialMessage,
				isSending: run.isSending,
				threadsListReady: threadsList.isSuccess,
				hasAutoSentInitial: hasAutoSentInitialRef.current,
			})
		) {
			return;
		}
		hasAutoSentInitialRef.current = true;
		dispatch(initialMessage, {
			refs: buildSendRefs(initialMessage, [], visibleAutoRefs),
		});
		onInitialMessageConsumedRef.current?.();
	}, [
		isVisible,
		initialMessage,
		scope,
		run.isSending,
		threadsList.isSuccess,
		dispatch,
		visibleAutoRefs,
	]);

	const handleCreateNewThread = useCallback(async () => {
		try {
			await threads.createNewThread();
		} catch (err) {
			setPanelError(
				err instanceof Error ? err.message : "Failed to create new thread.",
			);
		}
	}, [threads]);

	// A hard-deleted thread must stop its poll loop even when it is not the
	// active one (the active thread is also evicted by `useAiThreads`).
	const handleThreadDeleted = useCallback((threadId: string) => {
		aiRunController.teardownThread(threadId);
	}, []);

	const classes = VARIANT_CLASSES[variant];
	const errorMessage = run.errorMessage ?? panelError;
	const threadIsEmpty = !thread.isLoading && thread.messages.length === 0;

	const threadMenu = (
		<AiThreadMenuButton
			scope={scope}
			activeThreadId={activeThreadId}
			label={threads.activeThreadLabel}
			onSelectThread={threads.selectThread}
			onCreateNewThread={handleCreateNewThread}
			onDeleted={handleThreadDeleted}
			className={classes.menuTrigger}
		/>
	);

	const composer = (
		<AiComposer
			value={draftInput}
			picks={draftPicks ?? EMPTY_PICKS}
			onChange={handleComposerChange}
			onSend={handleSend}
			disabled={composerDisabled}
			placeholder={placeholder}
			candidates={candidates}
			candidatesLoading={candidatesLoading}
			onPickerActiveChange={(active, query) => setPicker({ active, query })}
			stacked={variant === "fullscreen"}
			ariaLabel={composerAriaLabel}
			contextRefs={contextChips}
			onAddRef={handleAddRef}
			onRemoveRef={handleRemoveRef}
		/>
	);

	const errorBanner = errorMessage ? (
		<div
			className="mb-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
			role="alert"
		>
			<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<span>{errorMessage}</span>
		</div>
	) : null;

	const unavailable =
		!scope && unavailableHint ? (
			<p className="mb-2 text-[11px] text-muted-foreground">
				{unavailableHint}
			</p>
		) : null;

	const sectionClassName = useMemo(
		() => (className ? `${classes.section} ${className}` : classes.section),
		[className, classes.section],
	);

	if (!isVisible) {
		return null;
	}

	if (variant === "fullscreen") {
		return (
			<section className={sectionClassName} aria-label={ariaLabel}>
				<div className={classes.header}>
					<div className="flex min-w-0 items-center gap-2">{title}</div>
					<div className="flex items-center gap-2">
						{threadMenu}
						{headerActions}
					</div>
				</div>
				<div className="relative flex min-h-0 flex-1 flex-col">
					<div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
						<AiThreadView
							scope={scope}
							threadId={activeThreadId}
							messages={thread.messages}
							isLoading={thread.isLoading}
							emptyState={resolvedEmptyState}
							commitLinkView={commitLinkView}
							onSend={handleCardSend}
							className={
								threadIsEmpty
									? "flex flex-1 flex-col justify-end px-4 pb-2"
									: "thin-scrollbar relative flex-1 space-y-3 overflow-y-auto px-4 py-6"
							}
						/>
						<AiRunBanner run={run} onCancel={cancel} onResume={resume} />
						<div className={classes.footer}>
							{errorBanner}
							{unavailable}
							<div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
								{composer}
							</div>
						</div>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section className={sectionClassName} aria-label={ariaLabel}>
			<div className={classes.header}>
				<div className="flex min-w-0 items-center gap-2">{title}</div>
				<div className="flex items-center gap-2">
					{threadMenu}
					{headerActions}
				</div>
			</div>
			<AiThreadView
				scope={scope}
				threadId={activeThreadId}
				messages={thread.messages}
				isLoading={thread.isLoading}
				emptyState={resolvedEmptyState}
				commitLinkView={commitLinkView}
				onSend={handleCardSend}
			/>
			<AiRunBanner run={run} onCancel={cancel} onResume={resume} />
			<footer className={classes.footer}>
				{errorBanner}
				{unavailable}
				{composer}
			</footer>
		</section>
	);
}

export default AiAssistantPanel;
