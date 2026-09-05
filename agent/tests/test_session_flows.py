"""Route flows over the real orchestrator with an in-memory store, a fake
NestJS client and a scripted LLM: trace-id resolution, the legacy sync mode,
`continue` at the budget and its trace reuse, the error codes the web
switches on (SESSION_NOT_FOUND / RUN_NOT_FOUND / RUN_NOT_CONTINUABLE /
RUN_IN_PROGRESS) and cancel."""

from __future__ import annotations

import json
import logging
import unittest
from time import monotonic
from types import SimpleNamespace
from uuid import UUID

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.flows import cancel_run_flow, continue_run_flow, send_message_flow
from app.api.routes.sessions_support.runtime import run_store_call
from app.core import trace
from app.core.contracts.sessions import MessageRequest
from app.core.runtime import orchestrator
from tests.runtime_fakes import (
    ALPHA,
    AUTH,
    BETA,
    OTHER_AUTH,
    FakeLLM,
    FakeNest,
    MemoryStore,
    add_epics,
    make_service,
    patched_llm,
    roadmap_session,
    settings_with,
    stage_args,
    text_resp,
    tool_resp,
    workspace_session,
)

LOGGER = logging.getLogger('session-flow-tests')


class _Harness:
    def __init__(self, session=None, **setting_updates):
        self.store = MemoryStore()
        self.nest = FakeNest()
        self.settings = settings_with(**setting_updates)
        self.service = make_service(self.store, self.nest, self.settings)
        self.session = session or roadmap_session()
        self.store.create(self.session)
        self.events: list[tuple[str, dict]] = []
        self.background: list = []

    async def runtime(self):
        return self.store, self.service

    async def session_or_404(self, service, session_id):
        return await run_store_call(service.get_session_or_404, session_id)

    def schedule(self, coro):
        self.background.append(coro)
        coro.close()

    def log(self, _logger, event, **data):
        self.events.append((event, data))

    def request(self, auth=AUTH, trace_id=None):
        headers = {'Authorization': auth} if auth and not auth.startswith('Guest ') else {}
        if auth and auth.startswith('Guest '):
            headers['X-Guest-User-Id'] = auth[6:]
        if trace_id:
            headers['X-Trace-Id'] = trace_id
        return SimpleNamespace(headers=headers)

    async def send(self, message, *, capabilities=('continue',), refs=None, auth=AUTH, trace_id=None):
        return await send_message_flow(
            session_id=self.session.session_id,
            payload=MessageRequest(message=message, refs=list(refs or []), capabilities=list(capabilities)),
            request=self.request(auth, trace_id),
            get_agent_runtime_async=self.runtime,
            get_session_or_404_async=self.session_or_404,
            run_store_call=run_store_call,
            schedule_background_task=self.schedule,
            settings=self.settings,
            logger=LOGGER,
            log_event_fn=self.log,
            nest_client=self.nest,
        )

    async def resume(self, run_id, *, auth=AUTH, trace_id=None, session_id=None):
        return await continue_run_flow(
            session_id=session_id or self.session.session_id,
            run_id=run_id,
            request=self.request(auth, trace_id),
            get_agent_runtime_async=self.runtime,
            get_session_or_404_async=self.session_or_404,
            run_store_call=run_store_call,
            schedule_background_task=self.schedule,
            settings=self.settings,
            logger=LOGGER,
            log_event_fn=self.log,
            nest_client=self.nest,
        )

    async def cancel(self, run_id, *, auth=AUTH):
        return await cancel_run_flow(
            session_id=self.session.session_id,
            run_id=run_id,
            request=self.request(auth),
            get_agent_runtime_async=self.runtime,
            get_session_or_404_async=self.session_or_404,
            run_store_call=run_store_call,
            logger=LOGGER,
        )


class _Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        trace.store.reset_for_tests()

    def tearDown(self) -> None:
        trace.store.reset_for_tests()


class TraceIdTests(_Base):
    async def test_send_message_uses_valid_x_trace_id(self):
        harness = _Harness()
        with patched_llm([text_resp('Planned response')]):
            response = await harness.send('Rename platform epic', trace_id='f607b6ec-a7df-41a8-ab15-ed9fac584f65')
        self.assertEqual(response.debug_trace_id, 'f607b6ec-a7df-41a8-ab15-ed9fac584f65')
        self.assertEqual(response.run.trace_id, response.debug_trace_id)
        self.assertTrue(any(name == 'message_received' for name, _ in harness.events))
        completed = next(data for name, data in harness.events if name == 'message_completed')
        self.assertEqual(completed['run_id'], response.run.run_id)
        self.assertEqual(completed['run_next'], 'done')

    async def test_send_message_generates_uuid_when_trace_id_invalid(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            response = await harness.send('Assign tasks', trace_id='not-a-valid-trace-id')
        parsed = UUID(response.debug_trace_id)
        self.assertEqual(str(parsed), response.debug_trace_id)


class SyncModeTests(_Base):
    async def test_legacy_client_runs_to_completion_in_one_request(self):
        harness = _Harness()
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(1))), text_resp('Done.')]):
            response = await harness.send('add an epic', capabilities=())
        self.assertEqual(response.run.next, 'done')
        self.assertEqual(response.response_mode, 'edit_plan')
        self.assertTrue(response.commit_summary.committed)
        self.assertEqual(len(response.operations), 1)
        self.assertEqual(response.staged_operations_count, 1)
        self.assertEqual(response.staged_operations_version, 1)
        # The trace is done (legacy message_completed + run_step_completed).
        payload = trace.store.read(session_id=harness.session.session_id, trace_id=response.debug_trace_id, settings=harness.settings)
        self.assertTrue(payload['done'])
        events = [event['event'] for event in payload['events']]
        self.assertIn('run_started', events)
        self.assertIn('commit_completed', events)
        self.assertIn('run_step_completed', events)

    async def test_legacy_client_skips_batches_beyond_the_reserve(self):
        harness = _Harness(workspace_session(), agent_run_hard_deadline_seconds=30, agent_run_step_budget_seconds=10)
        # Two-roadmap proposal, confirmed by a legacy client.
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(1), roadmap_id=ALPHA, message='A'), call_id='a').__class__(
            content=None,
            tool_calls=[
                *tool_resp('stage_edits', stage_args(add_epics(1), roadmap_id=ALPHA, message='A'), call_id='a').tool_calls,
                *tool_resp('stage_edits', stage_args(add_epics(1), roadmap_id=BETA, message='B'), call_id='b').tool_calls,
            ],
        )]):
            proposed = await harness.send('add an epic to Alpha and Beta', capabilities=())
        self.assertEqual(proposed.response_mode, 'plan_proposal')
        plan_id = proposed.plan_proposal['plan_id']
        harness.nest.commit_hook = lambda _n, _r, _p: None
        # Make the first commit consume the whole request budget.
        original_step = orchestrator.step

        def _step(ctx, session, run_input=None, **kwargs):
            def _spend(_n, _r, _p):
                ctx.started_monotonic = monotonic() - 100

            harness.nest.commit_hook = _spend
            return original_step(ctx, session, run_input, **kwargs)

        with patched_llm([text_resp('Committed one; the other was skipped.')]):
            confirmed = await send_message_flow(
                session_id=harness.session.session_id,
                payload=MessageRequest(message='__plan_decision__\n' + json.dumps({'decision': 'confirm', 'plan_id': plan_id})),
                request=harness.request(),
                get_agent_runtime_async=harness.runtime,
                get_session_or_404_async=harness.session_or_404,
                run_store_call=run_store_call,
                schedule_background_task=harness.schedule,
                settings=harness.settings,
                logger=LOGGER,
                log_event_fn=harness.log,
                nest_client=harness.nest,
                step_fn=_step,
            )
        self.assertEqual(confirmed.run.next, 'done')
        self.assertEqual([c.status for c in confirmed.commits], ['committed', 'skipped'])
        self.assertEqual(confirmed.commits[1].error_code, 'SKIPPED_BUDGET')
        # The pending plan keeps its committed flags so confirming again resumes.
        plan = harness.store.get(harness.session.session_id).metadata.pending_plan
        self.assertIsNotNone(plan)
        self.assertEqual([t.committed for t in plan.targets], [True, False])


class ContinueTests(_Base):
    async def test_continue_capability_returns_next_continue_at_budget_and_reuses_the_trace(self):
        harness = _Harness(agent_run_step_budget_seconds=10)
        original_step = orchestrator.step

        def _step(ctx, session, run_input=None, **kwargs):
            ctx.started_monotonic = monotonic() - 30  # the budget is already spent
            return original_step(ctx, session, run_input, **kwargs)

        with patched_llm([tool_resp('search_nodes', {'query': 'growth'})]):
            paused = await send_message_flow(
                session_id=harness.session.session_id,
                payload=MessageRequest(message='find growth', capabilities=['continue']),
                request=harness.request(trace_id='f607b6ec-a7df-41a8-ab15-ed9fac584f65'),
                get_agent_runtime_async=harness.runtime,
                get_session_or_404_async=harness.session_or_404,
                run_store_call=run_store_call,
                schedule_background_task=harness.schedule,
                settings=harness.settings,
                logger=LOGGER,
                log_event_fn=harness.log,
                nest_client=harness.nest,
                step_fn=_step,
            )
        self.assertEqual((paused.run.status, paused.run.next), ('running', 'continue'))
        self.assertEqual(paused.parse_mode, 'run_step')
        payload = trace.store.read(session_id=harness.session.session_id, trace_id=paused.debug_trace_id, settings=harness.settings)
        self.assertFalse(payload['done'])
        self.assertEqual(payload['run_id'], paused.run.run_id)
        # No snapshot push mid-segment.
        self.assertEqual(harness.nest.snapshot_puts, [])

        with patched_llm([text_resp('Found it.')]):
            resumed = await harness.resume(paused.run.run_id, trace_id='0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f')
        self.assertEqual(resumed.run.status, 'done')
        self.assertEqual(resumed.debug_trace_id, paused.debug_trace_id)  # request X-Trace-Id ignored
        self.assertEqual(resumed.run.trace_id, paused.run.trace_id)
        payload = trace.store.read(session_id=harness.session.session_id, trace_id=paused.debug_trace_id, settings=harness.settings)
        self.assertTrue(payload['done'])
        self.assertEqual(sum(1 for e in payload['events'] if e['event'] == 'run_step_completed'), 2)

    async def test_continue_on_finished_run_is_409_not_continuable(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            done = await harness.send('hello')
        with self.assertRaises(HTTPException) as caught:
            await harness.resume(done.run.run_id)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail['code'], 'RUN_NOT_CONTINUABLE')
        self.assertEqual(caught.exception.detail['run']['run_id'], done.run.run_id)

    async def test_continue_on_unknown_run_is_404(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            await harness.send('hello')
        with self.assertRaises(HTTPException) as caught:
            await harness.resume('missing-run')
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(caught.exception.detail['code'], 'RUN_NOT_FOUND')

    async def test_unknown_session_is_404_session_not_found(self):
        harness = _Harness()
        with self.assertRaises(HTTPException) as caught:
            await harness.resume('r', session_id='nope')
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(caught.exception.detail['code'], 'SESSION_NOT_FOUND')

    async def test_messages_while_locked_is_409_with_run_view(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            first = await harness.send('hello')
        harness.store.hold_lock(harness.session.session_id)
        with self.assertRaises(HTTPException) as caught:
            await harness.send('again')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail['code'], 'RUN_IN_PROGRESS')
        self.assertEqual(caught.exception.detail['run']['run_id'], first.run.run_id)

    async def test_owner_mismatch_is_404_on_every_route(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            done = await harness.send('hello')
        for call in (
            lambda: harness.send('x', auth=OTHER_AUTH),
            lambda: harness.resume(done.run.run_id, auth=OTHER_AUTH),
            lambda: harness.cancel(done.run.run_id, auth=OTHER_AUTH),
        ):
            with self.assertRaises(HTTPException) as caught:
                await call()
            self.assertEqual(caught.exception.status_code, 404)
            self.assertEqual(caught.exception.detail['code'], 'SESSION_NOT_FOUND')

    async def test_snapshot_pushed_only_at_segment_end_by_scope(self):
        harness = _Harness(workspace_session())
        with patched_llm([tool_resp('propose', {'summary': 's', 'goal': 'g', 'targets': [{'roadmap_id': ALPHA, 'proposed_hierarchy': [{'title': 'E'}]}]})]):
            await harness.send('plan')
        self.assertEqual(len(harness.background), 1)  # the snapshot push coroutine


class CancelTests(_Base):
    async def test_cancel_marks_side_key_and_finalizes_when_idle(self):
        harness = _Harness()
        with patched_llm([tool_resp('propose', {'summary': 's', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E'}]})]):
            proposed = await harness.send('plan')
        self.assertEqual(proposed.run.status, 'awaiting_user')
        cancelled = await harness.cancel(proposed.run.run_id)
        self.assertEqual(cancelled.run.status, 'cancelled')
        self.assertEqual(cancelled.run.run_id, proposed.run.run_id)
        session = harness.store.get(harness.session.session_id)
        self.assertIsNone(session.metadata.pending_plan)
        self.assertEqual(session.metadata.run.status, 'cancelled')
        key = harness.store.run_key(harness.session.session_id, proposed.run.run_id, 'cancel')
        self.assertTrue(harness.store.exists(key))
        self.assertEqual(session.metadata.run_history[0].status, 'cancelled')

    async def test_cancel_while_locked_only_flags(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            done = await harness.send('hello')
        # A still-running run whose step holds the lock elsewhere.
        session = harness.store.get(harness.session.session_id)
        session.metadata.run.status = 'running'
        session.metadata.run.next = 'continue'
        harness.store.update(session)
        harness.store.hold_lock(harness.session.session_id)
        response = await harness.cancel(done.run.run_id)
        self.assertEqual(response.run.status, 'running')
        key = harness.store.run_key(harness.session.session_id, done.run.run_id, 'cancel')
        self.assertTrue(harness.store.exists(key))

    async def test_cancel_unknown_run_is_404(self):
        harness = _Harness()
        with patched_llm([text_resp('ok')]):
            await harness.send('hello')
        with self.assertRaises(HTTPException) as caught:
            await harness.cancel('nope')
        self.assertEqual(caught.exception.detail['code'], 'RUN_NOT_FOUND')


if __name__ == '__main__':
    unittest.main()
