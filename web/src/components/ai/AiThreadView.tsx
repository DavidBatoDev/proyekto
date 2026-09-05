import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { useAiRunState, useAiRunStore } from "@/stores/aiRunStore";
import { AiActivityTimelineView } from "./AiActivityTimeline";
import type { AiCommitLinkView } from "./AiCommitCard";
import { AiMessage, type AiSendOptions } from "./AiMessage";
import {
	normalizeTimelineForDisplay,
	PROGRESS_PRESENTATION_MODE,
	shouldRenderThinkingFallback,
} from "./aiProgress";
import { type AiSessionScope, aiScopeKey } from "./scope";
import type { AiActivityPresentationMode, AiChatMessage } from "./types";

// =============================================================================
// The scrolling thread: history skeleton, empty-state slot, messages, the
// streaming preview bubble, the un-anchored live timeline / "Thinking..."
// fallback, and the autoscroll anchor. Run state (sending, live activity,
// streaming preview, polling failure) comes from the run store so both
// dashboard mounts render the same thing.
// =============================================================================

export interface AiThreadViewProps {
	scope: AiSessionScope | null;
	threadId: string | null;
	messages: AiChatMessage[];
	isLoading: boolean;
	emptyState: ReactNode;
	commitLinkView?: AiCommitLinkView;
	onSend: (content: string, options?: AiSendOptions) => void;
	presentationMode?: AiActivityPresentationMode;
	/** Scroll-container classes (the fullscreen variant widens the gutter). */
	className?: string;
}

const DEFAULT_CONTAINER_CLASS =
	"thin-scrollbar relative flex-1 space-y-3 overflow-y-auto px-3 py-4";

function SkeletonBlock({
	className,
	style,
}: {
	className: string;
	style?: CSSProperties;
}) {
	return <div className={`ai-shimmer rounded-md ${className}`} style={style} />;
}

const SKELETON_ROWS: Array<{ role: "user" | "assistant"; lines: number[] }> = [
	{ role: "assistant", lines: [75, 55, 40] },
	{ role: "user", lines: [60] },
	{ role: "assistant", lines: [85, 65] },
	{ role: "user", lines: [50] },
	{ role: "assistant", lines: [80, 60, 45, 30] },
];

export function ThreadHistorySkeleton() {
	return (
		<div className="space-y-3" data-testid="ai-thread-skeleton">
			{SKELETON_ROWS.map((row, i) =>
				row.role === "user" ? (
					<div key={i} className="ml-8 mr-0">
						<div className="ai-gradient-soft rounded-lg px-3.5 py-2.5 border border-primary/20 space-y-2">
							<SkeletonBlock
								className="h-2.5"
								style={{ width: `${row.lines[0]}%` }}
							/>
						</div>
					</div>
				) : (
					<div key={i} className="ml-0 mr-4 px-0 py-1.5 space-y-2">
						<div className="flex items-center gap-1.5 mb-1">
							<SkeletonBlock className="h-2 w-12 bg-primary/20" />
						</div>
						{row.lines.map((w, j) => (
							<SkeletonBlock
								key={j}
								className="h-2.5"
								style={{ width: `${w}%` }}
							/>
						))}
					</div>
				),
			)}
		</div>
	);
}

export function AiThreadView({
	scope,
	threadId,
	messages,
	isLoading,
	emptyState,
	commitLinkView,
	onSend,
	presentationMode = PROGRESS_PRESENTATION_MODE,
	className,
}: AiThreadViewProps) {
	const scopeKey = scope ? aiScopeKey(scope) : null;
	const run = useAiRunState(threadId, scopeKey);
	const patchRun = useAiRunStore((s) => s.patchRun);
	const messagesEndRef = useRef<HTMLDivElement | null>(null);

	const {
		isSending,
		liveActivity,
		liveActivityExpanded,
		liveActivityHostMessageId,
		streamingPreview,
		tracePollingFailed,
	} = run;

	const displayLiveTimeline = normalizeTimelineForDisplay(
		liveActivity,
		presentationMode,
	);
	const isLiveTimelineAnchoredInMessage = Boolean(
		displayLiveTimeline &&
			liveActivityHostMessageId &&
			messages.some((message) => message.id === liveActivityHostMessageId),
	);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [
		messages.length,
		isSending,
		liveActivity?.steps.length,
		streamingPreview?.text.length,
	]);

	const latestMessageId =
		messages.length > 0 ? messages[messages.length - 1].id : null;

	return (
		<div className={className ?? DEFAULT_CONTAINER_CLASS}>
			{isLoading ? (
				<ThreadHistorySkeleton />
			) : messages.length === 0 ? (
				emptyState
			) : (
				messages.map((message) => {
					const persistedActivityTimeline = normalizeTimelineForDisplay(
						message.activityTimeline,
						presentationMode,
					);
					const isLiveTimelineHost =
						message.role === "assistant" &&
						Boolean(displayLiveTimeline) &&
						message.id === liveActivityHostMessageId;
					const activityTimeline =
						isLiveTimelineHost && displayLiveTimeline
							? displayLiveTimeline
							: persistedActivityTimeline;
					return (
						<AiMessage
							key={message.id}
							message={message}
							scope={scope}
							threadId={threadId}
							isLatestMessage={message.id === latestMessageId}
							isSending={isSending}
							activityTimeline={activityTimeline}
							isLiveTimelineHost={isLiveTimelineHost}
							commitLinkView={commitLinkView}
							onSend={onSend}
						/>
					);
				})
			)}

			{isSending && streamingPreview && streamingPreview.text.trim() && (
				<article
					className="px-0 py-1.5 border-0 bg-transparent ml-0 mr-4"
					aria-live="polite"
				>
					<div className="mb-1 text-[10px] text-muted-foreground">
						Assistant
					</div>
					<div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
						{streamingPreview.text}
						<span className="ml-0.5 inline-block h-3 w-[2px] translate-y-[2px] animate-pulse bg-muted-foreground" />
					</div>
				</article>
			)}

			{displayLiveTimeline &&
			!tracePollingFailed &&
			!isLiveTimelineAnchoredInMessage ? (
				<div className="mr-4">
					<AiActivityTimelineView
						timeline={displayLiveTimeline}
						expanded={displayLiveTimeline.done ? liveActivityExpanded : true}
						onToggle={() => {
							if (!displayLiveTimeline.done || !threadId) return;
							patchRun(threadId, {
								liveActivityExpanded: !liveActivityExpanded,
							});
						}}
					/>
				</div>
			) : shouldRenderThinkingFallback(
					isSending,
					Boolean(liveActivity),
					tracePollingFailed,
				) ? (
				<div className="mr-4 text-xs text-muted-foreground italic">
					Thinking...
				</div>
			) : null}

			<div ref={messagesEndRef} />
		</div>
	);
}

export default AiThreadView;
