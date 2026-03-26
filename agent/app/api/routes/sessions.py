import logging

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

from app.core.contracts.sessions import (
    AgentSession,
    CommitRequest,
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
    PreviewRequest,
    RollbackRequest,
)
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore

router = APIRouter(prefix='/agent/sessions', tags=['agent'])
logger = logging.getLogger(__name__)

_store = SessionStore()
_agent_service = AgentService(_store)
_nest_client = NestRoadmapClient()


@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest) -> CreateSessionResponse:
    logger.info('Creating AI session for roadmap_id=%s base_revision=%s', payload.roadmap_id, payload.base_revision)
    session = AgentSession(
        roadmap_id=payload.roadmap_id,
        base_revision=payload.base_revision,
        metadata=payload.metadata or {},
    )
    _store.create(session)
    return CreateSessionResponse(
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        created_at=session.created_at,
    )


@router.post('/{session_id}/messages', response_model=MessageResponse)
async def send_message(session_id: str, payload: MessageRequest) -> MessageResponse:
    session = _agent_service.get_session_or_404(session_id)
    outcome = _agent_service.plan_message(
        session,
        payload.message,
        payload.replace_operations,
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
    )


@router.post('/{session_id}/preview')
async def preview_session(
    session_id: str,
    payload: PreviewRequest,
    request: Request,
) -> dict:
    session = _agent_service.get_session_or_404(session_id)

    operations = payload.operations if payload.operations is not None else session.operations
    base_revision = payload.base_revision if payload.base_revision is not None else session.base_revision

    try:
        preview_result = await _nest_client.preview(
            roadmap_id=session.roadmap_id,
            payload={
                'base_revision': base_revision,
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
    if isinstance(preview_id, str):
        session.latest_preview_id = preview_id
        _store.update(session)

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'base_revision': base_revision,
        'operations': [op.model_dump(exclude_none=True) for op in operations],
        'preview': preview_result,
    }


@router.post('/{session_id}/commit')
async def commit_session(
    session_id: str,
    payload: CommitRequest,
    request: Request,
) -> dict:
    session = _agent_service.get_session_or_404(session_id)

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
        },
        auth_header=request.headers.get('Authorization'),
    )

    return {
        'session_id': session.session_id,
        'roadmap_id': session.roadmap_id,
        'commit': commit_result,
    }


@router.post('/{session_id}/rollback')
async def rollback_session(
    session_id: str,
    payload: RollbackRequest,
    request: Request,
) -> dict:
    session = _agent_service.get_session_or_404(session_id)

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
