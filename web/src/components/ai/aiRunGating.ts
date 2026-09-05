// =============================================================================
// Pure gating predicates for the shared AI panel. Lifted verbatim from
// `roadmap/ai/RoadmapAiAssistantPanel.tsx` so the exactly-once behaviour stays
// unit-testable without rendering the panel.
// =============================================================================

/**
 * Gate for the hero-handoff auto-send: dispatch the pending initial message
 * only when the panel is visible, no turn is in flight, the sessions list has
 * resolved (so thread hydration can't race the send), and the once-latch has
 * not fired yet. Pure so the exactly-once behavior is unit-testable.
 */
export const shouldAutoSendInitialMessage = (state: {
	isVisible: boolean;
	initialMessage: string | null | undefined;
	isSending: boolean;
	threadsListReady: boolean;
	hasAutoSentInitial: boolean;
}): boolean =>
	state.isVisible &&
	Boolean(state.initialMessage && state.initialMessage.trim().length > 0) &&
	!state.isSending &&
	state.threadsListReady &&
	!state.hasAutoSentInitial;
