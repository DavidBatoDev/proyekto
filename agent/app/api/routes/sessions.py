import asyncio
import functools
import logging

from fastapi import APIRouter, Query, Request
from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.auth import owner_key_from_auth, resolve_forward_auth
from app.api.routes.sessions_support.flows import (
    CancelRunResponse,
    cancel_run_flow,
    continue_run_flow,
    create_session_flow,
    send_message_flow,
)
from app.api.routes.sessions_support.runtime import (
    get_agent_runtime_async,
    get_session_or_404_async,
    run_store_call,
    schedule_background_task,
)
from app.core import trace
from app.core.config import get_settings
from app.core.contracts.sessions import (
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
    TraceEventDetailMode,
    TraceEventsResponse,
)
from app.core.logging_utils import log_event
from app.core.nest_client import NestRoadmapClient
from app.core.runtime.snapshot import sanitize_session_metadata


# Module state and shared constants.
router = APIRouter(prefix='/agent/sessions', tags=['agent'])
logger = logging.getLogger(__name__)
settings = get_settings()

_nest_client = NestRoadmapClient()
# Strong refs for fire-and-forget work (snapshot push, summary compaction).
_background_tasks: set[asyncio.Task] = set()


def _schedule_background_task(coro) -> asyncio.Task:
    return schedule_background_task(task_set=_background_tasks, coro=coro)


# API route handlers.
@router.post('', response_model=CreateSessionResponse)
async def create_session(payload: CreateSessionRequest, request: Request) -> CreateSessionResponse:
    return await create_session_flow(
        payload=payload,
        request=request,
        get_agent_runtime_async=get_agent_runtime_async,
        sanitize_session_metadata=sanitize_session_metadata,
        run_store_call=run_store_call,
        log_event_fn=log_event,
        logger=logger,
        settings=settings,
        nest_client=_nest_client,
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
        get_agent_runtime_async=get_agent_runtime_async,
        get_session_or_404_async=get_session_or_404_async,
        run_store_call=run_store_call,
        schedule_background_task=_schedule_background_task,
        settings=settings,
        logger=logger,
        log_event_fn=log_event,
        nest_client=_nest_client,
    )


@router.post('/{session_id}/runs/{run_id}/continue', response_model=MessageResponse)
async def continue_run(
    session_id: str,
    run_id: str,
    request: Request,
) -> MessageResponse:
    return await continue_run_flow(
        session_id=session_id,
        run_id=run_id,
        request=request,
        get_agent_runtime_async=get_agent_runtime_async,
        get_session_or_404_async=get_session_or_404_async,
        run_store_call=run_store_call,
        schedule_background_task=_schedule_background_task,
        settings=settings,
        logger=logger,
        log_event_fn=log_event,
        nest_client=_nest_client,
    )


@router.post('/{session_id}/runs/{run_id}/cancel', response_model=CancelRunResponse)
async def cancel_run(
    session_id: str,
    run_id: str,
    request: Request,
) -> CancelRunResponse:
    return await cancel_run_flow(
        session_id=session_id,
        run_id=run_id,
        request=request,
        get_agent_runtime_async=get_agent_runtime_async,
        get_session_or_404_async=get_session_or_404_async,
        run_store_call=run_store_call,
        logger=logger,
    )


@router.get('/{session_id}/traces/{trace_id}/events', response_model=TraceEventsResponse)
async def get_trace_events(
    session_id: str,
    trace_id: str,
    request: Request,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    detail: TraceEventDetailMode = Query(default='verbose'),
) -> TraceEventsResponse:
    # The read may hit Redis (a trace another instance owns): off the loop.
    # Owner-checked: a trace that belongs to another caller is a 404.
    payload = await run_store_call(
        functools.partial(
            trace.store.read,
            session_id=session_id,
            trace_id=trace_id,
            after_seq=after_seq,
            limit=limit,
            detail=detail,
            settings=settings,
            owner_key=owner_key_from_auth(resolve_forward_auth(request)),
        )
    )
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail={
                'code': 'TRACE_EVENTS_NOT_FOUND',
                'message': 'Trace events were not found for this session.',
            },
        )
    return TraceEventsResponse.model_validate(payload)
