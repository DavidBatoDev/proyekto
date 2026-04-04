from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.contracts.operations import RoadmapOperation


class Message(BaseModel):
    role: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


IntentType = Literal['smalltalk', 'question', 'roadmap_edit', 'unclear']
ResponseMode = Literal['chat', 'edit_plan']
ArtifactType = Literal['roadmap_preview']
ProviderUsed = Literal['openai', 'rule_based']
DraftMode = Literal['append', 'revise', 'branch']
DraftStatus = Literal['active', 'previewed', 'applied', 'abandoned']
PreviewBindingScope = Literal['draft_snapshot', 'ad_hoc_operations']


class RoadmapPreviewArtifact(BaseModel):
    artifact_id: str = Field(default_factory=lambda: str(uuid4()))
    type: ArtifactType = 'roadmap_preview'
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    preview_id: str
    title: str
    summary: str
    semantic_diff_summary: dict[str, int] = Field(default_factory=dict)
    validation_issue_count: int = 0
    validation_issues: list[dict[str, Any]] = Field(default_factory=list)
    has_validation_errors: bool = False
    inline_preview: dict[str, Any] | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PendingEditResolvedReferences(BaseModel):
    epic_id: str | None = None
    epic_label: str | None = None
    feature_id: str | None = None
    feature_label: str | None = None
    parent_id: str | None = None
    parent_label: str | None = None


class PendingEditContext(BaseModel):
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
    resolver_hints: dict[str, Any] | None = None
    last_planner_stop_reason: str | None = None
    last_planner_needs_more_info: bool | None = None
    last_planner_draft_action: str | None = None
    last_tool_plan_summary: list[dict[str, Any]] = Field(default_factory=list)
    preview_validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    awaiting_preview_fix: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

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
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AppliedDraftCommit(BaseModel):
    preview_id: str
    draft_id: str
    draft_version: int
    preview_fingerprint: str | None = None
    committed_at: datetime = Field(default_factory=datetime.utcnow)


class PreviewFingerprintBinding(BaseModel):
    preview_id: str
    draft_id: str
    draft_version: int
    base_revision: int | None = None
    preview_fingerprint: str
    binding_scope: PreviewBindingScope = 'draft_snapshot'
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ActorContext(BaseModel):
    actor_id: str
    display_name: str | None = None
    roadmap_role: Literal['owner', 'editor']
    locale: str | None = None
    timezone: str | None = None
    actor_context_source: str = 'backend_context_actor'
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class SessionMetadata(BaseModel):
    model_config = ConfigDict(extra='allow')
    pending_context_resolution: PendingContextResolution | None = None
    pending_edit_context: PendingEditContext | None = None
    actor_context: ActorContext | None = None
    applied_preview_ids: list[str] = Field(default_factory=list)
    active_draft_id: str | None = None
    drafts: dict[str, DraftNode] = Field(default_factory=dict)
    draft_head_ids: list[str] = Field(default_factory=list)
    applied_draft_commits: list[AppliedDraftCommit] = Field(default_factory=list)
    preview_fingerprint_bindings: dict[str, PreviewFingerprintBinding] = Field(
        default_factory=dict
    )
    latest_preview_fingerprint: str | None = None


class AgentSession(BaseModel):
    model_config = ConfigDict(extra='forbid')

    session_id: str = Field(default_factory=lambda: str(uuid4()))
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    operations: list[RoadmapOperation] = Field(default_factory=list)
    staged_operations_version: int = 0
    latest_preview_id: str | None = None
    last_intent_type: IntentType | None = None
    artifacts: list[RoadmapPreviewArtifact] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)
    metadata: SessionMetadata = Field(default_factory=SessionMetadata)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CreateSessionRequest(BaseModel):
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    metadata: dict[str, Any] | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    roadmap_id: str
    base_revision: int | None = None
    revision_token: str | None = None
    created_at: datetime


class MessageRequest(BaseModel):
    message: str
    auto_preview: bool = True


class MessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    operations: list[RoadmapOperation]
    preview_available: bool
    preview_recommended: bool
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None = None
    active_draft_version: int | None = None
    artifacts: list[RoadmapPreviewArtifact] = Field(default_factory=list)
    provider_used: ProviderUsed = 'rule_based'
    fallback_used: bool = False
    provider_error_code: str | None = None
    debug_trace_id: str | None = None


class PreviewRequest(BaseModel):
    operations: list[RoadmapOperation] | None = None
    base_revision: int | None = None
    revision_token: str | None = None


class CommitRequest(BaseModel):
    preview_id: str | None = None
    base_revision: int | None = None
    revision_token: str | None = None


class DiscardRequest(BaseModel):
    preview_id: str | None = None


class DiscardResponse(BaseModel):
    session_id: str
    roadmap_id: str
    discarded_preview_id: str | None = None
    discarded_at: datetime
    staged_operations_count: int
    staged_operations_version: int


class RollbackRequest(BaseModel):
    target_revision: int


class ArtifactPreviewResponse(BaseModel):
    session_id: str
    roadmap_id: str
    artifact: RoadmapPreviewArtifact
    preview: dict[str, Any]
