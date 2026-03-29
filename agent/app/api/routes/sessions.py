import logging
import asyncio
from time import perf_counter
from uuid import uuid4
from typing import cast

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import (
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


def _service_unavailable(reason: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            'code': 'SERVICE_UNAVAILABLE',
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
    error_code: int | None = None
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
                )
                preview_id = preview_result.get('preview_id')
                if isinstance(preview_id, str):
                    outcome.session.latest_preview_id = preview_id
                    revision_token = preview_result.get('revision_token')
                    if isinstance(revision_token, str):
                        outcome.session.revision_token = revision_token
                    artifact = _build_preview_artifact(outcome.session, preview_result)
                    if artifact is not None:
                        outcome.session.artifacts.append(artifact)
                        artifacts.append(artifact)
                    await _run_store_call(store.update, outcome.session)
            except HTTPException as exc:
                logger.warning(
                    'Auto-preview artifact generation failed for session_id=%s roadmap_id=%s status=%s detail=%s',
                    outcome.session.session_id,
                    outcome.session.roadmap_id,
                    exc.status_code,
                    exc.detail,
                )

        return MessageResponse(
            session_id=outcome.session.session_id,
            assistant_message=outcome.assistant_message,
            parse_mode=outcome.parse_mode,
            intent_type=outcome.intent_type,
            response_mode=outcome.response_mode,
            operations=outcome.operations,
            preview_available=outcome.preview_available,
            preview_recommended=outcome.preview_recommended,
            staged_operations_version=outcome.staged_operations_version,
            staged_operations_count=outcome.staged_operations_count,
            artifacts=artifacts,
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
            preview_available=outcome.preview_available if outcome else False,
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
        )


@router.post('/{session_id}/preview')
async def preview_session(
    session_id: str,
    payload: PreviewRequest,
    request: Request,
) -> dict:
    store, agent_service = await _get_agent_runtime_async()
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
        )
    except HTTPException as exc:
        logger.warning(
            'Preview failed for session_id=%s roadmap_id=%s status=%s detail=%s',
            session_id,
            session.roadmap_id,
            exc.status_code,
            exc.detail,
        )
        raise

    preview_id = preview_result.get('preview_id')
    preview_revision_token = preview_result.get('revision_token')
    effective_revision_token = (
        preview_revision_token if isinstance(preview_revision_token, str) else revision_token
    )
    if isinstance(preview_id, str):
        session.latest_preview_id = preview_id
        if isinstance(preview_revision_token, str):
            session.revision_token = preview_revision_token
            effective_revision_token = preview_revision_token
        else:
            effective_revision_token = cast(str | None, session.revision_token) or revision_token
        await _run_store_call(store.update, session)

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

    preview_id = payload.preview_id or session.latest_preview_id
    if not preview_id:
        return {
            'session_id': session.session_id,
            'error': 'Missing preview_id. Run /preview first or pass preview_id explicitly.',
        }

    commit_result = await _nest_client.commit(
        roadmap_id=session.roadmap_id,
        payload={
            'preview_id': preview_id,
            'base_revision': payload.base_revision or session.base_revision,
            'revision_token': payload.revision_token or session.revision_token,
        },
        auth_header=request.headers.get('Authorization'),
    )

    committed_revision_token = commit_result.get('revision_token')
    if isinstance(committed_revision_token, str):
        session.revision_token = committed_revision_token
    session.latest_preview_id = None
    session.metadata.pending_disambiguation = None
    session.metadata.pending_context_resolution = None
    await _run_store_call(store.update, session)

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

    session.operations = []
    session.staged_operations_version += 1
    session.latest_preview_id = None
    session.artifacts = []
    session.metadata.pending_disambiguation = None
    session.metadata.pending_context_resolution = None
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
    store, agent_service = await _get_agent_runtime_async()
    session = await _get_session_or_404_async(agent_service, session_id)
    artifact = next(
        (item for item in session.artifacts if item.artifact_id == artifact_id),
        None,
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail=f'Artifact {artifact_id} not found for session {session_id}.')

    trace_id = str(uuid4())
    try:
        preview_result = await _nest_client.get_preview(
            roadmap_id=session.roadmap_id,
            preview_id=artifact.preview_id,
            auth_header=request.headers.get('Authorization'),
        )
    except HTTPException as exc:
        normalized = _normalize_artifact_preview_error(exc)
        self_heal_attempted = _is_preview_not_found_error(normalized)
        if self_heal_attempted:
            log_event(
                logger,
                'artifact_fetch_self_heal_attempted',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session_id,
                roadmap_id=session.roadmap_id,
                artifact_id=artifact_id,
                preview_id=artifact.preview_id,
            )
            try:
                regenerated_preview = await _nest_client.preview(
                    roadmap_id=session.roadmap_id,
                    payload={
                        'base_revision': session.base_revision,
                        'revision_token': session.revision_token,
                        'operations': [
                            op.model_dump(exclude_none=True)
                            for op in session.operations
                        ],
                    },
                    auth_header=request.headers.get('Authorization'),
                )

                regenerated_preview_id = regenerated_preview.get('preview_id')
                regenerated_revision_token = regenerated_preview.get('revision_token')

                if isinstance(regenerated_preview_id, str):
                    artifact.preview_id = regenerated_preview_id
                    session.latest_preview_id = regenerated_preview_id
                if isinstance(regenerated_revision_token, str):
                    artifact.revision_token = regenerated_revision_token
                    session.revision_token = regenerated_revision_token
                if isinstance(session.base_revision, int):
                    artifact.base_revision = session.base_revision

                await _run_store_call(store.update, session)
                log_event(
                    logger,
                    'artifact_fetch_self_heal_succeeded',
                    settings=settings,
                    trace_id=trace_id,
                    session_id=session_id,
                    roadmap_id=session.roadmap_id,
                    artifact_id=artifact_id,
                    preview_id=artifact.preview_id,
                    self_healed=True,
                )
                return ArtifactPreviewResponse(
                    session_id=session.session_id,
                    roadmap_id=session.roadmap_id,
                    artifact=artifact,
                    preview=regenerated_preview,
                )
            except HTTPException as self_heal_exc:
                normalized = _normalize_artifact_preview_error(self_heal_exc)

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
            self_heal_attempted=self_heal_attempted,
        )
        status_code = int(normalized.get('upstream_status') or exc.status_code)
        raise HTTPException(status_code=status_code, detail=normalized) from exc

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
