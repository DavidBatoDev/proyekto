from fastapi import APIRouter, Request

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

_store = SessionStore()
_agent_service = AgentService(_store)
_nest_client = NestRoadmapClient()


@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest) -> CreateSessionResponse:
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
    updated, assistant_message, parse_mode = _agent_service.plan_message(
        session,
        payload.message,
        payload.replace_operations,
    )

    return MessageResponse(
        session_id=updated.session_id,
        assistant_message=assistant_message,
        parse_mode=parse_mode,
        operations=updated.operations,
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

    preview_result = await _nest_client.preview(
        roadmap_id=session.roadmap_id,
        payload={
            'base_revision': base_revision,
            'operations': [op.model_dump(exclude_none=True) for op in operations],
        },
        auth_header=request.headers.get('Authorization'),
    )

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