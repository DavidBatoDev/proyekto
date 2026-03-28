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


@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest) -> CreateSessionResponse:
    store, _ = await _get_agent_runtime_async()
    logger.info('Creating AI session for roadmap_id=%s base_revision=%s', payload.roadmap_id, payload.base_revision)
    session = AgentSession(
        roadmap_id=payload.roadmap_id,
        base_revision=payload.base_revision,
        revision_token=payload.revision_token,
        metadata=payload.metadata or {},
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
            assistant_message=outcome.assistant_message if outcome else None,
            tokens_input=outcome.tokens_input if outcome else None,
            tokens_output=outcome.tokens_output if outcome else None,
            tokens_total=outcome.tokens_total if outcome else None,
            operations_count=len(outcome.operations) if outcome else 0,
            artifacts_count=len(artifacts),
            preview_available=outcome.preview_available if outcome else False,
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

    preview_result = await _nest_client.get_preview(
        roadmap_id=session.roadmap_id,
        preview_id=artifact.preview_id,
        auth_header=request.headers.get('Authorization'),
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
