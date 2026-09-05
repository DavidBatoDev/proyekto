import { useAiRunStore } from "@/stores/aiRunStore";
import { AiActivityTimelineView } from "./AiActivityTimeline";
import { AiClarifierCard } from "./AiClarifierCard";
import {
	buildClarifierDisplayLabel,
	buildClarifierSentinelPayload,
} from "./AiClarifierCard.logic";
import {
	AiCommitCard,
	type AiCommitLinkView,
	toCommitCards,
} from "./AiCommitCard";
import { AiMarkdown } from "./AiMarkdown";
import { AiMentionKindIcon } from "./AiMentionPicker";
import { AiPlanProposalCard } from "./AiPlanProposalCard";
import { AiPlanQuestionCard } from "./AiPlanQuestionCard";
import {
	AI_MENTION_CHIP_TONE_CLASS,
	AiRouteLink,
	contextRefsForMessage,
	mentionRefKey,
	renderEntityMentionContent,
	resolveAiEntityDestination,
} from "./aiMentions";
import { getDefaultTimelineExpanded } from "./aiProgress";
import type { AiSessionScope } from "./scope";
import type { AiActivityTimeline, AiChatMessage, AiMentionSpan } from "./types";

// =============================================================================
// One thread message. The branches are the old roadmap panel's (user bubble,
// assistant header, activity timeline, body, commit cards, clarifier, plan
// question / proposal cards) on theme tokens; the sentinel protocol the cards
// speak is byte-identical (`__clarifier_answer__`, `__plan_answers__`,
// `__plan_decision__`). Timeline expansion state lives in the run store so
// both dashboard mounts agree on it.
// =============================================================================

export interface AiSendOptions {
	displayLabel?: string;
}

export interface AiMessageProps {
	message: AiChatMessage;
	scope: AiSessionScope | null;
	threadId: string | null;
	/** A clarifier is answerable only while its message is the newest one. */
	isLatestMessage: boolean;
	isSending: boolean;
	/**
	 * Timeline to show for this message: the live one while this message
	 * hosts the in-flight run, otherwise the persisted one (already normalized
	 * for display by the view).
	 */
	activityTimeline: AiActivityTimeline | null;
	isLiveTimelineHost: boolean;
	commitLinkView?: AiCommitLinkView;
	/** Programmatic send used by the cards (sentinel content + friendly label). */
	onSend: (content: string, options?: AiSendOptions) => void;
}

const formatTime = (timestamp: string): string =>
	new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});

/** Heading of the user bubble's context chip row. */
export const AI_MESSAGE_CONTEXT_LABEL = "Context";

const CONTEXT_CHIP_CLASS = `inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${AI_MENTION_CHIP_TONE_CLASS.onGradient}`;

/**
 * The refs a user turn carried without an `@Label` in the text (the context
 * chips), as deep links where the ref resolves to a destination.
 */
function UserContextRow({
	refs,
	scope,
}: {
	refs: readonly AiMentionSpan[];
	scope: AiSessionScope | null;
}) {
	if (refs.length === 0) return null;
	return (
		<div
			className="mt-2 flex flex-wrap items-center gap-1"
			data-testid="ai-message-context"
		>
			<span className="text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/70">
				{AI_MESSAGE_CONTEXT_LABEL}
			</span>
			{refs.map((ref) => {
				const key = mentionRefKey(ref);
				const destination = resolveAiEntityDestination(ref, scope);
				const body = (
					<>
						<AiMentionKindIcon kind={ref.kind} size={12} />
						<span className="truncate">{ref.label}</span>
					</>
				);
				return destination ? (
					<AiRouteLink
						key={key}
						to={destination.to}
						params={destination.params}
						search={destination.search}
						className={`${CONTEXT_CHIP_CLASS} underline-offset-2 hover:underline`}
						data-mention-kind={ref.kind}
					>
						{body}
					</AiRouteLink>
				) : (
					<span
						key={key}
						className={CONTEXT_CHIP_CLASS}
						data-mention-kind={ref.kind}
					>
						{body}
					</span>
				);
			})}
		</div>
	);
}

export function AiMessage({
	message,
	scope,
	threadId,
	isLatestMessage,
	isSending,
	activityTimeline,
	isLiveTimelineHost,
	commitLinkView,
	onSend,
}: AiMessageProps) {
	const explicitExpanded = useAiRunStore((s) =>
		threadId
			? s.runsByThread[threadId]?.activityExpandedByMessageId[message.id]
			: undefined,
	);
	const setActivityExpanded = useAiRunStore((s) => s.setActivityExpanded);

	if (message.role === "user") {
		return (
			// A bubble hugs what was said. It used to stretch from an 8px indent
			// to the full width of the thread, so a three-word question painted a
			// 900px slab of primary across the page and the only thing separating
			// "you" from "the assistant" was colour. `w-fit` + `ml-auto` give it
			// the shape the side already implies, and the cap keeps a long
			// paragraph from creeping back to full width. The corner nearest the
			// composer is squared off (`rounded-br-sm`) — the standard tail.
			<article className="ai-gradient-bg ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2.5 border-0 text-primary-foreground shadow-sm">
				<div className="flex items-center justify-between gap-3 mb-1.5">
					<span className="text-[11px] font-semibold text-primary-foreground/90">
						You
					</span>
					<span className="text-[10px] text-primary-foreground/60">
						{formatTime(message.timestamp)}
					</span>
				</div>
				{message.content ? (
					<div className="text-xs leading-relaxed text-primary-foreground whitespace-pre-wrap [&_a]:text-primary-foreground">
						{renderEntityMentionContent(message.content, message.refs, {
							tone: "onGradient",
							scope,
						})}
					</div>
				) : null}
				<UserContextRow
					refs={contextRefsForMessage(message.content, message.refs)}
					scope={scope}
				/>
			</article>
		);
	}

	const commitCards = toCommitCards(message, scope);
	// A turn that applied changes collapses its timeline by default so the
	// commit cards are what the user sees first.
	const shouldCollapseForCommits = commitCards.length > 0;

	const timelineExpanded = (timeline: AiActivityTimeline): boolean => {
		if (shouldCollapseForCommits) return explicitExpanded ?? false;
		if (isLiveTimelineHost && !timeline.done) return true;
		return getDefaultTimelineExpanded(timeline.done, explicitExpanded);
	};

	const toggleTimeline = (timeline: AiActivityTimeline) => {
		if (!shouldCollapseForCommits && isLiveTimelineHost && !timeline.done) {
			return;
		}
		if (!threadId) return;
		const current =
			typeof explicitExpanded === "boolean" ? explicitExpanded : !timeline.done;
		setActivityExpanded(threadId, message.id, !current);
	};

	const planProposal = message.planProposal;

	return (
		<article className="px-0 py-1.5 border-0 bg-transparent ml-0 mr-4">
			<div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-muted-foreground">
				<span>Assistant</span>
				<span>{formatTime(message.timestamp)}</span>
			</div>

			{activityTimeline && (
				<div className="mb-2">
					<AiActivityTimelineView
						timeline={activityTimeline}
						expanded={timelineExpanded(activityTimeline)}
						onToggle={() => toggleTimeline(activityTimeline)}
					/>
				</div>
			)}

			{message.content ? <AiMarkdown content={message.content} /> : null}

			{commitCards.map((commit) => (
				<AiCommitCard
					key={`${message.id}-${commit.batch_id}-${commit.roadmap_id}`}
					commit={commit}
					scope={scope}
					linkView={commitLinkView}
				/>
			))}

			{message.clarifier && !planProposal && isLatestMessage && (
				<AiClarifierCard
					card={message.clarifier}
					disabled={isSending}
					onSubmit={(answers) => {
						const clarifierCard = message.clarifier;
						if (!clarifierCard) return;
						onSend(
							`__clarifier_answer__\n${JSON.stringify(
								buildClarifierSentinelPayload(
									clarifierCard.lane,
									clarifierCard,
									answers,
								),
							)}`,
							{ displayLabel: buildClarifierDisplayLabel(answers) },
						);
					}}
				/>
			)}

			{planProposal && planProposal.status === "awaiting_answers" && (
				<AiPlanQuestionCard
					plan={planProposal}
					disabled={isSending}
					onSubmit={(answers) => {
						// Batched submit: all answers for the current question batch go
						// in one sentinel. Legacy shape `{question_id, ...}` still works
						// for single-question clarifiers because the agent's plan-answer
						// ingest accepts both `{answers: [...]}` and a bare dict.
						const answerSummary = answers
							.map((a) => {
								const value = a.custom_answer || a.selected_option;
								return value ? `• ${value}` : null;
							})
							.filter((entry): entry is string => entry !== null)
							.join("\n");
						onSend(`__plan_answers__\n${JSON.stringify({ answers })}`, {
							displayLabel:
								answerSummary.length > 0
									? `Submitted plan answers:\n${answerSummary}`
									: "Submitted plan answers.",
						});
					}}
					onDiscard={() => {
						const planId = planProposal.plan_id;
						if (planId) {
							onSend(
								`__plan_decision__\n${JSON.stringify({
									decision: "reject",
									plan_id: planId,
								})}`,
								{ displayLabel: "Cancel this plan." },
							);
						} else {
							onSend("Cancel this plan.");
						}
					}}
				/>
			)}

			{planProposal && planProposal.status !== "awaiting_answers" && (
				<AiPlanProposalCard
					plan={planProposal}
					disabled={isSending}
					onApply={() => {
						// Structured decision bypasses the regex + classifier path in the
						// agent — deterministically fires the plan-confirm bridge instead
						// of relying on NLP to interpret "Yes, apply this plan." The
						// plain-text fallback is kept only for cards without a plan_id.
						const planId = planProposal.plan_id;
						if (planId) {
							onSend(
								`__plan_decision__\n${JSON.stringify({
									decision: "confirm",
									plan_id: planId,
								})}`,
								{ displayLabel: "Apply this plan." },
							);
						} else {
							onSend("Yes, apply this plan.");
						}
					}}
					onDiscard={() => {
						const planId = planProposal.plan_id;
						if (planId) {
							onSend(
								`__plan_decision__\n${JSON.stringify({
									decision: "reject",
									plan_id: planId,
								})}`,
								{ displayLabel: "Cancel this plan." },
							);
						} else {
							onSend("Cancel this plan.");
						}
					}}
				/>
			)}
		</article>
	);
}

export default AiMessage;
