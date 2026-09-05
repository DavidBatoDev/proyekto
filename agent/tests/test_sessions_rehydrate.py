"""Session create: explicit session_id + seed_messages rehydration, the scope
body vs the legacy roadmap_id body, required auth (401), the owner key, the
roadmap-scope actor fetch (403/404 -> SESSION_SCOPE_NOT_FOUND, 5xx -> create
without actor) and the workspace membership check."""

from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from typing import Any, Awaitable, Callable
from unittest.mock import MagicMock

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.flows import create_session_flow
from app.core.contracts.sessions import (
    AgentSession,
    CreateSessionRequest,
    Message,
)
from tests.runtime_fakes import AUTH, USER, FakeNest


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


def _make_runtime(store: _FakeStore, nest: FakeNest | None = None) -> Callable[[], Awaitable[tuple[Any, Any]]]:
    service = SimpleNamespace(nest_client=nest or FakeNest())

    async def _runtime() -> tuple[Any, Any]:
        return store, service

    return _runtime


def _request(auth: str | None = AUTH) -> SimpleNamespace:
    headers = {}
    if auth and auth.startswith('Guest '):
        headers['X-Guest-User-Id'] = auth[6:]
    elif auth:
        headers['Authorization'] = auth
    return SimpleNamespace(headers=headers)


async def _create(payload: CreateSessionRequest, store: _FakeStore, *, nest: FakeNest | None = None, auth: str | None = AUTH):
    nest = nest or FakeNest()
    return await create_session_flow(
        payload=payload,
        request=_request(auth),
        get_agent_runtime_async=_make_runtime(store, nest),
        sanitize_session_metadata=_noop_sanitize,
        run_store_call=_run_store_call,
        log_event_fn=MagicMock(),
        logger=logging.getLogger('test'),
        settings=SimpleNamespace(),
        nest_client=nest,
    )


class CreateSessionRehydrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_honors_explicit_session_id_and_seed_messages(self) -> None:
        store = _FakeStore()
        nest = FakeNest(roadmaps={'roadmap-1': {'title': 'R1'}})
        payload = CreateSessionRequest(
            session_id='db-generated-uuid-1',
            roadmap_id='roadmap-1',
            seed_messages=[
                Message(role='user', content='first user turn'),
                Message(role='assistant', content='first assistant turn'),
            ],
        )

        response = await _create(payload, store, nest=nest)

        self.assertEqual(response.session_id, 'db-generated-uuid-1')
        self.assertEqual(response.scope.kind, 'roadmap')
        self.assertEqual(response.roadmap_id, 'roadmap-1')
        self.assertEqual(len(store.created_sessions), 1)
        stored = store.created_sessions[0]
        self.assertEqual(stored.session_id, 'db-generated-uuid-1')
        self.assertEqual(len(stored.messages), 2)
        self.assertEqual(stored.messages[0].role, 'user')
        self.assertEqual(stored.messages[0].content, 'first user turn')
        self.assertEqual(stored.messages[1].role, 'assistant')
        # Ownership + the verified actor seeded from the backend.
        self.assertEqual(stored.owner_key, USER)
        self.assertEqual(stored.metadata.actor_context.actor_id, USER)
        self.assertEqual(stored.metadata.actor_context.roadmap_role, 'owner')

    async def test_create_without_session_id_generates_uuid(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(roadmap_id='roadmap-2')
        response = await _create(payload, store, nest=FakeNest(roadmaps={'roadmap-2': {'title': 'R2'}}))

        # Falls back to the Pydantic default_factory (uuid4).
        self.assertTrue(response.session_id)
        self.assertNotEqual(response.session_id, '')
        stored = store.created_sessions[0]
        self.assertEqual(stored.session_id, response.session_id)
        self.assertEqual(stored.messages, [])

    async def test_scope_body_creates_a_workspace_session(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        response = await _create(payload, store)
        self.assertEqual(response.scope.kind, 'workspace')
        self.assertIsNone(response.roadmap_id)
        stored = store.created_sessions[0]
        self.assertEqual(stored.scope.workspace_id, 'ws-1')
        self.assertEqual(stored.owner_key, USER)
        self.assertIsNone(stored.metadata.actor_context)

    async def test_guest_owner_key(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(roadmap_id='roadmap-3')
        await _create(payload, store, nest=FakeNest(roadmaps={'roadmap-3': {'title': 'R3'}}), auth='Guest guest-9')
        self.assertEqual(store.created_sessions[0].owner_key, 'Guest guest-9')

    async def test_auth_is_required(self) -> None:
        store = _FakeStore()
        with self.assertRaises(HTTPException) as caught:
            await _create(CreateSessionRequest(roadmap_id='roadmap-1'), store, auth=None)
        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.detail['code'], 'AUTH_REQUIRED')
        self.assertEqual(store.created_sessions, [])

    async def test_inaccessible_roadmap_is_session_scope_not_found(self) -> None:
        store = _FakeStore()
        for status in (403, 404):
            nest = FakeNest()
            nest.actor_error = HTTPException(status_code=status, detail={'code': 'FORBIDDEN'})
            with self.assertRaises(HTTPException) as caught:
                await _create(CreateSessionRequest(roadmap_id='roadmap-1'), store, nest=nest)
            self.assertEqual(caught.exception.status_code, 404)
            self.assertEqual(caught.exception.detail['code'], 'SESSION_SCOPE_NOT_FOUND')
        self.assertEqual(store.created_sessions, [])

    async def test_backend_outage_creates_without_actor(self) -> None:
        store = _FakeStore()
        nest = FakeNest()
        nest.actor_error = HTTPException(status_code=504, detail={'code': 'NEST_TIMEOUT'})
        response = await _create(CreateSessionRequest(roadmap_id='roadmap-1'), store, nest=nest)
        self.assertTrue(response.session_id)
        stored = store.created_sessions[0]
        self.assertIsNone(stored.metadata.actor_context)
        self.assertEqual(stored.owner_key, USER)  # from the bearer subject

    async def test_workspace_membership_denial_is_session_scope_not_found(self) -> None:
        store = _FakeStore()
        for status in (403, 404):
            nest = FakeNest()
            nest.workspace_error = HTTPException(status_code=status, detail={'code': 'FORBIDDEN'})
            with self.assertRaises(HTTPException) as caught:
                await _create(CreateSessionRequest(scope={'kind': 'workspace', 'workspace_id': 'ws-1'}), store, nest=nest)
            self.assertEqual(caught.exception.status_code, 404)
            self.assertEqual(caught.exception.detail['code'], 'SESSION_SCOPE_NOT_FOUND')

    async def test_existing_session_is_not_clobbered(self) -> None:
        store = _FakeStore()
        store.existing = AgentSession(session_id='keep', roadmap_id='roadmap-1', owner_key='someone')
        store.existing.messages.append(Message(role='user', content='live'))
        response = await _create(CreateSessionRequest(session_id='keep', roadmap_id='roadmap-1'), store)
        self.assertEqual(response.session_id, 'keep')
        self.assertEqual(response.scope.roadmap_id, 'roadmap-1')
        self.assertEqual(store.created_sessions, [])

    async def test_legacy_metadata_is_accepted(self) -> None:
        store = _FakeStore()
        payload = CreateSessionRequest(roadmap_id='roadmap-1', metadata={'brain_version': 'v2'})
        await _create(payload, store, nest=FakeNest(roadmaps={'roadmap-1': {'title': 'R1'}}))
        self.assertEqual(getattr(store.created_sessions[0].metadata, 'brain_version', None), 'v2')


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
