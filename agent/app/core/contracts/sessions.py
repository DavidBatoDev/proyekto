from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.contracts.operations import RoadmapOperation

# `SessionScope` and `CommitImpactedItem` are DEFINED in contracts/runs.py (the
# leaf module: RunState needs both, and this module needs RunState) and
# re-exported here so `from app.core.contracts.sessions import SessionScope`
# keeps working. The run models are re-exported for the same reason.
from app.core.contracts.runs import (  # noqa: F401 — re-exports
    CommitImpactedItem,
    ContextRef,
    ResolvedRef,
    RunCommitView,
    RunState,
    RunSummary,
    RunView,
    ScopeKind,
    SessionScope,
)


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
TraceEventDetailMode = Literal['verbose', 'structured']
TraceEventStatus = Literal['running', 'success', 'error']
RecentResolvedTargetType = Literal['epic', 'feature', 'task']
RecentResolvedTargetSource = Literal[
    'context_tool',
    'deictic_pre_resolver',
    'staged_operations',
    'commit_semantic_diff',
]


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


class RecentResolvedTarget(BaseModel):
    node_id: str
    node_type: RecentResolvedTargetType
    title: str | None = None
    label: str | None = None
    source: RecentResolvedTargetSource = 'context_tool'
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    # Roadmap the node belongs to. None on entries recorded before sessions
    # could load several roadmaps; batch validation lets those pass (the
    # backend rejects cross-roadmap ids at preview/commit).
    roadmap_id: str | None = None
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
    # Roadmap the change was committed to (None on pre-multi-roadmap entries).
    roadmap_id: str | None = None


class ChangeGroup(BaseModel):
    """All committed changes from a single commit, grouped for point-in-time
    revert.

    Each successful auto-commit appends one ChangeGroup to
    ``SessionMetadata.change_history`` (most recent first). Unlike the rolling
    ``recent_applied_changes`` log (capped + flattened across commits), a group
    holds the FULL change set of its commit so a multi-node delete is fully
    reversible. ``summary`` (the commit's assistant_message or a diff synopsis)
    lets the model map a natural-language reference ("before I did X") to a
    ``change_id``; revert composes the net inverse over a range of groups.
    """

    change_id: str | None = None
    committed_at: datetime = Field(default_factory=_utcnow)
    summary: str = ''
    changes: list[AppliedChange] = Field(default_factory=list)
    # Roadmap the commit landed on and the run that produced it, so the
    # prompt's "# Recent changes" block groups by roadmap and revert can be
    # filtered per roadmap. None on pre-multi-roadmap groups.
    roadmap_id: str | None = None
    run_id: str | None = None


class ActorContext(BaseModel):
    actor_id: str
    display_name: str | None = None
    # Role on the focus roadmap. None in workspace scope (the actor comes from
    # GET /api/ai/context/actor, which carries no roadmap role).
    roadmap_role: Literal['owner', 'editor'] | None = None
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


class ClarifierOption(BaseModel):
    """One selectable answer inside a `ClarifierQuestion`."""

    label: str
    description: str | None = None


class ClarifierQuestion(BaseModel):
    """One question inside a multi-question `ClarifierCard`.

    `multi_select` renders checkboxes (pick several) instead of radios.
    `allow_custom` keeps the free-form "Other..." input available.
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    header: str | None = None
    question: str
    multi_select: bool = False
    allow_custom: bool = True
    options: list[ClarifierOption] = Field(default_factory=list)


class ClarifierCard(BaseModel):
    """Lane-agnostic structured clarifier payload surfaced to the web.

    Emitted by any lane (plan, edit, query) when the LLM needs user input
    to proceed. Web renders a card with radio options + optional "Other..."
    input. Submit replays the selection via the `__clarifier_answer__`
    sentinel, and the pre-dispatcher routes the answer to the lane's
    pending-state machine based on `lane`.

    `question`/`options`/`allow_custom` mirror `questions[0]` so web bundles
    that predate the multi-question `questions` array still render a working
    single-question card (mobile OTA bundles lag behind the agent).
    """

    lane: Literal['edit', 'query', 'plan']
    question_id: str
    question: str
    options: list[str] = Field(default_factory=list)
    allow_custom: bool = True
    reason: str | None = None
    questions: list[ClarifierQuestion] = Field(default_factory=list)


class ProposedTask(BaseModel):
    title: str
    description: str | None = None
    status: str | None = None
    # Legacy single label; `assignee_labels` carries every assignee (first =
    # primary). Materialize resolves labels to member ids -> `assignee_ids`.
    assignee_label: str | None = None
    assignee_labels: list[str] | None = None
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


PendingPlanKind = Literal['plan', 'edits']


class PlanTarget(BaseModel):
    """One roadmap a pending proposal applies to.

    `kind='plan'` targets carry `proposed_hierarchy` (titles only; execute
    materializes them into operations). `kind='edits'` targets carry concrete
    `operations` (a stage_edits batch that tripped the checkpoint policy).
    `committed` flips when that target's commit lands, so confirming again
    after a partial failure resumes only the remaining targets.
    """

    roadmap_id: str
    roadmap_title: str | None = None
    project_id: str | None = None
    proposed_hierarchy: list[ProposedEpic] = Field(default_factory=list)
    operations: list[RoadmapOperation] | None = None
    # Human lines for the proposal card ("Delete epic 'X' and 4 tasks").
    summary_lines: list[str] = Field(default_factory=list)
    operations_count: int = 0
    contains_delete: bool = False
    committed: bool = False
    # Staleness anchors captured from the target's RoadmapContext when the
    # proposal was recorded (`is_plan_stale` compares per target).
    base_revision: int | None = None
    revision_token: str | None = None
    overview_hash: str | None = None


class PendingPlan(BaseModel):
    """A strategic plan proposed to the user, awaiting confirmation.

    Persisted in `SessionMetadata` across turns so that a later confirm can
    reference the structured proposal and convert it into concrete operations
    (the execute phase materializes it per target roadmap).

    The plan carries no node ids — only titles. The confirm bridge resolves
    existing titles → ids (via the edit lane's resolver) or issues creates.
    `base_revision` and `roadmap_overview_hash` let the confirm bridge detect
    drift and refuse to apply a stale plan.
    """

    plan_id: str = Field(default_factory=lambda: str(uuid4()))
    planning_turn_id: str | None = None
    # 'plan' = a strategic proposal (titles, materialized on confirm);
    # 'edits' = concrete operations that tripped the checkpoint policy.
    kind: PendingPlanKind = 'plan'
    # One entry per roadmap the proposal touches. `proposed_hierarchy` below
    # mirrors `targets[0].proposed_hierarchy` for the legacy single-roadmap
    # card; empty targets = the legacy focus-roadmap-only plan.
    targets: list[PlanTarget] = Field(default_factory=list)
    # Run that recorded the proposal (confirm resumes it or seeds a new one).
    run_id: str | None = None
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


class RoadmapContext(BaseModel):
    """Per-roadmap context cache, keyed by roadmap id in
    ``SessionMetadata.roadmaps``. The focus roadmap has ``handle_prefix=None``
    (bare ``E1`` / ``E1.F2`` / ``M1`` handles); every other loaded roadmap
    gets an ``R{n}`` prefix (``R2.E1``) that is never reused in a session.
    ``handle_map`` keys are already prefixed and each entry carries the
    ``roadmap_id`` it belongs to. Excluded from the durable snapshot (a
    cache: refetched on the next turn)."""

    model_config = ConfigDict(extra='allow')

    roadmap_id: str
    title: str | None = None
    project_id: str | None = None
    workspace_id: str | None = None
    handle_prefix: str | None = None
    overview_summary: str | None = None
    overview_fetched_at: datetime | None = None
    handle_map: dict[str, dict[str, str]] = Field(default_factory=dict)
    revision_token: str | None = None
    base_revision: int | None = None
    memory_notes: list[dict[str, Any]] | None = None
    memory_notes_fetched_at: datetime | None = None
    project_context: dict[str, Any] | None = None
    project_context_fetched_at: datetime | None = None
    role: Literal['owner', 'editor'] | None = None
    loaded_at: datetime = Field(default_factory=_utcnow)
    last_used_at: datetime = Field(default_factory=_utcnow)

    @property
    def is_focus(self) -> bool:
        return self.handle_prefix is None


class SessionMetadata(BaseModel):
    # extra='allow' keeps Redis documents and agent-state snapshots written
    # before a field was removed (the singular roadmap caches, the v1 pending
    # models) loading cleanly; the stale keys are simply carried along.
    model_config = ConfigDict(extra='allow')
    # Per-roadmap context caches (see RoadmapContext), keyed by roadmap id.
    # The focus roadmap (roadmap scope) has handle_prefix=None; every other
    # loaded roadmap gets an R{n} prefix. Excluded from the durable snapshot.
    roadmaps: dict[str, RoadmapContext] = Field(default_factory=dict)
    # Next `R{n}` handle prefix to hand out; monotonic within a session.
    next_handle_prefix_index: int = 1
    # Workspace-scope overview cache (GET /api/ai/context/overview); TTL via
    # AGENT_CACHE_TTL_SECONDS. Excluded from the durable snapshot.
    workspace_context: dict[str, Any] | None = None
    workspace_context_fetched_at: datetime | None = None
    # The active run (None between runs) and the last few finished ones.
    run: RunState | None = None
    run_history: list[RunSummary] = Field(default_factory=list)
    pending_plan: PendingPlan | None = None
    recent_resolved_targets: list[RecentResolvedTarget] = Field(default_factory=list)
    actor_context: ActorContext | None = None
    applied_change_ids: list[str] = Field(default_factory=list)
    recent_applied_changes: list[AppliedChange] = Field(default_factory=list)
    # Per-commit change groups (most recent first), for point-in-time revert.
    # Each commit appends one group; capped at MAX_CHANGE_GROUPS. Rides the
    # durable agent-state snapshot (older groups trimmed first under the size
    # cap) so revert survives Redis expiry.
    change_history: list[ChangeGroup] = Field(default_factory=list)
    # Rolling summary of turns folded out of `session.messages` by the
    # compaction pass (see app/core/runtime/summarizer.py). Rides the durable
    # agent-state snapshot so it survives Redis expiry.
    conversation_summary: str | None = None
    conversation_summary_folded_count: int = 0


def _derive_scope_from_legacy_roadmap_id(data: Any) -> Any:
    """Shared `mode='before'` hook: a payload without `scope` but with the
    legacy `roadmap_id` gets `scope={kind:'roadmap', roadmap_id}`. Keeps
    `AgentSession(roadmap_id=...)` fixtures, pre-scope Redis documents and
    the one-release legacy create body all loading."""
    if not isinstance(data, dict):
        return data
    if data.get('scope') is not None:
        return data
    roadmap_id = data.get('roadmap_id')
    if isinstance(roadmap_id, str) and roadmap_id.strip():
        return {**data, 'scope': {'kind': 'roadmap', 'roadmap_id': roadmap_id.strip()}}
    return data


class AgentSession(BaseModel):
    # Tolerate (and drop) fields removed in later versions so Redis rehydration
    # stays forward-compatible across deploys — e.g. the retired `artifacts`
    # list still present on sessions serialized before the artifact removal.
    model_config = ConfigDict(extra='ignore')

    session_id: str = Field(default_factory=lambda: str(uuid4()))
    # What the session is focused on. Derived from the legacy `roadmap_id`
    # when a payload (fixture, old Redis document) predates scopes.
    scope: SessionScope
    # Legacy mirror of `scope.roadmap_id` (None in workspace scope). Always
    # re-derived from `scope`; never authoritative on its own.
    roadmap_id: str | None = None
    # Who created the session, from the forwarded auth: the actor id, or
    # "Guest <id>". Messages/continue/cancel/trace reads 404 on a mismatch.
    # None only on sessions created before ownership was recorded.
    owner_key: str | None = None
    base_revision: int | None = None
    # Legacy mirror of the focus roadmap's revision token (kept on
    # CreateSessionResponse); the per-roadmap value lives in
    # metadata.roadmaps[rid].revision_token. Staged operations live in
    # metadata.run.batches — there is no session-level staged list.
    revision_token: str | None = None
    # Bumped once per batch staged in a step (response compat).
    staged_operations_version: int = 0
    # Storage-level optimistic-lock version; bumped by SessionStore.save_cas on
    # every successful write. Independent of `staged_operations_version`.
    version: int = 0
    last_intent_type: IntentType | None = None
    messages: list[Message] = Field(default_factory=list)
    metadata: SessionMetadata = Field(default_factory=SessionMetadata)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @model_validator(mode='before')
    @classmethod
    def _derive_scope(cls, data: Any) -> Any:
        return _derive_scope_from_legacy_roadmap_id(data)

    @model_validator(mode='after')
    def _mirror_legacy_roadmap_id(self) -> 'AgentSession':
        self.roadmap_id = self.scope.roadmap_id
        return self

    @property
    def focus_roadmap_id(self) -> str | None:
        return self.scope.focus_roadmap_id


class CreateSessionRequest(BaseModel):
    # Optional — when supplied (e.g. by the backend after inserting a
    # roadmap_ai_sessions row), the agent uses it as the Redis session key so
    # the DB row id and the agent session id are the same value. When omitted,
    # the agent generates a uuid as before.
    session_id: str | None = None
    # Exactly one of `scope` / legacy `roadmap_id` (one release; derives a
    # roadmap scope). Both are tolerated only when they agree.
    scope: SessionScope | None = None
    roadmap_id: str | None = None
    base_revision: int | None = None
    revision_token: str | None = None
    metadata: dict[str, Any] | None = None
    # Optional conversation history for rehydration after Redis TTL expiry.
    # The web client replays the last N messages from the DB into a fresh
    # Redis session so the planner has context. Ignored on a miss-hit race
    # where the session already exists — Redis remains authoritative for
    # transient working state (staged operations, resolver caches).
    seed_messages: list[Message] | None = None

    @field_validator('roadmap_id', mode='before')
    @classmethod
    def _blank_roadmap_id_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode='after')
    def _require_exactly_one_scope_source(self) -> 'CreateSessionRequest':
        if self.scope is None and self.roadmap_id is None:
            raise ValueError('scope or roadmap_id is required')
        if (
            self.scope is not None
            and self.roadmap_id is not None
            and (self.scope.kind != 'roadmap' or self.scope.roadmap_id != self.roadmap_id)
        ):
            raise ValueError('scope and roadmap_id disagree; send exactly one of them')
        return self

    @property
    def resolved_scope(self) -> SessionScope:
        if self.scope is not None:
            return self.scope
        return SessionScope(kind='roadmap', roadmap_id=self.roadmap_id)


class CreateSessionResponse(BaseModel):
    session_id: str
    scope: SessionScope
    # Legacy mirror of scope.roadmap_id (None in workspace scope).
    roadmap_id: str | None = None
    base_revision: int | None = None
    revision_token: str | None = None
    created_at: datetime

    @model_validator(mode='before')
    @classmethod
    def _derive_scope(cls, data: Any) -> Any:
        return _derive_scope_from_legacy_roadmap_id(data)

    @model_validator(mode='after')
    def _mirror_legacy_roadmap_id(self) -> 'CreateSessionResponse':
        self.roadmap_id = self.scope.roadmap_id
        return self


MessageCapability = Literal['continue']
MAX_MESSAGE_REFS = 20


class MessageRequest(BaseModel):
    message: str
    # @-references from the composer; a hint, never a restriction.
    refs: list[ContextRef] = Field(default_factory=list, max_length=MAX_MESSAGE_REFS)
    # Absent "continue" = a legacy client that expects one synchronous
    # response (one release); present = the web drives POST .../continue
    # while `run.next == 'continue'`.
    capabilities: list[MessageCapability] = Field(default_factory=list)

    @property
    def supports_continue(self) -> bool:
        return 'continue' in self.capabilities


class MessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    # Today's values plus 'run_step' (next='continue', no assistant text yet)
    # and 'run_report' (the verify report closed the run).
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    # Legacy: operations committed to the FOCUS roadmap in this step.
    operations: list[RoadmapOperation]
    staged_operations_version: int
    staged_operations_count: int
    plan_proposal: dict[str, Any] | None = None
    clarifier: ClarifierCard | None = None
    provider_used: ProviderUsed = 'rule_based'
    fallback_used: bool = False
    provider_error_code: str | None = None
    debug_trace_id: str | None = None
    # Legacy: the focus roadmap's commit in this step.
    commit_summary: CommitSummary | None = None
    # Cumulative for the run; `operations` present ONLY on commits made in
    # this step.
    commits: list[RunCommitView] = Field(default_factory=list)
    run: RunView | None = None


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
    # Run the trace segment belongs to and the phase it was in at the last
    # flush (None on traces recorded before runs existed).
    run_id: str | None = None
    phase: str | None = None
    events: list[TraceEvent] = Field(default_factory=list)
    next_seq: int
    done: bool = False
    started_at: str | None = None
    completed_at: str | None = None
    elapsed_ms: int | None = None
