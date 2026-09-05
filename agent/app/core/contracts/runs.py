"""Run contracts: the server-side state machine one user message drives.

A *run* is `investigate -> propose -> await_user -> execute -> verify ->
done|failed|cancelled`, persisted in the Redis session (`metadata.run`) and the
durable agent-state snapshot so any agent instance can `continue` it.

This module is the leaf of the contracts package: `contracts/sessions.py`
imports it (``SessionMetadata.run``, the API models), so the two models both
files need — ``SessionScope`` and ``CommitImpactedItem`` — are DEFINED here and
re-exported from ``contracts/sessions.py``. Import either name from whichever
module reads better; they are the same class.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.contracts.operations import RoadmapOperation
from app.core.uuid_utils import normalize_uuid


def _utcnow() -> datetime:
    # Naive UTC, matching contracts/sessions.py.
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Literals
# ---------------------------------------------------------------------------

ScopeKind = Literal['roadmap', 'workspace']
RunPhase = Literal['investigate', 'propose', 'execute', 'verify']
RunStatus = Literal['running', 'awaiting_user', 'done', 'failed', 'cancelled']
RunNext = Literal['continue', 'await_user', 'done']
CheckpointKind = Literal['clarifier', 'proposal']
RefKind = Literal['project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team']
BatchSource = Literal['stage_edits', 'proposal', 'revert']
CommitStatus = Literal['pending', 'committed', 'failed', 'skipped']
VerifyStatus = Literal['verified', 'partial', 'failed', 'nothing_to_verify']
VerifyCheckStatus = Literal['pass', 'warn', 'fail']

TERMINAL_RUN_STATUSES: frozenset[str] = frozenset({'done', 'failed', 'cancelled'})

# The two `parse_mode` values a run adds on top of today's table:
# `run_step` = the step ended with next='continue' (no assistant text yet),
# `run_report` = the verify report closed the run.
RunParseMode = Literal['run_step', 'run_report']

MAX_REF_LABEL_CHARS = 120
MAX_REF_ID_CHARS = 128


# ---------------------------------------------------------------------------
# Scope (shared with contracts/sessions.py)
# ---------------------------------------------------------------------------


class SessionScope(BaseModel):
    """What a session is focused on.

    ``roadmap`` scope focuses one roadmap (bare ``E1`` handles, in-roadmap
    behaviour byte for byte). ``workspace`` scope focuses a workspace; the
    agent may still touch anything the user can access. Ids are NOT required
    to be uuids here: fixtures across the test-suite use ``'roadmap-1'``
    style ids and the backend is the authority on existence/access anyway.
    """

    kind: ScopeKind
    roadmap_id: str | None = None
    workspace_id: str | None = None

    @field_validator('roadmap_id', 'workspace_id', mode='before')
    @classmethod
    def _blank_to_none(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode='after')
    def _check_ids_match_kind(self) -> 'SessionScope':
        if self.kind == 'roadmap':
            if not self.roadmap_id:
                raise ValueError('roadmap scope requires roadmap_id')
            if self.workspace_id:
                raise ValueError('roadmap scope must not carry workspace_id')
        else:
            if not self.workspace_id:
                raise ValueError('workspace scope requires workspace_id')
            if self.roadmap_id:
                raise ValueError('workspace scope must not carry roadmap_id')
        return self

    @property
    def key(self) -> str:
        """Stable prompt-cache / lock key for the scope."""
        if self.kind == 'roadmap':
            return f'roadmap:{self.roadmap_id}'
        return f'workspace:{self.workspace_id}'

    @property
    def focus_roadmap_id(self) -> str | None:
        """The roadmap bare handles refer to; None in workspace scope."""
        return self.roadmap_id if self.kind == 'roadmap' else None


class CommitImpactedItem(BaseModel):
    node_id: str
    node_type: Literal['roadmap', 'epic', 'feature', 'task', 'milestone']
    title: str | None = None
    change_type: str | None = None
    impact: Literal['created', 'modified', 'deleted'] = 'modified'


# ---------------------------------------------------------------------------
# Context refs (@-mentions)
# ---------------------------------------------------------------------------


class ContextRef(BaseModel):
    """One @-reference from the composer. Inbound and untrusted: a hint about
    what the user means, never a restriction. Hydrated once per run through
    `POST /api/ai/context/resolve-refs` (fail-closed per ref on the backend),
    so the id is only sanity-checked here — non-empty, bounded, and normalized
    to canonical form when it is uuid-like."""

    kind: RefKind
    id: str
    label: str | None = None

    @field_validator('id', mode='before')
    @classmethod
    def _normalize_id(cls, value: Any) -> Any:
        if not isinstance(value, str):
            raise ValueError('ref id must be a string')
        stripped = value.strip()
        if not stripped:
            raise ValueError('ref id must not be empty')
        if len(stripped) > MAX_REF_ID_CHARS:
            raise ValueError(f'ref id exceeds {MAX_REF_ID_CHARS} characters')
        return normalize_uuid(stripped) or stripped

    @field_validator('label', mode='before')
    @classmethod
    def _trim_label(cls, value: Any) -> Any:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError('ref label must be a string')
        stripped = value.strip()
        if not stripped:
            return None
        return stripped[:MAX_REF_LABEL_CHARS]

    @property
    def dedupe_key(self) -> tuple[str, str]:
        return (self.kind, self.id)


class RefChainEntry(BaseModel):
    model_config = ConfigDict(extra='ignore')

    kind: str
    id: str
    title: str | None = None


class ResolvedRef(BaseModel):
    """One entry of the resolve-refs response, plus the composer label echoed
    back so the web can render chips. `parent_chain` is nearest-first
    (feature -> epic -> roadmap -> project -> workspace)."""

    model_config = ConfigDict(extra='ignore')

    kind: RefKind
    id: str
    accessible: bool = False
    label: str | None = None
    title: str | None = None
    status: str | None = None
    roadmap_id: str | None = None
    project_id: str | None = None
    workspace_id: str | None = None
    parent_chain: list[RefChainEntry] = Field(default_factory=list)
    # NOT_FOUND | FORBIDDEN | RESOLVE_FAILED | ... when accessible=False.
    error_code: str | None = None


# ---------------------------------------------------------------------------
# Batches and commits
# ---------------------------------------------------------------------------


def _operation_to_plain(operation: Any) -> Any:
    if isinstance(operation, BaseModel):
        return operation.model_dump(mode='json', exclude_none=True)
    return operation


def compute_operations_hash(operations: list[Any]) -> str:
    """Stable sha256 over the canonical JSON of a batch's operations.

    Used to decide whether a pending commit may be retried with the SAME
    idempotency key (the backend replays only when its own operations hash
    matches and answers `IDEMPOTENCY_KEY_REUSED` otherwise): unchanged hash ->
    reuse the key, changed hash (repair, re-materialize) -> mint a new one."""
    canonical = json.dumps(
        [_operation_to_plain(operation) for operation in operations],
        sort_keys=True,
        separators=(',', ':'),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def operations_contain_delete(operations: list[Any]) -> bool:
    for operation in operations:
        op_value: Any
        if isinstance(operation, BaseModel):
            op_value = getattr(operation, 'op', None)
        elif isinstance(operation, dict):
            op_value = operation.get('op')
        else:
            op_value = None
        if op_value is None:
            continue
        op_name = getattr(op_value, 'value', op_value)
        if str(op_name) == 'delete_node':
            return True
    return False


class RunBatch(BaseModel):
    """One roadmap's worth of staged operations inside a run. A multi-roadmap
    `stage_edits` response becomes one batch per distinct roadmap; proposals
    materialize into one batch per target."""

    batch_id: str = Field(default_factory=lambda: str(uuid4()))
    roadmap_id: str
    roadmap_title: str | None = None
    operations: list[RoadmapOperation] = Field(default_factory=list)
    # Filled from `operations` when omitted; call `refresh_operations_hash()`
    # after mutating `operations` (repair iteration, re-materialize).
    operations_hash: str | None = None
    assistant_message: str = ''
    source: BatchSource = 'stage_edits'
    contains_delete: bool = False
    # kind='plan' proposal targets carry titles only; execute materializes
    # them into operations with a mini loop first.
    needs_materialize: bool = False
    # Side key holding a paused materialize transcript (resumed on continue).
    materialize_transcript_key: str | None = None

    @model_validator(mode='after')
    def _fill_derived(self) -> 'RunBatch':
        if self.operations:
            if self.operations_hash is None:
                self.operations_hash = compute_operations_hash(self.operations)
            if not self.contains_delete and operations_contain_delete(self.operations):
                self.contains_delete = True
        return self

    def refresh_operations_hash(self) -> str:
        self.operations_hash = compute_operations_hash(self.operations)
        self.contains_delete = operations_contain_delete(self.operations)
        return self.operations_hash

    @property
    def operations_count(self) -> int:
        return len(self.operations)


class RunCommit(BaseModel):
    """Progress record for one batch's commit. Carries the operations HASH,
    never the operations themselves (those live on the batch), so the session
    document and the snapshot do not double in size."""

    batch_id: str
    roadmap_id: str
    idempotency_key: str = Field(default_factory=lambda: str(uuid4()))
    operations_hash: str | None = None
    status: CommitStatus = 'pending'
    attempts: int = 0
    change_id: str | None = None
    revision_token_after: str | None = None
    semantic_diff_summary: dict[str, int] = Field(default_factory=dict)
    impacted_summary: dict[str, int] = Field(default_factory=dict)
    impacted_items: list[CommitImpactedItem] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    # Backend's `history_recorded` for run-attributed commits; None until the
    # commit lands (or when the backend predates the field).
    history_recorded: bool | None = None


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------


class VerifyCheck(BaseModel):
    name: str
    status: VerifyCheckStatus
    detail: str = ''


class VerifyReport(BaseModel):
    status: VerifyStatus
    checks: list[VerifyCheck] = Field(default_factory=list)
    summary: str = ''
    # A follow-up proposal the verify model call attached (never auto-fixed).
    follow_up_plan_id: str | None = None


# ---------------------------------------------------------------------------
# Run state
# ---------------------------------------------------------------------------


class RunSegment(BaseModel):
    """One trace's worth of a run: a user send or a checkpoint answer mints a
    trace; `continue` requests reuse it."""

    trace_id: str
    started_at: datetime = Field(default_factory=_utcnow)
    ended_at: datetime | None = None
    from_phase: RunPhase = 'investigate'
    # 'checkpoint' | 'done' | 'failed' | 'cancelled' | ...
    ended_with: str | None = None


class RunError(BaseModel):
    code: str
    message: str = ''


class RunState(BaseModel):
    model_config = ConfigDict(extra='allow')

    run_id: str = Field(default_factory=lambda: str(uuid4()))
    status: RunStatus = 'running'
    phase: RunPhase = 'investigate'
    next: RunNext = 'continue'
    # Current segment's trace id (== segments[-1].trace_id).
    trace_id: str
    segments: list[RunSegment] = Field(default_factory=list)
    # HTTP requests served for this run (messages + continues); capped by
    # AGENT_RUN_MAX_STEPS.
    step: int = 0
    scope: SessionScope
    # Folded text handed to the model (sentinels resolved) vs the raw body.
    user_message: str = ''
    raw_user_message: str = ''
    refs: list[ContextRef] = Field(default_factory=list)
    resolved_refs: list[ResolvedRef] = Field(default_factory=list)
    # Scope roadmap + auto-loaded referenced roadmaps + roadmaps loaded by
    # tools during this run. Never evicted from the context cache mid-run.
    focus_roadmap_ids: list[str] = Field(default_factory=list)
    checkpoint: CheckpointKind | None = None
    # ClarifierCard payload as built today (kept as a dict to avoid a cycle
    # with contracts/sessions.py).
    clarifier: dict[str, Any] | None = None
    # Phase to resume after a clarifier answer.
    asked_in_phase: RunPhase | None = None
    # metadata.pending_plan.plan_id while a proposal is pending.
    plan_id: str | None = None
    batches: list[RunBatch] = Field(default_factory=list)
    # Set by the snapshot ladder when batch operations were dropped to fit
    # the size cap: a rehydrated run can report but not resume execute.
    batches_truncated: bool = False
    commits: list[RunCommit] = Field(default_factory=list)
    # Next batch index for execute.
    execute_cursor: int = 0
    # Side key of a paused investigate transcript.
    loop_transcript_key: str | None = None
    # {phase: {'turns': n, 'tool_calls': n}}
    phase_usage: dict[str, dict[str, int]] = Field(default_factory=dict)
    # input/output/total/cached, summed across the run.
    tokens: dict[str, int] = Field(default_factory=dict)
    # {phase: effort} for telemetry.
    reasoning_effort: dict[str, str] = Field(default_factory=dict)
    final_message: str | None = None
    verify: VerifyReport | None = None
    error: RunError | None = None
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_RUN_STATUSES

    @property
    def committed_roadmap_ids(self) -> list[str]:
        seen: list[str] = []
        for commit in self.commits:
            if commit.status == 'committed' and commit.roadmap_id not in seen:
                seen.append(commit.roadmap_id)
        return seen


class RunSummary(BaseModel):
    """Compact record kept in `metadata.run_history` (last 5)."""

    run_id: str
    status: RunStatus
    phase: RunPhase
    trace_ids: list[str] = Field(default_factory=list)
    committed_roadmap_ids: list[str] = Field(default_factory=list)
    error_code: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
    ended_at: datetime | None = None

    @classmethod
    def from_state(cls, run: RunState, *, ended_at: datetime | None = None) -> 'RunSummary':
        return cls(
            run_id=run.run_id,
            status=run.status,
            phase=run.phase,
            trace_ids=[segment.trace_id for segment in run.segments] or [run.trace_id],
            committed_roadmap_ids=run.committed_roadmap_ids,
            error_code=run.error.code if run.error is not None else None,
            created_at=run.created_at,
            ended_at=ended_at or run.updated_at,
        )


# ---------------------------------------------------------------------------
# Wire projections
# ---------------------------------------------------------------------------


class RunBatchView(BaseModel):
    batch_id: str
    roadmap_id: str
    roadmap_title: str | None = None
    operations_count: int = 0
    contains_delete: bool = False
    source: BatchSource = 'stage_edits'

    @classmethod
    def from_batch(cls, batch: RunBatch) -> 'RunBatchView':
        return cls(
            batch_id=batch.batch_id,
            roadmap_id=batch.roadmap_id,
            roadmap_title=batch.roadmap_title,
            operations_count=batch.operations_count,
            contains_delete=batch.contains_delete,
            source=batch.source,
        )


class RunCommitView(BaseModel):
    """Wire shape of a commit. `operations` is attached ONLY on the commits
    made in the current step of `MessageResponse.commits`; `RunView.commits`
    never carries it."""

    batch_id: str
    roadmap_id: str
    roadmap_title: str | None = None
    project_id: str | None = None
    status: CommitStatus = 'pending'
    change_id: str | None = None
    operations_count: int = 0
    operations: list[RoadmapOperation] | None = None
    impacted_items: list[CommitImpactedItem] = Field(default_factory=list)
    impacted_summary: dict[str, int] = Field(default_factory=dict)
    semantic_diff_summary: dict[str, int] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None
    history_recorded: bool | None = None

    @classmethod
    def from_commit(
        cls,
        commit: RunCommit,
        batch: RunBatch | None = None,
        *,
        project_id: str | None = None,
        include_operations: bool = False,
    ) -> 'RunCommitView':
        return cls(
            batch_id=commit.batch_id,
            roadmap_id=commit.roadmap_id,
            roadmap_title=batch.roadmap_title if batch is not None else None,
            project_id=project_id,
            status=commit.status,
            change_id=commit.change_id,
            operations_count=batch.operations_count if batch is not None else 0,
            operations=(
                list(batch.operations)
                if include_operations and batch is not None
                else None
            ),
            impacted_items=list(commit.impacted_items),
            impacted_summary=dict(commit.impacted_summary),
            semantic_diff_summary=dict(commit.semantic_diff_summary),
            error_code=commit.error_code,
            error_message=commit.error_message,
            history_recorded=commit.history_recorded,
        )


class RunView(BaseModel):
    """`MessageResponse.run` / `continue` / `cancel` / 409 bodies: no
    operations, no transcripts, no internal cursors."""

    run_id: str
    trace_id: str
    status: RunStatus
    phase: RunPhase
    next: RunNext
    checkpoint: CheckpointKind | None = None
    step: int = 0
    scope: SessionScope
    focus_roadmap_ids: list[str] = Field(default_factory=list)
    refs: list[ResolvedRef] = Field(default_factory=list)
    batches: list[RunBatchView] = Field(default_factory=list)
    commits: list[RunCommitView] = Field(default_factory=list)
    verify: VerifyReport | None = None
    error: RunError | None = None
    created_at: datetime
    updated_at: datetime
