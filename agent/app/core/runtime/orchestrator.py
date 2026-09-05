"""Run orchestration: one HTTP request = one ``step`` of a run.

``step()`` verifies the caller owns the session, takes the per-session run
lock, starts or resumes the run per the input table (plain message /
clarifier answer / plan answers / plan decision / continue), then
``advance()`` drives ``investigate -> (propose) -> execute -> verify`` through
the transition table until a checkpoint, a terminal, a pause, or the soft
step budget. ``finalize_step()`` maps the run onto the response envelope,
appends the user + assistant turns at segment end, and emits the
``run_step_completed`` trace event (``done`` = ``next != 'continue'``).

Legacy clients (no ``continue`` capability) run in sync mode: a paused
investigate fails the run with ``RUN_TIMEOUT`` and execute skips the batches
that do not fit the hard deadline instead of pausing.
"""

from __future__ import annotations

import contextvars
import logging
from time import perf_counter
from typing import Any

from fastapi import HTTPException

from app.core import trace
from app.core.contracts.runs import RunState
from app.core.contracts.sessions import AgentSession, CommitSummary
from app.core.engine import progress
from app.core.logging_utils import log_event
from app.core.memory.actor_context import (
    ensure_actor_context as ensure_actor_context_helper,
)
from app.core.memory.pending_plan_manager import clear_pending_plan
from app.core.runtime import runs, staging, terminal
from app.core.runtime.phases import execute, investigate, propose, verify
from app.core.runtime.results import PhaseOutcome, StepResult
from app.core.runtime.sentinels import RunInput
from app.core.runtime.service import (
    RuntimeService,
    StepContext,
    caller_matches_owner,
    session_not_found,
)
from app.core.runtime.summarizer import apply_pending_compaction
from app.core.trace_context import bind as bind_trace_context_values

logger = logging.getLogger(__name__)

CANCELLED_MESSAGE = 'Cancelled.'
REJECTED_MESSAGE = 'Cancelled the proposed plan.'
NO_PROPOSAL_MESSAGE = 'There is no proposal awaiting confirmation.'
RUN_TIMEOUT_MESSAGE = (
    'This took too long; the changes that already landed are listed below.'
)
RUN_STEP_LIMIT_MESSAGE = (
    "I couldn't finish that within the allowed number of steps. Please try a "
    'smaller request.'
)
RUN_STATE_LOST_MESSAGE = (
    'The run state was lost while it was being applied; check the roadmap and '
    'confirm the proposal again to apply anything that is still missing.'
)
RUN_ABANDONED_MESSAGE = 'The previous run was interrupted.'
DEFAULT_CHAT_MESSAGE = 'How can I help with your roadmap?'
PROPOSAL_RETRY_LIMIT = 1


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def run_in_progress(session: AgentSession | None, run: RunState | None) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            'code': 'RUN_IN_PROGRESS',
            'message': 'A run is already in progress for this session.',
            'run': runs.run_view_payload(session, run),
        },
    )


def run_not_found(run_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={'code': 'RUN_NOT_FOUND', 'message': f'Run {run_id} was not found.'},
    )


def run_not_continuable(session: AgentSession, run: RunState) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            'code': 'RUN_NOT_CONTINUABLE',
            'message': f'Run {run.run_id} is {run.status} and cannot be continued.',
            'run': runs.run_view_payload(session, run),
        },
    )


# ---------------------------------------------------------------------------
# step
# ---------------------------------------------------------------------------


def step(
    ctx: StepContext,
    session: AgentSession,
    run_input: RunInput | None = None,
    *,
    continue_run_id: str | None = None,
) -> StepResult:
    # The trace-context binding a step makes (its trace id, the actor it
    # fetched) must not outlive the request: run the body in a copied
    # context so the caller's ContextVars are untouched.
    return contextvars.copy_context().run(
        _step, ctx, session, run_input, continue_run_id=continue_run_id
    )


def _step(
    ctx: StepContext,
    session: AgentSession,
    run_input: RunInput | None = None,
    *,
    continue_run_id: str | None = None,
) -> StepResult:
    if not caller_matches_owner(ctx.auth_header, session):
        raise session_not_found(session.session_id)
    settings = ctx.settings
    store = ctx.store
    token = store.acquire_run_lock(session.session_id, int(getattr(settings, 'agent_run_lock_ttl_seconds', 300)))
    if token is None:
        raise run_in_progress(session, session.metadata.run)
    run: RunState | None = None
    try:
        apply_pending_compaction(store, session, settings, ctx.trace_id)
        _ensure_actor_context(ctx, session)
        if run_input is not None:
            run = start_or_resume_from_input(ctx, session, run_input)
        else:
            run = resume_for_continue(ctx, session, continue_run_id or '')
        session.metadata.run = run
        ctx.bind_cancel_key(session.session_id, run.run_id)
        _activate_trace(ctx, session, run)
        if run.status == 'running':
            run.step += 1
            max_steps = int(getattr(settings, 'agent_run_max_steps', 8))
            if run.step > max_steps:
                runs.set_failed(run, 'RUN_STEP_LIMIT', 'Step limit reached.', final_message=RUN_STEP_LIMIT_MESSAGE)
            else:
                advance(ctx, session, run)
        return finalize_step(ctx, session, run)
    finally:
        try:
            trace.store.flush(ctx.trace_id)
            trace.store.end_active(ctx.trace_id)
        except Exception:  # noqa: BLE001 — never mask the step result
            logger.warning('trace flush failed trace_id=%s', ctx.trace_id, exc_info=True)
        try:
            store.release_run_lock(session.session_id, token)
        except Exception:  # noqa: BLE001 — the lock TTL is the backstop
            logger.warning('run lock release failed session_id=%s', session.session_id, exc_info=True)


def _activate_trace(ctx: StepContext, session: AgentSession, run: RunState) -> None:
    if ctx.trace_id != run.trace_id and run.trace_id:
        # A continue reuses the run's segment trace, whatever the request sent.
        ctx.trace_id = run.trace_id
    actor = session.metadata.actor_context
    bind_trace_context_values(
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        roadmap_id=session.scope.focus_roadmap_id,
        actor_id=actor.actor_id if actor is not None else None,
    )
    try:
        trace.store.activate(
            ctx.trace_id,
            session_id=session.session_id,
            roadmap_id=session.scope.focus_roadmap_id,
            user_id=actor.actor_id if actor is not None else None,
            owner_key=session.owner_key,
            run_id=run.run_id,
            phase=run.phase,
        )
    except Exception:  # noqa: BLE001 — tracing never fails a step
        logger.warning('trace activate failed trace_id=%s', ctx.trace_id, exc_info=True)


def _ensure_actor_context(ctx: StepContext, session: AgentSession) -> None:
    """Best-effort, once-per-session actor fetch (gives the model the actor id
    for "assign to me"-style edits). Cached on session.metadata thereafter."""
    if session.metadata.actor_context is not None or not ctx.auth_header:
        return
    try:
        ensure_actor_context_helper(
            session=session,
            auth_header=ctx.auth_header,
            trace_id=ctx.trace_id,
            nest_client=ctx.nest_client,
            run_async_call=ctx.run_async_call,
            logger=ctx.logger,
            settings=ctx.settings,
            actor_refresh_failures_key=ctx.service.actor_refresh_failures_key,
        )
    except Exception:  # pragma: no cover - actor context is best-effort
        pass


# ---------------------------------------------------------------------------
# Input table
# ---------------------------------------------------------------------------


def _log_run_started(ctx: StepContext, session: AgentSession, run: RunState) -> None:
    log_event(
        logger,
        'run_started',
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run.run_id,
        phase=run.phase,
        step=run.step,
        scope_kind=session.scope.kind,
        refs_count=len(run.refs),
    )


def _retire_existing(ctx: StepContext, session: AgentSession, existing: RunState | None) -> None:
    """Make room for a new run: an awaiting run is superseded, a crashed
    investigate is abandoned, a crashed execute with pending commits must be
    resumed first (409 RUN_IN_PROGRESS with next='continue')."""
    if existing is None:
        return
    if existing.status == 'awaiting_user':
        runs.set_cancelled(existing, 'superseded_by_new_message')
        runs.archive_run(session, existing)
        return
    if existing.status == 'running':
        if existing.phase == 'execute' and runs.has_pending_commits(existing):
            runs.set_continue(existing)
            ctx.persist(session)
            raise run_in_progress(session, existing)
        runs.set_failed(existing, 'RUN_ABANDONED', RUN_ABANDONED_MESSAGE)
        runs.archive_run(session, existing)
        return
    if runs.is_terminal(existing) and not any(
        entry.run_id == existing.run_id for entry in session.metadata.run_history
    ):
        runs.archive_run(session, existing)


def start_or_resume_from_input(ctx: StepContext, session: AgentSession, run_input: RunInput) -> RunState:
    existing = session.metadata.run
    trace_id = ctx.trace_id
    if run_input.kind == 'plan_decision':
        if run_input.is_reject:
            return _reject_plan(ctx, session, existing, run_input)
        return _confirm_plan(ctx, session, existing, run_input)

    if (
        run_input.kind == 'clarifier_answer'
        and existing is not None
        and existing.status == 'awaiting_user'
        and existing.checkpoint == 'clarifier'
    ):
        phase = existing.asked_in_phase or 'investigate'
        runs.start_segment(existing, trace_id, from_phase=phase)
        existing.user_message = run_input.text
        existing.raw_user_message = run_input.raw or run_input.text
        if run_input.refs:
            existing.refs = list(run_input.refs)
            existing.resolved_refs = []
        existing.clarifier = None
        runs.set_running(existing, phase)
        return existing

    if run_input.kind == 'plan_answers' and existing is not None and existing.status == 'awaiting_user':
        runs.start_segment(existing, trace_id, from_phase='investigate')
        existing.user_message = run_input.text
        existing.raw_user_message = run_input.raw or run_input.text
        existing.clarifier = None
        runs.set_running(existing, 'investigate')
        return existing

    # Plain message (a clarifier answer with no awaiting run behaves the same:
    # the model re-decides with the folded answer, as before runs existed).
    _retire_existing(ctx, session, existing)
    run = runs.new_run(
        session,
        trace_id=trace_id,
        user_message=run_input.text,
        raw_user_message=run_input.raw or run_input.text,
        refs=run_input.refs,
    )
    _log_run_started(ctx, session, run)
    return run


def _confirm_plan(ctx: StepContext, session: AgentSession, existing: RunState | None, run_input: RunInput) -> RunState:
    plan = execute.pending_plan_for_confirm(session)
    if plan is None:
        _retire_existing(ctx, session, existing)
        run = runs.new_run(session, trace_id=ctx.trace_id, user_message=run_input.text, raw_user_message=run_input.raw)
        runs.set_done(run, NO_PROPOSAL_MESSAGE)
        ctx.no_model_call = True
        ctx.intent_hint = 'confirm_action'
        return run
    if (
        existing is not None
        and existing.status == 'awaiting_user'
        and existing.checkpoint == 'proposal'
        and (existing.plan_id is None or existing.plan_id == plan.plan_id)
    ):
        run = existing
        runs.start_segment(run, ctx.trace_id, from_phase='execute')
        run.user_message = run_input.text
        run.raw_user_message = run_input.raw or run_input.text
        run.batches = []
        run.execute_cursor = 0
        run.plan_id = plan.plan_id
        runs.set_running(run, 'execute')
        return run
    _retire_existing(ctx, session, existing)
    run = runs.new_run(
        session,
        trace_id=ctx.trace_id,
        user_message=run_input.text,
        raw_user_message=run_input.raw,
        refs=run_input.refs,
        phase='execute',
        plan_id=plan.plan_id,
    )
    _log_run_started(ctx, session, run)
    return run


def _reject_plan(ctx: StepContext, session: AgentSession, existing: RunState | None, run_input: RunInput) -> RunState:
    clear_pending_plan(
        session,
        reason='user_rejected',
        logger=ctx.logger,
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        final_status='discarded',
    )
    ctx.no_model_call = True
    ctx.intent_hint = 'confirm_action'
    if existing is not None and existing.status == 'awaiting_user':
        run = existing
        runs.start_segment(run, ctx.trace_id)
        run.user_message = run_input.text
        run.raw_user_message = run_input.raw or run_input.text
        runs.set_cancelled(run, 'user_rejected', final_message=REJECTED_MESSAGE)
        return run
    _retire_existing(ctx, session, existing)
    run = runs.new_run(session, trace_id=ctx.trace_id, user_message=run_input.text, raw_user_message=run_input.raw)
    runs.set_cancelled(run, 'user_rejected', final_message=REJECTED_MESSAGE)
    return run


def resume_for_continue(ctx: StepContext, session: AgentSession, run_id: str) -> RunState:
    run = session.metadata.run
    if run is None or run.run_id != run_id:
        raise run_not_found(run_id)
    if not (run.status == 'running' and run.next == 'continue'):
        raise run_not_continuable(session, run)
    if run.batches_truncated and run.phase == 'execute' and runs.has_pending_commits(run):
        execute.skip_remaining(run, 'RUN_STATE_LOST', RUN_STATE_LOST_MESSAGE)
        runs.set_failed(run, 'RUN_STATE_LOST', RUN_STATE_LOST_MESSAGE, final_message=RUN_STATE_LOST_MESSAGE)
    return run


# ---------------------------------------------------------------------------
# advance + transitions
# ---------------------------------------------------------------------------


def _cancel_pending(ctx: StepContext, run: RunState) -> bool:
    return bool(run.cancel_requested) or ctx.should_stop()


def _cancel_run(ctx: StepContext, session: AgentSession, run: RunState, reason: str) -> None:
    clear_pending_plan(
        session,
        reason='user_cancelled',
        logger=ctx.logger,
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        final_status='discarded',
    )
    if run.loop_transcript_key:
        ctx.delete_transcript(run.loop_transcript_key)
        run.loop_transcript_key = None
    runs.set_cancelled(run, reason, final_message=CANCELLED_MESSAGE)


def advance(ctx: StepContext, session: AgentSession, run: RunState) -> None:
    while run.status == 'running':
        if run.phase in {'investigate', 'propose'} and _cancel_pending(ctx, run):
            _cancel_run(ctx, session, run, 'user_cancelled')
            break
        log_event(
            logger,
            'phase_entered',
            settings=ctx.settings,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run.run_id,
            phase=run.phase,
            step=run.step,
        )
        if run.phase == 'investigate':
            outcome = investigate.run(ctx, session, run)
        elif run.phase == 'execute':
            outcome = execute.run(ctx, session, run)
        elif run.phase == 'verify':
            outcome = verify.run(ctx, session, run)
        else:
            outcome = PhaseOutcome(kind='error', error={'code': 'INVALID_PHASE', 'message': run.phase})
        log_event(
            logger,
            'phase_completed',
            settings=ctx.settings,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run.run_id,
            phase=run.phase,
            step=run.step,
            outcome=outcome.kind,
        )
        apply_transition(ctx, session, run, outcome)
        ctx.persist(session)
        if run.status != 'running':
            break
        if run.next == 'continue' and outcome.kind == 'paused':
            break
        if run.next == 'continue' and not ctx.sync_mode and ctx.past_soft_budget():
            break


def apply_transition(ctx: StepContext, session: AgentSession, run: RunState, outcome: PhaseOutcome) -> None:
    kind = outcome.kind
    phase = run.phase
    ctx.last_outcome_kind = kind
    if outcome.loop is not None and getattr(outcome.loop, 'used_read_tools', False):
        ctx.chat_used_read_tools = True

    if kind == 'error':
        error = outcome.error or {}
        code = str(error.get('code') or 'provider_error')
        message = str(error.get('message') or '')
        if code in {'PROPOSAL_TARGET_REQUIRED', 'PROPOSAL_TARGET_INACCESSIBLE', 'PROPOSAL_INVALID'}:
            _retry_investigate_or_fail(ctx, session, run, code, message)
            return
        runs.set_failed(run, code, message, final_message=outcome.assistant_message or terminal.PROVIDER_FAILURE_MESSAGE)
        ctx.provider_used = 'rule_based'
        ctx.fallback_used = True
        ctx.provider_error_code = 'v2_provider_error'
        return
    if kind == 'cancelled':
        _cancel_run(ctx, session, run, 'user_cancelled')
        return
    if kind == 'paused':
        if ctx.sync_mode:
            runs.set_failed(run, 'RUN_TIMEOUT', 'The request ran out of time.', final_message=RUN_TIMEOUT_MESSAGE)
        else:
            runs.set_continue(run)
        return

    if phase == 'investigate':
        if kind == 'chat':
            runs.set_done(run, outcome.assistant_message or DEFAULT_CHAT_MESSAGE)
        elif kind == 'clarifier':
            card = terminal.build_clarifier_card(outcome.clarifier)
            message = outcome.assistant_message or (str(card.get('question') or '') if card else '')
            runs.set_awaiting(run, 'clarifier', clarifier=card, asked_in_phase='investigate')
            run.final_message = message
            ctx.clarifier_card = card
            log_event(
                logger,
                'run_checkpoint',
                settings=ctx.settings,
                trace_id=ctx.trace_id,
                session_id=session.session_id,
                run_id=run.run_id,
                phase='investigate',
                checkpoint='clarifier',
            )
        elif kind == 'budget':
            ctx.clarifier_card = terminal.budget_clarifier_card()
            runs.set_done(run, terminal.BUDGET_MESSAGE)
        elif kind == 'proposal':
            _propose(ctx, session, run, outcome)
        elif kind == 'batches':
            decision, reason = runs.checkpoint_decision(session, outcome.batches, ctx.settings)
            log_event(
                logger,
                'checkpoint_policy',
                settings=ctx.settings,
                trace_id=ctx.trace_id,
                session_id=session.session_id,
                run_id=run.run_id,
                decision=decision,
                reason=reason,
                batches=len(outcome.batches),
                operations=sum(len(batch.operations) for batch in outcome.batches),
            )
            if decision == runs.DECISION_EXECUTE:
                _stage(ctx, session, run, outcome.batches, 'stage_edits')
                runs.set_running(run, 'execute')
            else:
                _propose(ctx, session, run, outcome)
        elif kind == 'revert':
            _stage(ctx, session, run, outcome.batches, 'revert')
            runs.set_running(run, 'execute')
        else:
            runs.set_done(run, outcome.assistant_message or DEFAULT_CHAT_MESSAGE)
        return

    if phase == 'execute':
        if kind == 'executed':
            if outcome.cancelled:
                run.cancel_requested = True
            runs.set_running(run, 'verify')
        else:
            runs.set_failed(run, 'EXECUTE_FAILED', outcome.assistant_message or '')
        return

    if phase == 'verify':
        ctx.verify_reported = True
        if kind == 'verified' and outcome.proposal_payload is not None and session.metadata.pending_plan is not None:
            ctx.proposal_payload = outcome.proposal_payload
            ctx.intent_hint = outcome.intent_type or 'roadmap_plan'
            runs.set_awaiting(run, 'proposal', plan_id=session.metadata.pending_plan.plan_id)
            run.final_message = outcome.assistant_message
            return
        if run.cancel_requested:
            runs.set_cancelled(run, 'user_cancelled', final_message=outcome.assistant_message or CANCELLED_MESSAGE)
            return
        runs.set_done(run, outcome.assistant_message)
        return

    runs.set_failed(run, 'INVALID_PHASE', phase)


def _propose(ctx: StepContext, session: AgentSession, run: RunState, outcome: PhaseOutcome) -> None:
    run.phase = 'propose'
    result = propose.run(ctx, session, run, outcome)
    if result.kind == 'proposal':
        ctx.proposal_payload = result.proposal_payload
        ctx.intent_hint = result.intent_type
        runs.set_awaiting(run, 'proposal', plan_id=run.plan_id)
        run.phase = 'propose'
        run.final_message = result.assistant_message
        return
    if result.kind == 'chat':
        runs.set_done(run, result.assistant_message)
        return
    error = result.error or {}
    _retry_investigate_or_fail(ctx, session, run, str(error.get('code') or 'PROPOSAL_INVALID'), str(error.get('message') or ''))


def _retry_investigate_or_fail(ctx: StepContext, session: AgentSession, run: RunState, code: str, message: str) -> None:
    retries = int(getattr(run, 'proposal_retries', 0) or 0)
    if retries < PROPOSAL_RETRY_LIMIT:
        try:
            run.proposal_retries = retries + 1
        except Exception:  # noqa: BLE001
            pass
        investigate.set_feedback_note(run, f'Your previous proposal was rejected ({code}): {message}')
        runs.set_running(run, 'investigate')
        return
    runs.set_done(run, f"I couldn't record that proposal: {message or code}")


def _stage(ctx: StepContext, session: AgentSession, run: RunState, batches: list[Any], source: str) -> None:
    for batch in batches:
        result = staging.stage_batch(
            session,
            run,
            roadmap_id=batch.roadmap_id,
            operations=list(batch.operations),
            assistant_message=batch.assistant_message,
            source=source,
            roadmap_title=batch.roadmap_title,
        )
        if result.batch is None:
            continue
        ctx.step_batch_ids.add(result.batch.batch_id)
        if batch.roadmap_id not in run.focus_roadmap_ids:
            run.focus_roadmap_ids.append(batch.roadmap_id)
        try:
            ctx.service.record_recent_targets_from_operations(
                session=session,
                operations=result.added,
                source='staged_operations',
                roadmap_id=batch.roadmap_id,
            )
        except Exception:  # pragma: no cover - telemetry best-effort
            pass


# ---------------------------------------------------------------------------
# finalize
# ---------------------------------------------------------------------------


def _modes(ctx: StepContext, run: RunState, any_commit: bool) -> tuple[str, str, str]:
    """(response_mode, parse_mode, intent_type)."""
    if run.status == 'running':
        return 'chat', 'run_step', 'unclear'
    if run.checkpoint == 'proposal' and ctx.proposal_payload is not None:
        return 'plan_proposal', 'plan_proposal', ctx.intent_hint or 'roadmap_plan'
    if run.checkpoint == 'clarifier':
        return 'chat', 'clarifier', 'roadmap_edit'
    if ctx.clarifier_card is not None:
        return 'chat', 'clarifier', 'unclear'
    if any_commit:
        return 'edit_plan', ('run_report' if ctx.verify_reported else 'edit_plan'), 'roadmap_edit'
    if ctx.verify_reported:
        return 'chat', 'run_report', 'roadmap_edit'
    if ctx.intent_hint == 'confirm_action':
        return 'chat', 'chat', 'confirm_action'
    if run.status == 'cancelled':
        return 'chat', 'chat', 'unclear'
    if run.status == 'failed':
        return 'chat', 'chat', 'general_question'
    if ctx.chat_used_read_tools:
        return 'chat', 'context_answer', 'roadmap_query'
    return 'chat', 'chat', 'general_question'


def finalize_step(ctx: StepContext, session: AgentSession, run: RunState, *, started_at: float | None = None) -> StepResult:
    settings = ctx.settings
    segment_ended = run.status != 'running'
    assistant_message = '' if run.status == 'running' else (run.final_message or '')

    step_commit_ids = set(ctx.step_commit_batch_ids)
    step_commits = [c for c in run.commits if c.batch_id in step_commit_ids]
    any_commit = bool(step_commits)
    response_mode, parse_mode, intent_type = _modes(ctx, run, any_commit)

    focus = session.scope.focus_roadmap_id
    focus_commit = next((c for c in step_commits if c.roadmap_id == focus), None) if focus else None
    focus_batch = runs.batch_by_id(run, focus_commit.batch_id) if focus_commit is not None else None
    operations = list(focus_batch.operations) if focus_batch is not None else []
    commit_summary = None
    if focus_commit is not None:
        commit_summary = CommitSummary(
            committed=focus_commit.status == 'committed',
            change_id=focus_commit.change_id,
            semantic_diff_summary=dict(focus_commit.semantic_diff_summary),
            impacted_items=list(focus_commit.impacted_items),
            impacted_summary=dict(focus_commit.impacted_summary),
            error_code=focus_commit.error_code if focus_commit.status != 'committed' else None,
            error_message=focus_commit.error_message if focus_commit.status != 'committed' else None,
        )

    step_batch_ids = set(ctx.step_batch_ids) | step_commit_ids
    staged_count = sum(len(batch.operations) for batch in run.batches if batch.batch_id in step_batch_ids)

    if segment_ended:
        if runs.segment_is_open(run):
            runs.end_segment(run, ended_with=run.checkpoint or run.status)
            # The user turn (folded text) and the assistant turn land together
            # at segment end — never at run start, which would duplicate the
            # user turn in the next step's prompt.
            ctx.store.append_message(session, 'user', run.user_message)
            ctx.store.append_message(session, 'assistant', assistant_message)
        if runs.is_terminal(run):
            runs.archive_run(session, run)
    session.last_intent_type = intent_type  # type: ignore[assignment]
    session.metadata.run = run
    ctx.persist(session)

    route_lane = f'run_{run.phase}_{ctx.last_outcome_kind or run.status}'
    ctx.route_lane = route_lane
    progress.route_selected(
        settings,
        ctx.trace_id,
        route_lane=route_lane,
        response_mode=response_mode,
        turns=ctx.loop_turns,
        tool_calls_used=0,
        termination_reason=ctx.loop_termination_reason or run.status,
    )
    log_event(
        logger,
        'session_staged_state',
        settings=settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        roadmap_id=focus,
        run_id=run.run_id,
        staged_operations_count=staged_count,
        staged_operations_version=session.staged_operations_version,
        response_mode=response_mode,
        intent_type=intent_type,
        route_lane=route_lane,
        react_loop_turns=ctx.loop_turns,
        react_loop_termination_reason=ctx.loop_termination_reason,
        preview_available=staged_count > 0,
    )
    elapsed_ms = int((perf_counter() - started_at) * 1000) if started_at is not None else int(ctx.elapsed() * 1000)
    log_event(
        logger,
        'run_step_completed',
        settings=settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run.run_id,
        phase=run.phase,
        step=run.step,
        run_next=run.next,
        run_status=run.status,
        checkpoint=run.checkpoint,
        elapsed_ms=elapsed_ms,
    )

    clarifier_card = run.clarifier if run.checkpoint == 'clarifier' else ctx.clarifier_card
    return StepResult(
        session=session,
        run=run,
        assistant_message=assistant_message,
        parse_mode=parse_mode,
        intent_type=intent_type,  # type: ignore[arg-type]
        response_mode=response_mode,
        operations=operations,
        staged_operations_version=int(session.staged_operations_version or 0),
        staged_operations_count=staged_count,
        plan_proposal_payload=ctx.proposal_payload if run.checkpoint == 'proposal' else None,
        clarifier_card=clarifier_card,
        commit_summary=commit_summary,
        commits=runs.commit_views(session, run, step_batch_ids=step_commit_ids),
        provider_used='rule_based' if ctx.no_model_call else ctx.provider_used,
        fallback_used=ctx.fallback_used,
        provider_error_code=ctx.provider_error_code,
        tokens_input=ctx.tokens['input'] or None,
        tokens_output=ctx.tokens['output'] or None,
        tokens_total=ctx.tokens['total'] or None,
        tokens_cached=ctx.tokens['cached'] or None,
        route_lane=route_lane,
        react_loop_turns=ctx.loop_turns or None,
        react_loop_budget=int(getattr(settings, 'agent_v2_max_turns', 8)),
        react_loop_termination_reason=ctx.loop_termination_reason,
        segment_ended=segment_ended,
    )


# ---------------------------------------------------------------------------
# cancel
# ---------------------------------------------------------------------------


def request_cancel(service: RuntimeService, session: AgentSession, run_id: str, *, auth_header: str | None, trace_id: str | None = None) -> RunState:
    """Flag the run for cancellation (side key + run field) and, when no
    request holds the lock, finalize the cancel synchronously."""
    if not caller_matches_owner(auth_header, session):
        raise session_not_found(session.session_id)
    run = session.metadata.run
    if run is None or run.run_id != run_id:
        raise run_not_found(run_id)
    if runs.is_terminal(run):
        return run
    store = service.store
    settings = service.settings
    ttl = int(getattr(settings, 'agent_run_transcript_ttl_seconds', 900))
    try:
        store.put_side_key(store.run_key(session.session_id, run_id, 'cancel'), 1, ttl)
    except Exception:  # noqa: BLE001 — the run field below is the fallback signal
        logger.warning('cancel side key failed session_id=%s run_id=%s', session.session_id, run_id)
    token = store.acquire_run_lock(session.session_id, int(getattr(settings, 'agent_run_lock_ttl_seconds', 300)))
    if token is None:
        # A step holds the lock: it observes the side key between turns,
        # phases and batches and finalizes the cancel itself.
        return run
    try:
        fresh = store.get(session.session_id) or session
        run = fresh.metadata.run
        if run is None or run.run_id != run_id or runs.is_terminal(run):
            return run if run is not None else session.metadata.run  # type: ignore[return-value]
        run.cancel_requested = True
        if run.phase == 'execute' and runs.has_pending_commits(run):
            execute.skip_remaining(run, 'CANCELLED', execute.SKIPPED_CANCELLED_MESSAGE)
            run.verify = verify.deterministic_report(fresh, run)
        else:
            clear_pending_plan(
                fresh,
                reason='user_cancelled',
                logger=service.logger,
                settings=settings,
                trace_id=trace_id,
                final_status='discarded',
            )
        if run.loop_transcript_key:
            try:
                store.delete_side_key(run.loop_transcript_key)
            except Exception:  # noqa: BLE001
                pass
            run.loop_transcript_key = None
        runs.set_cancelled(run, 'user_cancelled', final_message=CANCELLED_MESSAGE)
        if runs.segment_is_open(run):
            runs.end_segment(run, ended_with='cancelled')
            store.append_message(fresh, 'user', run.user_message)
            store.append_message(fresh, 'assistant', CANCELLED_MESSAGE)
        runs.archive_run(fresh, run)
        fresh.metadata.run = run
        store.update(fresh)
        session.metadata = fresh.metadata
        session.messages = fresh.messages
        return run
    finally:
        try:
            store.release_run_lock(session.session_id, token)
        except Exception:  # noqa: BLE001
            pass
