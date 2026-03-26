import logging

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

from app.core.contracts.sessions import (
    AgentSession,
    ArtifactPreviewResponse,
    CommitRequest,
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
    PreviewRequest,
    RoadmapPreviewArtifact,
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
async def send_message(
    session_id: str,
    payload: MessageRequest,
    request: Request,
) -> MessageResponse:
    session = _agent_service.get_session_or_404(session_id)
    outcome = _agent_service.plan_message(
        session,
        payload.message,
        payload.replace_operations,
    )

    artifacts: list[RoadmapPreviewArtifact] = []
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
                artifact = _build_preview_artifact(outcome.session, preview_result)
                if artifact is not None:
                    outcome.session.artifacts.append(artifact)
                    artifacts.append(artifact)
                _store.update(outcome.session)
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


@router.get('/{session_id}/artifacts/{artifact_id}', response_model=ArtifactPreviewResponse)
async def get_artifact_preview(
    session_id: str,
    artifact_id: str,
    request: Request,
) -> ArtifactPreviewResponse:
    session = _agent_service.get_session_or_404(session_id)
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
        preview_id=preview_id,
        title='Roadmap Preview',
        summary=f'Prepared {total_changes} semantic change(s).',
        semantic_diff_summary=semantic_diff_summary,
        validation_issue_count=validation_issue_count,
    )
