import logging
import asyncio
from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.exceptions import HTTPException

# Extracted endpoint/auto-commit orchestrators.
from app.api.routes.sessions_support.auto_commit import (
    AutoCommitExecutionResult,
    execute_auto_commit as execute_auto_commit_helper,
    run_auto_commit_in_background as run_auto_commit_in_background_helper,
    schedule_auto_commit_task as schedule_auto_commit_task_helper,
)
from app.api.routes.sessions_support.route_flows import (
    commit_session_flow,
    create_session_flow,
    discard_session_flow,
    rollback_session_flow,
    send_message_flow,
)

# Extracted stateless helper utilities.
from app.api.routes.sessions_support.artifact_builder import (
    build_commit_artifact as build_commit_artifact_helper,
)
from app.api.routes.sessions_support.common import (
    extract_upstream_error_code as extract_upstream_error_code_helper,
    extract_upstream_error_details as extract_upstream_error_details_helper,
    sanitize_session_metadata as sanitize_session_metadata_helper,
    serialized_payload_bytes as serialized_payload_bytes_helper,
    utcnow as utcnow_helper,
)
from app.api.routes.sessions_support.draft_state import (
    get_draft_parent_id as get_draft_parent_id_helper,
    get_draft_status as get_draft_status_helper,
    is_descendant_of_draft as is_descendant_of_draft_helper,
    repoint_active_draft_after_commit as repoint_active_draft_after_commit_helper,
    resolve_draft_snapshot as resolve_draft_snapshot_helper,
    reuse_selected_draft_as_post_commit_head as reuse_selected_draft_as_post_commit_head_helper,
    set_draft_status as set_draft_status_helper,
)
from app.api.routes.sessions_support.runtime import (
    configure_runtime_resolver,
    get_agent_runtime as get_agent_runtime_helper,
    get_agent_runtime_async as get_agent_runtime_async_helper,
    get_session_or_404_async as get_session_or_404_async_helper,
    run_store_call as run_store_call_helper,
    service_unavailable as service_unavailable_helper,
)
from app.api.routes.sessions_support.timeline import parse_change_timeline
from app.core.config import get_settings
from app.core.contracts.sessions import (
    AgentSession,
    CommitRequest,
    RoadmapCommitArtifact,
    CreateSessionRequest,
    CreateSessionResponse,
    DiscardRequest,
    DiscardResponse,
    MessageRequest,
    MessageResponse,
    RollbackRequest,
)
from app.core.nest_client import NestRoadmapClient
from app.core.logging_utils import log_event
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore


# Module state and shared constants.
router = APIRouter(prefix='/agent/sessions', tags=['agent'])
logger = logging.getLogger(__name__)
settings = get_settings()

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


# Compatibility wrapper adapters retained for existing tests/call sites.
def _utcnow() -> datetime:
    return utcnow_helper()


def _serialized_payload_bytes(payload: dict) -> int:
    return serialized_payload_bytes_helper(payload)


def _extract_upstream_error_code(detail: object) -> str | None:
    return extract_upstream_error_code_helper(detail)


def _extract_upstream_error_details(detail: object) -> dict:
    details = extract_upstream_error_details_helper(detail)
    return details if isinstance(details, dict) else {}


def _resolve_draft_snapshot(
    session: AgentSession,
    agent_service: AgentService,
) -> tuple[str, int, list]:
    return resolve_draft_snapshot_helper(
        session=session,
        agent_service=agent_service,
        draft_graph_enabled=settings.agent_draft_graph_enabled,
    )


def _set_draft_status(
    *,
    session: AgentSession,
    draft_id: str,
    status: str,
) -> bool:
    return set_draft_status_helper(
        session=session,
        draft_id=draft_id,
        status=status,
        utcnow=_utcnow,
    )


def _get_draft_parent_id(
    session: AgentSession,
    draft_id: str,
) -> str | None:
    return get_draft_parent_id_helper(
        session=session,
        draft_id=draft_id,
    )


def _get_draft_status(
    session: AgentSession,
    draft_id: str,
) -> str | None:
    return get_draft_status_helper(
        session=session,
        draft_id=draft_id,
    )


def _is_descendant_of_draft(
    session: AgentSession,
    *,
    draft_id: str,
    ancestor_draft_id: str,
) -> bool:
    return is_descendant_of_draft_helper(
        session,
        draft_id=draft_id,
        ancestor_draft_id=ancestor_draft_id,
        get_parent_id=_get_draft_parent_id,
    )


def _repoint_active_draft_after_commit(
    session: AgentSession,
    *,
    selected_draft_id: str,
) -> int:
    return repoint_active_draft_after_commit_helper(
        session,
        selected_draft_id=selected_draft_id,
        is_descendant=_is_descendant_of_draft,
        get_status=_get_draft_status,
        set_status=_set_draft_status,
    )


def _reuse_selected_draft_as_post_commit_head(
    session: AgentSession,
    *,
    selected_draft_id: str,
) -> int:
    return reuse_selected_draft_as_post_commit_head_helper(
        session,
        selected_draft_id=selected_draft_id,
        utcnow=_utcnow,
    )


def _service_unavailable(reason: str) -> HTTPException:
    return service_unavailable_helper(reason)


async def _run_store_call(func, *args):
    return await run_store_call_helper(func, *args)


def _get_agent_runtime() -> tuple[SessionStore, AgentService]:
    return get_agent_runtime_helper()


async def _get_agent_runtime_async() -> tuple[SessionStore, AgentService]:
    return await get_agent_runtime_async_helper()


async def _get_session_or_404_async(
    agent_service: AgentService,
    session_id: str,
) -> AgentSession:
    return await get_session_or_404_async_helper(agent_service, session_id)


def _sanitize_session_metadata(
    metadata: dict | None,
) -> tuple[dict, bool]:
    return sanitize_session_metadata_helper(
        metadata,
        actor_metadata_keys=_ACTOR_METADATA_KEYS,
    )


def _schedule_auto_commit_task(coro) -> asyncio.Task:
    return schedule_auto_commit_task_helper(
        task_set=_pending_auto_commit_tasks,
        coro=coro,
    )


async def _execute_auto_commit(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
) -> AutoCommitExecutionResult:
    return await execute_auto_commit_helper(
        store=store,
        agent_service=agent_service,
        session=session,
        auth_header=auth_header,
        trace_id=trace_id,
        nest_client=_nest_client,
        draft_graph_enabled=settings.agent_draft_graph_enabled,
        resolve_draft_snapshot=_resolve_draft_snapshot,
        reuse_selected_draft_as_post_commit_head=_reuse_selected_draft_as_post_commit_head,
        set_draft_status=_set_draft_status,
        build_commit_artifact=_build_commit_artifact,
        serialized_payload_bytes=_serialized_payload_bytes,
        run_store_call=_run_store_call,
    )


async def _run_auto_commit_in_background(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
) -> None:
    await run_auto_commit_in_background_helper(
        store=store,
        agent_service=agent_service,
        session=session,
        auth_header=auth_header,
        trace_id=trace_id,
        execute_auto_commit_fn=_execute_auto_commit,
        extract_upstream_error_code=_extract_upstream_error_code,
        extract_upstream_error_details=_extract_upstream_error_details,
        logger=logger,
        settings=settings,
        log_event_fn=log_event,
    )


# API route handlers.
@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest) -> CreateSessionResponse:
    return await create_session_flow(
        payload=payload,
        get_agent_runtime_async=_get_agent_runtime_async,
        sanitize_session_metadata=_sanitize_session_metadata,
        run_store_call=_run_store_call,
        log_event_fn=log_event,
        logger=logger,
        settings=settings,
    )


@router.post('/{session_id}/messages', response_model=MessageResponse)
async def send_message(
    session_id: str,
    payload: MessageRequest,
    request: Request,
) -> MessageResponse:
    return await send_message_flow(
        session_id=session_id,
        payload=payload,
        request=request,
        get_agent_runtime_async=_get_agent_runtime_async,
        get_session_or_404_async=_get_session_or_404_async,
        run_store_call=_run_store_call,
        resolve_draft_snapshot=_resolve_draft_snapshot,
        execute_auto_commit=_execute_auto_commit,
        schedule_auto_commit_task=_schedule_auto_commit_task,
        run_auto_commit_in_background=_run_auto_commit_in_background,
        extract_upstream_error_code=_extract_upstream_error_code,
        extract_upstream_error_details=_extract_upstream_error_details,
        settings=settings,
        logger=logger,
        log_event_fn=log_event,
    )


@router.post('/{session_id}/commit')
async def commit_session(
    session_id: str,
    payload: CommitRequest,
    request: Request,
) -> dict:
    return await commit_session_flow(
        session_id=session_id,
        payload=payload,
        request=request,
        get_agent_runtime_async=_get_agent_runtime_async,
        get_session_or_404_async=_get_session_or_404_async,
        resolve_draft_snapshot=_resolve_draft_snapshot,
        run_store_call=_run_store_call,
        set_draft_status=_set_draft_status,
        reuse_selected_draft_as_post_commit_head=_reuse_selected_draft_as_post_commit_head,
        nest_client=_nest_client,
        settings=settings,
        logger=logger,
        log_event_fn=log_event,
    )


@router.post('/{session_id}/discard', response_model=DiscardResponse)
async def discard_session(
    session_id: str,
    payload: DiscardRequest,
    request: Request,
) -> DiscardResponse:
    return await discard_session_flow(
        session_id=session_id,
        payload=payload,
        request=request,
        get_agent_runtime_async=_get_agent_runtime_async,
        get_session_or_404_async=_get_session_or_404_async,
        resolve_draft_snapshot=_resolve_draft_snapshot,
        run_store_call=_run_store_call,
        parse_change_timeline=parse_change_timeline,
        utcnow=_utcnow,
        nest_client=_nest_client,
    )


@router.post('/{session_id}/rollback')
async def rollback_session(
    session_id: str,
    payload: RollbackRequest,
    request: Request,
) -> dict:
    return await rollback_session_flow(
        session_id=session_id,
        payload=payload,
        request=request,
        get_agent_runtime_async=_get_agent_runtime_async,
        get_session_or_404_async=_get_session_or_404_async,
        run_store_call=_run_store_call,
        parse_change_timeline=parse_change_timeline,
        nest_client=_nest_client,
    )


# Artifact adapter shim.
def _build_commit_artifact(
    session: AgentSession,
    commit_result: dict,
    change_id: str | None = None,
    status: str = 'applied',
) -> RoadmapCommitArtifact | None:
    return build_commit_artifact_helper(
        session,
        commit_result,
        change_id=change_id,
        status=status,
    )
