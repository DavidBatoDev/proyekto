"""Session ownership: the owner key a forwarded auth identifies, the
per-request check (adopt-first-caller for pre-ownership sessions), the 404
on a mismatch in step(), and the owner-checked trace read."""

from __future__ import annotations

import unittest
from uuid import uuid4

from fastapi.exceptions import HTTPException

from app.core import trace
from app.core.contracts.sessions import ActorContext, AgentSession
from app.core.logging_utils import log_event
from app.core.runtime import orchestrator
from app.core.runtime.sentinels import parse_user_input
from app.core.runtime.service import caller_matches_owner, owner_key_from_auth
from tests.runtime_fakes import ALPHA, AUTH, OTHER_AUTH, USER, MemoryStore, make_service, patched_llm, roadmap_session, settings_with, text_resp


class OwnerKeyTests(unittest.TestCase):
    def test_guest_header(self):
        self.assertEqual(owner_key_from_auth('Guest g-1'), 'Guest g-1')
        self.assertEqual(owner_key_from_auth('guest g-2'), 'Guest g-2')
        self.assertIsNone(owner_key_from_auth('Guest '))

    def test_bearer_subject(self):
        self.assertEqual(owner_key_from_auth(AUTH), USER)
        self.assertEqual(owner_key_from_auth(AUTH, actor_id='verified-id'), 'verified-id')
        self.assertIsNone(owner_key_from_auth('Bearer not-a-jwt'))
        self.assertIsNone(owner_key_from_auth(None))
        self.assertIsNone(owner_key_from_auth(''))

    def test_caller_matches_owner(self):
        session = roadmap_session(owner_key=USER)
        self.assertTrue(caller_matches_owner(AUTH, session))
        self.assertFalse(caller_matches_owner(OTHER_AUTH, session))
        self.assertFalse(caller_matches_owner(None, session))
        self.assertFalse(caller_matches_owner('Guest g-1', session))

    def test_legacy_session_adopts_the_first_identified_caller(self):
        session = AgentSession(roadmap_id=ALPHA)
        self.assertIsNone(session.owner_key)
        self.assertTrue(caller_matches_owner(None, session))  # nothing to adopt
        self.assertIsNone(session.owner_key)
        self.assertTrue(caller_matches_owner('Guest g-9', session))
        self.assertEqual(session.owner_key, 'Guest g-9')
        self.assertFalse(caller_matches_owner(AUTH, session))

    def test_verified_actor_backs_the_bearer(self):
        session = roadmap_session(owner_key=USER)
        session.metadata.actor_context = ActorContext(actor_id=USER)
        self.assertTrue(caller_matches_owner(AUTH, session))


class StepOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        trace.store.reset_for_tests()

    def test_step_404s_on_owner_mismatch_before_taking_the_lock(self):
        store = MemoryStore()
        service = make_service(store)
        session = roadmap_session()
        store.create(session)
        ctx = service.new_step_context(auth_header=OTHER_AUTH, trace_id=str(uuid4()))
        with self.assertRaises(HTTPException) as caught:
            orchestrator.step(ctx, session, parse_user_input(session, 'hi'))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(caught.exception.detail['code'], 'SESSION_NOT_FOUND')
        self.assertEqual(store.lock_events, [])

    def test_guest_owner_matches_guest_header(self):
        store = MemoryStore()
        service = make_service(store, settings=settings_with())
        session = roadmap_session(owner_key='Guest g-1')
        store.create(session)
        ctx = service.new_step_context(auth_header='Guest g-1', trace_id=str(uuid4()))
        with patched_llm([text_resp('hello')]):
            result = orchestrator.step(ctx, session, parse_user_input(session, 'hi'))
        self.assertEqual(result.run.status, 'done')


class TraceOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        trace.store.reset_for_tests()

    def tearDown(self) -> None:
        trace.store.reset_for_tests()

    def test_trace_read_404s_for_another_owner(self):
        settings = settings_with(agent_progress_events_enabled=True)
        trace_id = str(uuid4())
        trace.store.activate(trace_id, session_id='s-1', owner_key=USER, run_id='r-1', phase='investigate')
        log_event(trace.store.__class__.__module__ and __import__('logging').getLogger('t'), 'message_received', settings=settings, trace_id=trace_id, session_id='s-1', message='hi')
        owner = trace.store.read(session_id='s-1', trace_id=trace_id, settings=settings, owner_key=owner_key_from_auth(AUTH))
        self.assertIsNotNone(owner)
        self.assertEqual(owner['run_id'], 'r-1')
        other = trace.store.read(session_id='s-1', trace_id=trace_id, settings=settings, owner_key=owner_key_from_auth(OTHER_AUTH))
        self.assertIsNone(other)
        anonymous = trace.store.read(session_id='s-1', trace_id=trace_id, settings=settings, owner_key=owner_key_from_auth(None))
        self.assertIsNone(anonymous)


if __name__ == '__main__':
    unittest.main()
