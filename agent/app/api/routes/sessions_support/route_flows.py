from __future__ import annotations

from datetime import datetime
from time import perf_counter
from typing import Any, Awaitable, Callable
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import HTTPException

from app.core.contracts.sessions import (
    AgentSession,
    AppliedDraftCommit,
    CommitRequest,
    CreateSessionRequest,
    CreateSessionResponse,
    DiscardRequest,
    DiscardResponse,
    MessageRequest,
    MessageResponse,
    RoadmapCommitArtifact,
    RollbackRequest,
)
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore


async def create_session_flow(
    *,
    payload: CreateSessionRequest,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, AgentService]]],
    sanitize_session_metadata: Callable[[dict | None], tuple[dict, bool]],
    run_store_call: Callable[..., Awaitable[Any]],
    log_event_fn: Callable[..., None],
    logger: Any,
    settings: Any,
) -> CreateSessionResponse:
    store, _ = await get_agent_runtime_async()
    logger.info(
        'Creating AI session for roadmap_id=%s base_revision=%s',
        payload.roadmap_id,
        payload.base_revision,
    )
    sanitized_metadata, actor_metadata_stripped = sanitize_session_metadata(payload.metadata)
    if actor_metadata_stripped:
        log_event_fn(
            logger,
            'session_metadata_sanitized',
            settings=settings,
            roadmap_id=payload.roadmap_id,
            actor_context_stripped=True,
        )
    session = AgentSession(
        roadmap_id=payload.roadmap_id,
        base_revision=payload.base_revision,
        revision_token=payload.revision_token,
        metadata=sanitized_metadata,
    )
    await run_store_call(store.create, session)
    return CreateSessionResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        created_at=session.created_at,
    )


async def send_message_flow(
    *,
    session_id: str,
    payload: MessageRequest,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, AgentService]]],
    get_session_or_404_async: Callable[[AgentService, str], Awaitable[AgentSession]],
    run_store_call: Callable[..., Awaitable[Any]],
    resolve_draft_snapshot: Callable[[AgentSession, AgentService], tuple[str, int, list]],
    execute_auto_commit: Callable[..., Awaitable[Any]],
    schedule_auto_commit_task: Callable[[Any], Any],
    run_auto_commit_in_background: Callable[..., Awaitable[None]],
    extract_upstream_error_code: Callable[[object], str | None],
    settings: Any,
    logger: Any,
    log_event_fn: Callable[..., None],
) -> MessageResponse:
    store, agent_service = await get_agent_runtime_async()
    trace_id = str(uuid4())
    started_at = perf_counter()
    session = await get_session_or_404_async(agent_service, session_id)
    log_event_fn(
        logger,
        'message_received',
        settings=settings,
        trace_id=trace_id,
        session_id=session_id,
        roadmap_id=session.roadmap_id,
        message=payload.message,
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
    outcome = None
    artifacts: list[RoadmapCommitArtifact] = []
    response_artifacts: list[RoadmapCommitArtifact] = []
    error_code: int | None = None
    auto_commit_ms: int | None = None
    auto_commit_error_code: str | None = None
    auto_commit_error_retryable: bool | None = None
    auto_commit_error_upstream_status: int | None = None
    auto_commit_async_enqueued = False
    inline_commit_size_bytes: int | None = None
    response_staged_operations_version: int | None = None
    response_staged_operations_count: int | None = None
    response_active_draft_id: str | None = None
    response_active_draft_version: int | None = None
    try:
        outcome = await run_store_call(
            agent_service.plan_message,
            session,
            payload.message,
            False,
            request.headers.get('Authorization'),
            trace_id,
        )
        _, _, staged_snapshot_operations = resolve_draft_snapshot(
            outcome.session,
            agent_service,
        )
        response_staged_operations_version = outcome.staged_operations_version
        response_staged_operations_count = outcome.staged_operations_count
        response_active_draft_id = outcome.active_draft_id
        response_active_draft_version = outcome.active_draft_version

        should_auto_commit = (
            outcome.response_mode == 'edit_plan'
            and len(staged_snapshot_operations) > 0
        )

        if should_auto_commit:
            auth_header = request.headers.get('Authorization')
            if auth_header:
                if settings.agent_async_auto_commit_enabled:
                    schedule_auto_commit_task(
                        run_auto_commit_in_background(
                            store=store,
                            agent_service=agent_service,
                            session=outcome.session,
                            auth_header=auth_header,
                            trace_id=trace_id,
                        )
                    )
                    auto_commit_async_enqueued = True
                else:
                    auto_commit_result = await execute_auto_commit(
                        store=store,
                        agent_service=agent_service,
                        session=outcome.session,
                        auth_header=auth_header,
                        trace_id=trace_id,
                    )
                    auto_commit_ms = auto_commit_result.auto_commit_ms
                    inline_commit_size_bytes = auto_commit_result.inline_commit_size_bytes
                    response_staged_operations_count = auto_commit_result.staged_operations_count
                    response_staged_operations_version = auto_commit_result.staged_operations_version
                    response_active_draft_id = auto_commit_result.active_draft_id
                    response_active_draft_version = auto_commit_result.active_draft_version
                    if auto_commit_result.artifact is not None:
                        response_artifacts.append(auto_commit_result.artifact)
                        artifacts.append(auto_commit_result.artifact)
            else:
                logger.info(
                    'Auto-commit skipped due to missing auth header. session_id=%s roadmap_id=%s',
                    outcome.session.session_id,
                    outcome.session.roadmap_id,
                )

        return MessageResponse(
            session_id=outcome.session.session_id,
            assistant_message=outcome.assistant_message,
            parse_mode=outcome.parse_mode,
            intent_type=outcome.intent_type,
            response_mode=outcome.response_mode,
            operations=outcome.operations,
            staged_operations_version=(
                response_staged_operations_version
                if response_staged_operations_version is not None
                else outcome.staged_operations_version
            ),
            staged_operations_count=(
                response_staged_operations_count
                if response_staged_operations_count is not None
                else outcome.staged_operations_count
            ),
            active_draft_id=(
                response_active_draft_id
                if response_active_draft_id is not None
                else outcome.active_draft_id
            ),
            active_draft_version=(
                response_active_draft_version
                if response_active_draft_version is not None
                else outcome.active_draft_version
            ),
            artifacts=response_artifacts or artifacts,
            provider_used=outcome.provider_used,
            fallback_used=outcome.fallback_used,
            provider_error_code=outcome.provider_error_code,
            debug_trace_id=trace_id,
        )
    except HTTPException as exc:
        error_code = exc.status_code
        if outcome is not None and outcome.response_mode == 'edit_plan':
            auto_commit_error_code = extract_upstream_error_code(exc.detail)
            auto_commit_error_retryable = exc.status_code >= 500 or exc.status_code in {408, 429}
            auto_commit_error_upstream_status = exc.status_code
        raise
    finally:
        elapsed_ms = int((perf_counter() - started_at) * 1000)
        total_edit_turn_ms = (
            elapsed_ms
            if outcome is not None and outcome.response_mode == 'edit_plan'
            else None
        )
        staged_changes_present = (
            (
                response_staged_operations_count
                if response_staged_operations_count is not None
                else (outcome.staged_operations_count if outcome is not None else 0)
            )
            > 0
        )
        log_event_fn(
            logger,
            'message_completed',
            settings=settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=session.roadmap_id,
            elapsed_ms=elapsed_ms,
            intent_type=outcome.intent_type if outcome else None,
            response_mode=outcome.response_mode if outcome else None,
            provider_used=outcome.provider_used if outcome else None,
            fallback_used=outcome.fallback_used if outcome else None,
            provider_error_code=outcome.provider_error_code if outcome else None,
            parse_mode=outcome.parse_mode if outcome else None,
            assistant_message=outcome.assistant_message if outcome else None,
            tokens_input=outcome.tokens_input if outcome else None,
            tokens_output=outcome.tokens_output if outcome else None,
            tokens_total=outcome.tokens_total if outcome else None,
            operations_count=len(outcome.operations) if outcome else 0,
            artifacts_count=len(artifacts),
            inline_commit_included=any(
                artifact.inline_commit is not None for artifact in response_artifacts
            ),
            inline_commit_skipped_due_to_size=False,
            inline_commit_size_bytes=inline_commit_size_bytes,
            artifact_first_read_source=(
                'inline'
                if any(artifact.inline_commit is not None for artifact in response_artifacts)
                else None
            ),
            staged_changes_present=staged_changes_present,
            actor_present=(
                outcome.session.metadata.actor_context is not None
                if outcome is not None
                else session.metadata.actor_context is not None
            ),
            roadmap_role=(
                outcome.session.metadata.actor_context.roadmap_role
                if outcome is not None and outcome.session.metadata.actor_context is not None
                else (
                    session.metadata.actor_context.roadmap_role
                    if session.metadata.actor_context is not None
                    else None
                )
            ),
            actor_context_source=(
                outcome.session.metadata.actor_context.actor_context_source
                if outcome is not None and outcome.session.metadata.actor_context is not None
                else (
                    session.metadata.actor_context.actor_context_source
                    if session.metadata.actor_context is not None
                    else None
                )
            ),
            error_code=error_code,
            route_lane=outcome.route_lane if outcome else None,
            llm_skipped_for_simple_edit=(
                outcome.llm_skipped_for_simple_edit if outcome else False
            ),
            actor_fetch_attempted=(
                outcome.actor_fetch_attempted if outcome else False
            ),
            actor_fetch_skipped_reason=(
                outcome.actor_fetch_skipped_reason if outcome else None
            ),
            actor_fetch_ms=(
                outcome.actor_fetch_ms if outcome else None
            ),
            phase_timings=outcome.phase_timings if outcome else None,
            total_edit_turn_ms=total_edit_turn_ms,
            invalid_operation_detected=(
                outcome.invalid_operation_detected if outcome else False
            ),
            invalid_operation_reason=(
                outcome.invalid_operation_reason if outcome else None
            ),
            invalid_operation_index=(
                outcome.invalid_operation_index if outcome else None
            ),
            auto_commit_ms=auto_commit_ms,
            auto_commit_async_enabled=settings.agent_async_auto_commit_enabled,
            auto_commit_async_enqueued=auto_commit_async_enqueued,
            auto_commit_error_code=auto_commit_error_code,
            auto_commit_error_retryable=auto_commit_error_retryable,
            auto_commit_error_upstream_status=auto_commit_error_upstream_status,
            pending_edit_context_present=(
                outcome.pending_edit_context_present if outcome else False
            ),
            edit_guard_intervened=(
                outcome.edit_guard_intervened if outcome else False
            ),
            edit_continuation_trigger=(
                outcome.edit_continuation_trigger if outcome else None
            ),
            planner_schema_invalid_attempts=(
                outcome.planner_schema_invalid_attempts if outcome else None
            ),
            planner_repair_attempted=(
                outcome.planner_repair_attempted if outcome else None
            ),
            deterministic_create_fastpath_skipped=(
                outcome.deterministic_create_fastpath_skipped if outcome else False
            ),
            retry_tool_calls_used=(
                outcome.retry_tool_calls_used if outcome else None
            ),
            retry_duplicate_operation_deduped=(
                outcome.retry_duplicate_operation_deduped if outcome else False
            ),
            retry_autostage_applied=(
                outcome.retry_autostage_applied if outcome else False
            ),
            stop_reason=(
                outcome.stop_reason if outcome else None
            ),
            react_terminal_action=(
                outcome.react_terminal_action if outcome else None
            ),
            react_loop_turns=(
                outcome.react_loop_turns if outcome else None
            ),
            react_loop_budget=(
                outcome.react_loop_budget if outcome else None
            ),
            react_loop_termination_reason=(
                outcome.react_loop_termination_reason if outcome else None
            ),
            resolve_cache_hits=(
                outcome.resolve_cache_hits if outcome else None
            ),
            resolve_cache_misses=(
                outcome.resolve_cache_misses if outcome else None
            ),
            resolve_dedup_hits=(
                outcome.resolve_dedup_hits if outcome else None
            ),
        )


async def commit_session_flow(
    *,
    session_id: str,
    payload: CommitRequest,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, AgentService]]],
    get_session_or_404_async: Callable[[AgentService, str], Awaitable[AgentSession]],
    resolve_draft_snapshot: Callable[[AgentSession, AgentService], tuple[str, int, list]],
    run_store_call: Callable[..., Awaitable[Any]],
    set_draft_status: Callable[..., bool],
    reuse_selected_draft_as_post_commit_head: Callable[..., int],
    nest_client: Any,
    settings: Any,
    logger: Any,
    log_event_fn: Callable[..., None],
) -> dict:
    store, agent_service = await get_agent_runtime_async()
    session = await get_session_or_404_async(agent_service, session_id)
    trace_id = request.headers.get('X-Trace-Id') or str(uuid4())
    started_at = perf_counter()
    if payload.operations is not None:
        selected_draft_id = session.metadata.active_draft_id or f'{session.session_id}:adhoc'
        selected_draft_version = 0
        selected_operations = payload.operations
    else:
        selected_draft_id, selected_draft_version, selected_operations = resolve_draft_snapshot(
            session,
            agent_service,
        )

    if len(selected_operations) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                'code': 'EMPTY_OPERATIONS',
                'message': 'No staged operations available to commit.',
            },
        )

    commit_result = await nest_client.commit(
        roadmap_id=session.roadmap_id,
        payload={
            'base_revision': payload.base_revision or session.base_revision,
            'revision_token': payload.revision_token or session.revision_token,
            'operations': [
                operation.model_dump(exclude_none=True)
                for operation in selected_operations
            ],
        },
        auth_header=request.headers.get('Authorization'),
        trace_id=trace_id,
    )

    committed_revision_token = commit_result.get('revision_token')
    if isinstance(committed_revision_token, str):
        session.revision_token = committed_revision_token

    change_id_raw = commit_result.get('change_id')
    change_id = (
        str(change_id_raw).strip()
        if isinstance(change_id_raw, str) and str(change_id_raw).strip()
        else None
    )

    if change_id is not None:
        applied_change_ids_raw = session.metadata.applied_change_ids
        if isinstance(applied_change_ids_raw, list):
            applied_change_ids = [
                value
                for value in applied_change_ids_raw
                if isinstance(value, str) and value.strip()
            ]
        else:
            applied_change_ids = []
        if change_id not in applied_change_ids:
            applied_change_ids.append(change_id)
        session.metadata.applied_change_ids = applied_change_ids

    session.metadata.applied_draft_commits.append(
        AppliedDraftCommit(
            change_id=change_id,
            draft_id=selected_draft_id,
            draft_version=selected_draft_version,
            status='applied',
        )
    )

    record_recent_targets_from_preview = getattr(
        agent_service,
        'record_recent_targets_from_preview',
        None,
    )
    if callable(record_recent_targets_from_preview):
        record_recent_targets_from_preview(
            session=session,
            preview_result=commit_result,
            source='commit_semantic_diff',
        )

    if payload.operations is None:
        if settings.agent_draft_graph_enabled:
            agent_service.ensure_draft_graph_initialized(session)
            reuse_selected_draft_as_post_commit_head(
                session,
                selected_draft_id=selected_draft_id,
            )
        else:
            set_draft_status(
                session=session,
                draft_id=selected_draft_id,
                status='applied',
            )
            session.operations = []
            session.staged_operations_version += 1

    if change_id is not None:
        for artifact in session.artifacts:
            if artifact.status != 'draft':
                continue
            artifact.status = 'applied'
            artifact.change_id = change_id

    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None
    await run_store_call(store.update, session)

    log_event_fn(
        logger,
        'session_commit_completed',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        change_id=change_id,
        committed_revision_token=(
            committed_revision_token if isinstance(committed_revision_token, str) else None
        ),
        active_draft_id=session.metadata.active_draft_id,
        elapsed_ms=int((perf_counter() - started_at) * 1000),
    )

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'commit': commit_result,
    }


async def discard_session_flow(
    *,
    session_id: str,
    payload: DiscardRequest,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, AgentService]]],
    get_session_or_404_async: Callable[[AgentService, str], Awaitable[AgentSession]],
    resolve_draft_snapshot: Callable[[AgentSession, AgentService], tuple[str, int, list]],
    run_store_call: Callable[..., Awaitable[Any]],
    parse_change_timeline: Callable[[Any], tuple[dict[str, str], dict[str, datetime | None]]],
    utcnow: Callable[[], datetime],
    nest_client: Any,
) -> DiscardResponse:
    store, agent_service = await get_agent_runtime_async()
    session = await get_session_or_404_async(agent_service, session_id)
    change_id = payload.change_id
    if not change_id:
        for commit in reversed(session.metadata.applied_draft_commits):
            commit_change_id = getattr(commit, 'change_id', None)
            commit_status = getattr(commit, 'status', 'applied')
            if (
                isinstance(commit_change_id, str)
                and commit_change_id.strip()
                and commit_status == 'applied'
            ):
                change_id = commit_change_id
                break

    if not change_id:
        raise HTTPException(
            status_code=400,
            detail={
                'code': 'MISSING_CHANGE_ID',
                'message': 'Discard requires a committed change_id.',
            },
        )

    discard_result = await nest_client.discard_preview(
        roadmap_id=session.roadmap_id,
        payload={'change_id': change_id},
        auth_header=request.headers.get('Authorization'),
    )

    discarded_at = utcnow()
    discarded_at_raw = discard_result.get('discarded_at')
    if isinstance(discarded_at_raw, str):
        try:
            discarded_at = datetime.fromisoformat(
                discarded_at_raw.replace('Z', '+00:00')
            ).replace(tzinfo=None)
        except ValueError:
            pass

    revision_token = discard_result.get('revision_token')
    if isinstance(revision_token, str):
        session.revision_token = revision_token

    timeline = discard_result.get('timeline')
    timeline_status, timeline_discarded_at = parse_change_timeline(timeline)

    for commit in session.metadata.applied_draft_commits:
        commit_change_id = getattr(commit, 'change_id', None)
        if not isinstance(commit_change_id, str) or not commit_change_id.strip():
            continue
        next_status = timeline_status.get(commit_change_id)
        if next_status not in {'applied', 'discarded'}:
            continue
        commit.status = next_status
        commit.discarded_at = timeline_discarded_at.get(commit_change_id)

    for artifact in session.artifacts:
        artifact_change_id = getattr(artifact, 'change_id', None)
        if not isinstance(artifact_change_id, str) or not artifact_change_id.strip():
            continue
        next_status = timeline_status.get(artifact_change_id)
        if next_status in {'applied', 'discarded'}:
            artifact.status = next_status

    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None
    await run_store_call(store.update, session)

    staged_operations_count = len(session.operations)
    staged_operations_version = session.staged_operations_version
    try:
        _, staged_operations_version, staged_operations = resolve_draft_snapshot(
            session,
            agent_service,
        )
        staged_operations_count = len(staged_operations)
    except Exception:
        pass

    return DiscardResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        discarded_change_id=change_id,
        discarded_at=discarded_at,
        staged_operations_count=staged_operations_count,
        staged_operations_version=staged_operations_version,
    )


async def rollback_session_flow(
    *,
    session_id: str,
    payload: RollbackRequest,
    request: Request,
    get_agent_runtime_async: Callable[[], Awaitable[tuple[SessionStore, AgentService]]],
    get_session_or_404_async: Callable[[AgentService, str], Awaitable[AgentSession]],
    run_store_call: Callable[..., Awaitable[Any]],
    parse_change_timeline: Callable[[Any], tuple[dict[str, str], dict[str, datetime | None]]],
    nest_client: Any,
) -> dict:
    store, agent_service = await get_agent_runtime_async()
    session = await get_session_or_404_async(agent_service, session_id)

    rollback_result = await nest_client.rollback(
        roadmap_id=session.roadmap_id,
        payload=payload.model_dump(),
        auth_header=request.headers.get('Authorization'),
    )

    revision_token = rollback_result.get('revision_token')
    if isinstance(revision_token, str):
        session.revision_token = revision_token

    timeline = rollback_result.get('timeline')
    timeline_status, _ = parse_change_timeline(timeline)

    for commit in session.metadata.applied_draft_commits:
        commit_change_id = getattr(commit, 'change_id', None)
        if not isinstance(commit_change_id, str) or not commit_change_id.strip():
            continue
        next_status = timeline_status.get(commit_change_id)
        if next_status in {'applied', 'discarded'}:
            commit.status = next_status
            if next_status == 'applied':
                commit.discarded_at = None

    for artifact in session.artifacts:
        artifact_change_id = getattr(artifact, 'change_id', None)
        if not isinstance(artifact_change_id, str) or not artifact_change_id.strip():
            continue
        next_status = timeline_status.get(artifact_change_id)
        if next_status in {'applied', 'discarded'}:
            artifact.status = next_status

    await run_store_call(store.update, session)

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'rollback': rollback_result,
    }
