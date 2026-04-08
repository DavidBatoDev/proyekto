from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable

from fastapi.exceptions import HTTPException

from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore, SessionStoreUnavailableError


@dataclass
class RuntimeState:
    store: SessionStore | None = None
    agent_service: AgentService | None = None
    unavailable_reason: str | None = None


_RUNTIME_STATE = RuntimeState()
_RUNTIME_RESOLVER: Callable[[], tuple[SessionStore, AgentService]] | None = None


def configure_runtime_resolver(
    resolver: Callable[[], tuple[SessionStore, AgentService]] | None,
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
    try:
        return await asyncio.to_thread(func, *args)
    except SessionStoreUnavailableError as exc:
        logging.getLogger(__name__).error(
            'Session store unavailable. operation=%s reason=%s',
            exc.operation,
            exc.reason,
        )
        raise service_unavailable(exc.reason) from exc


def get_agent_runtime() -> tuple[SessionStore, AgentService]:
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

    if _RUNTIME_STATE.store is not None and _RUNTIME_STATE.agent_service is not None:
        return _RUNTIME_STATE.store, _RUNTIME_STATE.agent_service

    if _RUNTIME_STATE.unavailable_reason is not None:
        raise service_unavailable(_RUNTIME_STATE.unavailable_reason)

    try:
        store = SessionStore()
        service = AgentService(store)
        _RUNTIME_STATE.store = store
        _RUNTIME_STATE.agent_service = service
        return store, service
    except Exception as exc:
        _RUNTIME_STATE.unavailable_reason = str(exc)
        logging.getLogger(__name__).error(
            'Session runtime unavailable: %s',
            _RUNTIME_STATE.unavailable_reason,
        )
        raise service_unavailable(_RUNTIME_STATE.unavailable_reason)


async def get_agent_runtime_async() -> tuple[SessionStore, AgentService]:
    return await run_store_call(get_agent_runtime)


async def get_session_or_404_async(
    agent_service: AgentService,
    session_id: str,
) -> Any:
    return await run_store_call(agent_service.get_session_or_404, session_id)
