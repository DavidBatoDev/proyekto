from __future__ import annotations

import asyncio
import logging
import unittest

from fastapi import HTTPException

from app.core.contracts.sessions import AgentSession
from app.core.memory.actor_context import (
    ensure_actor_context,
    is_actor_context_required_message,
    should_fetch_actor_context,
)


class _ActorNest:
    def __init__(self, *, error: Exception | None = None):
        self.roadmap_calls: list[str] = []
        self.user_calls = 0
        self.error = error

    async def context_actor(self, *, roadmap_id, auth_header, trace_id=None):
        self.roadmap_calls.append(roadmap_id)
        if self.error is not None:
            raise self.error
        return {'actor_id': 'user-1', 'display_name': 'Ana', 'roadmap_role': 'editor'}

    async def ai_context_actor(self, auth_header, trace_id=None):
        self.user_calls += 1
        if self.error is not None:
            raise self.error
        return {'actor_id': 'user-1', 'display_name': 'Ana', 'locale': None, 'timezone': None}


def _ensure(session, nest, auth='Bearer t'):
    ensure_actor_context(
        session=session,
        auth_header=auth,
        trace_id='trace-1',
        nest_client=nest,
        run_async_call=asyncio.run,
        logger=logging.getLogger('actor-context-tests'),
        settings=None,
    )


class EnsureActorContextScopeTests(unittest.TestCase):
    def test_roadmap_scope_uses_the_roadmap_actor_route(self) -> None:
        session = AgentSession(roadmap_id='roadmap-1')
        nest = _ActorNest()
        _ensure(session, nest)
        self.assertEqual(nest.roadmap_calls, ['roadmap-1'])
        self.assertEqual(nest.user_calls, 0)
        actor = session.metadata.actor_context
        assert actor is not None
        self.assertEqual(actor.actor_id, 'user-1')
        self.assertEqual(actor.roadmap_role, 'editor')

    def test_workspace_scope_uses_the_user_scoped_route_without_a_role(self) -> None:
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        nest = _ActorNest()
        _ensure(session, nest)
        self.assertEqual(nest.roadmap_calls, [])
        self.assertEqual(nest.user_calls, 1)
        actor = session.metadata.actor_context
        assert actor is not None
        self.assertEqual(actor.display_name, 'Ana')
        self.assertIsNone(actor.roadmap_role)

    def test_missing_auth_clears_actor(self) -> None:
        session = AgentSession(roadmap_id='roadmap-1')
        nest = _ActorNest()
        _ensure(session, nest)
        _ensure(session, nest, auth=None)
        self.assertIsNone(session.metadata.actor_context)

    def test_backend_failure_keeps_previous_actor_once(self) -> None:
        session = AgentSession(roadmap_id='roadmap-1')
        _ensure(session, _ActorNest())
        failing = _ActorNest(error=HTTPException(status_code=503, detail='down'))
        _ensure(session, failing)
        self.assertIsNotNone(session.metadata.actor_context)
        _ensure(session, failing)
        self.assertIsNone(session.metadata.actor_context)


class ActorContextProviderTests(unittest.TestCase):
    def test_is_actor_context_required_message_detects_me_reference(self) -> None:
        self.assertTrue(
            is_actor_context_required_message(
                'Assigned all tasks to me inside the Agent Module'
            )
        )

    def test_is_actor_context_required_message_detects_user_reference(self) -> None:
        self.assertTrue(
            is_actor_context_required_message('Assign all tasks in Agent Module to user')
        )

    def test_should_fetch_actor_context_for_simple_edit_when_actor_reference_present(self) -> None:
        should_fetch, skip_reason = should_fetch_actor_context(
            preview_intent='roadmap_edit',
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            auth_header='Bearer token',
            simple_edit_detected=True,
            actor_context_present=False,
        )
        self.assertTrue(should_fetch)
        self.assertIsNone(skip_reason)

    def test_should_skip_simple_edit_without_actor_reference(self) -> None:
        should_fetch, skip_reason = should_fetch_actor_context(
            preview_intent='roadmap_edit',
            user_message='Rename Platform Foundation to Platform Foundation 1',
            auth_header='Bearer token',
            simple_edit_detected=True,
            actor_context_present=False,
        )
        self.assertFalse(should_fetch)
        self.assertEqual(skip_reason, 'simple_edit_turn')


if __name__ == '__main__':
    unittest.main()

