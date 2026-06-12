"""Streaming progress events for the v2 loop.

Progress is captured as a side effect of ``log_event`` whenever the event
name is in ``logging_utils._PROGRESS_EVENT_ALLOWLIST`` and a ``trace_id`` is
bound. The ``GET .../traces/{trace_id}/events`` endpoint serves them. Read
tools already emit ``tool_call_requested`` / ``tool_call_result`` from the
ToolDispatcher, so these helpers only cover the loop's own lifecycle.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.logging_utils import log_event

logger = logging.getLogger('app.core.v2')


def provider_attempt(settings: Any, trace_id: str | None, turn: int) -> None:
    log_event(
        logger,
        'provider_attempt',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        turn=turn,
    )


def provider_success(
    settings: Any,
    trace_id: str | None,
    turn: int,
    *,
    tool_names: list[str],
    finish_reason: str | None,
    tokens_total: int | None,
) -> None:
    log_event(
        logger,
        'provider_success',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        turn=turn,
        tool_names=tool_names,
        finish_reason=finish_reason,
        tokens_total=tokens_total,
    )


def tool_requested(settings: Any, trace_id: str | None, tool_name: str, tool_args: Any) -> None:
    log_event(
        logger,
        'tool_call_requested',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        tool_name=tool_name,
        tool_args=tool_args,
    )


def route_selected(
    settings: Any,
    trace_id: str | None,
    *,
    route_lane: str,
    response_mode: str,
    turns: int,
    tool_calls_used: int,
    termination_reason: str,
) -> None:
    log_event(
        logger,
        'route_selected',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        route_lane=route_lane,
        response_mode=response_mode,
        react_loop_turns=turns,
        tool_calls_used=tool_calls_used,
        react_loop_termination_reason=termination_reason,
    )
