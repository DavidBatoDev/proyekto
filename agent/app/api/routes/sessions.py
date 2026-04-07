import logging
import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import (
    AppliedDraftCommit,
    AgentSession,
    CommitRequest,
    RoadmapCommitArtifact,
    CreateSessionRequest,
    CreateSessionResponse,
    DraftNode,
    DiscardRequest,
    DiscardResponse,
    MessageRequest,
    MessageResponse,
    RollbackRequest,
)
from app.core.nest_client import NestRoadmapClient
from app.core.logging_utils import log_event
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore, SessionStoreUnavailableError

router = APIRouter(prefix='/agent/sessions', tags=['agent'])
logger = logging.getLogger(__name__)
settings = get_settings()

_store: SessionStore | None = None
_agent_service: AgentService | None = None
_session_service_unavailable_reason: str | None = None
_nest_client = NestRoadmapClient()
_pending_auto_commit_tasks: set[asyncio.Task] = set()

_ACTOR_METADATA_KEYS = {
    'actor_context',
    'actor_id',
    'roadmap_role',
    'actor_context_source',
    'display_name',
    'locale',
    'timezone',
    'fetched_at',
}


@dataclass
class _AutoCommitExecutionResult:
    auto_commit_ms: int
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None
    active_draft_version: int | None
    artifact: RoadmapCommitArtifact | None
    inline_commit_size_bytes: int | None


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _serialized_payload_bytes(payload: dict) -> int:
    return len(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))


def _extract_upstream_error_code(detail: object) -> str | None:
    if not isinstance(detail, dict):
        return None

    code = detail.get('code')
    if isinstance(code, str) and code.strip():
        return code.strip()

    nested_detail = detail.get('detail')
    if isinstance(nested_detail, dict):
        nested_code = nested_detail.get('code')
        if isinstance(nested_code, str) and nested_code.strip():
            return nested_code.strip()

        nested_error = nested_detail.get('error')
        if isinstance(nested_error, dict):
            error_code = nested_error.get('code')
            if isinstance(error_code, str) and error_code.strip():
                return error_code.strip()

    return None


def _resolve_draft_snapshot(
    session: AgentSession,
    agent_service: AgentService,
) -> tuple[str, int, list]:
    if settings.agent_draft_graph_enabled:
        ensure_fn = getattr(agent_service, 'ensure_draft_graph_initialized', None)
        get_active_fn = getattr(agent_service, 'get_active_draft', None)
        if callable(ensure_fn) and callable(get_active_fn):
            ensure_fn(session)
            active_draft = get_active_fn(session)
            return active_draft.draft_id, active_draft.draft_version, active_draft.operations

        drafts = session.metadata.drafts
        if not isinstance(drafts, dict):
            raise RuntimeError('Draft graph metadata is malformed: drafts must be a mapping.')

        active_draft_id = session.metadata.active_draft_id
        if active_draft_id:
            draft = drafts.get(active_draft_id)
            if isinstance(draft, DraftNode):
                return draft.draft_id, draft.draft_version, draft.operations
        raise RuntimeError('Draft graph runtime does not expose active draft helpers.')
    draft_id = session.metadata.active_draft_id or f'{session.session_id}:draft'
    return draft_id, session.staged_operations_version, session.operations


def _set_draft_status(
    *,
    session: AgentSession,
    draft_id: str,
    status: str,
) -> bool:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return False

    if hasattr(candidate, 'status') and hasattr(candidate, 'updated_at'):
        candidate.status = status
        candidate.updated_at = _utcnow()
        return True

    if isinstance(candidate, dict):
        candidate['status'] = status
        candidate['updated_at'] = _utcnow()
        return True

    return False


def _get_draft_parent_id(
    session: AgentSession,
    draft_id: str,
) -> str | None:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return None
    if hasattr(candidate, 'parent_draft_id'):
        parent_draft_id = candidate.parent_draft_id
        return parent_draft_id if isinstance(parent_draft_id, str) and parent_draft_id else None
    if isinstance(candidate, dict):
        parent_draft_id = candidate.get('parent_draft_id')
        return parent_draft_id if isinstance(parent_draft_id, str) and parent_draft_id else None
    return None


def _get_draft_status(
    session: AgentSession,
    draft_id: str,
) -> str | None:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return None
    if hasattr(candidate, 'status'):
        status = candidate.status
        return status if isinstance(status, str) and status else None
    if isinstance(candidate, dict):
        status = candidate.get('status')
        return status if isinstance(status, str) and status else None
    return None


def _is_descendant_of_draft(
    session: AgentSession,
    *,
    draft_id: str,
    ancestor_draft_id: str,
) -> bool:
    visited: set[str] = set()
    current = _get_draft_parent_id(session, draft_id)
    while current is not None and current not in visited:
        if current == ancestor_draft_id:
            return True
        visited.add(current)
        current = _get_draft_parent_id(session, current)
    return False


def _repoint_active_draft_after_commit(
    session: AgentSession,
    *,
    selected_draft_id: str,
) -> int:
    if selected_draft_id not in session.metadata.drafts:
        return 0

    session.metadata.active_draft_id = selected_draft_id
    session.metadata.draft_head_ids = [selected_draft_id]

    abandoned_descendants = 0
    for candidate_draft_id in list(session.metadata.drafts.keys()):
        if candidate_draft_id == selected_draft_id:
            continue
        if not _is_descendant_of_draft(
            session,
            draft_id=candidate_draft_id,
            ancestor_draft_id=selected_draft_id,
        ):
            continue

        current_status = _get_draft_status(session, candidate_draft_id)
        if current_status in {'applied', 'abandoned'}:
            continue

        if _set_draft_status(
            session=session,
            draft_id=candidate_draft_id,
            status='abandoned',
        ):
            abandoned_descendants += 1

    return abandoned_descendants


def _reuse_selected_draft_as_post_commit_head(
    session: AgentSession,
    *,
    selected_draft_id: str,
) -> int:
    candidate = session.metadata.drafts.get(selected_draft_id)
    if candidate is None:
        raise RuntimeError(
            f'Cannot reuse draft as post-commit head; draft not found: {selected_draft_id}'
        )

    now = _utcnow()
    if hasattr(candidate, 'operations') and hasattr(candidate, 'draft_version'):
        next_version = (
            candidate.draft_version + 1
            if isinstance(candidate.draft_version, int)
            else 1
        )
        candidate.operations = []
        candidate.draft_version = next_version
        candidate.status = 'active'
        candidate.updated_at = now
    elif isinstance(candidate, dict):
        current_version = candidate.get('draft_version')
        next_version = current_version + 1 if isinstance(current_version, int) else 1
        candidate['operations'] = []
        candidate['draft_version'] = next_version
        candidate['status'] = 'active'
        candidate['updated_at'] = now
    else:
        raise RuntimeError(
            f'Cannot reuse draft as post-commit head; malformed draft: {selected_draft_id}'
        )

    session.metadata.active_draft_id = selected_draft_id
    session.metadata.draft_head_ids = [selected_draft_id]
    return next_version


def _service_unavailable(reason: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            'code': 'SESSION_STORE_UNAVAILABLE',
            'message': (
                'Agent session service is unavailable. Configure Redis and restart the agent.'
            ),
            'retryable': True,
        },
    )


async def _run_store_call(func, *args):
    try:
        return await asyncio.to_thread(func, *args)
    except SessionStoreUnavailableError as exc:
        logger.error(
            'Session store unavailable. operation=%s reason=%s',
            exc.operation,
            exc.reason,
        )
        raise _service_unavailable(exc.reason) from exc


def _get_agent_runtime() -> tuple[SessionStore, AgentService]:
    global _store, _agent_service, _session_service_unavailable_reason

    if _store is not None and _agent_service is not None:
        return _store, _agent_service

    if _session_service_unavailable_reason is not None:
        raise _service_unavailable(_session_service_unavailable_reason)

    try:
        store = SessionStore()
        service = AgentService(store)
        _store = store
        _agent_service = service
        return store, service
    except Exception as exc:
        _session_service_unavailable_reason = str(exc)
        logger.error('Session runtime unavailable: %s', _session_service_unavailable_reason)
        raise _service_unavailable(_session_service_unavailable_reason)


async def _get_agent_runtime_async() -> tuple[SessionStore, AgentService]:
    return await _run_store_call(_get_agent_runtime)


async def _get_session_or_404_async(
    agent_service: AgentService,
    session_id: str,
) -> AgentSession:
    return await _run_store_call(agent_service.get_session_or_404, session_id)


def _sanitize_session_metadata(
    metadata: dict | None,
) -> tuple[dict, bool]:
    if not isinstance(metadata, dict):
        return {}, False

    stripped = False

    def _walk(value):
        nonlocal stripped
        if isinstance(value, dict):
            cleaned: dict = {}
            for key, nested in value.items():
                key_text = str(key).strip().lower()
                if key_text in _ACTOR_METADATA_KEYS:
                    stripped = True
                    continue
                cleaned[key] = _walk(nested)
            return cleaned
        if isinstance(value, list):
            return [_walk(item) for item in value]
        return value

    sanitized = _walk(metadata)
    if not isinstance(sanitized, dict):
        return {}, stripped
    return sanitized, stripped


def _schedule_auto_commit_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _pending_auto_commit_tasks.add(task)
    task.add_done_callback(_pending_auto_commit_tasks.discard)
    return task


async def _execute_auto_commit(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
) -> _AutoCommitExecutionResult:
    draft_id, draft_version, draft_operations = _resolve_draft_snapshot(
        session,
        agent_service,
    )

    commit_started = perf_counter()
    commit_result = await _nest_client.commit(
        roadmap_id=session.roadmap_id,
        payload={
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'operations': [
                operation.model_dump(exclude_none=True)
                for operation in draft_operations
            ],
        },
        auth_header=auth_header,
        trace_id=trace_id,
    )
    auto_commit_ms = int((perf_counter() - commit_started) * 1000)

    change_id_raw = commit_result.get('change_id')
    change_id = (
        str(change_id_raw).strip()
        if isinstance(change_id_raw, str) and str(change_id_raw).strip()
        else None
    )
    committed_revision_token = commit_result.get('revision_token')
    if isinstance(committed_revision_token, str):
        session.revision_token = committed_revision_token

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
            draft_id=draft_id,
            draft_version=draft_version,
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

    staged_operations_count: int
    staged_operations_version: int
    active_draft_id: str | None
    active_draft_version: int | None
    if settings.agent_draft_graph_enabled:
        agent_service.ensure_draft_graph_initialized(session)
        next_draft_version = _reuse_selected_draft_as_post_commit_head(
            session,
            selected_draft_id=draft_id,
        )
        staged_operations_count = 0
        staged_operations_version = next_draft_version
        active_draft_id = draft_id
        active_draft_version = next_draft_version
    else:
        _set_draft_status(
            session=session,
            draft_id=draft_id,
            status='applied',
        )
        session.operations = []
        session.staged_operations_version += 1
        staged_operations_count = 0
        staged_operations_version = session.staged_operations_version
        active_draft_id = None
        active_draft_version = None

    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None

    artifact = _build_commit_artifact(
        session,
        commit_result,
        change_id=change_id,
        status='applied',
    )
    inline_commit_size_bytes: int | None = None
    if artifact is not None:
        inline_payload = dict(commit_result)
        inline_commit_size_bytes = _serialized_payload_bytes(inline_payload)
        inline_artifact = artifact.model_copy(update={'inline_commit': inline_payload})
        session.artifacts.append(inline_artifact)
        artifact = inline_artifact

    await _run_store_call(store.update, session)
    return _AutoCommitExecutionResult(
        auto_commit_ms=auto_commit_ms,
        staged_operations_version=staged_operations_version,
        staged_operations_count=staged_operations_count,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        artifact=artifact,
        inline_commit_size_bytes=inline_commit_size_bytes,
    )


async def _run_auto_commit_in_background(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
) -> None:
    started_at = perf_counter()
    try:
        result = await _execute_auto_commit(
            store=store,
            agent_service=agent_service,
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        log_event(
            logger,
            'auto_commit_async_completed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_ms=result.auto_commit_ms,
            staged_operations_count=result.staged_operations_count,
            staged_operations_version=result.staged_operations_version,
            active_draft_id=result.active_draft_id,
            active_draft_version=result.active_draft_version,
            inline_commit_size_bytes=result.inline_commit_size_bytes,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
    except HTTPException as exc:
        log_event(
            logger,
            'auto_commit_async_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_error_code=_extract_upstream_error_code(exc.detail),
            auto_commit_error_retryable=(
                exc.status_code >= 500 or exc.status_code in {408, 429}
            ),
            auto_commit_error_upstream_status=exc.status_code,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
    except Exception:
        logger.exception(
            'Async auto-commit failed. session_id=%s roadmap_id=%s',
            session.session_id,
            session.roadmap_id,
        )
        log_event(
            logger,
            'auto_commit_async_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_error_code='INTERNAL_ERROR',
            auto_commit_error_retryable=True,
            auto_commit_error_upstream_status=None,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )


@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest) -> CreateSessionResponse:
    store, _ = await _get_agent_runtime_async()
    logger.info('Creating AI session for roadmap_id=%s base_revision=%s', payload.roadmap_id, payload.base_revision)
    sanitized_metadata, actor_metadata_stripped = _sanitize_session_metadata(payload.metadata)
    if actor_metadata_stripped:
        log_event(
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
    await _run_store_call(store.create, session)
    return CreateSessionResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        created_at=session.created_at,
    )


@router.post('/{session_id}/messages', response_model=MessageResponse)
async def send_message(
    session_id: str,
    payload: MessageRequest,
    request: Request,
) -> MessageResponse:
    store, agent_service = await _get_agent_runtime_async()
    trace_id = str(uuid4())
    started_at = perf_counter()
    session = await _get_session_or_404_async(agent_service, session_id)
    log_event(
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
        outcome = await _run_store_call(
            agent_service.plan_message,
            session,
            payload.message,
            False,
            request.headers.get('Authorization'),
            trace_id,
        )
        _, _, staged_snapshot_operations = _resolve_draft_snapshot(
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
                    _schedule_auto_commit_task(
                        _run_auto_commit_in_background(
                            store=store,
                            agent_service=agent_service,
                            session=outcome.session,
                            auth_header=auth_header,
                            trace_id=trace_id,
                        )
                    )
                    auto_commit_async_enqueued = True
                else:
                    auto_commit_result = await _execute_auto_commit(
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
            auto_commit_error_code = _extract_upstream_error_code(exc.detail)
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
        log_event(
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


@router.post('/{session_id}/commit')
async def commit_session(
    session_id: str,
    payload: CommitRequest,
    request: Request,
) -> dict:
    store, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)
    trace_id = request.headers.get('X-Trace-Id') or str(uuid4())
    started_at = perf_counter()
    if payload.operations is not None:
        selected_draft_id = session.metadata.active_draft_id or f'{session.session_id}:adhoc'
        selected_draft_version = 0
        selected_operations = payload.operations
    else:
        selected_draft_id, selected_draft_version, selected_operations = _resolve_draft_snapshot(
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

    try:
        commit_result = await _nest_client.commit(
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
    except HTTPException:
        raise

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
            _reuse_selected_draft_as_post_commit_head(
                session,
                selected_draft_id=selected_draft_id,
            )
        else:
            _set_draft_status(
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
    await _run_store_call(store.update, session)

    log_event(
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


@router.post('/{session_id}/discard', response_model=DiscardResponse)
async def discard_session(
    session_id: str,
    payload: DiscardRequest,
    request: Request,
) -> DiscardResponse:
    store, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)
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

    discard_result = await _nest_client.discard_preview(
        roadmap_id=session.roadmap_id,
        payload={'change_id': change_id},
        auth_header=request.headers.get('Authorization'),
    )

    discarded_at = _utcnow()
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
    timeline_status: dict[str, str] = {}
    timeline_discarded_at: dict[str, datetime | None] = {}
    if isinstance(timeline, list):
        for item in timeline:
            if not isinstance(item, dict):
                continue
            timeline_change_id = item.get('change_id')
            timeline_entry_status = item.get('status')
            if not isinstance(timeline_change_id, str) or not timeline_change_id.strip():
                continue
            if timeline_entry_status not in {'applied', 'discarded'}:
                continue
            timeline_status[timeline_change_id] = timeline_entry_status
            timeline_entry_discarded_at = item.get('discarded_at')
            if isinstance(timeline_entry_discarded_at, str):
                try:
                    timeline_discarded_at[timeline_change_id] = datetime.fromisoformat(
                        timeline_entry_discarded_at.replace('Z', '+00:00')
                    ).replace(tzinfo=None)
                except ValueError:
                    timeline_discarded_at[timeline_change_id] = None
            else:
                timeline_discarded_at[timeline_change_id] = None

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
    await _run_store_call(store.update, session)

    staged_operations_count = len(session.operations)
    staged_operations_version = session.staged_operations_version
    try:
        _, staged_operations_version, staged_operations = _resolve_draft_snapshot(
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


@router.post('/{session_id}/rollback')
async def rollback_session(
    session_id: str,
    payload: RollbackRequest,
    request: Request,
) -> dict:
    store, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)

    rollback_result = await _nest_client.rollback(
        roadmap_id=session.roadmap_id,
        payload=payload.model_dump(),
        auth_header=request.headers.get('Authorization'),
    )

    revision_token = rollback_result.get('revision_token')
    if isinstance(revision_token, str):
        session.revision_token = revision_token

    timeline = rollback_result.get('timeline')
    timeline_status: dict[str, str] = {}
    if isinstance(timeline, list):
        for item in timeline:
            if not isinstance(item, dict):
                continue
            timeline_change_id = item.get('change_id')
            timeline_entry_status = item.get('status')
            if (
                isinstance(timeline_change_id, str)
                and timeline_change_id.strip()
                and timeline_entry_status in {'applied', 'discarded'}
            ):
                timeline_status[timeline_change_id] = timeline_entry_status

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

    await _run_store_call(store.update, session)

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'rollback': rollback_result,
    }


def _build_commit_artifact(
    session: AgentSession,
    commit_result: dict,
    change_id: str | None = None,
    status: str = 'applied',
) -> RoadmapCommitArtifact | None:
    effective_change_id = change_id
    if effective_change_id is None:
        change_id_raw = commit_result.get('change_id')
        if isinstance(change_id_raw, str) and change_id_raw.strip():
            effective_change_id = change_id_raw.strip()

    semantic_diff = commit_result.get('semantic_diff')
    summary_payload = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else {}
    semantic_diff_summary = summary_payload if isinstance(summary_payload, dict) else {}
    total_changes = sum(
        value for value in semantic_diff_summary.values() if isinstance(value, int)
    )
    validation_issues = commit_result.get('validation_issues')
    validation_issue_count = (
        len(validation_issues) if isinstance(validation_issues, list) else 0
    )

    return RoadmapCommitArtifact(
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        change_id=effective_change_id,
        title='Roadmap Commit Artifact',
        summary=f'Applied {total_changes} semantic change(s).',
        semantic_diff_summary=semantic_diff_summary,
        validation_issue_count=validation_issue_count,
        validation_issues=[],
        has_validation_errors=False,
        status=status if status in {'draft', 'applied', 'discarded'} else 'applied',
    )
