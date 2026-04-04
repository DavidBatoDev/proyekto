import logging
import asyncio
import json
import hashlib
from datetime import datetime
from time import perf_counter
from uuid import uuid4
from typing import cast

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import (
    AppliedDraftCommit,
    AgentSession,
    ArtifactPreviewResponse,
    CommitRequest,
    CreateSessionRequest,
    CreateSessionResponse,
    DiscardRequest,
    DiscardResponse,
    MessageRequest,
    MessageResponse,
    PreviewRequest,
    PreviewFingerprintBinding,
    RoadmapPreviewArtifact,
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


def _serialized_payload_bytes(payload: dict) -> int:
    return len(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))


def _normalize_artifact_preview_error(exc: HTTPException) -> dict:
    detail = exc.detail if isinstance(exc.detail, dict) else {'message': str(exc.detail)}
    upstream_status = int(exc.status_code)
    code = 'ARTIFACT_PREVIEW_FAILED'
    message = 'Failed to load artifact preview.'

    upstream_error = detail.get('detail') if isinstance(detail, dict) else None
    if isinstance(upstream_error, dict):
        nested_error = upstream_error.get('error')
        if isinstance(nested_error, dict):
            nested_message = nested_error.get('message')
            if isinstance(nested_message, str) and nested_message.strip():
                message = nested_message
            nested_code = nested_error.get('code')
            if isinstance(nested_code, str) and nested_code.strip():
                code = nested_code

    if isinstance(detail, dict):
        maybe_message = detail.get('message')
        if isinstance(maybe_message, str) and maybe_message.strip():
            message = maybe_message
        maybe_code = detail.get('code')
        if isinstance(maybe_code, str) and maybe_code.strip():
            code = maybe_code

    retryable = upstream_status >= 500 or upstream_status in {408, 429}
    return {
        'code': code,
        'message': message,
        'retryable': retryable,
        'upstream_status': upstream_status,
    }


def _is_preview_not_found_error(normalized: dict) -> bool:
    upstream_status = normalized.get('upstream_status')
    if upstream_status != 404:
        return False

    code = str(normalized.get('code') or '').strip().upper()
    if code in {'PREVIEW_NOT_FOUND', 'NOT_FOUND'}:
        return True

    message = str(normalized.get('message') or '').strip().lower()
    return 'preview' in message and 'not found' in message


def _resolve_draft_snapshot(
    session: AgentSession,
    agent_service: AgentService,
) -> tuple[str, int, list]:
    if settings.agent_draft_graph_enabled:
        try:
            agent_service.ensure_draft_graph_initialized(session)
            active_draft = agent_service.get_active_draft(session)
            return active_draft.draft_id, active_draft.draft_version, active_draft.operations
        except Exception:
            pass
    draft_id = session.metadata.active_draft_id or f'{session.session_id}:legacy'
    return draft_id, session.staged_operations_version, session.operations


def _resolve_draft_snapshot_by_id(
    session: AgentSession,
    draft_id: str,
) -> tuple[str, int, list] | None:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return None

    if hasattr(candidate, 'draft_version') and hasattr(candidate, 'operations'):
        return draft_id, int(candidate.draft_version), list(candidate.operations)

    if isinstance(candidate, dict):
        draft_version = candidate.get('draft_version')
        operations = candidate.get('operations')
        if isinstance(draft_version, int) and isinstance(operations, list):
            return draft_id, draft_version, operations

    return None


def _resolve_snapshot_for_binding(
    session: AgentSession,
    binding: PreviewFingerprintBinding,
) -> tuple[str, int, list] | None:
    if binding.binding_scope == 'ad_hoc_operations':
        return None

    by_id = _resolve_draft_snapshot_by_id(session, binding.draft_id)
    if by_id is not None:
        return by_id

    legacy_prefix = f'{session.session_id}:legacy'
    if binding.draft_id == legacy_prefix:
        return legacy_prefix, session.staged_operations_version, session.operations

    return None


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
        candidate.updated_at = datetime.utcnow()
        return True

    if isinstance(candidate, dict):
        candidate['status'] = status
        candidate['updated_at'] = datetime.utcnow()
        return True

    return False


def _compute_preview_fingerprint(
    *,
    draft_id: str,
    draft_version: int,
    operations: list,
    base_revision: int | None,
) -> str:
    payload = {
        'draft_id': draft_id,
        'draft_version': draft_version,
        'base_revision': base_revision,
        'operations': [
            op.model_dump(exclude_none=True) if hasattr(op, 'model_dump') else op
            for op in operations
        ],
    }
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(',', ':'),
        ensure_ascii=True,
    ).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def _upsert_preview_fingerprint_binding(
    *,
    session: AgentSession,
    preview_id: str,
    draft_id: str,
    draft_version: int,
    base_revision: int | None,
    fingerprint: str,
    binding_scope: str = 'draft_snapshot',
) -> None:
    bindings = session.metadata.preview_fingerprint_bindings
    if not isinstance(bindings, dict):
        bindings = {}
    bindings[preview_id] = PreviewFingerprintBinding(
        preview_id=preview_id,
        draft_id=draft_id,
        draft_version=draft_version,
        base_revision=base_revision,
        preview_fingerprint=fingerprint,
        binding_scope=binding_scope,
    )
    session.metadata.preview_fingerprint_bindings = bindings
    session.metadata.latest_preview_fingerprint = fingerprint


def _get_preview_fingerprint_binding(
    session: AgentSession,
    preview_id: str,
) -> PreviewFingerprintBinding | None:
    bindings = session.metadata.preview_fingerprint_bindings
    if not isinstance(bindings, dict):
        return None
    candidate = bindings.get(preview_id)
    if isinstance(candidate, PreviewFingerprintBinding):
        return candidate
    if isinstance(candidate, dict):
        try:
            return PreviewFingerprintBinding.model_validate(candidate)
        except Exception:
            return None
    return None


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
        replace_operations=payload.replace_operations,
        auto_preview=payload.auto_preview,
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
    artifacts: list[RoadmapPreviewArtifact] = []
    response_artifacts: list[RoadmapPreviewArtifact] = []
    error_code: int | None = None
    preview_generation_ms: int | None = None
    preview_error_code: str | None = None
    preview_error_retryable: bool | None = None
    preview_error_upstream_status: int | None = None
    inline_preview_skipped_due_to_size = False
    inline_preview_size_bytes: int | None = None
    effective_preview_available: bool = False
    effective_preview_recommended: bool = False
    try:
        outcome = await _run_store_call(
            agent_service.plan_message,
            session,
            payload.message,
            payload.replace_operations,
            request.headers.get('Authorization'),
            trace_id,
        )

        if (
            payload.auto_preview
            and outcome.response_mode == 'edit_plan'
            and outcome.preview_available
        ):
            preview_started = perf_counter()
            try:
                preview_result = await _nest_client.preview(
                    roadmap_id=outcome.session.roadmap_id,
                    payload={
                        'base_revision': outcome.session.base_revision,
                        'revision_token': outcome.session.revision_token,
                        'operations': [
                            op.model_dump(exclude_none=True)
                            for op in outcome.session.operations
                        ],
                    },
                    auth_header=request.headers.get('Authorization'),
                    trace_id=trace_id,
                )
                preview_generation_ms = int((perf_counter() - preview_started) * 1000)
                validation_issues = preview_result.get('validation_issues')
                has_validation_errors = (
                    isinstance(validation_issues, list)
                    and any(
                        isinstance(issue, dict)
                        and str(issue.get('severity') or '').lower() == 'error'
                        for issue in validation_issues
                    )
                )
                if has_validation_errors:
                    effective_preview_available = False
                    effective_preview_recommended = False
                    preview_error_code = 'PREVIEW_VALIDATION_ERROR'
                    preview_error_retryable = False
                    preview_error_upstream_status = None
                    setattr(outcome.session.metadata, 'awaiting_preview_fix', True)
                    outcome.session.latest_preview_id = None
                    outcome.session.metadata.latest_preview_fingerprint = None
                    outcome.session.artifacts = []
                    outcome.assistant_message = (
                        'I staged your edit, but preview validation failed. '
                        'Please adjust the change details and try again, or say "cancel".'
                    )
                    await _run_store_call(store.update, outcome.session)
                else:
                    preview_id = preview_result.get('preview_id')
                    if isinstance(preview_id, str):
                        outcome.session.latest_preview_id = preview_id
                        draft_id, draft_version, draft_operations = _resolve_draft_snapshot(
                            outcome.session,
                            agent_service,
                        )
                        preview_fingerprint = _compute_preview_fingerprint(
                            draft_id=draft_id,
                            draft_version=draft_version,
                            operations=draft_operations,
                            base_revision=outcome.session.base_revision,
                        )
                        _upsert_preview_fingerprint_binding(
                            session=outcome.session,
                            preview_id=preview_id,
                            draft_id=draft_id,
                            draft_version=draft_version,
                            base_revision=outcome.session.base_revision,
                            fingerprint=preview_fingerprint,
                            binding_scope='draft_snapshot',
                        )
                        _set_draft_status(
                            session=outcome.session,
                            draft_id=draft_id,
                            status='previewed',
                        )
                        revision_token = preview_result.get('revision_token')
                        if isinstance(revision_token, str):
                            outcome.session.revision_token = revision_token
                        if bool(getattr(outcome.session.metadata, 'awaiting_preview_fix', False)):
                            setattr(outcome.session.metadata, 'awaiting_preview_fix', False)
                        artifact = _build_preview_artifact(outcome.session, preview_result)
                        if artifact is not None:
                            outcome.session.artifacts.append(artifact)
                            inline_preview_size_bytes = _serialized_payload_bytes(preview_result)
                            if inline_preview_size_bytes <= settings.inline_preview_max_bytes:
                                response_artifacts.append(
                                    artifact.model_copy(update={'inline_preview': preview_result})
                                )
                            else:
                                inline_preview_skipped_due_to_size = True
                                response_artifacts.append(artifact)
                            artifacts.append(artifact)
                        await _run_store_call(store.update, outcome.session)
                    effective_preview_available = outcome.preview_available
                    effective_preview_recommended = outcome.preview_recommended
            except HTTPException as exc:
                preview_generation_ms = int((perf_counter() - preview_started) * 1000)
                normalized_preview_error = _normalize_artifact_preview_error(exc)
                preview_error_code = str(normalized_preview_error.get('code') or '')
                preview_error_retryable = bool(normalized_preview_error.get('retryable'))
                upstream_status_value = normalized_preview_error.get('upstream_status')
                preview_error_upstream_status = (
                    int(upstream_status_value)
                    if isinstance(upstream_status_value, int)
                    else None
                )
                effective_preview_available = False
                effective_preview_recommended = False
                logger.warning(
                    'Auto-preview artifact generation failed for session_id=%s roadmap_id=%s status=%s detail=%s',
                    outcome.session.session_id,
                    outcome.session.roadmap_id,
                    exc.status_code,
                    exc.detail,
                )
        else:
            effective_preview_available = outcome.preview_available
            effective_preview_recommended = outcome.preview_recommended

        return MessageResponse(
            session_id=outcome.session.session_id,
            assistant_message=outcome.assistant_message,
            parse_mode=outcome.parse_mode,
            intent_type=outcome.intent_type,
            response_mode=outcome.response_mode,
            operations=outcome.operations,
            preview_available=effective_preview_available,
            preview_recommended=effective_preview_recommended,
            staged_operations_version=outcome.staged_operations_version,
            staged_operations_count=outcome.staged_operations_count,
            active_draft_id=outcome.active_draft_id,
            active_draft_version=outcome.active_draft_version,
            artifacts=response_artifacts or artifacts,
            provider_used=outcome.provider_used,
            fallback_used=outcome.fallback_used,
            provider_error_code=outcome.provider_error_code,
            debug_trace_id=trace_id,
        )
    except HTTPException as exc:
        error_code = exc.status_code
        raise
    finally:
        elapsed_ms = int((perf_counter() - started_at) * 1000)
        total_edit_turn_ms = (
            elapsed_ms
            if outcome is not None and outcome.response_mode == 'edit_plan'
            else None
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
            inline_preview_included=any(
                artifact.inline_preview is not None for artifact in response_artifacts
            ),
            inline_preview_skipped_due_to_size=inline_preview_skipped_due_to_size,
            inline_preview_size_bytes=inline_preview_size_bytes,
            artifact_first_read_source=(
                'inline'
                if any(artifact.inline_preview is not None for artifact in response_artifacts)
                else None
            ),
            preview_available=effective_preview_available if outcome else False,
            preview_recommended=effective_preview_recommended if outcome else False,
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
            fastpath_reason=outcome.fastpath_reason if outcome else None,
            fastpath_bypass_reason=outcome.fastpath_bypass_reason if outcome else None,
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
            preview_generation_ms=preview_generation_ms,
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
            preview_error_code=preview_error_code,
            preview_error_retryable=preview_error_retryable,
            preview_error_upstream_status=preview_error_upstream_status,
            planner_mode=(outcome.planner_mode if outcome else None),
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
        )


@router.post('/{session_id}/preview')
async def preview_session(
    session_id: str,
    payload: PreviewRequest,
    request: Request,
) -> dict:
    store, agent_service = await _get_agent_runtime_async()
    trace_id = request.headers.get('X-Trace-Id') or str(uuid4())
    started_at = perf_counter()
    session = await _get_session_or_404_async(agent_service, session_id)

    operations = payload.operations if payload.operations is not None else session.operations
    base_revision = payload.base_revision if payload.base_revision is not None else session.base_revision
    revision_token = (
        payload.revision_token
        if payload.revision_token is not None
        else session.revision_token
    )

    try:
        preview_result = await _nest_client.preview(
            roadmap_id=session.roadmap_id,
            payload={
                'base_revision': base_revision,
                'revision_token': revision_token,
                'operations': [op.model_dump(exclude_none=True) for op in operations],
            },
            auth_header=request.headers.get('Authorization'),
            trace_id=trace_id,
        )
    except HTTPException as exc:
        logger.warning(
            'Preview failed for session_id=%s roadmap_id=%s status=%s detail=%s',
            session_id,
            session.roadmap_id,
            exc.status_code,
            exc.detail,
        )
        log_event(
            logger,
            'session_preview_completed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=session.roadmap_id,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
            preview_available=False,
            preview_error_code='PREVIEW_FAILED',
            preview_error_upstream_status=exc.status_code,
        )
        raise

    preview_id = preview_result.get('preview_id')
    preview_revision_token = preview_result.get('revision_token')
    effective_revision_token = (
        preview_revision_token if isinstance(preview_revision_token, str) else revision_token
    )
    if isinstance(preview_id, str):
        session.latest_preview_id = preview_id
        if payload.operations is not None:
            draft_id = f'{session.session_id}:adhoc:{preview_id}'
            draft_version = 0
            draft_operations = payload.operations
            binding_scope = 'ad_hoc_operations'
        else:
            draft_id, draft_version, draft_operations = _resolve_draft_snapshot(
                session,
                agent_service,
            )
            binding_scope = 'draft_snapshot'
        preview_fingerprint = _compute_preview_fingerprint(
            draft_id=draft_id,
            draft_version=draft_version,
            operations=draft_operations,
            base_revision=base_revision,
        )
        _upsert_preview_fingerprint_binding(
            session=session,
            preview_id=preview_id,
            draft_id=draft_id,
            draft_version=draft_version,
            base_revision=base_revision,
            fingerprint=preview_fingerprint,
            binding_scope=binding_scope,
        )
        if binding_scope == 'draft_snapshot':
            _set_draft_status(
                session=session,
                draft_id=draft_id,
                status='previewed',
            )
        if isinstance(preview_revision_token, str):
            session.revision_token = preview_revision_token
            effective_revision_token = preview_revision_token
        else:
            effective_revision_token = cast(str | None, session.revision_token) or revision_token
        await _run_store_call(store.update, session)

    log_event(
        logger,
        'session_preview_completed',
        settings=settings,
        trace_id=trace_id,
        session_id=session_id,
        roadmap_id=session.roadmap_id,
        elapsed_ms=int((perf_counter() - started_at) * 1000),
        preview_available=True,
        preview_error_code=None,
        preview_error_upstream_status=None,
    )

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'base_revision': base_revision,
        'revision_token': effective_revision_token,
        'operations': [op.model_dump(exclude_none=True) for op in operations],
        'preview': preview_result,
    }


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

    preview_id = payload.preview_id or session.latest_preview_id
    if not preview_id:
        log_event(
            logger,
            'session_commit_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            reason='missing_preview_id',
        )
        return {
            'session_id': session.session_id,
            'error': 'Missing preview_id. Run /preview first or pass preview_id explicitly.',
        }

    auth_header = request.headers.get('Authorization')
    base_revision = payload.base_revision or session.base_revision
    revision_token = payload.revision_token or session.revision_token
    applied_preview_ids_raw = session.metadata.applied_preview_ids
    if isinstance(applied_preview_ids_raw, list):
        applied_preview_ids = [
            value
            for value in applied_preview_ids_raw
            if isinstance(value, str) and value.strip()
        ]
    else:
        applied_preview_ids = []

    def _is_preview_already_applied(selected_preview_id: str) -> bool:
        return selected_preview_id in applied_preview_ids

    if _is_preview_already_applied(preview_id):
        log_event(
            logger,
            'session_commit_duplicate_blocked',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            preview_id=preview_id,
            reason='preview_already_applied',
        )
        raise HTTPException(
            status_code=409,
            detail={
                'code': 'ARTIFACT_ALREADY_APPLIED',
                'message': 'This artifact has already been applied. Generate a new preview before applying again.',
            },
        )

    draft_id, draft_version, draft_operations = _resolve_draft_snapshot(session, agent_service)
    selected_draft_id = draft_id
    selected_draft_version = draft_version
    selected_draft_operations = draft_operations
    selected_base_revision = base_revision
    selected_binding_scope = 'draft_snapshot'
    current_preview_fingerprint = _compute_preview_fingerprint(
        draft_id=selected_draft_id,
        draft_version=selected_draft_version,
        operations=selected_draft_operations,
        base_revision=selected_base_revision,
    )
    binding = _get_preview_fingerprint_binding(session, preview_id)
    binding_snapshot = None
    if binding is not None:
        selected_draft_id = binding.draft_id
        selected_draft_version = binding.draft_version
        selected_binding_scope = binding.binding_scope
        if binding.base_revision is not None:
            selected_base_revision = binding.base_revision
        if binding.binding_scope == 'draft_snapshot':
            binding_snapshot = _resolve_snapshot_for_binding(session, binding)
            if binding_snapshot is not None:
                (
                    selected_draft_id,
                    selected_draft_version,
                    selected_draft_operations,
                ) = binding_snapshot
                current_preview_fingerprint = _compute_preview_fingerprint(
                    draft_id=selected_draft_id,
                    draft_version=selected_draft_version,
                    operations=selected_draft_operations,
                    base_revision=selected_base_revision,
                )
        else:
            current_preview_fingerprint = binding.preview_fingerprint

    if settings.agent_strict_preview_fingerprint:
        if binding is None:
            log_event(
                logger,
                'session_commit_preview_binding_missing',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                preview_id=preview_id,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    'code': 'STALE_PREVIEW_REFERENCE',
                    'message': (
                        'Selected preview is not bound to the current staged snapshot. '
                        'Regenerate preview and apply again.'
                    ),
                },
            )
        if binding.binding_scope == 'draft_snapshot' and (
            binding_snapshot is None
            or binding.preview_fingerprint != current_preview_fingerprint
        ):
            log_event(
                logger,
                'session_commit_preview_fingerprint_mismatch',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                preview_id=preview_id,
                draft_id=selected_draft_id,
                draft_version=selected_draft_version,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    'code': 'STALE_PREVIEW_REFERENCE',
                    'message': (
                        'Selected preview is stale for the current staged edits. '
                        'Regenerate preview and apply again.'
                    ),
                },
            )

    def _build_commit_payload(selected_preview_id: str) -> dict:
        return {
            'preview_id': selected_preview_id,
            'base_revision': base_revision,
            'revision_token': revision_token,
        }

    commit_preview_id = preview_id

    try:
        commit_result = await _nest_client.commit(
            roadmap_id=session.roadmap_id,
            payload=_build_commit_payload(commit_preview_id),
            auth_header=auth_header,
            trace_id=trace_id,
        )
    except HTTPException as exc:
        normalized = _normalize_artifact_preview_error(exc)
        if _is_preview_not_found_error(normalized):
            log_event(
                logger,
                'session_commit_preview_not_found_stale',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                preview_id=commit_preview_id,
                latest_preview_id=session.latest_preview_id,
                reason='preview_not_found_requires_regeneration',
            )
            raise HTTPException(
                status_code=409,
                detail={
                    'code': 'STALE_PREVIEW_REFERENCE',
                    'message': (
                        'Selected preview is no longer available. Regenerate preview for current staged edits '
                        'and apply again.'
                    ),
                },
            ) from exc
        raise

    committed_revision_token = commit_result.get('revision_token')
    if isinstance(committed_revision_token, str):
        session.revision_token = committed_revision_token
    if commit_preview_id not in applied_preview_ids:
        applied_preview_ids.append(commit_preview_id)
    session.metadata.applied_preview_ids = applied_preview_ids
    session.metadata.applied_draft_commits.append(
        AppliedDraftCommit(
            preview_id=commit_preview_id,
            draft_id=selected_draft_id,
            draft_version=selected_draft_version,
            preview_fingerprint=current_preview_fingerprint,
        )
    )
    if selected_binding_scope == 'draft_snapshot':
        _set_draft_status(
            session=session,
            draft_id=selected_draft_id,
            status='applied',
        )
    session.latest_preview_id = None
    session.metadata.latest_preview_fingerprint = None
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
        preview_id=commit_preview_id,
        committed_revision_token=(
            committed_revision_token if isinstance(committed_revision_token, str) else None
        ),
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
    preview_id = payload.preview_id or session.latest_preview_id

    discarded_preview_id: str | None = None
    if preview_id:
        try:
            await _nest_client.discard_preview(
                roadmap_id=session.roadmap_id,
                payload={'preview_id': preview_id},
                auth_header=request.headers.get('Authorization'),
            )
            discarded_preview_id = preview_id
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

    draft_sync_applied = False
    if settings.agent_draft_graph_enabled:
        try:
            agent_service.ensure_draft_graph_initialized(session)
            active_draft = agent_service.get_active_draft(session)
            active_draft.operations = []
            active_draft.draft_version += 1
            active_draft.status = 'abandoned'
            active_draft.updated_at = datetime.utcnow()
            agent_service.mirror_active_draft_to_legacy_fields(session)
            draft_sync_applied = True
        except Exception:
            session.operations = []

    if not draft_sync_applied:
        session.operations = []
        session.staged_operations_version += 1
    session.latest_preview_id = None
    session.metadata.latest_preview_fingerprint = None
    session.metadata.preview_fingerprint_bindings = {}
    session.artifacts = []
    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None
    await _run_store_call(store.update, session)

    return DiscardResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        discarded_preview_id=discarded_preview_id,
        discarded_at=session.updated_at,
        staged_operations_count=len(session.operations),
        staged_operations_version=session.staged_operations_version,
    )


@router.post('/{session_id}/rollback')
async def rollback_session(
    session_id: str,
    payload: RollbackRequest,
    request: Request,
) -> dict:
    _, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)

    rollback_result = await _nest_client.rollback(
        roadmap_id=session.roadmap_id,
        payload=payload.model_dump(),
        auth_header=request.headers.get('Authorization'),
    )

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'rollback': rollback_result,
    }


@router.get('/{session_id}/artifacts/{artifact_id}', response_model=ArtifactPreviewResponse)
async def get_artifact_preview(
    session_id: str,
    artifact_id: str,
    request: Request,
) -> ArtifactPreviewResponse:
    _, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)
    artifact = next(
        (item for item in session.artifacts if item.artifact_id == artifact_id),
        None,
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail=f'Artifact {artifact_id} not found for session {session_id}.')

    trace_id = str(uuid4())
    fetch_started = perf_counter()
    try:
        preview_result = await _nest_client.get_preview(
            roadmap_id=session.roadmap_id,
            preview_id=artifact.preview_id,
            auth_header=request.headers.get('Authorization'),
            trace_id=trace_id,
        )
    except HTTPException as exc:
        normalized = _normalize_artifact_preview_error(exc)
        if _is_preview_not_found_error(normalized):
            log_event(
                logger,
                'artifact_fetch_stale_preview_reference',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session_id,
                roadmap_id=session.roadmap_id,
                artifact_id=artifact_id,
                preview_id=artifact.preview_id,
                error_code='STALE_PREVIEW_REFERENCE',
                upstream_status=normalized.get('upstream_status'),
            )
            raise HTTPException(
                status_code=409,
                detail={
                    'code': 'STALE_PREVIEW_REFERENCE',
                    'message': (
                        'Artifact preview is no longer available. Regenerate preview for current staged edits '
                        'and retry.'
                    ),
                    'retryable': False,
                    'upstream_status': normalized.get('upstream_status'),
                },
            ) from exc

        log_event(
            logger,
            'artifact_fetch_error',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=session.roadmap_id,
            artifact_id=artifact_id,
            preview_id=artifact.preview_id,
            error_code=normalized.get('code'),
            upstream_status=normalized.get('upstream_status'),
            retryable=normalized.get('retryable'),
            self_healed=False,
            self_heal_attempted=False,
            artifact_fetch_ms=int((perf_counter() - fetch_started) * 1000),
            artifact_self_heal_ms=None,
            artifact_first_read_source='fetch',
        )
        status_code = int(normalized.get('upstream_status') or exc.status_code)
        raise HTTPException(status_code=status_code, detail=normalized) from exc

    artifact_fetch_ms = int((perf_counter() - fetch_started) * 1000)
    log_event(
        logger,
        'artifact_fetch_succeeded',
        settings=settings,
        trace_id=trace_id,
        session_id=session_id,
        roadmap_id=session.roadmap_id,
        artifact_id=artifact_id,
        preview_id=artifact.preview_id,
        artifact_fetch_ms=artifact_fetch_ms,
        artifact_self_heal_ms=None,
        self_healed=False,
        artifact_first_read_source='fetch',
    )
    return ArtifactPreviewResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        artifact=artifact,
        preview=preview_result,
    )


def _build_preview_artifact(
    session: AgentSession,
    preview_result: dict,
) -> RoadmapPreviewArtifact | None:
    preview_id = preview_result.get('preview_id')
    if not isinstance(preview_id, str):
        return None

    semantic_diff = preview_result.get('semantic_diff')
    summary_payload = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else {}
    semantic_diff_summary = (
        summary_payload if isinstance(summary_payload, dict) else {}
    )
    total_changes = sum(
        value for value in semantic_diff_summary.values() if isinstance(value, int)
    )
    validation_issues = preview_result.get('validation_issues')
    validation_issue_count = (
        len(validation_issues) if isinstance(validation_issues, list) else 0
    )

    return RoadmapPreviewArtifact(
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        preview_id=preview_id,
        title='Roadmap Preview',
        summary=f'Prepared {total_changes} semantic change(s).',
        semantic_diff_summary=semantic_diff_summary,
        validation_issue_count=validation_issue_count,
    )
