// =============================================================================
// Transitional re-export shim over `ai-agent.service.ts`.
//
// The runtime client and error class moved to `@/services/ai-agent.service`
// (the shared AI kit's canonical agent client). Every TYPE name this module
// used to export is kept here so `roadmapStore.ts`, `RoadmapBuilder.tsx` and
// `roadmapIntakeTurns.ts` keep compiling until they are repointed (PR5 deletes
// this file). New code must import from `@/services/ai-agent.service`.
// =============================================================================

export type {
	AgentClarifierAnswerEntry,
	AgentClarifierCard,
	AgentClarifierOption,
	AgentClarifierQuestion,
	AgentCommitImpactedItem,
	AgentCommitSummary,
	AgentCreateSessionRequest,
	AgentCreateSessionResponse,
	AgentMessageRequest,
	AgentMessageResponse,
	AgentNodeType,
	AgentOperation,
	AgentOperationType,
	AgentPlanProposal,
	AgentPlanProposalAnswer,
	AgentPlanProposalEpic,
	AgentPlanProposalFeature,
	AgentPlanProposalQuestion,
	AgentPlanProposalTask,
	AgentSendMessageOptions,
	AgentTraceDetailMode,
	AgentTraceEvent,
	AgentTraceEventStatus,
	AgentTraceEventsRequest,
	AgentTraceEventsResponse,
	AgentValidationIssue,
} from "./ai-agent.service";
