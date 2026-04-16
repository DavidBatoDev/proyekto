from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.contracts.operations import RoadmapOperation


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Message(BaseModel):
    role: str
    content: str
    created_at: datetime = Field(default_factory=_utcnow)


IntentType = Literal[
    'smalltalk',
    'general_question',
    'roadmap_query',
    'roadmap_plan',
    'roadmap_edit',
    'confirm_action',
    'unclear',
    'question',
]
ResponseMode = Literal['chat', 'edit_plan']
ArtifactType = Literal['roadmap_commit']
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
    node_type: Literal['roadmap', 'epic', 'feature', 'task']
    title: str | None = None
    change_type: str | None = None
    impact: Literal['created', 'modified', 'deleted'] = 'modified'


class RoadmapCommitArtifact(BaseModel):
    artifact_id: str = Field(default_factory=lambda: str(uuid4()))
    type: ArtifactType = 'roadmap_commit'
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    change_id: str | None = None
    title: str
    summary: str
    semantic_diff_summary: dict[str, int] = Field(default_factory=dict)
    validation_issue_count: int = 0
    validation_issues: list[dict[str, Any]] = Field(default_factory=list)
    impacted_items: list[CommitImpactedItem] = Field(default_factory=list)
    has_validation_errors: bool = False
    status: Literal['draft', 'applied', 'discarded'] = 'draft'
    inline_commit: dict[str, Any] | None = None
    created_at: datetime = Field(default_factory=_utcnow)


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


class SessionMetadata(BaseModel):
    model_config = ConfigDict(extra='allow')
    pending_context_resolution: PendingContextResolution | None = None
    pending_edit_context: PendingEditContext | None = None
    recent_resolved_targets: list[RecentResolvedTarget] = Field(default_factory=list)
    actor_context: ActorContext | None = None
    applied_change_ids: list[str] = Field(default_factory=list)
    active_draft_id: str | None = None
    drafts: dict[str, DraftNode] = Field(default_factory=dict)
    draft_head_ids: list[str] = Field(default_factory=list)
    applied_draft_commits: list[AppliedDraftCommit] = Field(default_factory=list)


class AgentSession(BaseModel):
    model_config = ConfigDict(extra='forbid')

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
    artifacts: list[RoadmapCommitArtifact] = Field(default_factory=list)
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
    artifacts: list[RoadmapCommitArtifact] = Field(default_factory=list)
    provider_used: ProviderUsed = 'rule_based'
    fallback_used: bool = False
    provider_error_code: str | None = None
    debug_trace_id: str | None = None


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


class CommitRequest(BaseModel):
    operations: list[RoadmapOperation] | None = None
    base_revision: int | None = None
    revision_token: str | None = None


class DiscardRequest(BaseModel):
    change_id: str | None = None


class DiscardResponse(BaseModel):
    session_id: str
    roadmap_id: str
    discarded_change_id: str | None = None
    discarded_at: datetime
    staged_operations_count: int
    staged_operations_version: int


class RollbackRequest(BaseModel):
    change_id: str
