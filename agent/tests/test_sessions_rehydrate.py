"""Tests for explicit session_id + seed_messages rehydration on create.

Covers the contract added for DB-backed multi-thread sessions: the backend
passes a DB-generated uuid as `session_id` so the Redis key and the
roadmap_ai_sessions.id match, and on Redis TTL expiry the web resends the
last N messages as `seed_messages` so the planner keeps conversational
context without persisting any transient staged state.
"""

from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from typing import Any, Awaitable, Callable
from unittest.mock import MagicMock

from app.api.routes.sessions_support.route_flows import create_session_flow
from app.core.contracts.sessions import (
    AgentSession,
    CreateSessionRequest,
    Message,
)


class _FakeStore:
    def __init__(self) -> None:
        self.created_sessions: list[AgentSession] = []
        self.existing: AgentSession | None = None

    def create(self, session: AgentSession) -> AgentSession:
        self.created_sessions.append(session)
        return session

    def get(self, _session_id: str) -> AgentSession | None:
        return self.existing


def _noop_sanitize(metadata: dict | None) -> tuple[dict, bool]:
    return metadata or {}, False


async def _run_store_call(
    func: Callable[..., Awaitable[Any] | Any], *args: Any
) -> Any:
    result = func(*args)
    if hasattr(result, '__await__'):
        return await result  # type: ignore[no-any-return]
    return result


def _make_runtime(store: _FakeStore) -> Callable[[], Awaitable[tuple[Any, Any]]]:
    agent_service = SimpleNamespace()

    async def _runtime() -> tuple[Any, Any]:
        return store, agent_service

    return _runtime


class CreateSessionRehydrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_honors_explicit_session_id_and_seed_messages(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(
            session_id='db-generated-uuid-1',
            roadmap_id='roadmap-1',
            seed_messages=[
                Message(role='user', content='first user turn'),
                Message(role='assistant', content='first assistant turn'),
            ],
        )

        response = await create_session_flow(
            payload=payload,
            get_agent_runtime_async=_make_runtime(store),
            sanitize_session_metadata=_noop_sanitize,
            run_store_call=_run_store_call,
            log_event_fn=MagicMock(),
            logger=logging.getLogger('test'),
            settings=SimpleNamespace(),
        )

        self.assertEqual(response.session_id, 'db-generated-uuid-1')
        self.assertEqual(len(store.created_sessions), 1)
        stored = store.created_sessions[0]
        self.assertEqual(stored.session_id, 'db-generated-uuid-1')
        self.assertEqual(len(stored.messages), 2)
        self.assertEqual(stored.messages[0].role, 'user')
        self.assertEqual(stored.messages[0].content, 'first user turn')
        self.assertEqual(stored.messages[1].role, 'assistant')

    async def test_create_without_session_id_generates_uuid(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(roadmap_id='roadmap-2')

        response = await create_session_flow(
            payload=payload,
            get_agent_runtime_async=_make_runtime(store),
            sanitize_session_metadata=_noop_sanitize,
            run_store_call=_run_store_call,
            log_event_fn=MagicMock(),
            logger=logging.getLogger('test'),
            settings=SimpleNamespace(),
        )

        # Falls back to the Pydantic default_factory (uuid4).
        self.assertTrue(response.session_id)
        self.assertNotEqual(response.session_id, '')
        stored = store.created_sessions[0]
        self.assertEqual(stored.session_id, response.session_id)
        self.assertEqual(stored.messages, [])


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
