"""Run lifecycle: constructors, transition mutators, the checkpoint policy
(D4) and the wire projections.

A run is the server-side state machine one user message drives
(``investigate -> propose -> await_user -> execute -> verify ->
done|failed|cancelled``). It lives in ``session.metadata.run``; finished runs
leave a compact ``RunSummary`` in ``metadata.run_history`` (last 5).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import (
    ContextRef,
    RunBatch,
    RunBatchView,
    RunCommit,
    RunCommitView,
    RunError,
    RunSegment,
    RunState,
    RunSummary,
    RunView,
    TERMINAL_RUN_STATUSES,
)
from app.core.contracts.sessions import AgentSession

MAX_RUN_HISTORY = 5

# Checkpoint-policy reasons (telemetry + the proposal card).
DECISION_EXECUTE = 'execute'
DECISION_PROPOSE = 'propose'


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def touch(run: RunState) -> None:
    run.updated_at = _utcnow()


# ---------------------------------------------------------------------------
# Constructors / segments
# ---------------------------------------------------------------------------


def new_run(
    session: AgentSession,
    *,
    trace_id: str,
    user_message: str,
    raw_user_message: str = '',
    refs: list[ContextRef] | None = None,
    phase: str = 'investigate',
    plan_id: str | None = None,
) -> RunState:
    """A fresh run in ``investigate`` (or the given phase) with its first
    segment open on ``trace_id``. The scope roadmap is the initial focus."""
    focus = session.scope.focus_roadmap_id
    run = RunState(
        trace_id=trace_id,
        scope=session.scope,
        user_message=user_message or '',
        raw_user_message=raw_user_message or user_message or '',
        refs=list(refs or []),
        focus_roadmap_ids=[focus] if focus else [],
        phase=phase,  # type: ignore[arg-type]
        plan_id=plan_id,
    )
    run.segments.append(RunSegment(trace_id=trace_id, from_phase=run.phase))
    return run


def start_segment(run: RunState, trace_id: str, *, from_phase: str | None = None) -> None:
    """Open a new segment (a checkpoint answer mints a new trace)."""
    phase = from_phase or run.phase
    run.trace_id = trace_id
    run.segments.append(RunSegment(trace_id=trace_id, from_phase=phase))  # type: ignore[arg-type]
    touch(run)


def current_segment(run: RunState) -> RunSegment | None:
    return run.segments[-1] if run.segments else None


def end_segment(run: RunState, ended_with: str) -> bool:
    """Close the open segment; False when it was already closed."""
    segment = current_segment(run)
    if segment is None or segment.ended_at is not None:
        return False
    segment.ended_at = _utcnow()
    segment.ended_with = ended_with
    touch(run)
    return True


def segment_is_open(run: RunState) -> bool:
    segment = current_segment(run)
    return segment is not None and segment.ended_at is None


# ---------------------------------------------------------------------------
# Transition mutators
# ---------------------------------------------------------------------------


def set_running(run: RunState, phase: str | None = None) -> None:
    run.status = 'running'
    run.next = 'continue'
    run.checkpoint = None
    if phase is not None:
        run.phase = phase  # type: ignore[assignment]
    touch(run)


def set_awaiting(
    run: RunState,
    checkpoint: str,
    *,
    clarifier: dict[str, Any] | None = None,
    plan_id: str | None = None,
    asked_in_phase: str | None = None,
) -> None:
    run.status = 'awaiting_user'
    run.next = 'await_user'
    run.checkpoint = checkpoint  # type: ignore[assignment]
    run.clarifier = clarifier
    if plan_id is not None:
        run.plan_id = plan_id
    if asked_in_phase is not None:
        run.asked_in_phase = asked_in_phase  # type: ignore[assignment]
    touch(run)


def set_done(run: RunState, final_message: str | None = None) -> None:
    run.status = 'done'
    run.next = 'done'
    run.checkpoint = None
    if final_message is not None:
        run.final_message = final_message
    touch(run)


def set_failed(run: RunState, code: str, message: str = '', *, final_message: str | None = None) -> None:
    run.status = 'failed'
    run.next = 'done'
    run.checkpoint = None
    run.error = RunError(code=code, message=message or '')
    if final_message is not None:
        run.final_message = final_message
    touch(run)


def set_cancelled(run: RunState, reason: str, *, final_message: str | None = None) -> None:
    run.status = 'cancelled'
    run.next = 'done'
    run.checkpoint = None
    run.cancel_requested = True
    run.error = RunError(code=reason, message='')
    if final_message is not None:
        run.final_message = final_message
    touch(run)


def set_continue(run: RunState) -> None:
    """The step must return to the client; the run stays running."""
    run.status = 'running'
    run.next = 'continue'
    run.checkpoint = None
    touch(run)


def is_terminal(run: RunState | None) -> bool:
    return run is not None and run.status in TERMINAL_RUN_STATUSES


def archive_run(session: AgentSession, run: RunState) -> None:
    """Record a finished run in ``run_history`` (last 5, newest first)."""
    summary = RunSummary.from_state(run, ended_at=run.updated_at)
    history = [entry for entry in session.metadata.run_history if entry.run_id != run.run_id]
    session.metadata.run_history = [summary, *history][:MAX_RUN_HISTORY]


# ---------------------------------------------------------------------------
# Batches / commits
# ---------------------------------------------------------------------------


def batch_by_id(run: RunState, batch_id: str) -> RunBatch | None:
    for batch in run.batches:
        if batch.batch_id == batch_id:
            return batch
    return None


def commit_for_batch(run: RunState, batch_id: str) -> RunCommit | None:
    for commit in run.commits:
        if commit.batch_id == batch_id:
            return commit
    return None


def ensure_commit_records(run: RunState) -> list[RunCommit]:
    """One pending ``RunCommit`` per batch that has none yet (created before
    any network call so a crash can never lose an idempotency key)."""
    created: list[RunCommit] = []
    known = {commit.batch_id for commit in run.commits}
    for batch in run.batches:
        if batch.batch_id in known:
            continue
        commit = RunCommit(
            batch_id=batch.batch_id,
            roadmap_id=batch.roadmap_id,
            operations_hash=batch.operations_hash,
        )
        run.commits.append(commit)
        created.append(commit)
    return created


def has_pending_commits(run: RunState | None) -> bool:
    if run is None:
        return False
    return any(commit.status == 'pending' for commit in run.commits)


def committed_batch_ids(run: RunState) -> set[str]:
    return {commit.batch_id for commit in run.commits if commit.status == 'committed'}


# ---------------------------------------------------------------------------
# Checkpoint policy (D4)
# ---------------------------------------------------------------------------


def checkpoint_decision(
    session: AgentSession, batches: list[RunBatch], settings: Any
) -> tuple[str, str]:
    """``(decision, reason)`` for a set of ``stage_edits`` batches.

    Roadmap scope: a batch on the FOCUS roadmap executes immediately up to
    ``AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS`` ops, deletes included (today's
    in-roadmap behaviour). Any non-focus batch, any multi-roadmap response,
    and every workspace-scope batch that deletes, exceeds
    ``AGENT_DIRECT_EDIT_MAX_OPERATIONS`` ops or targets more than one roadmap
    becomes an ``edits`` proposal. Reverts never reach this function.
    """
    if not batches:
        return DECISION_EXECUTE, 'no_batches'
    roadmap_ids = {batch.roadmap_id for batch in batches}
    if len(roadmap_ids) > 1:
        return DECISION_PROPOSE, 'multi_roadmap'
    batch = batches[0]
    total_ops = sum(len(item.operations) for item in batches)
    contains_delete = any(item.contains_delete for item in batches)
    focus = session.scope.focus_roadmap_id
    if session.scope.kind == 'roadmap':
        if batch.roadmap_id != focus:
            return DECISION_PROPOSE, 'non_focus_roadmap'
        cap = int(getattr(settings, 'agent_direct_edit_max_operations_focus', 90))
        if total_ops > cap:
            return DECISION_PROPOSE, 'too_many_operations'
        return DECISION_EXECUTE, 'focus_roadmap'
    if contains_delete:
        return DECISION_PROPOSE, 'contains_delete'
    cap = int(getattr(settings, 'agent_direct_edit_max_operations', 15))
    if total_ops > cap:
        return DECISION_PROPOSE, 'too_many_operations'
    return DECISION_EXECUTE, 'small_single_roadmap'


# ---------------------------------------------------------------------------
# Wire projections
# ---------------------------------------------------------------------------


def _project_id_for(session: AgentSession | None, roadmap_id: str) -> str | None:
    if session is None:
        return None
    context = session.metadata.roadmaps.get(roadmap_id)
    return context.project_id if context is not None else None


def commit_views(
    session: AgentSession | None,
    run: RunState,
    *,
    step_batch_ids: set[str] | frozenset[str] | None = None,
) -> list[RunCommitView]:
    """Cumulative commit views; ``operations`` only on this step's commits."""
    step_ids = set(step_batch_ids or ())
    views: list[RunCommitView] = []
    for commit in run.commits:
        batch = batch_by_id(run, commit.batch_id)
        views.append(
            RunCommitView.from_commit(
                commit,
                batch,
                project_id=_project_id_for(session, commit.roadmap_id),
                include_operations=commit.batch_id in step_ids,
            )
        )
    return views


def run_view(session: AgentSession | None, run: RunState) -> RunView:
    return RunView(
        run_id=run.run_id,
        trace_id=run.trace_id,
        status=run.status,
        phase=run.phase,
        next=run.next,
        checkpoint=run.checkpoint,
        step=run.step,
        scope=run.scope,
        focus_roadmap_ids=list(run.focus_roadmap_ids),
        refs=list(run.resolved_refs),
        batches=[RunBatchView.from_batch(batch) for batch in run.batches],
        commits=commit_views(session, run),
        verify=run.verify,
        error=run.error,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def run_view_payload(session: AgentSession | None, run: RunState | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return run_view(session, run).model_dump(mode='json', exclude_none=True)


def operations_of(batch: RunBatch | None) -> list[RoadmapOperation]:
    return list(batch.operations) if batch is not None else []
