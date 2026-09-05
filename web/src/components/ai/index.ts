// =============================================================================
// Shared AI kit barrel. Rule: nothing under `components/ai/` imports
// `@/stores/roadmapStore` or `@/components/roadmap/` (importBoundary.test.ts).
// Components and hooks are appended here as they land.
// =============================================================================

export {
	AiActivityTimelineView,
	collapseToolCallPairs,
	declutterProviderAttempts,
	getTimelineHeaderLabel,
	getTitleListOverflowCount,
	getVisibleTimelineSteps,
	groupParallelSteps,
	toElapsedSeconds,
} from "./AiActivityTimeline";
export {
	AiAssistantIntro,
	AiAssistantWordmark,
	type AiQuickPrompt,
	AskIllustration,
} from "./AiAssistantIdentity";
export {
	AiAssistantPanel,
	type AiAssistantPanelProps,
	type AiAssistantPanelVariant,
	type AiEmptyStateContext,
} from "./AiAssistantPanel";
export { AiClarifierCard, type AiClarifierCardProps } from "./AiClarifierCard";
export {
	buildClarifierAnswers,
	buildClarifierDisplayLabel,
	buildClarifierSentinelPayload,
	type ClarifierCardLike,
	CUSTOM_SENTINEL,
	findCatchAllOptionIndex,
	isCatchAllOptionLabel,
	isClarifierQuestionAnswered,
	resolveClarifierQuestions,
} from "./AiClarifierCard.logic";
export {
	AiCommitCard,
	type AiCommitCardProps,
	type AiCommitLinkView,
	getCommitStatusLabel,
	legacyLifecycleToCommit,
	toCommitCards,
} from "./AiCommitCard";
export {
	AI_COMPOSER_AUTO_CHIP_TITLE,
	AI_COMPOSER_MAX_HEIGHT_PX,
	AI_COMPOSER_NO_CONTEXT_MATCHES_LABEL,
	AiComposer,
	type AiComposerProps,
} from "./AiComposer";
export {
	AiMarkdown,
	type AiMarkdownProps,
	renderBracketTagsInNode,
	renderBracketTagText,
} from "./AiMarkdown";
export {
	AI_MENTION_GROUP_LABELS,
	AI_MENTION_LOADING_LABEL,
	AiMentionKindIcon,
	AiMentionPicker,
} from "./AiMentionPicker";
export {
	AI_MESSAGE_CONTEXT_LABEL,
	AiMessage,
	type AiMessageProps,
	type AiSendOptions,
} from "./AiMessage";
export {
	AiPlanProposalCard,
	type AiPlanProposalCardProps,
} from "./AiPlanProposalCard";
export {
	AiPlanProposalGraph,
	type AiPlanProposalGraphProps,
} from "./AiPlanProposalGraph";
export {
	AiPlanQuestionCard,
	type AiPlanQuestionCardProps,
} from "./AiPlanQuestionCard";
export {
	AiRunBanner,
	type AiRunBannerProps,
	getRunBannerLabel,
	shouldRenderRunBanner,
} from "./AiRunBanner";
export { AiThreadList } from "./AiThreadList";
export {
	AiThreadMenuButton,
	type AiThreadMenuButtonProps,
} from "./AiThreadMenuButton";
export {
	AiThreadView,
	type AiThreadViewProps,
	ThreadHistorySkeleton,
} from "./AiThreadView";
export {
	AI_MENTION_CHIP_TONE_CLASS,
	type AiContextChip,
	type AiMentionCandidate,
	AiRouteLink,
	buildAiMentionCandidates,
	buildContextChips,
	buildSendRefs,
	CONTEXT_ONLY_SPAN,
	contextRefsForMessage,
	getMentionContext,
	isInlineSpan,
	MAX_AGENT_REFS,
	mentionRefKey,
	renderEntityMentionContent,
	renderHighlightBackdrop,
	resolveAiEntityDestination,
	resolveEntityMentions,
	toAgentRefs,
	toMentionPick,
} from "./aiMentions";
export {
	COMMIT_IMPACT_KIND_LABEL,
	COMMIT_IMPACT_KIND_ORDER,
	chooseNextPollDelayMs,
	collectUnseenDeltaEvents,
	ensureTimelineCompleted,
	getCommitLifecycleLabel,
	getDefaultTimelineExpanded,
	groupCommitImpactedItems,
	mergeCommitImpactedItems,
	mergeTimelineSteps,
	normalizeActivityStep,
	normalizeTimelineForDisplay,
	PROGRESS_DETAIL_MODE,
	PROGRESS_PRESENTATION_MODE,
	parseCommitImpactedItemsFromOperations,
	parseCommitImpactedItemsFromTraceDetails,
	parseProgressPresentationMode,
	resolveCommitLifecycleFromTimeline,
	SHARED_HIDDEN_ACTIVITY_EVENTS,
	shouldRenderThinkingFallback,
	TRACE_NOT_READY_GRACE_MS,
	TRACE_POLL_ACTIVE_INTERVAL_MS,
	TRACE_POLL_INTERVAL_MS,
	TRACE_POLL_LIMIT,
	TRACE_POLL_PUSH_BACKOFF_INTERVAL_MS,
	TRACE_POLL_STREAMING_INTERVAL_MS,
	TRACE_PUSH_FRESH_WINDOW_MS,
	toTimelineFromTraceResponse,
} from "./aiProgress";
export { shouldAutoSendInitialMessage } from "./aiRunGating";
export {
	buildCuratedToolRequestedMessage,
	buildCuratedToolResultMessage,
	buildFriendlyMinimalToolLabel,
	extractTraceToolName,
	isSupportedTraceToolName,
	SUPPORTED_TRACE_TOOL_NAMES,
	type SupportedTraceToolName,
} from "./aiToolMessaging";
export {
	AiRunController,
	aiRunController,
	isTraceNotReadyError,
	RUN_WALL_CLOCK_CAP_MS,
	type RunHookContext,
	type RunHooks,
	type SendParams,
	type ThreadPersistence,
	TRACE_POLL_LEG_TIMEOUT_MS,
} from "./runController";
export {
	type AiSessionScope,
	type AiSessionScopeKind,
	aiScopeKey,
	aiSessionsBasePath,
	focusRoadmapId,
	isSameAiScope,
	NO_PROJECT_ROUTE_ID,
	toAgentScope,
	toRouteProjectId,
} from "./scope";
export type {
	AiActivityDetailMode,
	AiActivityPresentationMode,
	AiActivityStep,
	AiActivityStepStatus,
	AiActivityStepTitleList,
	AiActivityTimeline,
	AiChatAttachment,
	AiChatMessage,
	AiChatRole,
	AiCommitImpactedItem,
	AiCommitImpactedItemKind,
	AiCommitLifecycle,
	AiCommitLifecycleState,
	AiMentionKind,
	AiMentionPick,
	AiMentionSpan,
} from "./types";
export {
	type AiSendRequest,
	type UseAiAssistantRunInput,
	type UseAiAssistantRunResult,
	useAiAssistantRun,
} from "./useAiAssistantRun";
export { useAiMentionCandidates } from "./useAiMentionCandidates";
export {
	dbRowToClientMessage,
	type PersistTurnExtras,
	type PersistTurnResult,
	persistTurnForScope,
	readAgentStateSnapshot,
	rehydrateAgentSessionForScope,
	type SeedMessages,
	type UseAiThreadMessagesResult,
	useAiThreadMessages,
	useThreadMessagesStore,
} from "./useAiThreadMessages";
export {
	NEW_THREAD_LABEL,
	UNTITLED_THREAD_LABEL,
	type UseAiThreadsOptions,
	type UseAiThreadsResult,
	useAiThreads,
} from "./useAiThreads";
