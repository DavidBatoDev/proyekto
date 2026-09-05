"""Execute phase: one independent commit per roadmap batch.

On confirm the batches are re-created from ``pending_plan.targets`` (skipping
targets already committed) with one pending ``RunCommit`` (own idempotency
key) per batch persisted BEFORE any network call. Per batch, gated on
``elapsed + BATCH_RESERVE <= HARD_DEADLINE``:

1. refresh the roadmap overview when invalidated (fresh revision token);
2. materialize ``kind='plan'`` targets (a mini loop pinned to that roadmap,
   deadline = hard deadline - reserve; a pause saves its transcript);
3. re-check every referenced node belongs to the batch's roadmap;
4. preview — only for proposal / materialized / revert batches — with one
   repair iteration on error-severity validation issues and one
   STALE_REVISION re-preview (direct-edit batches commit directly, as today);
5. commit with the retry policy ported verbatim from the old auto-commit:
   STALE_REVISION -> refresh token + retry once (same key), transient
   5xx/408/429 -> sleep 1s + retry once, 400 enriched with the first invalid
   operation. The idempotency key is reused only while the operations hash is
   unchanged (a repair / re-materialize mints a fresh key).

Each batch's network sequence runs under one ``asyncio.run`` so the httpx
client is reused within the batch. Progress is persisted after every commit;
a failure never stops the next batch (verify reports partial).
"""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter
from typing import Any
from uuid import uuid4

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.errors import (
    extract_upstream_error_code,
    extract_upstream_error_details,
)
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import CommitImpactedItem, RunBatch, RunCommit
from app.core.contracts.sessions import AgentSession, PendingPlan
from app.core.engine.llm_client import LLMClient
from app.core.engine.loop import LoopResult, run_loop
from app.core.logging_utils import log_event
from app.core.memory.applied_changes_log import record_applied_changes_from_commit
from app.core.memory.pending_plan_manager import clear_pending_plan
from app.core.memory.recent_targets import prune_recent_targets_by_node_ids
from app.core.runtime import context_cache, runs, terminal
from app.core.runtime.handles import handle_map_for_roadmap, merged_handle_map, validate_batch_roadmap
from app.core.runtime.phases.investigate import escalated_effort
from app.core.runtime.prompt import (
    _pending_plan_outline,
    build_messages,
    render_phase_tail,
)
from app.core.runtime.results import PhaseOutcome
from app.core.runtime.tools import materialize_tools, repair_tools
from app.core.tools.dispatch import ToolDispatcher
from app.core.uuid_utils import is_uuid_like

logger = logging.getLogger(__name__)

SKIPPED_BUDGET_MESSAGE = (
    'Skipped: the request ran out of time before this roadmap could be committed. '
    'Confirm the proposal again to apply the remaining roadmaps.'
)
SKIPPED_CANCELLED_MESSAGE = 'Skipped: the run was cancelled.'
GENERIC_COMMIT_ERROR = 'The edit could not be applied to the roadmap.'

MATERIALIZE_INSTRUCTION = (
    'Apply the plan you proposed: stage the concrete roadmap operations '
    'to create it now.'
)


# ---------------------------------------------------------------------------
# Phase entry
# ---------------------------------------------------------------------------


def run(ctx: Any, session: AgentSession, run_state: Any) -> PhaseOutcome:
    ensure_batches_from_plan(session, run_state)
    if runs.ensure_commit_records(run_state) or not run_state.commits:
        # Keys exist before any network call: a crash can never lose one.
        ctx.persist(session)
    if _needs_resume_guard(run_state):
        apply_changes_guard(ctx, session, run_state)

    total = len(run_state.batches)
    cancelled = False
    while run_state.execute_cursor < total:
        index = run_state.execute_cursor
        batch = run_state.batches[index]
        commit = runs.commit_for_batch(run_state, batch.batch_id)
        if commit is None:
            commit = RunCommit(batch_id=batch.batch_id, roadmap_id=batch.roadmap_id, operations_hash=batch.operations_hash)
            run_state.commits.append(commit)
        if commit.status != 'pending':
            run_state.execute_cursor = index + 1
            continue
        if run_state.cancel_requested or ctx.should_stop():
            cancelled = True
            run_state.cancel_requested = True
            skip_remaining(run_state, 'CANCELLED', SKIPPED_CANCELLED_MESSAGE)
            break
        if not ctx.can_start_batch(batch):
            if ctx.sync_mode:
                skip_remaining(run_state, 'SKIPPED_BUDGET', SKIPPED_BUDGET_MESSAGE)
                break
            ctx.persist(session)
            return PhaseOutcome(kind='paused')
        _emit_phase_entered(ctx, session, run_state)
        status = execute_batch(ctx, session, run_state, batch, commit)
        if status == 'paused':
            ctx.persist(session)
            return PhaseOutcome(kind='paused')
        run_state.execute_cursor = index + 1
        # Progress after every commit.
        ctx.persist(session)
    finish_pending_plan(ctx, session, run_state)
    ctx.persist(session)
    return PhaseOutcome(kind='executed', cancelled=cancelled)


def _emit_phase_entered(ctx: Any, session: AgentSession, run_state: Any) -> None:
    done = sum(1 for commit in run_state.commits if commit.status != 'pending')
    log_event(
        logger,
        'phase_entered',
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        phase='execute',
        step=run_state.step,
        commits_done=done,
        commits_total=len(run_state.commits),
    )


# ---------------------------------------------------------------------------
# Batches from the pending plan (confirm)
# ---------------------------------------------------------------------------


def _plan_targets(session: AgentSession) -> list[Any]:
    plan = session.metadata.pending_plan
    if plan is None or plan.status != 'proposed':
        return []
    if plan.targets:
        return list(plan.targets)
    focus = session.scope.focus_roadmap_id
    if not focus:
        return []
    # Legacy single-roadmap plan: one target on the focus roadmap.
    context = session.metadata.roadmaps.get(focus)
    return [
        {
            'roadmap_id': focus,
            'roadmap_title': context.title if context is not None else None,
            'project_id': context.project_id if context is not None else None,
            'proposed_hierarchy': plan.proposed_hierarchy,
            'operations': None,
            'committed': False,
        }
    ]


def _target_field(target: Any, name: str, default: Any = None) -> Any:
    if isinstance(target, dict):
        return target.get(name, default)
    return getattr(target, name, default)


def ensure_batches_from_plan(session: AgentSession, run_state: Any) -> list[RunBatch]:
    """Materialize the pending plan's uncommitted targets into batches when
    the run has none (a confirm). ``kind='edits'`` targets carry operations;
    ``kind='plan'`` targets carry titles and get materialized per batch."""
    if run_state.batches or not run_state.plan_id:
        return []
    plan = session.metadata.pending_plan
    if plan is None or plan.status != 'proposed':
        return []
    created: list[RunBatch] = []
    for target in _plan_targets(session):
        if _target_field(target, 'committed'):
            continue
        roadmap_id = str(_target_field(target, 'roadmap_id') or '').strip()
        if not roadmap_id:
            continue
        raw_operations = _target_field(target, 'operations')
        operations: list[RoadmapOperation] = []
        if isinstance(raw_operations, list):
            for item in raw_operations:
                if isinstance(item, RoadmapOperation):
                    operations.append(item)
                elif isinstance(item, dict):
                    try:
                        operations.append(RoadmapOperation.model_validate(item))
                    except Exception:  # noqa: BLE001 — a malformed op fails the batch later
                        continue
        needs_materialize = plan.kind == 'plan' or not operations
        batch = RunBatch(
            roadmap_id=roadmap_id,
            roadmap_title=_target_field(target, 'roadmap_title'),
            operations=operations,
            assistant_message=plan.summary or '',
            source='proposal',
            needs_materialize=needs_materialize,
        )
        run_state.batches.append(batch)
        created.append(batch)
        if roadmap_id not in run_state.focus_roadmap_ids:
            run_state.focus_roadmap_ids.append(roadmap_id)
    run_state.execute_cursor = 0
    return created


def finish_pending_plan(ctx: Any, session: AgentSession, run_state: Any) -> None:
    """Flag committed targets; clear the plan only once every target landed
    (partial success keeps it so confirming again resumes the rest)."""
    plan = session.metadata.pending_plan
    if plan is None or plan.status != 'proposed':
        return
    if not any(batch.source == 'proposal' for batch in run_state.batches):
        return
    committed_roadmaps = {
        commit.roadmap_id for commit in run_state.commits if commit.status == 'committed'
    }
    if plan.targets:
        for target in plan.targets:
            if target.roadmap_id in committed_roadmaps:
                target.committed = True
        all_done = all(target.committed for target in plan.targets)
    else:
        focus = session.scope.focus_roadmap_id
        all_done = bool(focus) and focus in committed_roadmaps
    if all_done:
        clear_pending_plan(
            session,
            reason='confirm_committed',
            logger=ctx.logger,
            settings=ctx.settings,
            trace_id=ctx.trace_id,
            final_status='confirmed',
        )


def skip_remaining(run_state: Any, code: str, message: str) -> None:
    for commit in run_state.commits:
        if commit.status == 'pending':
            commit.status = 'skipped'
            commit.error_code = code
            commit.error_message = message
    run_state.execute_cursor = len(run_state.batches)


# ---------------------------------------------------------------------------
# Resume guard: which batches already landed (authoritative)
# ---------------------------------------------------------------------------


def _needs_resume_guard(run_state: Any) -> bool:
    return any(commit.status == 'pending' and commit.attempts > 0 for commit in run_state.commits)


def _rows_of(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ('changes', 'items', 'data', 'history'):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    return []


def apply_changes_guard(ctx: Any, session: AgentSession, run_state: Any) -> None:
    """``GET /ai/context/changes?run_id=`` — a batch whose roadmap already has
    an applied change for this run is marked committed (the first attempt
    landed even though the response was lost)."""
    if not ctx.auth_header:
        return
    try:
        payload = ctx.run_async_call(
            ctx.nest_client.ai_context_changes(ctx.auth_header, ctx.trace_id, run_id=run_state.run_id)
        )
    except Exception as exc:  # noqa: BLE001 — the idempotency key still protects the retry
        log_event(
            logger,
            'run_changes_guard_failed',
            settings=ctx.settings,
            level=logging.WARNING,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            error=type(exc).__name__,
        )
        return
    rows = [
        row
        for row in _rows_of(payload)
        if str(row.get('status') or 'applied').lower() == 'applied'
    ]
    claimed: set[int] = set()
    for commit in run_state.commits:
        if commit.status != 'pending' or commit.attempts <= 0:
            continue
        for index, row in enumerate(rows):
            if index in claimed or str(row.get('roadmap_id') or '') != commit.roadmap_id:
                continue
            claimed.add(index)
            commit.status = 'committed'
            change_id = row.get('change_id')
            commit.change_id = str(change_id).strip() if isinstance(change_id, str) and change_id.strip() else None
            token_after = row.get('revision_token_after')
            commit.revision_token_after = token_after if isinstance(token_after, str) else None
            semantic_diff = row.get('semantic_diff')
            summary = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else None
            commit.semantic_diff_summary = {k: v for k, v in summary.items() if isinstance(v, int)} if isinstance(summary, dict) else {}
            commit.history_recorded = True
            log_event(
                logger,
                'commit_completed',
                settings=ctx.settings,
                trace_id=ctx.trace_id,
                session_id=session.session_id,
                run_id=run_state.run_id,
                roadmap_id=commit.roadmap_id,
                batch_id=commit.batch_id,
                change_id=commit.change_id,
                history_recorded=True,
                source='changes_guard',
            )
            break


# ---------------------------------------------------------------------------
# One batch
# ---------------------------------------------------------------------------


def _fail(commit: RunCommit, code: str, message: str) -> str:
    commit.status = 'failed'
    commit.error_code = code
    commit.error_message = message
    return 'failed'


def _revision_before(run_state: Any) -> dict[str, str | None]:
    tokens = getattr(run_state, 'revision_before', None)
    if not isinstance(tokens, dict):
        tokens = {}
        try:
            run_state.revision_before = tokens
        except Exception:  # noqa: BLE001
            pass
    return tokens


def _note_repair(run_state: Any, batch_id: str) -> None:
    repairs = getattr(run_state, 'repairs', None)
    if not isinstance(repairs, dict):
        repairs = {}
    repairs[batch_id] = int(repairs.get(batch_id, 0) or 0) + 1
    try:
        run_state.repairs = repairs
    except Exception:  # noqa: BLE001
        pass


def execute_batch(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit) -> str:
    """'committed' | 'failed' | 'skipped' | 'paused'."""
    ctx.step_commit_batch_ids.add(batch.batch_id)
    if batch.needs_materialize:
        status = materialize(ctx, session, run_state, batch, commit)
        if status != 'ok':
            return status
    if not batch.operations:
        return _fail(commit, 'EMPTY_BATCH', 'There were no operations to apply.')
    mismatch = validate_batch_roadmap(
        batch.operations,
        batch.roadmap_id,
        merged_handle_map(session, run_state),
        recent_targets=session.metadata.recent_resolved_targets,
        roadmap_titles={rid: c.title for rid, c in session.metadata.roadmaps.items()},
        roadmap_prefixes={rid: c.handle_prefix for rid, c in session.metadata.roadmaps.items()},
    )
    if mismatch is not None:
        _fail(commit, 'HANDLE_ROADMAP_MISMATCH', mismatch)
        _after_failure(ctx, session, run_state, batch, commit)
        return 'failed'
    return ctx.run_async_call(_network_sequence(ctx, session, run_state, batch, commit))


# -- materialize -------------------------------------------------------------


def _plan_target_for(session: AgentSession, batch: RunBatch) -> Any:
    plan = session.metadata.pending_plan
    if plan is None:
        return None
    for target in plan.targets:
        if target.roadmap_id == batch.roadmap_id:
            return target
    return plan


def _target_block(session: AgentSession, batch: RunBatch, target: Any) -> str:
    context = session.metadata.roadmaps.get(batch.roadmap_id)
    prefix = context.handle_prefix if context is not None else None
    label = prefix or 'the focus roadmap'
    title = batch.roadmap_title or (context.title if context is not None else None) or 'Untitled roadmap'
    head = render_phase_tail('execute', roadmap_label=label, roadmap_title=title, roadmap_id=batch.roadmap_id)
    outline = (context.overview_summary or '').strip() if context is not None else ''
    hierarchy: list[Any] = []
    if target is not None:
        hierarchy = getattr(target, 'proposed_hierarchy', None) or []
    rendered = _pending_plan_outline(
        {
            'proposed_hierarchy': [
                epic.model_dump(mode='json', exclude_none=True) if hasattr(epic, 'model_dump') else epic
                for epic in hierarchy
            ]
        }
    )
    parts = [head]
    if outline:
        parts.append(f'# Target roadmap {label} "{title}"\n{outline}')
    parts.append('# Target\n' + (rendered or '(no items listed)'))
    return '\n\n'.join(parts)


def materialize(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit) -> str:
    """Titles -> operations for one proposal target via a mini loop pinned to
    that roadmap. 'ok' | 'paused' | 'failed' | 'skipped'."""
    settings = ctx.settings
    rid = batch.roadmap_id
    deps = ctx.cache_deps()
    focus = session.scope.focus_roadmap_id
    context = context_cache.load_roadmap(
        session=session, roadmap_id=rid, as_focus=(rid == focus), run=run_state, reason='materialize', **deps
    )
    if context is None and rid not in session.metadata.roadmaps:
        return _fail(commit, 'MATERIALIZE_FAILED', 'The target roadmap could not be loaded.')
    target = _plan_target_for(session, batch)
    turn_context = ctx.service.build_turn_context(session, ctx.auth_header, ctx.trace_id, run=run_state)
    turn_context['on_roadmap_loaded'] = context_cache.make_on_roadmap_loaded(
        session=session, run=run_state, settings=settings, logger=ctx.logger, trace_id=ctx.trace_id
    )
    transcript = ctx.get_transcript(batch.materialize_transcript_key) if batch.materialize_transcript_key else None
    messages = build_messages(
        session,
        run_state,
        turn_context,
        'investigate',
        user_message=MATERIALIZE_INSTRUCTION,
        transcript=transcript,
        extra_tail=_target_block(session, batch, target),
    )
    loop_settings = settings.model_copy(
        update={
            'agent_v2_max_turns': int(getattr(settings, 'agent_execute_max_turns', 4)),
            'agent_v2_max_tool_calls': int(getattr(settings, 'agent_execute_max_tool_calls', 10)),
        }
    )
    actor = session.metadata.actor_context
    actor_id = actor.actor_id if actor is not None else None
    client = LLMClient(settings, prompt_cache_key=f'roadmap:{rid}')
    dispatcher = ToolDispatcher(settings=settings, logger=ctx.logger, nest_client=ctx.nest_client)
    handler = terminal.for_materialize(
        session, run_state, rid, settings=settings, trace_id=ctx.trace_id, actor_id=actor_id, session_context=turn_context
    )
    effort = escalated_effort(settings, 'medium')
    reasoning_effort = effort if effort != settings.openai_v2_reasoning_effort else None
    if effort:
        run_state.reasoning_effort['execute'] = effort
    try:
        result = run_loop(
            client=client,
            messages=messages,
            tools=materialize_tools(session, rid),
            dispatcher=dispatcher,
            session_context=turn_context,
            handle_map=merged_handle_map(session, run_state),
            settings=loop_settings,
            trace_id=ctx.trace_id,
            actor_id=actor_id,
            reasoning_effort=reasoning_effort,
            terminal_handler=handler,
            deadline_monotonic=ctx.materialize_deadline_monotonic(),
            transcript=transcript,
            should_stop=ctx.should_stop,
        )
    except Exception as exc:  # noqa: BLE001 — provider failure fails the batch, not the run
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.ERROR,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            roadmap_id=rid,
            phase='execute',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        return _fail(commit, 'MATERIALIZE_FAILED', 'The model could not turn the proposal into operations.')
    ctx.add_loop_usage(result)
    usage = run_state.phase_usage.setdefault('execute', {'turns': 0, 'tool_calls': 0})
    usage['turns'] = int(usage.get('turns', 0) or 0) + int(result.turns or 0)
    usage['tool_calls'] = int(usage.get('tool_calls', 0) or 0) + int(result.tool_calls_used or 0)
    if result.kind == 'paused':
        key = ctx.transcript_key(session.session_id, run_state.run_id, f'materialize:{batch.batch_id}')
        if result.transcript and ctx.put_transcript(key, result.transcript):
            batch.materialize_transcript_key = key
        return 'paused'
    if result.kind == 'cancelled':
        commit.status = 'skipped'
        commit.error_code = 'CANCELLED'
        commit.error_message = SKIPPED_CANCELLED_MESSAGE
        return 'skipped'
    if batch.materialize_transcript_key:
        ctx.delete_transcript(batch.materialize_transcript_key)
        batch.materialize_transcript_key = None
    if result.kind != 'batches':
        return _fail(
            commit,
            'MATERIALIZE_FAILED',
            'The model did not stage operations for this roadmap'
            + (f' ({result.termination_reason}).' if result.termination_reason else '.'),
        )
    operations = [op for item in result.batches if item.roadmap_id == rid for op in item.operations]
    if not operations:
        return _fail(commit, 'MATERIALIZE_FAILED', 'The model staged no operations for this roadmap.')
    batch.operations = operations
    batch.needs_materialize = False
    batch.refresh_operations_hash()
    if result.assistant_message:
        batch.assistant_message = result.assistant_message
    try:
        ctx.service.record_recent_targets_from_operations(
            session=session, operations=operations, source='staged_operations', roadmap_id=rid
        )
    except Exception:  # pragma: no cover - telemetry best-effort
        pass
    return 'ok'


# -- network sequence ------------------------------------------------------------


def _is_stale_revision_409(exc: HTTPException) -> bool:
    if exc.status_code != 409:
        return False
    code = extract_upstream_error_code(exc.detail)
    if code == 'STALE_REVISION':
        return True
    if isinstance(exc.detail, dict):
        message = exc.detail.get('message')
        if isinstance(message, str) and 'revision token' in message.lower():
            return True
    return False


def _is_transient(exc: HTTPException) -> bool:
    return exc.status_code >= 500 or exc.status_code in {408, 429}


async def _refresh_revision_token_from_summary(ctx: Any, session: AgentSession, roadmap_id: str) -> str | None:
    try:
        payload = await ctx.nest_client.context_summary(
            roadmap_id=roadmap_id, preview_id=None, auth_header=ctx.auth_header, trace_id=ctx.trace_id
        )
    except Exception:  # noqa: BLE001 — refresh is best-effort
        return None
    if not isinstance(payload, dict):
        return None
    token = payload.get('revision_token')
    if isinstance(token, str) and token.strip():
        return token.strip()
    return None


async def _refresh_overview(ctx: Any, session: AgentSession, run_state: Any, roadmap_id: str) -> None:
    try:
        payload = await ctx.nest_client.context_summary(
            roadmap_id=roadmap_id, preview_id=None, auth_header=ctx.auth_header, trace_id=ctx.trace_id
        )
    except Exception:  # noqa: BLE001 — the commit's own token check is the guard
        return
    if isinstance(payload, dict) and not isinstance(payload.get('error'), dict):
        context_cache.register_roadmap_from_summary(
            session, roadmap_id, payload, as_focus=(roadmap_id == session.scope.focus_roadmap_id)
        )


def _tokens_for(session: AgentSession, roadmap_id: str) -> tuple[str | None, int | None]:
    context = session.metadata.roadmaps.get(roadmap_id)
    focus = session.scope.focus_roadmap_id
    token = context.revision_token if context is not None and context.revision_token else None
    base = context.base_revision if context is not None and context.base_revision is not None else None
    if roadmap_id == focus:
        token = token or session.revision_token
        base = base if base is not None else session.base_revision
    return token, base


def _set_token(session: AgentSession, roadmap_id: str, token: str | None) -> None:
    if not token:
        return
    context = session.metadata.roadmaps.get(roadmap_id)
    if context is not None:
        context.revision_token = token
    if roadmap_id == session.scope.focus_roadmap_id:
        session.revision_token = token


def _commit_payload(batch: RunBatch, commit: RunCommit, token: str | None, base: int | None) -> dict[str, Any]:
    return {
        'base_revision': base,
        'revision_token': token,
        'include_roadmap': False,
        'include_timeline': False,
        'idempotency_key': commit.idempotency_key,
        'operations': [operation.model_dump(exclude_none=True) for operation in batch.operations],
    }


def _sync_idempotency_key(batch: RunBatch, commit: RunCommit) -> None:
    """Reuse the key only while the operations are byte-identical: the backend
    replays on a hash match and answers IDEMPOTENCY_KEY_REUSED otherwise."""
    if batch.operations_hash is None:
        batch.refresh_operations_hash()
    if commit.operations_hash != batch.operations_hash:
        if commit.operations_hash is not None or commit.attempts > 0:
            commit.idempotency_key = str(uuid4())
        commit.operations_hash = batch.operations_hash


async def _network_sequence(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit) -> str:
    rid = batch.roadmap_id
    context = session.metadata.roadmaps.get(rid)
    if context is None or context.overview_fetched_at is None:
        await _refresh_overview(ctx, session, run_state, rid)
    token, base = _tokens_for(session, rid)
    _revision_before(run_state)[batch.batch_id] = token

    if batch.source in {'proposal', 'revert'}:
        preview = await _preview_with_repair(ctx, session, run_state, batch, commit, token, base)
        if preview.get('failed'):
            _fail(commit, str(preview.get('code') or 'VALIDATION_FAILED'), str(preview.get('message') or GENERIC_COMMIT_ERROR))
            _after_failure(ctx, session, run_state, batch, commit)
            return 'failed'
        if preview.get('token'):
            token = str(preview['token'])
            _set_token(session, rid, token)

    _sync_idempotency_key(batch, commit)
    started = perf_counter()
    try:
        commit_result = await _commit_with_retries(ctx, session, run_state, batch, commit, token, base)
    except HTTPException as exc:
        _record_commit_failure(ctx, session, run_state, batch, commit, exc)
        _after_failure(ctx, session, run_state, batch, commit)
        return 'failed'
    commit_ms = int((perf_counter() - started) * 1000)
    _apply_commit_success(ctx, session, run_state, batch, commit, commit_result, commit_ms)
    return 'committed'


async def _commit_once(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit, token: str | None, base: int | None) -> dict[str, Any]:
    commit.attempts += 1
    # `attempts` persisted before each call: a resume knows the key was used.
    ctx.persist(session)
    log_event(
        logger,
        'commit_started',
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        roadmap_id=batch.roadmap_id,
        roadmap_title=batch.roadmap_title,
        batch_id=batch.batch_id,
        operations_count=len(batch.operations),
        attempt=commit.attempts,
    )
    result = await ctx.nest_client.commit(
        batch.roadmap_id,
        _commit_payload(batch, commit, token, base),
        ctx.auth_header,
        ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
    )
    _log_commit_response_shape(commit_result=result, session_id=session.session_id, roadmap_id=batch.roadmap_id, trace_id=ctx.trace_id)
    return result


async def _commit_with_retries(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit, token: str | None, base: int | None) -> dict[str, Any]:
    rid = batch.roadmap_id
    try:
        return await _commit_once(ctx, session, run_state, batch, commit, token, base)
    except HTTPException as exc:
        if exc.status_code == 400:
            invalid_snapshot = _first_invalid_operation_snapshot(list(batch.operations))
            if invalid_snapshot is not None:
                enriched_detail: dict[str, Any]
                if isinstance(exc.detail, dict):
                    enriched_detail = dict(exc.detail)
                else:
                    enriched_detail = {'detail': exc.detail}
                enriched_detail['_auto_commit_invalid_operation'] = invalid_snapshot
                raise HTTPException(
                    status_code=exc.status_code,
                    detail=enriched_detail,
                    headers=getattr(exc, 'headers', None),
                ) from exc
            raise
        if _is_stale_revision_409(exc):
            # Defense-in-depth against cross-request revision drift (another
            # client commit, a backend-side updated_at bump that outran our
            # refresh). Re-fetch the authoritative token via the summary path
            # and retry the commit exactly once with the SAME idempotency key.
            stale_token = token
            fresh_token = await _refresh_revision_token_from_summary(ctx, session, rid)
            if fresh_token and fresh_token != stale_token:
                _set_token(session, rid, fresh_token)
                try:
                    result = await _commit_once(ctx, session, run_state, batch, commit, fresh_token, base)
                except HTTPException as retry_exc:
                    _log_stale_revision_retry(ctx, session, rid, stale_token, fresh_token, 'still_stale')
                    raise retry_exc from exc
                _log_stale_revision_retry(ctx, session, rid, stale_token, fresh_token, 'success')
                return result
            _log_stale_revision_retry(ctx, session, rid, stale_token, fresh_token, 'no_fresh_token')
            raise
        if _is_transient(exc):
            # Transient upstream failure. Safe to retry once because the
            # payload carries an idempotency key — if the first attempt
            # actually landed, the backend replays its stored result.
            log_event(
                logger,
                'auto_commit_transient_retry',
                settings=None,
                trace_id=ctx.trace_id,
                session_id=session.session_id,
                roadmap_id=rid,
                upstream_status=exc.status_code,
            )
            await asyncio.sleep(1.0)
            return await _commit_once(ctx, session, run_state, batch, commit, token, base)
        raise


def _log_stale_revision_retry(ctx: Any, session: AgentSession, roadmap_id: str, stale_token: str | None, fresh_token: str | None, retry_outcome: str) -> None:
    log_event(
        logger,
        'auto_commit_stale_revision_retry',
        settings=None,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        roadmap_id=roadmap_id,
        stale_token=stale_token,
        fresh_token=fresh_token,
        retry_outcome=retry_outcome,
    )


# -- preview + repair -----------------------------------------------------------


def _error_issues(payload: Any) -> list[dict[str, Any]]:
    issues = payload.get('validation_issues') if isinstance(payload, dict) else None
    if not isinstance(issues, list):
        return []
    return [
        issue
        for issue in issues
        if isinstance(issue, dict) and str(issue.get('severity') or 'error').lower() == 'error'
    ]


def _issues_from_exception(exc: HTTPException) -> list[dict[str, Any]]:
    detail = exc.detail
    queue: list[Any] = [detail]
    while queue:
        candidate = queue.pop(0)
        if not isinstance(candidate, dict):
            continue
        issues = _error_issues(candidate)
        if issues:
            return issues
        for key in ('detail', 'error'):
            nested = candidate.get(key)
            if isinstance(nested, dict):
                queue.append(nested)
    return []


async def _preview_once(ctx: Any, batch: RunBatch, token: str | None, base: int | None) -> dict[str, Any]:
    payload = {
        'operations': [operation.model_dump(exclude_none=True) for operation in batch.operations],
        'revision_token': token,
        'base_revision': base,
    }
    try:
        result = await ctx.nest_client.preview(batch.roadmap_id, payload, ctx.auth_header, ctx.trace_id)
    except HTTPException as exc:
        if exc.status_code == 400:
            issues = _issues_from_exception(exc)
            if issues:
                return {'issues': issues}
            details = extract_upstream_error_details(exc.detail)
            return {
                'failed': True,
                'code': details.get('code') or 'PREVIEW_FAILED',
                'message': details.get('message') or GENERIC_COMMIT_ERROR,
            }
        if _is_stale_revision_409(exc):
            return {'stale': True}
        details = extract_upstream_error_details(exc.detail)
        return {
            'failed': True,
            'code': details.get('code') or f'HTTP_{exc.status_code}',
            'message': details.get('message') or GENERIC_COMMIT_ERROR,
        }
    if not isinstance(result, dict):
        return {}
    issues = _error_issues(result)
    if issues:
        return {'issues': issues, 'token': result.get('revision_token')}
    token_after = result.get('revision_token')
    return {'token': token_after if isinstance(token_after, str) and token_after.strip() else None}


def _issues_text(issues: list[dict[str, Any]]) -> str:
    lines = []
    for issue in issues[:10]:
        path = issue.get('path')
        message = issue.get('message') or issue.get('code') or 'invalid operation'
        lines.append(f'- {path}: {message}' if path else f'- {message}')
    return '\n'.join(lines)


async def _preview_with_repair(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit, token: str | None, base: int | None) -> dict[str, Any]:
    rid = batch.roadmap_id
    result = await _preview_once(ctx, batch, token, base)
    if result.get('stale'):
        fresh = await _refresh_revision_token_from_summary(ctx, session, rid)
        if fresh:
            token = fresh
            _set_token(session, rid, fresh)
        result = await _preview_once(ctx, batch, token, base)
    if result.get('failed'):
        return result
    issues = result.get('issues') or []
    if not issues:
        return result
    repaired = _repair(ctx, session, run_state, batch, issues)
    if not repaired:
        return {
            'failed': True,
            'code': 'VALIDATION_FAILED',
            'message': str(issues[0].get('message') or GENERIC_COMMIT_ERROR),
        }
    result = await _preview_once(ctx, batch, token, base)
    if result.get('failed'):
        return result
    issues = result.get('issues') or []
    if issues:
        return {
            'failed': True,
            'code': 'VALIDATION_FAILED',
            'message': str(issues[0].get('message') or GENERIC_COMMIT_ERROR),
        }
    return result


def _repair(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, issues: list[dict[str, Any]]) -> bool:
    """One model turn (stage_edits pinned) with the preview issues as the
    error text. Replaces the batch operations on success."""
    settings = ctx.settings
    rid = batch.roadmap_id
    turn_context = ctx.service.build_turn_context(session, ctx.auth_header, ctx.trace_id, run=run_state)
    staged = [op.model_dump(mode='json', exclude_none=True) for op in batch.operations]
    extra_tail = (
        '# Run\nPhase: execute (repair). The staged operations below were rejected by the '
        f'roadmap validator. Re-stage the corrected operations for roadmap_id {rid} in ONE '
        '`stage_edits` call, keeping every valid operation and fixing only what the issues '
        'name. Do not ask questions.\n\n# Staged operations\n'
        + '\n'.join(f'- {item}' for item in staged)
        + '\n\n# Validation issues\n'
        + _issues_text(issues)
    )
    messages = build_messages(
        session,
        run_state,
        turn_context,
        'investigate',
        user_message=MATERIALIZE_INSTRUCTION,
        extra_tail=extra_tail,
    )
    loop_settings = settings.model_copy(update={'agent_v2_max_turns': 1, 'agent_v2_max_tool_calls': 1})
    actor = session.metadata.actor_context
    actor_id = actor.actor_id if actor is not None else None
    client = LLMClient(settings, prompt_cache_key=f'roadmap:{rid}')
    dispatcher = ToolDispatcher(settings=settings, logger=ctx.logger, nest_client=ctx.nest_client)
    handler = terminal.for_repair(
        session, run_state, rid, settings=settings, trace_id=ctx.trace_id, actor_id=actor_id, session_context=turn_context
    )
    effort = escalated_effort(settings, 'medium')
    reasoning_effort = effort if effort != settings.openai_v2_reasoning_effort else None
    try:
        result = run_loop(
            client=client,
            messages=messages,
            tools=repair_tools(rid, session.scope),
            dispatcher=dispatcher,
            session_context=turn_context,
            handle_map=merged_handle_map(session, run_state),
            settings=loop_settings,
            trace_id=ctx.trace_id,
            actor_id=actor_id,
            reasoning_effort=reasoning_effort,
            terminal_handler=handler,
        )
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.ERROR,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            roadmap_id=rid,
            phase='execute',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        return False
    ctx.add_loop_usage(result)
    _note_repair(run_state, batch.batch_id)
    if result.kind != 'batches':
        return False
    operations = [op for item in result.batches if item.roadmap_id == rid for op in item.operations]
    if not operations:
        return False
    batch.operations = operations
    # New ops -> new operations hash -> a fresh idempotency key on commit.
    batch.refresh_operations_hash()
    return True


# -- success / failure bookkeeping -----------------------------------------------


def _record_commit_failure(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit, exc: HTTPException) -> None:
    details = extract_upstream_error_details(exc.detail)
    code = extract_upstream_error_code(exc.detail) or details.get('code') or f'HTTP_{exc.status_code}'
    message = (
        str(details.get('message')).strip()
        if isinstance(details.get('message'), str) and str(details.get('message')).strip()
        else GENERIC_COMMIT_ERROR
    )
    # The backend's generic 400 carries per-op validation issues — surface the
    # first one so the user learns WHY ("Task not found"), not just that it failed.
    issue_message = details.get('validation_issue_message')
    if isinstance(issue_message, str) and issue_message.strip() and issue_message.strip() not in message:
        message = f'{message}: {issue_message.strip()}'
    _fail(commit, str(code), message)
    log_event(
        logger,
        'commit_failed',
        settings=ctx.settings,
        level=logging.WARNING,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        roadmap_id=batch.roadmap_id,
        roadmap_title=batch.roadmap_title,
        batch_id=batch.batch_id,
        error_code=code,
        error_message=message,
        upstream_status=exc.status_code,
        invalid_operation=details.get('invalid_operation'),
        attempt=commit.attempts,
        retryable=_is_transient(exc),
        impacted_items=[],
    )


def _after_failure(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit) -> None:
    """A failed commit usually means the session's view of the roadmap has
    drifted from reality: drop the cached overview so the next turn refetches
    the truth, and prune the failed ops' targets from the recent items so the
    model does not replay a dead id."""
    context_cache.invalidate_overview(session, batch.roadmap_id)
    suspect = {
        str(getattr(operation, 'node_id', '') or '').strip()
        for operation in batch.operations
        if getattr(operation, 'node_id', None)
    }
    if suspect:
        prune_recent_targets_by_node_ids(session, suspect)
    if commit.status == 'failed' and commit.error_code == 'HANDLE_ROADMAP_MISMATCH':
        log_event(
            logger,
            'commit_failed',
            settings=ctx.settings,
            level=logging.WARNING,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            roadmap_id=batch.roadmap_id,
            roadmap_title=batch.roadmap_title,
            batch_id=batch.batch_id,
            error_code=commit.error_code,
            error_message=commit.error_message,
            attempt=commit.attempts,
            impacted_items=[],
        )


def _apply_commit_success(ctx: Any, session: AgentSession, run_state: Any, batch: RunBatch, commit: RunCommit, commit_result: dict[str, Any], commit_ms: int) -> None:
    rid = batch.roadmap_id
    change_id_raw = commit_result.get('change_id')
    change_id = str(change_id_raw).strip() if isinstance(change_id_raw, str) and change_id_raw.strip() else None
    token_after = commit_result.get('revision_token')
    token_after = token_after if isinstance(token_after, str) and token_after.strip() else None
    _set_token(session, rid, token_after)

    if change_id is not None:
        applied = [v for v in (session.metadata.applied_change_ids or []) if isinstance(v, str) and v.strip()]
        if change_id not in applied:
            applied.append(change_id)
        session.metadata.applied_change_ids = applied

    try:
        ctx.service.record_recent_targets_from_preview(
            session=session, preview_result=commit_result, source='commit_semantic_diff', roadmap_id=rid
        )
    except Exception:  # pragma: no cover - telemetry best-effort
        pass

    # Snapshot titles before invalidating the handle map: description/date-
    # only changes carry no title in the semantic diff, so the impacted-items
    # extraction below needs this to label the commit chip in the web.
    handle_titles_by_id: dict[str, str] = {}
    for entry in handle_map_for_roadmap(session, rid).values():
        if isinstance(entry, dict):
            entry_id = entry.get('id')
            entry_title = entry.get('title')
            if isinstance(entry_id, str) and isinstance(entry_title, str) and entry_title:
                handle_titles_by_id[entry_id] = entry_title
    # Keep recent_resolved_targets in sync with committed renames so the LLM
    # doesn't see a stale pre-rename title for an item it just renamed.
    _refresh_recent_resolved_target_titles(session, list(batch.operations))
    record_applied_changes_from_commit(
        session,
        commit_result,
        summary=batch.assistant_message,
        roadmap_id=rid,
        run_id=run_state.run_id,
    )
    # The roadmap shape has changed — the next turn refetches the overview.
    context_cache.invalidate_overview(session, rid)

    impacted_items = _extract_impacted_items_from_commit_result(commit_result)
    for item in impacted_items:
        if item.get('title') is None:
            item['title'] = handle_titles_by_id.get(item.get('node_id') or '')
    impacted_summary = _summarize_impacted_items(impacted_items)
    semantic_diff = commit_result.get('semantic_diff')
    summary = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else None
    history_recorded = commit_result.get('history_recorded')

    commit.status = 'committed'
    commit.change_id = change_id
    commit.revision_token_after = token_after
    commit.semantic_diff_summary = {k: v for k, v in summary.items() if isinstance(v, int)} if isinstance(summary, dict) else {}
    commit.impacted_summary = impacted_summary
    commit.impacted_items = [CommitImpactedItem.model_validate(item) for item in impacted_items]
    commit.error_code = None
    commit.error_message = None
    commit.history_recorded = history_recorded if isinstance(history_recorded, bool) else None

    log_event(
        logger,
        'commit_completed',
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        roadmap_id=rid,
        roadmap_title=batch.roadmap_title,
        batch_id=batch.batch_id,
        change_id=change_id,
        operations_count=len(batch.operations),
        commit_ms=commit_ms,
        impacted_item_count=len(impacted_items),
        impacted_summary=impacted_summary,
        impacted_items=impacted_items,
        history_recorded=commit.history_recorded,
    )


# ---------------------------------------------------------------------------
# Helpers ported from the single-roadmap auto-commit
# ---------------------------------------------------------------------------


def _sanitize_invalid_operation_snapshot(*, index: int, operation: RoadmapOperation, reason: str) -> dict[str, Any]:
    patch = operation.patch if isinstance(operation.patch, dict) else None
    payload = operation.model_dump(exclude_none=True)
    return {
        'index': index,
        'reason': reason,
        'op': operation.op.value,
        'node_type': operation.node_type.value if operation.node_type is not None else None,
        'node_id': operation.node_id,
        'node_ref': operation.node_ref,
        'patch_keys': sorted(patch.keys())[:20] if isinstance(patch, dict) else [],
        'operation': {
            key: payload.get(key)
            for key in (
                'op',
                'node_type',
                'node_id',
                'node_ref',
                'parent_id',
                'parent_ref',
                'new_parent_id',
                'new_parent_ref',
                'temp_id',
                'status',
                'delta_days',
            )
            if key in payload
        },
    }


def _first_invalid_operation_snapshot(staged_snapshot: list[Any]) -> dict[str, Any] | None:
    for index, operation in enumerate(staged_snapshot):
        if not isinstance(operation, RoadmapOperation):
            continue
        issues = operation.semantic_contract_issues(is_uuid=is_uuid_like)
        if not issues:
            continue
        return _sanitize_invalid_operation_snapshot(index=index, operation=operation, reason=issues[0])
    return None


def _refresh_recent_resolved_target_titles(session: AgentSession, applied_operations: list[RoadmapOperation]) -> None:
    """After a commit, update `recent_resolved_targets[*].title` for any node
    that was just renamed. Without this, a subsequent turn's system prompt
    still shows the pre-rename title and the LLM may resolve references by
    the obsolete name. Safe no-op when no renames were applied.
    """
    renames: dict[str, str] = {}
    for operation in applied_operations:
        op_value = getattr(operation.op, 'value', str(operation.op or ''))
        if op_value != 'update_node':
            continue
        node_id = operation.node_id
        patch = operation.patch
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if not isinstance(patch, dict):
            continue
        new_title = patch.get('title')
        if not isinstance(new_title, str) or not new_title.strip():
            continue
        renames[node_id] = new_title.strip()

    if not renames:
        return

    for target in session.metadata.recent_resolved_targets:
        new_title = renames.get(target.node_id)
        if new_title is None:
            continue
        target.title = new_title


def _log_commit_response_shape(*, commit_result: dict[str, Any], session_id: str, roadmap_id: str, trace_id: str | None) -> None:
    """Dump the structural fields of the backend commit response (diagnoses an
    empty `impacted_items`: backend diff bug vs agent parser mismatch)."""
    semantic_diff = commit_result.get('semantic_diff') if isinstance(commit_result, dict) else None
    if isinstance(semantic_diff, dict):
        changes_raw = semantic_diff.get('changes')
        changes = changes_raw if isinstance(changes_raw, list) else []
        summary = semantic_diff.get('summary')
        sample = changes[:2]
    else:
        changes = []
        summary = None
        sample = None
    logger.info(
        'commit_response_shape trace_id=%s session_id=%s roadmap_id=%s '
        'top_level_keys=%s semantic_diff_keys=%s '
        'semantic_diff_changes_count=%d semantic_diff_summary=%s '
        'semantic_diff_first_changes=%s',
        trace_id,
        session_id,
        roadmap_id,
        sorted(commit_result.keys()) if isinstance(commit_result, dict) else None,
        sorted(semantic_diff.keys()) if isinstance(semantic_diff, dict) else None,
        len(changes),
        summary,
        sample,
    )


def _extract_impacted_items_from_commit_result(commit_result: dict[str, Any]) -> list[dict[str, Any]]:
    semantic_diff = commit_result.get('semantic_diff')
    changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
    if not isinstance(changes, list):
        return []

    impacted_items: list[dict[str, Any]] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        node = change.get('node')
        if not isinstance(node, dict):
            continue
        node_id = node.get('id')
        node_type_raw = node.get('type')
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if not isinstance(node_type_raw, str):
            continue
        node_type = node_type_raw.strip().lower()
        if node_type not in {'roadmap', 'epic', 'feature', 'task', 'milestone'}:
            continue

        change_type_raw = change.get('type')
        change_type = (
            change_type_raw.strip().upper()
            if isinstance(change_type_raw, str) and change_type_raw.strip()
            else None
        )
        if change_type == 'NODE_ADDED':
            impact = 'created'
        elif change_type == 'NODE_REMOVED':
            impact = 'deleted'
        else:
            impact = 'modified'

        title: str | None = None
        node_title = node.get('title')
        if isinstance(node_title, str) and node_title.strip():
            title = node_title.strip()
        else:
            for source in (change.get('to'), change.get('from')):
                if not isinstance(source, dict):
                    continue
                for key in ('title', 'name', 'node_title'):
                    raw_title = source.get(key)
                    if isinstance(raw_title, str) and raw_title.strip():
                        title = raw_title.strip()
                        break
                if title:
                    break

        impacted_items.append(
            {
                'node_id': node_id.strip(),
                'node_type': node_type,
                'title': title,
                'change_type': change_type,
                'impact': impact,
            }
        )

    return impacted_items


def _summarize_impacted_items(impacted_items: list[dict[str, Any]]) -> dict[str, int]:
    summary = {'created': 0, 'modified': 0, 'deleted': 0}
    for item in impacted_items:
        impact = item.get('impact')
        if impact in summary:
            summary[impact] += 1
    return summary


def pending_plan_for_confirm(session: AgentSession) -> PendingPlan | None:
    plan = session.metadata.pending_plan
    if plan is None or plan.status != 'proposed':
        return None
    return plan
