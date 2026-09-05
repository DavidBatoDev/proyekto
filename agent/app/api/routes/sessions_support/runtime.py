from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi.exceptions import HTTPException

from app.core import trace
from app.core.config import get_settings
from app.core.runtime.service import RuntimeService
from app.core.session_store import SessionStore, SessionStoreUnavailableError


@dataclass
class RuntimeState:
    store: SessionStore | None = None
    service: RuntimeService | None = None
    unavailable_reason: str | None = None


_RUNTIME_STATE = RuntimeState()
_RUNTIME_RESOLVER: Callable[[], tuple[SessionStore, RuntimeService]] | None = None


def configure_runtime_resolver(
    resolver: Callable[[], tuple[SessionStore, RuntimeService]] | None,
) -> None:
    global _RUNTIME_RESOLVER
    _RUNTIME_RESOLVER = resolver


def service_unavailable(reason: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            'code': 'SESSION_STORE_UNAVAILABLE',
            'message': (
                'Agent session service is unavailable. Configure Redis and restart the agent.'
            ),
            'retryable': True,
        },
    )


async def run_store_call(func: Callable[..., Any], *args: Any) -> Any:
    """Run a blocking store/runtime call off the event loop."""
    try:
        return await asyncio.to_thread(func, *args)
    except SessionStoreUnavailableError as exc:
        logging.getLogger(__name__).error(
            'Session store unavailable. operation=%s reason=%s',
            exc.operation,
            exc.reason,
        )
        raise service_unavailable(exc.reason) from exc


def schedule_background_task(
    *,
    task_set: set[asyncio.Task],
    coro: Awaitable[None],
) -> asyncio.Task:
    """Fire-and-forget a coroutine on the request loop (agent-state snapshot
    push, summary compaction). The set holds a strong reference until the
    task finishes so the loop cannot garbage-collect it mid-flight."""
    task = asyncio.create_task(coro)
    task_set.add(task)
    task.add_done_callback(task_set.discard)
    return task


def build_runtime() -> tuple[SessionStore, RuntimeService]:
    """The process-wide runtime: the Redis session store (shared with the
    trace store and the run lock / side keys) + the runtime service."""
    store = SessionStore()
    trace.store.configure(store.redis, get_settings())
    service = RuntimeService(store)
    return store, service


def get_agent_runtime() -> tuple[SessionStore, RuntimeService]:
    global _RUNTIME_RESOLVER

    if _RUNTIME_RESOLVER is not None:
        try:
            return _RUNTIME_RESOLVER()
        except HTTPException:
            raise
        except Exception as exc:
            _RUNTIME_STATE.unavailable_reason = str(exc)
            logging.getLogger(__name__).error(
                'Session runtime unavailable: %s',
                _RUNTIME_STATE.unavailable_reason,
            )
            raise service_unavailable(_RUNTIME_STATE.unavailable_reason)

    if _RUNTIME_STATE.store is not None and _RUNTIME_STATE.service is not None:
        return _RUNTIME_STATE.store, _RUNTIME_STATE.service

    if _RUNTIME_STATE.unavailable_reason is not None:
        raise service_unavailable(_RUNTIME_STATE.unavailable_reason)

    try:
        store, service = build_runtime()
        _RUNTIME_STATE.store = store
        _RUNTIME_STATE.service = service
        return store, service
    except Exception as exc:
        _RUNTIME_STATE.unavailable_reason = str(exc)
        logging.getLogger(__name__).error(
            'Session runtime unavailable: %s',
            _RUNTIME_STATE.unavailable_reason,
        )
        raise service_unavailable(_RUNTIME_STATE.unavailable_reason)


async def get_agent_runtime_async() -> tuple[SessionStore, RuntimeService]:
    return await run_store_call(get_agent_runtime)


async def get_session_or_404_async(
    service: RuntimeService,
    session_id: str,
) -> Any:
    return await run_store_call(service.get_session_or_404, session_id)
