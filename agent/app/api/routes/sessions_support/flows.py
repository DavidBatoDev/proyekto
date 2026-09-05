"""Route flows: create a session, send a message (start / advance a run),
continue a run, cancel a run. Each flow resolves the runtime, loads the
session, binds the trace context, hands the blocking orchestration to a
worker thread and maps the ``StepResult`` onto the wire ``MessageResponse``.
"""

from __future__ import annotations

import functools
from time import perf_counter
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from fastapi import Request
from fastapi.exceptions import HTTPException
from pydantic import BaseModel

from app.api.routes.sessions_support.auth import (
    owner_key_from_auth,
    require_forward_auth,
    resolve_forward_auth,
)
from app.core.contracts.runs import RunView
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
)
from app.core.runtime import orchestrator, runs
from app.core.runtime.results import StepResult
from app.core.runtime.sentinels import parse_user_input
from app.core.runtime.service import RuntimeService
from app.core.runtime.snapshot import (
    build_agent_state_snapshot,
    push_agent_state_snapshot,
    snapshot_fingerprint,
)
from app.core.runtime.summarizer import run_summary_compaction, should_schedule_compaction
from app.core.session_store import SessionStore
from app.core.trace_context import bind as bind_trace_context_values


class CancelRunResponse(BaseModel):
    run: RunView


def session_scope_not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            'code': 'SESSION_SCOPE_NOT_FOUND',
            'message': 'The roadmap or workspace was not found.',
        },
    )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_session_flow(
    *,
    payload: CreateSessionRequest,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, RuntimeService]]],
    sanitize_session_metadata: Callable[[dict | None], tuple[dict, bool]],
    run_store_call: Callable[..., Awaitable[Any]],
    log_event_fn: Callable[..., None],
    logger: Any,
    settings: Any,
    request: Request | None = None,
    nest_client: Any = None,
) -> CreateSessionResponse:
    store, service = await get_agent_runtime_async()
    auth_header = require_forward_auth(request) if request is not None else None
    scope = payload.resolved_scope
    logger.info(
        'Creating AI session scope=%s base_revision=%s',
        scope.key,
        payload.base_revision,
    )
    # No-clobber guard: the web calls create both on cold thread loads and on
    # 404-rehydrates. When the Redis session is still alive, overwriting it
    # would wipe live staged state — return the existing identifiers instead.
    if payload.session_id:
        existing = await run_store_call(store.get, payload.session_id)
        if existing is not None:
            log_event_fn(
                logger,
                'session_create_noop_existing',
                settings=settings,
                session_id=existing.session_id,
                roadmap_id=existing.scope.focus_roadmap_id,
            )
            return CreateSessionResponse(
                session_id=existing.session_id,
                scope=existing.scope,
                base_revision=existing.base_revision,
                revision_token=existing.revision_token,
                created_at=existing.created_at,
            )
    sanitized_metadata, actor_metadata_stripped = sanitize_session_metadata(payload.metadata)
    if actor_metadata_stripped:
        log_event_fn(
            logger,
            'session_metadata_sanitized',
            settings=settings,
            roadmap_id=scope.focus_roadmap_id,
            actor_context_stripped=True,
        )

    client = nest_client if nest_client is not None else getattr(service, 'nest_client', None)
    actor_context: ActorContext | None = None
    owner_key = owner_key_from_auth(auth_header)
    if auth_header and client is not None:
        if scope.kind == 'roadmap':
            try:
                actor_payload = await client.context_actor(
                    roadmap_id=scope.roadmap_id, auth_header=auth_header, trace_id=None
                )
            except HTTPException as exc:
                if exc.status_code in {403, 404}:
                    raise session_scope_not_found() from exc
                # 5xx / timeout: create WITHOUT the actor (recoverable — every
                # later call is authorized per request as the user anyway).
                actor_payload = None
            if isinstance(actor_payload, dict) and actor_payload.get('actor_id'):
                try:
                    actor_context = ActorContext.model_validate(
                        {**actor_payload, 'actor_context_source': 'backend_context_actor'}
                    )
                except Exception:  # noqa: BLE001 — a malformed actor is just absent
                    actor_context = None
                if actor_context is not None:
                    owner_key = owner_key_from_auth(auth_header, actor_id=actor_context.actor_id)
        else:
            try:
                await client.workspace_get(scope.workspace_id, auth_header, trace_id=None)
            except HTTPException as exc:
                if exc.status_code in {403, 404}:
                    # Never reveal whether the workspace exists.
                    raise session_scope_not_found() from exc

    session_kwargs: dict[str, Any] = {
        'scope': scope,
        'owner_key': owner_key,
        'base_revision': payload.base_revision,
        'revision_token': payload.revision_token,
        'metadata': sanitized_metadata,
    }
    if payload.session_id:
        session_kwargs['session_id'] = payload.session_id
    if payload.seed_messages:
        session_kwargs['messages'] = list(payload.seed_messages)
    session = AgentSession(**session_kwargs)
    if actor_context is not None:
        session.metadata.actor_context = actor_context
    await run_store_call(store.create, session)
    return CreateSessionResponse(
        session_id=session.session_id,
        scope=session.scope,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        created_at=session.created_at,
    )


# ---------------------------------------------------------------------------
# Trace ids
# ---------------------------------------------------------------------------


def _normalize_trace_id(candidate: str | None) -> str | None:
    if not isinstance(candidate, str):
        return None
    value = candidate.strip()
    if not value:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _resolve_request_trace_id(request: Request) -> str:
    header_trace_id = _normalize_trace_id(request.headers.get('X-Trace-Id'))
    if header_trace_id is not None:
        return header_trace_id
    return str(uuid4())


def _bind_trace(trace_id: str, session: AgentSession) -> None:
    bind_trace_context_values(
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.scope.focus_roadmap_id,
        # The Supabase user id — lets the trace store target `user:{id}` for
        # realtime push. Guests have no actor_context → push stays off.
        actor_id=(
            session.metadata.actor_context.actor_id
            if session.metadata.actor_context is not None
            else None
        ),
    )


# ---------------------------------------------------------------------------
# Messages / continue
# ---------------------------------------------------------------------------


def _to_message_response(result: StepResult, trace_id: str) -> MessageResponse:
    session = result.session
    return MessageResponse(
        session_id=session.session_id,
        assistant_message=result.assistant_message,
        parse_mode=result.parse_mode,
        intent_type=result.intent_type,
        response_mode=result.response_mode,
        operations=result.operations,
        staged_operations_version=result.staged_operations_version,
        staged_operations_count=result.staged_operations_count,
        plan_proposal=result.plan_proposal_payload,
        clarifier=result.clarifier_card,
        provider_used=result.provider_used,
        fallback_used=result.fallback_used,
        provider_error_code=result.provider_error_code,
        debug_trace_id=trace_id,
        commit_summary=result.commit_summary,
        commits=result.commits,
        run=runs.run_view(session, result.run),
    )


async def _after_step(
    *,
    result: StepResult,
    store: Any,
    auth_header: str | None,
    trace_id: str,
    snapshot_fp_before: str,
    schedule_background_task: Callable[[Any], Any],
    nest_client: Any,
    settings: Any,
) -> None:
    session = result.session
    # Durable memory write-back: only at checkpoints / terminals, and only
    # when memory-class state changed (the fingerprint ignores the run's
    # volatile step fields, so a plain continue never pushes).
    if nest_client is not None and auth_header and result.segment_ended:
        snapshot = build_agent_state_snapshot(session)
        if snapshot and snapshot_fingerprint(snapshot) != snapshot_fp_before:
            schedule_background_task(
                push_agent_state_snapshot(
                    nest_client=nest_client,
                    scope=session.scope,
                    session_id=session.session_id,
                    snapshot=snapshot,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )
            )
    # Conversation compaction: compute a summary candidate off-path; it is
    # applied (and the message list truncated) at the next turn start.
    if should_schedule_compaction(session, settings):
        schedule_background_task(
            run_summary_compaction(
                store=store,
                session_id=session.session_id,
                settings=settings,
                trace_id=trace_id,
            )
        )


def _log_message_completed(
    *,
    log_event_fn: Callable[..., None],
    logger: Any,
    settings: Any,
    trace_id: str,
    session: AgentSession,
    result: StepResult | None,
    error_code: int | None,
    elapsed_ms: int,
    message: str | None,
) -> None:
    actor = (result.session if result is not None else session).metadata.actor_context
    run = result.run if result is not None else session.metadata.run
    commits = list(run.commits) if run is not None else []
    log_event_fn(
        logger,
        'message_completed',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.scope.focus_roadmap_id,
        owner_key=session.owner_key,
        elapsed_ms=elapsed_ms,
        message=message,
        intent_type=result.intent_type if result else None,
        response_mode=result.response_mode if result else None,
        provider_used=result.provider_used if result else None,
        fallback_used=result.fallback_used if result else None,
        provider_error_code=result.provider_error_code if result else None,
        parse_mode=result.parse_mode if result else None,
        assistant_message=result.assistant_message if result else None,
        tokens_input=result.tokens_input if result else None,
        tokens_output=result.tokens_output if result else None,
        tokens_total=result.tokens_total if result else None,
        # Cached-prefix tokens for the whole step. Compare against
        # tokens_input: a healthy conversation should cache most of its input
        # after the first turn (runtime/prompt.py keeps the prefix stable).
        tokens_cached=result.tokens_cached if result else None,
        operations_count=len(result.operations) if result else 0,
        staged_changes_present=bool(result.staged_operations_count) if result else False,
        actor_present=actor is not None,
        roadmap_role=actor.roadmap_role if actor is not None else None,
        actor_context_source=actor.actor_context_source if actor is not None else None,
        error_code=error_code,
        route_lane=result.route_lane if result else None,
        run_id=run.run_id if run is not None else None,
        phase=run.phase if run is not None else None,
        step=run.step if run is not None else None,
        run_next=run.next if run is not None else None,
        run_status=run.status if run is not None else None,
        commits_committed=sum(1 for c in commits if c.status == 'committed'),
        commits_failed=sum(1 for c in commits if c.status in {'failed', 'skipped'}),
        react_loop_turns=result.react_loop_turns if result else None,
        react_loop_budget=result.react_loop_budget if result else None,
        react_loop_termination_reason=result.react_loop_termination_reason if result else None,
    )


async def send_message_flow(
    *,
    session_id: str,
    payload: MessageRequest,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, RuntimeService]]],
    get_session_or_404_async: Callable[[RuntimeService, str], Awaitable[AgentSession]],
    run_store_call: Callable[..., Awaitable[Any]],
    schedule_background_task: Callable[[Any], Any],
    settings: Any,
    logger: Any,
    log_event_fn: Callable[..., None],
    nest_client: Any = None,
    step_fn: Callable[..., StepResult] | None = None,
) -> MessageResponse:
    store, service = await get_agent_runtime_async()
    trace_id = _resolve_request_trace_id(request)
    started_at = perf_counter()
    session = await get_session_or_404_async(service, session_id)
    auth_header = resolve_forward_auth(request)
    snapshot_fp_before = snapshot_fingerprint(build_agent_state_snapshot(session))
    _bind_trace(trace_id, session)
    log_event_fn(
        logger,
        'message_received',
        settings=settings,
        trace_id=trace_id,
        session_id=session_id,
        roadmap_id=session.scope.focus_roadmap_id,
        owner_key=session.owner_key,
        message=payload.message,
        refs_count=len(payload.refs),
        capabilities=list(payload.capabilities),
        actor_present=session.metadata.actor_context is not None,
        roadmap_role=(
            session.metadata.actor_context.roadmap_role
            if session.metadata.actor_context is not None
            else None
        ),
        actor_context_source=(
            session.metadata.actor_context.actor_context_source
            if session.metadata.actor_context is not None
            else None
        ),
    )
    run_input = parse_user_input(session, payload.message, payload.refs)
    ctx = service.new_step_context(
        auth_header=auth_header,
        trace_id=trace_id,
        sync_mode=not payload.supports_continue,
    )
    result: StepResult | None = None
    error_code: int | None = None
    try:
        step = step_fn or orchestrator.step
        result = await run_store_call(step, ctx, session, run_input)
        await _after_step(
            result=result,
            store=store,
            auth_header=auth_header,
            trace_id=ctx.trace_id,
            snapshot_fp_before=snapshot_fp_before,
            schedule_background_task=schedule_background_task,
            nest_client=nest_client if nest_client is not None else getattr(service, 'nest_client', None),
            settings=settings,
        )
        return _to_message_response(result, ctx.trace_id)
    except HTTPException as exc:
        error_code = exc.status_code
        raise
    finally:
        _log_message_completed(
            log_event_fn=log_event_fn,
            logger=logger,
            settings=settings,
            trace_id=ctx.trace_id,
            session=session,
            result=result,
            error_code=error_code,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
            message=payload.message,
        )


async def continue_run_flow(
    *,
    session_id: str,
    run_id: str,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, RuntimeService]]],
    get_session_or_404_async: Callable[[RuntimeService, str], Awaitable[AgentSession]],
    run_store_call: Callable[..., Awaitable[Any]],
    schedule_background_task: Callable[[Any], Any],
    settings: Any,
    logger: Any,
    log_event_fn: Callable[..., None],
    nest_client: Any = None,
    step_fn: Callable[..., StepResult] | None = None,
) -> MessageResponse:
    store, service = await get_agent_runtime_async()
    started_at = perf_counter()
    session = await get_session_or_404_async(service, session_id)
    auth_header = resolve_forward_auth(request)
    run = session.metadata.run
    # A continue reuses the run's segment trace; the request's X-Trace-Id is
    # ignored (a run the session does not know 404s inside step()).
    trace_id = (
        run.trace_id
        if run is not None and run.run_id == run_id and run.trace_id
        else _resolve_request_trace_id(request)
    )
    snapshot_fp_before = snapshot_fingerprint(build_agent_state_snapshot(session))
    _bind_trace(trace_id, session)
    ctx = service.new_step_context(auth_header=auth_header, trace_id=trace_id, sync_mode=False)
    result: StepResult | None = None
    error_code: int | None = None
    try:
        step = step_fn or orchestrator.step
        result = await run_store_call(
            functools.partial(step, ctx, session, None, continue_run_id=run_id)
        )
        await _after_step(
            result=result,
            store=store,
            auth_header=auth_header,
            trace_id=ctx.trace_id,
            snapshot_fp_before=snapshot_fp_before,
            schedule_background_task=schedule_background_task,
            nest_client=nest_client if nest_client is not None else getattr(service, 'nest_client', None),
            settings=settings,
        )
        return _to_message_response(result, ctx.trace_id)
    except HTTPException as exc:
        error_code = exc.status_code
        raise
    finally:
        _log_message_completed(
            log_event_fn=log_event_fn,
            logger=logger,
            settings=settings,
            trace_id=ctx.trace_id,
            session=session,
            result=result,
            error_code=error_code,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
            message=None,
        )


async def cancel_run_flow(
    *,
    session_id: str,
    run_id: str,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, RuntimeService]]],
    get_session_or_404_async: Callable[[RuntimeService, str], Awaitable[AgentSession]],
    run_store_call: Callable[..., Awaitable[Any]],
    logger: Any,
) -> CancelRunResponse:
    _store, service = await get_agent_runtime_async()
    session = await get_session_or_404_async(service, session_id)
    auth_header = resolve_forward_auth(request)
    run_before = session.metadata.run
    trace_id = run_before.trace_id if run_before is not None and run_before.run_id == run_id else None
    if trace_id:
        _bind_trace(trace_id, session)
    run = await run_store_call(
        functools.partial(
            orchestrator.request_cancel,
            service,
            session,
            run_id,
            auth_header=auth_header,
            trace_id=trace_id,
        )
    )
    logger.info('Run cancel requested. session_id=%s run_id=%s status=%s', session_id, run_id, run.status)
    return CancelRunResponse(run=runs.run_view(session, run))
