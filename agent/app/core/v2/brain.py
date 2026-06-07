"""v2 entrypoint — mirrors ``planning_orchestrator.plan_message``.

Loads context (reusing v1 helpers), runs the single loop, and assembles a
``MessagePlanningOutcome``. Synchronous: it runs in the same worker thread as
the v1 planner. A provider failure degrades to a graceful chat reply instead
of a 500, mirroring v1's outage handling.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable

from app.core.contracts.sessions import AgentSession
from app.core.llm.context.dispatch import ToolDispatcher
from app.core.logging_utils import log_event
from app.core.orchestration.context.actor_context_provider import (
    ensure_actor_context as ensure_actor_context_helper,
)
from app.core.orchestration.shared.outcomes import MessagePlanningOutcome
from app.core.v2.context import build_messages
from app.core.v2.loop import LoopResult, run_loop
from app.core.v2.openai_client import V2LLMClient
from app.core.v2.sentinels import parse_and_fold
from app.core.v2.terminal import to_outcome
from app.core.v2.tools_spec import build_tools

logger = logging.getLogger('app.core.v2')


def run_v2_message(
    *,
    service: Any,
    session: AgentSession,
    user_message: str,
    replace: bool,
    auth_header: str | None,
    trace_id: str | None,
    utcnow: Callable[[], datetime],
) -> MessagePlanningOutcome:
    _ = replace  # API-compatible; v2 staging is append/draft-action driven.
    settings = service._settings

    # Context prep — reuse the v1 helpers so behavior matches exactly.
    _ensure_actor_context(service, session, auth_header, trace_id)
    service._ensure_roadmap_overview_summary(
        session=session,
        auth_header=auth_header,
        trace_id=trace_id,
    )
    session_context = service._build_session_context(session, auth_header, trace_id)

    folded_message = parse_and_fold(session, user_message)
    handle_map = dict(session.metadata.roadmap_handle_map)
    messages = build_messages(session, session_context, folded_message)
    tools = build_tools()

    client = V2LLMClient(settings)
    dispatcher = ToolDispatcher(
        settings=settings,
        logger=service._logger,
        nest_client=service._nest_client,
    )

    try:
        loop_result = run_loop(
            client=client,
            messages=messages,
            tools=tools,
            dispatcher=dispatcher,
            session_context=session_context,
            handle_map=handle_map,
            settings=settings,
            trace_id=trace_id,
        )
        return to_outcome(
            service=service,
            session=session,
            loop_result=loop_result,
            session_context=session_context,
            user_message=user_message,
            trace_id=trace_id,
            utcnow=utcnow,
        )
    except Exception as exc:  # noqa: BLE001 — keep the endpoint resilient
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.ERROR,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            brain='v2',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        fallback = LoopResult(
            kind='chat',
            assistant_message=(
                "I hit an issue reaching the model and couldn't process that "
                'just now. Please try again in a moment.'
            ),
            termination_reason='provider_error',
        )
        return to_outcome(
            service=service,
            session=session,
            loop_result=fallback,
            session_context=session_context,
            user_message=user_message,
            trace_id=trace_id,
            utcnow=utcnow,
            provider_used='rule_based',
            fallback_used=True,
            provider_error_code='v2_provider_error',
        )


def _ensure_actor_context(
    service: Any,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
) -> None:
    """Best-effort, once-per-session actor fetch (gives the model the actor id
    for "assign to me"-style edits). Cached on session.metadata thereafter.
    """
    if session.metadata.actor_context is not None or not auth_header:
        return
    try:
        ensure_actor_context_helper(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            nest_client=service._nest_client,
            run_async_call=service._run_async_call,
            logger=service._logger,
            settings=service._settings,
            actor_refresh_failures_key=getattr(
                service, '_actor_refresh_failures_key', 'actor_context_refresh_failures'
            ),
        )
    except Exception:  # pragma: no cover - actor context is best-effort
        pass
