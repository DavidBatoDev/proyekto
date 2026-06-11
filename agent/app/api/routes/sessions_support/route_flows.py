from __future__ import annotations

from datetime import datetime
from time import perf_counter
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from fastapi import Request
from fastapi.exceptions import HTTPException

from app.core.contracts.sessions import (
    AgentSession,
    CommitImpactedItem,
    CommitSummary,
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
)
from app.core.orchestration.agent_service import AgentService
from app.core.orchestration.shared.tool_message_persistence import (
    persist_tool_observations_as_messages,
)
from app.core.session_store import SessionStore
from app.core.trace_context import bind as bind_trace_context_values


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
    session_kwargs: dict[str, Any] = {
        'roadmap_id': payload.roadmap_id,
        'base_revision': payload.base_revision,
        'revision_token': payload.revision_token,
        'metadata': sanitized_metadata,
    }
    if payload.session_id:
        session_kwargs['session_id'] = payload.session_id
    if payload.seed_messages:
        session_kwargs['messages'] = list(payload.seed_messages)
    session = AgentSession(**session_kwargs)
    await run_store_call(store.create, session)
    return CreateSessionResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        created_at=session.created_at,
    )


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
    extract_upstream_error_details: Callable[[object], dict[str, Any]] | None,
    settings: Any,
    logger: Any,
    log_event_fn: Callable[..., None],
) -> MessageResponse:
    store, agent_service = await get_agent_runtime_async()
    trace_id = _resolve_request_trace_id(request)
    started_at = perf_counter()
    session = await get_session_or_404_async(agent_service, session_id)
    bind_trace_context_values(
        trace_id=trace_id,
        session_id=session_id,
        roadmap_id=session.roadmap_id,
    )
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
    error_code: int | None = None
    auto_commit_ms: int | None = None
    auto_commit_error_code: str | None = None
    auto_commit_error_name: str | None = None
    auto_commit_error_message: str | None = None
    auto_commit_error_status_code: int | None = None
    auto_commit_invalid_operation: dict[str, Any] | None = None
    auto_commit_error_retryable: bool | None = None
    auto_commit_error_upstream_status: int | None = None
    auto_commit_async_enqueued = False
    response_staged_operations_version: int | None = None
    response_staged_operations_count: int | None = None
    response_active_draft_id: str | None = None
    response_active_draft_version: int | None = None
    commit_summary: CommitSummary | None = None
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
                    try:
                        auto_commit_result = await execute_auto_commit(
                            store=store,
                            agent_service=agent_service,
                            session=outcome.session,
                            auth_header=auth_header,
                            trace_id=trace_id,
                        )
                        auto_commit_ms = auto_commit_result.auto_commit_ms
                        response_staged_operations_count = auto_commit_result.staged_operations_count
                        response_staged_operations_version = auto_commit_result.staged_operations_version
                        response_active_draft_id = auto_commit_result.active_draft_id
                        response_active_draft_version = auto_commit_result.active_draft_version
                        # Lightweight summary the web uses to refresh the canvas
                        # and render the "Committed changes" confirmation.
                        commit_summary = CommitSummary(
                            committed=auto_commit_result.change_id is not None,
                            change_id=auto_commit_result.change_id,
                            semantic_diff_summary=auto_commit_result.semantic_diff_summary,
                            impacted_items=[
                                CommitImpactedItem.model_validate(item)
                                for item in auto_commit_result.impacted_items
                            ],
                            impacted_summary=auto_commit_result.impacted_summary,
                        )
                    except HTTPException as commit_exc:
                        # A synchronous commit failure must NOT fail the whole
                        # message. There is no manual apply/discard UI, so a
                        # staged-but-uncommittable edit is a dead end that would
                        # cascade into every following turn — discard it, start
                        # the next turn clean, and surface the error on the
                        # response so the web can render a failed state.
                        details = (
                            extract_upstream_error_details(commit_exc.detail)
                            if callable(extract_upstream_error_details)
                            else {}
                        )
                        auto_commit_error_upstream_status = commit_exc.status_code
                        auto_commit_error_status_code = commit_exc.status_code
                        auto_commit_error_code = extract_upstream_error_code(commit_exc.detail)
                        if not auto_commit_error_code and isinstance(details.get('code'), str):
                            auto_commit_error_code = str(details.get('code')).strip() or None
                        auto_commit_error_message = (
                            str(details.get('message')).strip()
                            if isinstance(details.get('message'), str)
                            and str(details.get('message')).strip()
                            else 'The edit could not be applied to the roadmap.'
                        )
                        # The backend's generic 400 carries per-op validation
                        # issues — surface the first one so the user learns WHY
                        # ("Task not found"), not just that it failed.
                        issue_message = details.get('validation_issue_message')
                        if (
                            isinstance(issue_message, str)
                            and issue_message.strip()
                            and issue_message.strip() not in auto_commit_error_message
                        ):
                            auto_commit_error_message = (
                                f'{auto_commit_error_message}: {issue_message.strip()}'
                            )
                        if isinstance(details.get('invalid_operation'), dict):
                            auto_commit_invalid_operation = details.get('invalid_operation')
                        auto_commit_error_retryable = (
                            commit_exc.status_code >= 500
                            or commit_exc.status_code in {408, 429}
                        )
                        failed_session = outcome.session
                        suspect_node_ids = {
                            operation.node_id
                            for operation in failed_session.operations
                            if getattr(operation, 'node_id', None)
                        }
                        failed_session.operations = []
                        failed_session.staged_operations_version += 1
                        # A failed commit usually means the session's view of
                        # the roadmap has drifted from reality (e.g. a node a
                        # collaborator deleted). Drop the cached overview +
                        # handle map so the next turn refetches the truth
                        # instead of re-staging against ghosts — and prune the
                        # failed ops' targets from recently-resolved items, or
                        # the model keeps replaying the dead node_id from there.
                        failed_session.metadata.roadmap_overview_summary = None
                        failed_session.metadata.roadmap_overview_summary_fetched_at = None
                        failed_session.metadata.roadmap_handle_map = {}
                        if suspect_node_ids:
                            failed_session.metadata.recent_resolved_targets = [
                                target
                                for target in failed_session.metadata.recent_resolved_targets
                                if target.node_id not in suspect_node_ids
                            ]
                        response_staged_operations_count = 0
                        response_staged_operations_version = (
                            failed_session.staged_operations_version
                        )
                        # The assistant text was written before the commit ran
                        # ("Assigned X to you.") — replace it with the truth in
                        # BOTH the response and the persisted history, or the
                        # next turn's model context claims the edit happened.
                        honest_message = (
                            f"I couldn't apply that change: {auto_commit_error_message}"
                        )
                        outcome.assistant_message = honest_message
                        for message in reversed(failed_session.messages):
                            if message.role == 'assistant':
                                message.content = honest_message
                                break
                        try:
                            await run_store_call(store.update, failed_session)
                        except Exception:  # noqa: BLE001 — discard is best-effort
                            logger.exception(
                                'Failed to persist staged-op discard after sync '
                                'commit failure. session_id=%s',
                                failed_session.session_id,
                            )
                        commit_summary = CommitSummary(
                            committed=False,
                            error_code=auto_commit_error_code,
                            error_message=auto_commit_error_message,
                        )
                        log_event_fn(
                            logger,
                            'auto_commit_sync_failed',
                            settings=settings,
                            trace_id=trace_id,
                            session_id=outcome.session.session_id,
                            roadmap_id=outcome.session.roadmap_id,
                            auto_commit_error_code=auto_commit_error_code,
                            auto_commit_error_message=auto_commit_error_message,
                            auto_commit_error_upstream_status=auto_commit_error_upstream_status,
                            auto_commit_error_retryable=auto_commit_error_retryable,
                            staged_operations_discarded=True,
                        )
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
            plan_proposal=outcome.plan_proposal_payload,
            clarifier=outcome.clarifier_card,
            provider_used=outcome.provider_used,
            fallback_used=outcome.fallback_used,
            provider_error_code=outcome.provider_error_code,
            debug_trace_id=trace_id,
            commit_summary=commit_summary,
        )
    except HTTPException as exc:
        error_code = exc.status_code
        if outcome is not None and outcome.response_mode == 'edit_plan':
            details = (
                extract_upstream_error_details(exc.detail)
                if callable(extract_upstream_error_details)
                else {}
            )
            auto_commit_error_code = extract_upstream_error_code(exc.detail)
            if not auto_commit_error_code and isinstance(details.get('code'), str):
                auto_commit_error_code = str(details.get('code')).strip() or None
            auto_commit_error_name = (
                str(details.get('error')).strip()
                if isinstance(details.get('error'), str) and str(details.get('error')).strip()
                else None
            )
            auto_commit_error_message = (
                str(details.get('message')).strip()
                if isinstance(details.get('message'), str) and str(details.get('message')).strip()
                else None
            )
            auto_commit_error_status_code = (
                int(details.get('status_code'))
                if isinstance(details.get('status_code'), int)
                else None
            )
            auto_commit_invalid_operation = (
                details.get('invalid_operation')
                if isinstance(details.get('invalid_operation'), dict)
                else None
            )
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
            auto_commit_error_name=auto_commit_error_name,
            auto_commit_error_message=auto_commit_error_message,
            auto_commit_error_status_code=auto_commit_error_status_code,
            auto_commit_invalid_operation=auto_commit_invalid_operation,
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

