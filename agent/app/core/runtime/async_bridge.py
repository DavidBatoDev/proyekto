from __future__ import annotations

import asyncio
import contextvars
import logging
from queue import Empty, Queue
import threading
from typing import Any

from fastapi import HTTPException, status

from app.core.logging_utils import log_event


def async_bridge_unavailable_error(*, reason: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            'code': 'ASYNC_BRIDGE_UNAVAILABLE',
            'message': (
                'Agent async bridge is temporarily unavailable. '
                'Please retry the request.'
            ),
            'reason': reason,
            'retryable': True,
        },
    )


def run_async_call(
    coro: Any,
    *,
    settings: Any,
    logger: logging.Logger,
) -> Any:
    if not asyncio.iscoroutine(coro):
        return coro
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    timeout_seconds = max(float(settings.nest_timeout_seconds), 0.1)
    queue: Queue[tuple[str, Any]] = Queue(maxsize=1)

    def _bridge_runner() -> None:
        try:
            queue.put(('result', asyncio.run(coro)))
        except Exception as exc:  # pragma: no cover
            queue.put(('error', exc))

    # Copy the caller's context so the thread inherits ContextVars (trace_id,
    # session_id, etc.). Without this the new thread starts with a fresh
    # context and log lines emitted from within the bridged coroutine lose
    # their trace correlation.
    ctx = contextvars.copy_context()
    bridge_thread = threading.Thread(
        target=ctx.run,
        args=(_bridge_runner,),
        name='agent-async-bridge',
        daemon=True,
    )
    bridge_thread.start()
    bridge_thread.join(timeout=timeout_seconds)

    if bridge_thread.is_alive():
        log_event(
            logger,
            'async_bridge_fallback',
            settings=settings,
            level=logging.WARNING,
            status='timeout',
            timeout_seconds=timeout_seconds,
        )
        raise async_bridge_unavailable_error(reason='timeout')

    try:
        outcome_type, payload = queue.get_nowait()
    except Empty:
        log_event(
            logger,
            'async_bridge_fallback',
            settings=settings,
            level=logging.WARNING,
            status='missing_result',
        )
        raise async_bridge_unavailable_error(reason='missing_result')

    if outcome_type == 'error':
        log_event(
            logger,
            'async_bridge_fallback',
            settings=settings,
            level=logging.WARNING,
            status='error',
            error_type=type(payload).__name__,
        )
        if isinstance(payload, HTTPException):
            raise payload
        raise async_bridge_unavailable_error(reason='error')

    log_event(
        logger,
        'async_bridge_fallback',
        settings=settings,
        status='success',
    )
    return payload
