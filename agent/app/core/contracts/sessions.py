from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.contracts.operations import RoadmapOperation


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Message(BaseModel):
    # Extra fields are allowed so Redis rehydration remains forward-compatible
    # across version bumps (e.g. the tool_calls / tool_call_id additions below).
    model_config = ConfigDict(extra='allow')

    role: str
    content: str
    created_at: datetime = Field(default_factory=_utcnow)
    # For role='assistant' messages that requested tool calls. Shape mirrors
    # OpenAI / LangChain tool_calls: list of {id, type='function',
    # function: {name, arguments}}. None on pure-text assistant messages.
    tool_calls: list[dict[str, Any]] | None = None
    # Set on role='tool' messages; binds the result to the assistant's
    # tool_calls[*].id from the preceding turn.
    tool_call_id: str | None = None


IntentType = Literal[
    'smalltalk',
    'general_question',
    'roadmap_query',
    'roadmap_plan',
    'roadmap_edit',
    'plan_revision',
    'confirm_action',
    'unclear',
    'question',
]
ResponseMode = Literal['chat', 'edit_plan', 'plan_proposal']
ProviderUsed = Literal['openai', 'rule_based']
DraftMode = Literal['append', 'revise', 'branch']
DraftStatus = Literal['active', 'previewed', 'applied', 'abandoned']
TraceEventDetailMode = Literal['verbose', 'structured']
TraceEventStatus = Literal['running', 'success', 'error']
RecentResolvedTargetType = Literal['epic', 'feature', 'task']
RecentResolvedTargetSource = Literal[
    'context_tool',
    'deictic_pre_resolver',
    'staged_operations',
    'commit_semantic_diff',
]


class CommitImpactedItem(BaseModel):
    node_id: str
    node_type: Literal['roadmap', 'epic', 'feature', 'task', 'milestone']
    title: str | None = None
    change_type: str | None = None
    impact: Literal['created', 'modified', 'deleted'] = 'modified'


class CommitSummary(BaseModel):
    """Lightweight result of a synchronous auto-commit, surfaced on the
    message response so the web can render the "Committed changes"
    confirmation and refresh the canvas — without the heavy commit artifact
    (no inline_commit / candidate_snapshot / preview).

    On failure (`committed=False` with `error_code`/`error_message` set) the
    staged operations have already been discarded server-side — there is no
    manual apply/discard UI anymore, so surfacing the error and starting the
    next turn clean is the whole recovery story."""

    committed: bool = False
    change_id: str | None = None
    semantic_diff_summary: dict[str, int] = Field(default_factory=dict)
    impacted_items: list[CommitImpactedItem] = Field(default_factory=list)
    impacted_summary: dict[str, int] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None


class ResolverCandidate(BaseModel):
    id: str
    type: str
    title: str
    parent_id: str | None = None
    parent_title: str | None = None
    confidence: float | None = None
    matched_fields: list[str] | None = None


class PendingContextResolution(BaseModel):
    kind: Literal['features_of_epic', 'tasks_of_feature', 'my_tasks']
    resolution_id: str
    label: str
    node_type: Literal['epic', 'feature', 'task'] | None = None
    option_choices: list[int] | None = None
    created_at: datetime = Field(default_factory=_utcnow)


class PendingEditResolvedReferences(BaseModel):
    epic_id: str | None = None
    epic_label: str | None = None
    feature_id: str | None = None
    feature_label: str | None = None
    parent_id: str | None = None
    parent_label: str | None = None


class RecentResolvedTarget(BaseModel):
    node_id: str
    node_type: RecentResolvedTargetType
    title: str | None = None
    label: str | None = None
    source: RecentResolvedTargetSource = 'context_tool'
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    created_at: datetime = Field(default_factory=_utcnow)


class AppliedChange(BaseModel):
    """One structural change that was actually committed to the roadmap.

    Records a single entry from the backend's `semantic_diff.changes` so the
    LLM can answer undo/revert requests deterministically across turns — it
    reads `change_from` / `change_to` to know the direction of the change
    and uses the stable `node_id` to stage the reversal without re-resolving
    by a (possibly stale) title.
    """

    node_id: str
    node_type: str
    change_type: str
    change_from: dict[str, Any] = Field(default_factory=dict)
    change_to: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    committed_at: datetime = Field(default_factory=_utcnow)
    # Backend change_id the entry was produced by — kept so reverted commits can
    # be dropped instead of leaving the prompt's "recent changes" section
    # misrepresenting roadmap state.
    change_id: str | None = None


class PendingEditContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    intent_family: Literal[
        'rename_node',
        'create_epic',
        'create_feature',
        'create_task',
        'move_node',
        'update_node',
        'delete_node',
        'mark_status',
        'shift_dates',
        'roadmap_edit_clarifier',
    ]
    draft_operations: list[RoadmapOperation] = Field(default_factory=list)
    required_fields: list[str] = Field(default_factory=list)
    resolved_references: PendingEditResolvedReferences = Field(
        default_factory=PendingEditResolvedReferences
    )
    confirmation_mode: Literal['awaiting_clarification', 'draft_ready'] = (
        'awaiting_clarification'
    )
    source_user_message: str
    default_title: str | None = None
    awaiting_field: Literal['rename_title', 'target_label', 'parent', 'title'] | None = None
    target_hint: str | None = None
    last_clarifier_reason: str | None = None
    last_followup_kind: str | None = None
    resolver_hints: dict[str, Any] | None = None
    last_planner_stop_reason: str | None = None
    last_planner_needs_more_info: bool | None = None
    last_planner_draft_action: str | None = None
    last_tool_plan_summary: list[dict[str, Any]] = Field(default_factory=list)
    last_guard_reason: str | None = None
    last_retry_blocked_reason: str | None = None
    last_retry_blocked_intent_family: str | None = None
    # Set when an edit-lane clarifier was emitted with a ClarifierCard. The
    # pre-dispatcher uses this to verify that an incoming `__clarifier_answer__`
    # sentinel is routed to the correct pending context.
    pending_clarifier_question_id: str | None = None
    staging_validation_errors: list[dict[str, Any]] = Field(
        default_factory=list,
        alias='preview_validation_errors',
    )
    awaiting_staging_fix: bool = Field(
        default=False,
        alias='awaiting_preview_fix',
    )
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @field_validator('intent_family', mode='before')
    @classmethod
    def _normalize_intent_family(cls, value: Any) -> str:
        normalized = str(value or '').strip().lower()
        alias_map = {
            'rename': 'rename_node',
            'rename_item': 'rename_node',
            'rename_task': 'rename_node',
            'rename_feature': 'rename_node',
            'rename_epic': 'rename_node',
            'move': 'move_node',
            'move_item': 'move_node',
            'update': 'update_node',
            'delete': 'delete_node',
            'mark': 'mark_status',
            'shift': 'shift_dates',
        }
        canonical = {
            'rename_node',
            'create_epic',
            'create_feature',
            'create_task',
            'move_node',
            'update_node',
            'delete_node',
            'mark_status',
            'shift_dates',
            'roadmap_edit_clarifier',
        }
        mapped = alias_map.get(normalized, normalized)
        if mapped in canonical:
            return mapped
        return 'roadmap_edit_clarifier'


class DraftNode(BaseModel):
    draft_id: str
    parent_draft_id: str | None = None
    draft_mode: DraftMode = 'append'
    operations: list[RoadmapOperation] = Field(default_factory=list)
    draft_version: int = 0
    base_revision: int | None = None
    revision_token: str | None = None
    created_from_message_id: str | None = None
    summary: str | None = None
    status: DraftStatus = 'active'
    updated_at: datetime = Field(default_factory=_utcnow)


class AppliedDraftCommit(BaseModel):
    change_id: str | None = None
    draft_id: str
    draft_version: int
    status: Literal['applied', 'discarded'] = 'applied'
    discarded_at: datetime | None = None
    committed_at: datetime = Field(default_factory=_utcnow)


class ActorContext(BaseModel):
    actor_id: str
    display_name: str | None = None
    roadmap_role: Literal['owner', 'editor']
    locale: str | None = None
    timezone: str | None = None
    actor_context_source: str = 'backend_context_actor'
    fetched_at: datetime = Field(default_factory=_utcnow)


PendingPlanStatus = Literal[
    'awaiting_answers',
    'proposed',
    'confirmed',
    'discarded',
    'superseded',
]


class PendingPlanQuestion(BaseModel):
    """One clarifier question the plan lane asked the user.

    `allow_custom` is True by default so the web UI always renders a free-form
    "Other..." input alongside the predefined `options`. Mirrors how Claude
    Code / Copilot ask one question at a time with a mix of multiple choice
    and custom answers.
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    question: str
    options: list[str] = Field(default_factory=list)
    allow_custom: bool = True
    asked_at: datetime = Field(default_factory=_utcnow)


class PendingPlanAnswer(BaseModel):
    """User's response to a `PendingPlanQuestion`. Exactly one of
    `selected_option` or `custom_answer` is populated.
    """

    question_id: str
    question_text: str | None = None
    selected_option: str | None = None
    custom_answer: str | None = None
    answered_at: datetime = Field(default_factory=_utcnow)


class ClarifierCard(BaseModel):
    """Lane-agnostic structured clarifier payload surfaced to the web.

    Emitted by any lane (plan, edit, query) when the LLM needs user input
    to proceed. Web renders a card with radio options + optional "Other..."
    input. Submit replays the selection via the `__clarifier_answer__`
    sentinel, and the pre-dispatcher routes the answer to the lane's
    pending-state machine based on `lane`.
    """

    lane: Literal['edit', 'query', 'plan']
    question_id: str
    question: str
    options: list[str] = Field(default_factory=list)
    allow_custom: bool = True
    reason: str | None = None


class ProposedTask(BaseModel):
    title: str
    description: str | None = None
    status: str | None = None
    assignee_label: str | None = None
    target_feature_title: str | None = None


class ProposedFeature(BaseModel):
    title: str
    description: str | None = None
    target_epic_title: str | None = None
    tasks: list[ProposedTask] = Field(default_factory=list)


class ProposedEpic(BaseModel):
    title: str
    description: str | None = None
    features: list[ProposedFeature] = Field(default_factory=list)


class PendingPlan(BaseModel):
    """A strategic plan proposed to the user, awaiting confirmation.

    Mirrors `PendingEditContext` in shape: persisted in `SessionMetadata` across
    turns so that a later `confirm_action` can reference the structured proposal
    and convert it into concrete operations via the edit lane.

    The plan carries no node ids — only titles. The confirm bridge resolves
    existing titles → ids (via the edit lane's resolver) or issues creates.
    `base_revision` and `roadmap_overview_hash` let the confirm bridge detect
    drift and refuse to apply a stale plan.
    """

    plan_id: str = Field(default_factory=lambda: str(uuid4()))
    planning_turn_id: str | None = None
    summary: str = ''
    goal: str = ''
    rationale: str | None = None
    proposed_hierarchy: list[ProposedEpic] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    source_user_message: str
    base_revision: int | None = None
    revision_token: str | None = None
    roadmap_overview_hash: str | None = None
    status: PendingPlanStatus = 'proposed'
    # Multi-turn clarifier machinery: when the plan lane decides it needs
    # more info before drafting, it emits `status='awaiting_answers'` with
    # one or more questions in `current_questions` (1-4 per turn). Each user
    # answer is appended to `answers`; the pre-dispatcher synthesizes a new
    # prompt that replays the original request plus all accumulated answers
    # and re-enters the plan lane. Hard cap of 10 total questions per plan
    # session — past that, the replay prompt forces `plan_ready`.
    current_questions: list[PendingPlanQuestion] = Field(default_factory=list)
    answers: list[PendingPlanAnswer] = Field(default_factory=list)
    # Revision counter: 0 on initial proposal, incremented each time the user
    # asks the planner to revise the same plan. Plan_id is preserved across
    # revisions so the web can re-render the same card rather than spawning a
    # new one; revision_count lets telemetry and the prompt distinguish
    # "revision 3 of the same plan" from "three unrelated plans".
    revision_count: int = 0
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class SessionMetadata(BaseModel):
    model_config = ConfigDict(extra='allow')
    pending_context_resolution: PendingContextResolution | None = None
    pending_edit_context: PendingEditContext | None = None
    pending_plan: PendingPlan | None = None
    recent_resolved_targets: list[RecentResolvedTarget] = Field(default_factory=list)
    actor_context: ActorContext | None = None
    applied_change_ids: list[str] = Field(default_factory=list)
    active_draft_id: str | None = None
    drafts: dict[str, DraftNode] = Field(default_factory=dict)
    draft_head_ids: list[str] = Field(default_factory=list)
    applied_draft_commits: list[AppliedDraftCommit] = Field(default_factory=list)
    roadmap_overview_summary: str | None = None
    roadmap_overview_summary_fetched_at: datetime | None = None
    # Maps each rendered handle (e.g. "E1", "E1.F2") in
    # ``roadmap_overview_summary`` to the underlying node: ``{"id", "type",
    # "title"}``. Used by the op-emission path to expand planner-emitted
    # handles back to real UUIDs before dispatch. Invalidated together with
    # ``roadmap_overview_summary`` on auto-commit.
    roadmap_handle_map: dict[str, dict[str, str]] = Field(default_factory=dict)
    recent_applied_changes: list[AppliedChange] = Field(default_factory=list)


class AgentSession(BaseModel):
    # Tolerate (and drop) fields removed in later versions so Redis rehydration
    # stays forward-compatible across deploys — e.g. the retired `artifacts`
    # list still present on sessions serialized before the artifact removal.
    model_config = ConfigDict(extra='ignore')

    session_id: str = Field(default_factory=lambda: str(uuid4()))
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    operations: list[RoadmapOperation] = Field(default_factory=list)
    staged_operations_version: int = 0
    # Storage-level optimistic-lock version; bumped by SessionStore.save_cas on
    # every successful write. Independent of `staged_operations_version`.
    version: int = 0
    last_intent_type: IntentType | None = None
    messages: list[Message] = Field(default_factory=list)
    metadata: SessionMetadata = Field(default_factory=SessionMetadata)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class CreateSessionRequest(BaseModel):
    # Optional — when supplied (e.g. by the backend after inserting a
    # roadmap_ai_sessions row), the agent uses it as the Redis session key so
    # the DB row id and the agent session id are the same value. When omitted,
    # the agent generates a uuid as before.
    session_id: str | None = None
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    metadata: dict[str, Any] | None = None
    # Optional conversation history for rehydration after Redis TTL expiry.
    # The web client replays the last N messages from the DB into a fresh
    # Redis session so the planner has context. Ignored on a miss-hit race
    # where the session already exists — Redis remains authoritative for
    # transient working state (staged operations, drafts, resolver caches).
    seed_messages: list[Message] | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    created_at: datetime


class MessageRequest(BaseModel):
    message: str


class MessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    operations: list[RoadmapOperation]
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None = None
    active_draft_version: int | None = None
    plan_proposal: dict[str, Any] | None = None
    clarifier: ClarifierCard | None = None
    provider_used: ProviderUsed = 'rule_based'
    fallback_used: bool = False
    provider_error_code: str | None = None
    debug_trace_id: str | None = None
    commit_summary: CommitSummary | None = None


class TraceEvent(BaseModel):
    seq: int
    ts: str
    event: str
    title: str
    status: TraceEventStatus
    summary: str
    details: dict[str, Any] | None = None


class TraceEventsResponse(BaseModel):
    trace_id: str
    session_id: str | None = None
    roadmap_id: str | None = None
    events: list[TraceEvent] = Field(default_factory=list)
    next_seq: int
    done: bool = False
    started_at: str | None = None
    completed_at: str | None = None
    elapsed_ms: int | None = None
