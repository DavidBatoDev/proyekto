from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import contextvars
import logging
from queue import Empty, Queue
import threading
from typing import Any, Callable

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


_thread_loops = threading.local()


def run_on_thread_loop(coro: Any) -> Any:
    """Run ``coro`` to completion on this thread's persistent event loop.

    The sync run machine (``orchestrator.step`` on a ``to_thread`` worker)
    drives every Nest call through here. ``asyncio.run`` would build and close
    a loop per call, and since the Nest client pools connections per loop,
    every call paid a fresh TCP+TLS handshake. A loop that lives as long as
    its (reused) worker thread keeps that pool warm. Semantics otherwise match
    ``asyncio.run``: the coroutine runs on this thread, so a blocking call
    inside it still only blocks this request, and the Task copies the
    caller's ContextVars.
    """
    loop = getattr(_thread_loops, 'loop', None)
    if loop is None or loop.is_closed():
        loop = asyncio.new_event_loop()
        _thread_loops.loop = loop
    try:
        return loop.run_until_complete(coro)
    finally:
        _cancel_leftover_tasks(loop)


def _cancel_leftover_tasks(loop: asyncio.AbstractEventLoop) -> None:
    """What ``asyncio.run`` does at close: a task the coroutine left behind
    (a ``gather`` sibling after the other side raised) must not wake up inside
    the next, unrelated call on this thread's loop."""
    pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
    if not pending:
        return
    for task in pending:
        task.cancel()
    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))


_prefetch_pool: ThreadPoolExecutor | None = None
_prefetch_pool_lock = threading.Lock()


def _prefetch_executor() -> ThreadPoolExecutor:
    global _prefetch_pool
    with _prefetch_pool_lock:
        if _prefetch_pool is None:
            # Persistent threads, so each keeps its loop (and Nest pool) warm.
            _prefetch_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix='agent-prefetch')
        return _prefetch_pool


def run_concurrently(calls: list[Callable[[], Any]]) -> list[Any]:
    """Run independent blocking calls in parallel and return their results in
    order. Each call runs with a copy of the caller's ContextVars (trace
    correlation); every call finishes before the first exception, if any, is
    re-raised. The calls must not mutate shared state the others read."""
    if len(calls) <= 1:
        return [call() for call in calls]
    pool = _prefetch_executor()
    futures = [pool.submit(contextvars.copy_context().run, call) for call in calls]
    results: list[Any] = []
    first_error: BaseException | None = None
    for future in futures:
        try:
            results.append(future.result())
        except BaseException as exc:  # noqa: BLE001 — re-raised below, after the rest
            results.append(None)
            first_error = first_error or exc
    if first_error is not None:
        raise first_error
    return results


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
        return run_on_thread_loop(coro)

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
