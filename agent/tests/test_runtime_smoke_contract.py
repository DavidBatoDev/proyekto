"""HTTP smoke test of the agent wire contract.

Boots the real FastAPI app under ``TestClient`` with the in-memory trace
backend, the in-memory session store and the scripted NestJS client patched
into the runtime resolver (no Redis, no network, no sleeps), then drives the
routes the web calls: create (legacy body / scope body / missing auth),
messages, ``runs/{id}/continue``, ``runs/{id}/cancel`` and the trace read.
Every assertion is on the JSON the web will parse.
"""

from __future__ import annotations

import json
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app import main as main_module
from app.api.routes import sessions as sessions_routes
from app.api.routes.sessions_support import runtime as runtime_mod
from app.core import trace
from app.main import app
from tests.runtime_fakes import (
    ALPHA,
    AUTH,
    BETA,
    OTHER_AUTH,
    USER,
    WORKSPACE,
    FakeNest,
    MemoryStore,
    add_epics,
    make_service,
    multi_tool_resp,
    patched_llm,
    settings_with,
    stage_args,
    text_resp,
    tool_resp,
)

MAX_CONTINUES = 10


def _confirm(plan_id: str | None) -> str:
    return '__plan_decision__\n' + json.dumps({'decision': 'confirm', 'plan_id': plan_id})


class _SmokeBase(unittest.TestCase):
    """One app, one fake runtime per test, wired through the resolver hook."""

    setting_updates: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        trace.store.reset_for_tests()
        self.store = MemoryStore()
        self.nest = FakeNest()
        self.settings = settings_with(
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
            **self.setting_updates,
        )
        self.service = make_service(self.store, self.nest, self.settings)
        runtime_mod.configure_runtime_resolver(lambda: (self.store, self.service))
        self._saved = (
            sessions_routes._nest_client,
            sessions_routes._schedule_background_task,
            sessions_routes.settings.agent_progress_events_enabled,
            sessions_routes.settings.agent_progress_events_allow_verbose,
        )
        sessions_routes._nest_client = self.nest
        sessions_routes._schedule_background_task = self._discard_background
        sessions_routes.settings.agent_progress_events_enabled = True
        sessions_routes.settings.agent_progress_events_allow_verbose = True
        self.background: list[str] = []

    def tearDown(self) -> None:
        (
            sessions_routes._nest_client,
            sessions_routes._schedule_background_task,
            sessions_routes.settings.agent_progress_events_enabled,
            sessions_routes.settings.agent_progress_events_allow_verbose,
        ) = self._saved
        runtime_mod.configure_runtime_resolver(main_module._resolve_agent_runtime)
        trace.store.reset_for_tests()

    # -- background work: recorded, never run (no loop outlives a request) --
    def _discard_background(self, coro):
        self.background.append(getattr(coro, '__name__', type(coro).__name__))
        coro.close()
        return None

    # -- HTTP helpers --------------------------------------------------------
    @staticmethod
    def _headers(auth: str | None = AUTH, trace_id: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if auth and auth.startswith('Guest '):
            headers['X-Guest-User-Id'] = auth[6:]
        elif auth:
            headers['Authorization'] = auth
        if trace_id:
            headers['X-Trace-Id'] = trace_id
        return headers

    def _create(self, body: dict, *, auth: str | None = AUTH):
        return self.client.post('/agent/sessions', json=body, headers=self._headers(auth))

    def _create_roadmap_session(self) -> str:
        response = self._create({'roadmap_id': ALPHA, 'metadata': {'brain_version': 'v2'}})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['session_id']

    def _create_workspace_session(self) -> str:
        response = self._create({'scope': {'kind': 'workspace', 'workspace_id': WORKSPACE}})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['session_id']

    def _send(
        self,
        session_id: str,
        message: str,
        *,
        capabilities: tuple[str, ...] | None = ('continue',),
        refs: list[dict] | None = None,
        auth: str | None = AUTH,
        trace_id: str | None = None,
    ):
        body: dict = {'message': message}
        if capabilities is not None:
            body['capabilities'] = list(capabilities)
        if refs:
            body['refs'] = refs
        return self.client.post(
            f'/agent/sessions/{session_id}/messages',
            json=body,
            headers=self._headers(auth, trace_id),
        )

    def _continue(self, session_id: str, run_id: str, *, auth: str | None = AUTH):
        return self.client.post(
            f'/agent/sessions/{session_id}/runs/{run_id}/continue',
            headers=self._headers(auth),
        )

    def _cancel(self, session_id: str, run_id: str, *, auth: str | None = AUTH):
        return self.client.post(
            f'/agent/sessions/{session_id}/runs/{run_id}/cancel',
            headers=self._headers(auth),
        )

    def _trace_events(self, session_id: str, trace_id: str, *, auth: str | None = AUTH):
        return self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'after_seq': 0, 'limit': 200, 'detail': 'verbose'},
            headers=self._headers(auth),
        )

    def _drive(self, session_id: str, payload: dict) -> tuple[dict, int]:
        """Follow ``run.next == 'continue'`` the way the web does; returns the
        settled payload and how many continues it took."""
        continues = 0
        while payload['run']['next'] == 'continue':
            self.assertLess(continues, MAX_CONTINUES, 'run never settled')
            response = self._continue(session_id, payload['run']['run_id'])
            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            continues += 1
        return payload, continues


class CreateSessionTests(_SmokeBase):
    def test_legacy_body_scope_body_and_missing_auth(self) -> None:
        # Legacy create body (the deployed web bundle + the Playwright specs).
        legacy = self._create({'roadmap_id': ALPHA, 'metadata': {'brain_version': 'v2'}})
        self.assertEqual(legacy.status_code, 200, legacy.text)
        body = legacy.json()
        self.assertEqual(body['scope'], {'kind': 'roadmap', 'roadmap_id': ALPHA, 'workspace_id': None})
        self.assertEqual(body['roadmap_id'], ALPHA)
        UUID(body['session_id'])  # the agent mints a uuid when none is given
        stored = self.store.get(body['session_id'])
        self.assertEqual(stored.owner_key, USER)
        self.assertEqual(stored.metadata.actor_context.actor_id, USER)
        self.assertEqual(getattr(stored.metadata, 'brain_version', None), 'v2')

        # Scope body (the dashboard assistant).
        scoped = self._create({'scope': {'kind': 'workspace', 'workspace_id': WORKSPACE}})
        self.assertEqual(scoped.status_code, 200, scoped.text)
        body = scoped.json()
        self.assertEqual(body['scope']['kind'], 'workspace')
        self.assertEqual(body['scope']['workspace_id'], WORKSPACE)
        self.assertIsNone(body['roadmap_id'])
        self.assertEqual(self.store.get(body['session_id']).owner_key, USER)

        # Explicit session id (the web passes the DB row id) is honoured.
        explicit = self._create({'session_id': str(uuid4()), 'scope': {'kind': 'roadmap', 'roadmap_id': ALPHA}})
        self.assertEqual(explicit.status_code, 200, explicit.text)

        # No auth at all -> 401 AUTH_REQUIRED, nothing stored.
        before = len(self.store.docs)
        anonymous = self._create({'roadmap_id': ALPHA}, auth=None)
        self.assertEqual(anonymous.status_code, 401, anonymous.text)
        self.assertEqual(anonymous.json()['detail']['code'], 'AUTH_REQUIRED')
        self.assertEqual(len(self.store.docs), before)

        # Both bodies must agree when both are sent.
        conflicting = self._create({'roadmap_id': ALPHA, 'scope': {'kind': 'roadmap', 'roadmap_id': BETA}})
        self.assertEqual(conflicting.status_code, 422, conflicting.text)

    def test_inaccessible_scope_is_404_session_scope_not_found(self) -> None:
        from fastapi.exceptions import HTTPException

        self.nest.actor_error = HTTPException(status_code=403, detail={'code': 'FORBIDDEN'})
        denied = self._create({'roadmap_id': ALPHA})
        self.assertEqual(denied.status_code, 404, denied.text)
        self.assertEqual(denied.json()['detail']['code'], 'SESSION_SCOPE_NOT_FOUND')
        self.nest.actor_error = None
        self.nest.workspace_error = HTTPException(status_code=404, detail={'code': 'NOT_FOUND'})
        denied = self._create({'scope': {'kind': 'workspace', 'workspace_id': WORKSPACE}})
        self.assertEqual(denied.status_code, 404, denied.text)
        self.assertEqual(denied.json()['detail']['code'], 'SESSION_SCOPE_NOT_FOUND')


class RunContractTests(_SmokeBase):
    def test_direct_focus_roadmap_edit_runs_to_done_with_one_commit(self) -> None:
        session_id = self._create_roadmap_session()
        trace_id = str(uuid4())
        with patched_llm([
            tool_resp('stage_edits', stage_args([{'op': 'add_epic', 'data': {'title': 'Growth'}}], message='Added Growth.')),
            text_resp('Added the Growth epic to Alpha.'),
        ]):
            response = self._send(session_id, 'add an epic called Growth', trace_id=trace_id)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        run = payload['run']
        self.assertEqual((run['status'], run['next'], run['phase']), ('done', 'done', 'verify'))
        self.assertIsNone(run['checkpoint'])
        self.assertEqual(run['scope'], {'kind': 'roadmap', 'roadmap_id': ALPHA, 'workspace_id': None})
        self.assertEqual(run['focus_roadmap_ids'], [ALPHA])
        self.assertEqual(run['verify']['status'], 'verified')
        self.assertEqual(payload['debug_trace_id'], trace_id)
        self.assertEqual(run['trace_id'], trace_id)
        UUID(run['run_id'])
        # Legacy fields the deployed bundle reads.
        self.assertEqual(payload['response_mode'], 'edit_plan')
        self.assertEqual(payload['parse_mode'], 'run_report')
        self.assertEqual(payload['intent_type'], 'roadmap_edit')
        self.assertEqual(len(payload['operations']), 1)
        self.assertEqual(payload['operations'][0]['op'], 'add_epic')
        self.assertTrue(payload['commit_summary']['committed'])
        self.assertGreater(payload['staged_operations_count'], 0)
        self.assertEqual(payload['staged_operations_version'], 1)
        self.assertEqual(payload['assistant_message'], 'Added the Growth epic to Alpha.')
        # The run's commits: one, committed, carrying this step's operations.
        self.assertEqual(len(payload['commits']), 1)
        commit = payload['commits'][0]
        self.assertEqual((commit['status'], commit['roadmap_id'], commit['roadmap_title']), ('committed', ALPHA, 'Alpha'))
        self.assertEqual(commit['operations_count'], 1)
        self.assertEqual(len(commit['operations']), 1)
        self.assertTrue(commit['history_recorded'])
        # RunView.commits never carries operations (the key serializes as null).
        self.assertEqual(run['commits'][0]['batch_id'], commit['batch_id'])
        self.assertIsNone(run['commits'][0].get('operations'))
        # Direct focus edit: no preview; the commit carries the session + run ids.
        self.assertEqual(self.nest.preview_calls, [])
        self.assertEqual(len(self.nest.commit_calls), 1)
        self.assertEqual(self.nest.commit_calls[0]['session_id'], session_id)
        self.assertEqual(self.nest.commit_calls[0]['run_id'], run['run_id'])
        self.assertEqual(self.store.lock_events, ['acquired', 'released'])
        # Snapshot push was scheduled at the terminal (the segment ended).
        self.assertIn('push_agent_state_snapshot', self.background)

        # The trace read: Redis-backed store, owner-checked, done at the terminal.
        events = self._trace_events(session_id, trace_id)
        self.assertEqual(events.status_code, 200, events.text)
        trace_payload = events.json()
        self.assertTrue(trace_payload['done'])
        self.assertEqual(trace_payload['run_id'], run['run_id'])
        names = [event['event'] for event in trace_payload['events']]
        for expected in ('run_started', 'commit_completed', 'verify_completed', 'run_step_completed'):
            self.assertIn(expected, names)

    def test_workspace_sixteen_ops_proposal_confirm_continue_until_verify(self) -> None:
        session_id = self._create_workspace_session()
        with patched_llm([
            tool_resp('stage_edits', stage_args(add_epics(16), roadmap_id=ALPHA, message='Sixteen epics.')),
        ]):
            response = self._send(session_id, 'add sixteen epics to Alpha')
        self.assertEqual(response.status_code, 200, response.text)
        proposed = response.json()
        self.assertEqual(proposed['run']['status'], 'awaiting_user')
        self.assertEqual(proposed['run']['next'], 'await_user')
        self.assertEqual(proposed['run']['checkpoint'], 'proposal')
        self.assertEqual(proposed['response_mode'], 'plan_proposal')
        self.assertEqual(proposed['plan_proposal']['kind'], 'edits')
        plan_id = proposed['plan_proposal']['plan_id']
        self.assertTrue(plan_id)
        self.assertEqual(self.nest.commit_calls, [])

        with patched_llm([text_resp('Added sixteen epics to Alpha.')]):
            response = self._send(session_id, _confirm(plan_id))
        self.assertEqual(response.status_code, 200, response.text)
        confirmed, _continues = self._drive(session_id, response.json())
        run = confirmed['run']
        self.assertEqual(run['run_id'], proposed['run']['run_id'])  # same run, new segment
        self.assertEqual((run['status'], run['next'], run['phase']), ('done', 'done', 'verify'))
        self.assertEqual(confirmed['parse_mode'], 'run_report')
        self.assertEqual(confirmed['response_mode'], 'edit_plan')
        self.assertEqual(confirmed['assistant_message'], 'Added sixteen epics to Alpha.')
        # The verify report.
        self.assertEqual(run['verify']['status'], 'verified')
        self.assertTrue(run['verify']['checks'])
        self.assertTrue(run['verify']['summary'])
        self.assertIsNone(run['verify']['follow_up_plan_id'])
        # Proposal batches preview then commit; one commit for Alpha.
        self.assertEqual([c['roadmap_id'] for c in self.nest.preview_calls], [ALPHA])
        self.assertEqual(len(self.nest.commit_calls), 1)
        self.assertEqual(len(self.nest.commit_calls[0]['payload']['operations']), 16)
        self.assertEqual([c['status'] for c in confirmed['commits']], ['committed'])
        self.assertEqual(confirmed['commits'][0]['operations_count'], 16)
        # Workspace scope has no focus roadmap: the legacy fields stay empty.
        self.assertIsNone(confirmed['commit_summary'])
        self.assertEqual(confirmed['operations'], [])
        self.assertIsNone(self.store.get(session_id).metadata.pending_plan)

    def test_two_roadmap_edit_commits_each_roadmap(self) -> None:
        session_id = self._create_roadmap_session()
        with patched_llm([
            tool_resp('get_roadmap_overview', {'roadmap_id': BETA}),
            multi_tool_resp(
                ('stage_edits', stage_args(add_epics(1, 'Alpha'), message='Alpha done.')),
                ('stage_edits', stage_args(add_epics(1, 'Beta'), roadmap_id=BETA, message='Beta done.')),
            ),
        ]):
            response = self._send(session_id, 'add an epic to Alpha and Beta')
        self.assertEqual(response.status_code, 200, response.text)
        proposed = response.json()
        self.assertEqual(proposed['run']['checkpoint'], 'proposal')
        self.assertEqual(sorted(proposed['run']['focus_roadmap_ids']), sorted([ALPHA, BETA]))
        # At the checkpoint the batches live on the proposal (run.batches is
        # rebuilt from pending_plan.targets on confirm).
        self.assertEqual(proposed['run']['batches'], [])
        self.assertEqual(proposed['plan_proposal']['kind'], 'edits')
        self.assertEqual([t['roadmap_id'] for t in proposed['plan_proposal']['targets']], [ALPHA, BETA])
        plan_id = proposed['plan_proposal']['plan_id']

        with patched_llm([text_resp('Committed to both roadmaps.')]):
            response = self._send(session_id, _confirm(plan_id))
        self.assertEqual(response.status_code, 200, response.text)
        confirmed, _continues = self._drive(session_id, response.json())
        self.assertEqual(confirmed['run']['status'], 'done')
        commits = confirmed['commits']
        self.assertEqual([c['status'] for c in commits], ['committed', 'committed'])
        self.assertEqual([c['roadmap_id'] for c in commits], [ALPHA, BETA])
        self.assertEqual([c['roadmap_title'] for c in commits], ['Alpha', 'Beta'])
        self.assertEqual(len({c['change_id'] for c in commits}), 2)
        self.assertTrue(all(c['operations'] for c in commits))
        self.assertEqual([c['roadmap_id'] for c in self.nest.commit_calls], [ALPHA, BETA])
        # The legacy mirror only reports the focus roadmap's commit.
        self.assertTrue(confirmed['commit_summary']['committed'])
        self.assertEqual(len(confirmed['operations']), 1)
        self.assertEqual(confirmed['run']['verify']['status'], 'verified')

    def test_cancel_mid_execute_skips_the_rest_and_reports_cancelled(self) -> None:
        session_id = self._create_roadmap_session()
        with patched_llm([
            multi_tool_resp(
                ('stage_edits', stage_args(add_epics(1, 'Alpha'), message='Alpha done.')),
                ('stage_edits', stage_args(add_epics(1, 'Beta'), roadmap_id=BETA, message='Beta done.')),
            ),
        ]):
            proposed = self._send(session_id, 'add an epic to Alpha and Beta').json()
        plan_id = proposed['plan_proposal']['plan_id']
        cancel_responses: list[dict] = []

        def _cancel_from_inside_the_first_commit(_nest, _roadmap_id, _payload):
            # The step holds the run lock: cancel only flags (side key) and
            # the execute phase observes it before the next batch.
            run_id = self.store.get(session_id).metadata.run.run_id
            response = self._cancel(session_id, run_id)
            cancel_responses.append({'status_code': response.status_code, **response.json()})
            self.nest.commit_hook = None

        self.nest.commit_hook = _cancel_from_inside_the_first_commit
        with patched_llm([text_resp('Committed one; the rest was cancelled.')]):
            response = self._send(session_id, _confirm(plan_id))
        self.assertEqual(response.status_code, 200, response.text)
        final, _continues = self._drive(session_id, response.json())
        self.assertEqual(len(cancel_responses), 1)
        self.assertEqual(cancel_responses[0]['status_code'], 200)
        self.assertEqual(cancel_responses[0]['run']['status'], 'running')  # lock held: flagged only
        run = final['run']
        self.assertEqual((run['status'], run['next']), ('cancelled', 'done'))
        self.assertEqual([c['status'] for c in final['commits']], ['committed', 'skipped'])
        self.assertEqual(final['commits'][1]['error_code'], 'CANCELLED')
        self.assertEqual(len(self.nest.commit_calls), 1)
        self.assertEqual(run['verify']['status'], 'partial')
        stored = self.store.get(session_id)
        self.assertEqual(stored.metadata.run.status, 'cancelled')
        self.assertTrue(self.store.exists(self.store.run_key(session_id, run['run_id'], 'cancel')))
        # A cancelled run is terminal: continue is 409 RUN_NOT_CONTINUABLE.
        again = self._continue(session_id, run['run_id'])
        self.assertEqual(again.status_code, 409, again.text)
        self.assertEqual(again.json()['detail']['code'], 'RUN_NOT_CONTINUABLE')
        self.assertEqual(again.json()['detail']['run']['status'], 'cancelled')

    def test_owner_mismatch_is_404_on_every_route(self) -> None:
        session_id = self._create_roadmap_session()
        trace_id = str(uuid4())
        with patched_llm([text_resp('Hello.')]):
            own = self._send(session_id, 'hello', trace_id=trace_id)
        self.assertEqual(own.status_code, 200, own.text)
        run_id = own.json()['run']['run_id']

        with patched_llm([text_resp('never')]):
            other = self._send(session_id, 'hello', auth=OTHER_AUTH)
        self.assertEqual(other.status_code, 404, other.text)
        self.assertEqual(other.json()['detail']['code'], 'SESSION_NOT_FOUND')
        self.assertEqual(self._continue(session_id, run_id, auth=OTHER_AUTH).status_code, 404)
        self.assertEqual(self._cancel(session_id, run_id, auth=OTHER_AUTH).status_code, 404)
        self.assertEqual(self._trace_events(session_id, trace_id, auth=OTHER_AUTH).status_code, 404)
        # The owner still reads the trace.
        self.assertEqual(self._trace_events(session_id, trace_id).status_code, 200)
        # Unknown session -> SESSION_NOT_FOUND (the web rehydrates + retries).
        missing = self._send('no-such-session', 'hello')
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()['detail']['code'], 'SESSION_NOT_FOUND')

    def test_legacy_client_without_capabilities_completes_in_one_request(self) -> None:
        session_id = self._create_roadmap_session()
        with patched_llm([
            tool_resp('stage_edits', stage_args([{'op': 'add_epic', 'data': {'title': 'Legacy'}}], message='Staged.')),
            text_resp('Added the Legacy epic.'),
        ]):
            response = self._send(session_id, 'add an epic called Legacy', capabilities=None)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual((payload['run']['status'], payload['run']['next']), ('done', 'done'))
        self.assertEqual(payload['response_mode'], 'edit_plan')
        self.assertTrue(payload['commit_summary']['committed'])
        self.assertEqual(len(payload['operations']), 1)
        self.assertEqual(payload['staged_operations_count'], 1)
        self.assertEqual(payload['assistant_message'], 'Added the Legacy epic.')
        self.assertEqual(len(self.nest.commit_calls), 1)

    def test_messages_while_locked_is_409_run_in_progress(self) -> None:
        session_id = self._create_roadmap_session()
        self.store.hold_lock(session_id)
        try:
            with patched_llm([text_resp('never')]):
                response = self._send(session_id, 'hello')
        finally:
            self.store.locks.clear()
        self.assertEqual(response.status_code, 409, response.text)
        detail = response.json()['detail']
        self.assertEqual(detail['code'], 'RUN_IN_PROGRESS')
        self.assertIn('run', detail)
        # Unknown run on continue / cancel.
        self.assertEqual(self._continue(session_id, str(uuid4())).json()['detail']['code'], 'RUN_NOT_FOUND')
        self.assertEqual(self._cancel(session_id, str(uuid4())).json()['detail']['code'], 'RUN_NOT_FOUND')


class ContinueContractTests(_SmokeBase):
    """A zero soft budget: the investigate loop pauses after its first turn
    whenever that turn was not terminal, so ``continue`` is exercised for real."""

    setting_updates = {'agent_run_step_budget_seconds': 0.0}

    def test_continue_resumes_a_paused_investigate_and_reuses_the_trace(self) -> None:
        session_id = self._create_roadmap_session()
        trace_id = str(uuid4())
        with patched_llm([
            tool_resp('search_nodes', {'query': 'growth'}),
            text_resp('Growth is the first epic.'),
        ]):
            first = self._send(session_id, 'which epic is about growth?', trace_id=trace_id)
            self.assertEqual(first.status_code, 200, first.text)
            paused = first.json()
            self.assertEqual((paused['run']['status'], paused['run']['next']), ('running', 'continue'))
            self.assertEqual(paused['parse_mode'], 'run_step')
            self.assertEqual(paused['assistant_message'], '')
            self.assertEqual(paused['run']['step'], 1)
            # Mid-segment: the trace is still open.
            mid = self._trace_events(session_id, trace_id).json()
            self.assertFalse(mid['done'])
            self.assertEqual(mid['run_id'], paused['run']['run_id'])

            final, continues = self._drive(session_id, paused)
        self.assertEqual(continues, 1)
        run = final['run']
        self.assertEqual((run['status'], run['next']), ('done', 'done'))
        self.assertEqual(run['run_id'], paused['run']['run_id'])
        self.assertEqual(run['trace_id'], trace_id)  # continue reuses the segment trace
        self.assertEqual(final['debug_trace_id'], trace_id)
        self.assertEqual(run['step'], 2)
        self.assertEqual(final['assistant_message'], 'Growth is the first epic.')
        self.assertEqual(final['response_mode'], 'chat')
        self.assertEqual(final['commits'], [])
        # One user turn + one assistant turn in history, no duplicate.
        self.assertEqual([m.role for m in self.store.get(session_id).messages], ['user', 'assistant'])
        done = self._trace_events(session_id, trace_id).json()
        self.assertTrue(done['done'])
        # A finished run cannot be continued.
        again = self._continue(session_id, run['run_id'])
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['detail']['code'], 'RUN_NOT_CONTINUABLE')


if __name__ == '__main__':
    unittest.main()
