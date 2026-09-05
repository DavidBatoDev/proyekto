"""Execute phase: per-roadmap commits with the retry policy ported from the
single-roadmap auto-commit, idempotency-key reuse only while the operations
hash is unchanged, the resume guard over ``GET /ai/context/changes``, the
batch gate on the hard deadline + reserve, materialize pause/resume, cancel
between batches, the handle-roadmap guard and the one repair iteration."""

from __future__ import annotations

import unittest
from time import monotonic
from unittest.mock import AsyncMock, patch

from fastapi.exceptions import HTTPException

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch
from datetime import datetime, timezone

from app.core.contracts.sessions import PendingPlan, RecentResolvedTarget, RoadmapContext
from app.core.runtime import runs
from app.core.runtime.phases import execute
from app.core.runtime.service import StepContext
from tests.runtime_fakes import (
    ALPHA,
    ALPHA_EPIC,
    BETA,
    BETA_EPIC,
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


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _stale():
    return HTTPException(
        status_code=409,
        detail={'code': 'STALE_REVISION', 'message': 'Revision token does not match current roadmap revision'},
    )


def _transient():
    return HTTPException(
        status_code=503,
        detail={'upstream': 'nestjs', 'detail': {'statusCode': 503, 'code': 'NEST_UNAVAILABLE', 'message': 'The backend service is temporarily unavailable. Please retry.'}},
    )


def _bad_request():
    return HTTPException(
        status_code=400,
        detail={'statusCode': 400, 'error': 'Bad Request', 'message': 'Invalid operation payload'},
    )


def _fixture(session=None, *, nest=None, sync_mode=False, **setting_updates):
    store = MemoryStore()
    nest = nest or FakeNest()
    service = make_service(store, nest, settings_with(**setting_updates))
    session = session or roadmap_session()
    store.create(session)
    ctx = StepContext(service=service, auth_header='Bearer x', trace_id='trace-1', sync_mode=sync_mode)
    run = runs.new_run(session, trace_id='trace-1', user_message='apply')
    runs.set_running(run, 'execute')
    session.metadata.run = run
    ctx.bind_cancel_key(session.session_id, run.run_id)
    return ctx, session, run, store, nest


def _add_batch(run, roadmap_id, count=1, *, source='stage_edits', title=None, operations=None):
    ops = operations or [RoadmapOperation(op='add_epic', data={'title': f'{roadmap_id[:4]} epic {i}'}) for i in range(count)]
    batch = RunBatch(roadmap_id=roadmap_id, roadmap_title=title, operations=ops, source=source, assistant_message='Staged.')
    run.batches.append(batch)
    return batch


class CommitRetryTests(unittest.TestCase):
    def test_stale_revision_retries_once_with_the_same_key_and_fresh_token(self):
        ctx, session, run, store, nest = _fixture()
        # A loaded overview (no refresh before the commit) holding a token the
        # backend has since moved past.
        session.metadata.roadmaps[ALPHA] = RoadmapContext(
            roadmap_id=ALPHA, title='Alpha', revision_token='stale-token', overview_fetched_at=_now()
        )
        session.revision_token = 'stale-token'
        nest.roadmaps[ALPHA]['revision_token'] = 'fresh-token'
        _add_batch(run, ALPHA)
        nest.commit_errors = [_stale()]
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(len(nest.commit_calls), 2)
        keys = [c['payload']['idempotency_key'] for c in nest.commit_calls]
        self.assertEqual(keys[0], keys[1])
        self.assertEqual(nest.commit_calls[0]['payload']['revision_token'], 'stale-token')
        self.assertEqual(nest.commit_calls[1]['payload']['revision_token'], 'fresh-token')
        self.assertEqual(nest.summary_calls, [ALPHA])
        commit = run.commits[0]
        self.assertEqual((commit.status, commit.attempts), ('committed', 2))
        self.assertEqual(session.metadata.roadmaps[ALPHA].revision_token, commit.revision_token_after)
        self.assertEqual(session.revision_token, commit.revision_token_after)

    def test_non_stale_409_fails_the_batch_without_retry(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        nest.commit_errors = [HTTPException(status_code=409, detail={'code': 'CONFLICT_OTHER', 'message': 'Unrelated conflict'})]
        execute.run(ctx, session, run)
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'CONFLICT_OTHER'))
        self.assertEqual(run.commits[0].error_message, 'Unrelated conflict')

    def test_second_stale_revision_fails(self):
        ctx, session, run, store, nest = _fixture()
        nest.roadmaps[ALPHA]['revision_token'] = 'fresh-token'
        session.metadata.roadmaps.clear()
        _add_batch(run, ALPHA)
        # The overview refresh installs 'fresh-token'; make the summary re-read
        # after the first stale answer return a different token so the retry fires.
        nest.commit_errors = [_stale(), _stale()]

        async def _summary(*, roadmap_id, preview_id, auth_header, trace_id=None):
            nest.summary_calls.append(roadmap_id)
            return {**nest.roadmaps[roadmap_id], 'revision_token': f'tok-{len(nest.summary_calls)}'}

        nest.context_summary = _summary
        execute.run(ctx, session, run)
        self.assertEqual(len(nest.commit_calls), 2)
        self.assertEqual(run.commits[0].status, 'failed')
        self.assertEqual(run.commits[0].error_code, 'STALE_REVISION')

    def test_no_retry_when_the_summary_returns_the_same_token(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        nest.commit_errors = [_stale()]
        execute.run(ctx, session, run)
        # tok-1 both times -> no retry.
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(run.commits[0].status, 'failed')

    def test_transient_failure_retries_once_with_the_same_key(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        nest.commit_errors = [_transient()]
        with patch('app.core.runtime.phases.execute.asyncio.sleep', new=AsyncMock()):
            execute.run(ctx, session, run)
        self.assertEqual(len(nest.commit_calls), 2)
        keys = [c['payload']['idempotency_key'] for c in nest.commit_calls]
        self.assertEqual(keys[0], keys[1])
        self.assertEqual(run.commits[0].status, 'committed')

    def test_second_transient_failure_propagates_after_one_retry(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        nest.commit_errors = [_transient(), _transient()]
        with patch('app.core.runtime.phases.execute.asyncio.sleep', new=AsyncMock()):
            execute.run(ctx, session, run)
        self.assertEqual(len(nest.commit_calls), 2)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'NEST_UNAVAILABLE'))
        self.assertEqual(run.commits[0].attempts, 2)

    def test_400_is_enriched_with_the_first_invalid_operation(self):
        ctx, session, run, store, nest = _fixture()
        invalid = RoadmapOperation(op='update_node', node_type='task', node_id='123e4567-e89b-12d3-a456-426614174000')
        _add_batch(run, ALPHA, operations=[invalid])
        nest.commit_errors = [_bad_request()]
        events = []
        with patch('app.core.runtime.phases.execute.log_event', side_effect=lambda _l, event, **data: events.append((event, data))):
            execute.run(ctx, session, run)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'BAD_REQUEST'))
        failed = next(data for name, data in events if name == 'commit_failed')
        self.assertEqual(failed['invalid_operation']['reason'], 'update_node.mutation_missing')
        self.assertEqual(failed['invalid_operation']['index'], 0)
        snapshot = execute._first_invalid_operation_snapshot([invalid])
        self.assertEqual(snapshot['op'], 'update_node')

    def test_direct_edit_batches_skip_preview_and_commit_directly(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA, 2)
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(nest.preview_calls, [])
        self.assertEqual(len(nest.commit_calls), 1)
        commit = run.commits[0]
        self.assertEqual(commit.status, 'committed')
        self.assertEqual(commit.impacted_summary, {'created': 2, 'modified': 0, 'deleted': 0})
        self.assertEqual(len(commit.impacted_items), 2)
        self.assertTrue(commit.history_recorded)
        self.assertEqual(commit.operations_hash, run.batches[0].operations_hash)
        self.assertEqual(session.metadata.applied_change_ids, [commit.change_id])
        self.assertEqual(session.metadata.change_history[0].run_id, run.run_id)
        self.assertEqual(session.metadata.change_history[0].roadmap_id, ALPHA)
        # The overview is invalidated for the next turn.
        self.assertIsNone(session.metadata.roadmaps[ALPHA].overview_fetched_at)
        self.assertGreaterEqual(store.update_calls, 2)  # keys persisted, then progress

    def test_commit_payload_carries_base_revision_and_run_ids(self):
        ctx, session, run, store, nest = _fixture()
        session.base_revision = 7
        _add_batch(run, ALPHA)
        execute.run(ctx, session, run)
        call = nest.commit_calls[0]
        self.assertEqual(call['payload']['base_revision'], 7)
        self.assertEqual(call['payload']['revision_token'], 'tok-1')
        self.assertFalse(call['payload']['include_roadmap'])
        self.assertEqual(call['session_id'], session.session_id)
        self.assertEqual(call['run_id'], run.run_id)


class ResumeTests(unittest.TestCase):
    def test_resume_marks_batches_committed_from_changes_endpoint(self):
        ctx, session, run, store, nest = _fixture()
        batch = _add_batch(run, ALPHA)
        commit = runs.ensure_commit_records(run)[0]
        commit.attempts = 1  # the first attempt's response was lost
        nest.changes_rows = [{'change_id': 'chg-landed', 'roadmap_id': ALPHA, 'status': 'applied', 'revision_token_after': 'tok-x'}]
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(nest.changes_calls, [{'run_id': run.run_id, 'session_id': None}])
        self.assertEqual(nest.commit_calls, [])  # nothing re-sent
        self.assertEqual((commit.status, commit.change_id), ('committed', 'chg-landed'))

    def test_pending_commit_with_attempts_and_unchanged_hash_reuses_the_key(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        commit = runs.ensure_commit_records(run)[0]
        commit.attempts = 1
        original_key = commit.idempotency_key
        execute.run(ctx, session, run)
        self.assertEqual(nest.commit_calls[0]['payload']['idempotency_key'], original_key)
        self.assertEqual(commit.attempts, 2)

    def test_changed_hash_mints_a_fresh_key(self):
        ctx, session, run, store, nest = _fixture()
        batch = _add_batch(run, ALPHA)
        commit = runs.ensure_commit_records(run)[0]
        commit.attempts = 1
        original_key = commit.idempotency_key
        batch.operations.append(RoadmapOperation(op='add_epic', data={'title': 'Extra'}))
        batch.refresh_operations_hash()
        execute.run(ctx, session, run)
        self.assertNotEqual(nest.commit_calls[0]['payload']['idempotency_key'], original_key)
        self.assertEqual(commit.operations_hash, batch.operations_hash)

    def test_changes_guard_failure_still_retries_with_the_key(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        commit = runs.ensure_commit_records(run)[0]
        commit.attempts = 1

        async def _boom(*args, **kwargs):
            raise HTTPException(status_code=503, detail={'code': 'NEST_UNAVAILABLE'})

        nest.ai_context_changes = _boom
        execute.run(ctx, session, run)
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(commit.status, 'committed')


class MultiBatchTests(unittest.TestCase):
    def test_second_roadmap_still_commits_after_the_first_fails(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        _add_batch(run, BETA)
        nest.commit_errors = [HTTPException(status_code=422, detail={'code': 'INVALID_OPERATION', 'message': 'Parent epic not found.'}), None]
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual([c.status for c in run.commits], ['failed', 'committed'])
        self.assertEqual(run.commits[0].error_message, 'Parent epic not found.')
        self.assertEqual([c['roadmap_id'] for c in nest.commit_calls], [ALPHA, BETA])
        self.assertEqual(run.execute_cursor, 2)

    def test_partial_success_keeps_the_pending_plan_with_committed_targets(self):
        ctx, session, run, store, nest = _fixture()
        session.metadata.pending_plan = PendingPlan(
            source_user_message='x',
            summary='Two roadmaps',
            kind='edits',
            targets=[
                {'roadmap_id': ALPHA, 'operations': add_epics(1, 'A'), 'operations_count': 1},
                {'roadmap_id': BETA, 'operations': add_epics(1, 'B'), 'operations_count': 1},
            ],
        )
        run.plan_id = session.metadata.pending_plan.plan_id
        nest.commit_errors = [None, _stale()]
        execute.run(ctx, session, run)
        self.assertEqual([b.source for b in run.batches], ['proposal', 'proposal'])
        self.assertEqual([c.status for c in run.commits], ['committed', 'failed'])
        plan = session.metadata.pending_plan
        self.assertIsNotNone(plan)
        self.assertEqual([t.committed for t in plan.targets], [True, False])
        # Confirming again only re-creates the uncommitted target.
        again = runs.new_run(session, trace_id='t2', user_message='apply', phase='execute', plan_id=plan.plan_id)
        created = execute.ensure_batches_from_plan(session, again)
        self.assertEqual([b.roadmap_id for b in created], [BETA])

    def test_all_targets_committed_clears_the_plan(self):
        ctx, session, run, store, nest = _fixture()
        session.metadata.pending_plan = PendingPlan(
            source_user_message='x', summary='One', kind='edits',
            targets=[{'roadmap_id': ALPHA, 'operations': add_epics(2), 'operations_count': 2}],
        )
        run.plan_id = session.metadata.pending_plan.plan_id
        execute.run(ctx, session, run)
        self.assertIsNone(session.metadata.pending_plan)
        self.assertEqual(len(nest.preview_calls), 1)  # proposal batches preview
        self.assertEqual(run.commits[0].status, 'committed')

    def test_batch_gate_runs_at_least_one_batch_then_pauses_between_batches(self):
        ctx, session, run, store, nest = _fixture(agent_run_hard_deadline_seconds=30, nest_timeout_seconds=1.0, openai_model_timeout_seconds=5.0)
        _add_batch(run, ALPHA)
        _add_batch(run, BETA)

        def _spend_the_budget(_nest, roadmap_id, payload):
            # The first commit "takes" the whole request budget.
            ctx.started_monotonic = monotonic() - 100

        nest.commit_hook = _spend_the_budget
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'paused')
        self.assertEqual([c.status for c in run.commits], ['committed', 'pending'])
        self.assertEqual(run.execute_cursor, 1)
        self.assertEqual(len(nest.commit_calls), 1)  # never mid-commit
        # A continue that begins in execute always runs at least one batch.
        ctx.started_monotonic = monotonic()
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual([c.status for c in run.commits], ['committed', 'committed'])

    def test_direct_edit_batches_reserve_only_their_nest_calls(self):
        # hard=30, nest=1, model=5: full reserve 8, direct-edit reserve 3.
        # At elapsed=26 a direct batch still starts (26 + 3 <= 30) while a
        # proposal batch (preview + repair turn) must wait for a continue.
        ctx, session, run, store, nest = _fixture(agent_run_hard_deadline_seconds=30, nest_timeout_seconds=1.0, openai_model_timeout_seconds=5.0)
        self.assertEqual(ctx.batch_reserve_seconds, 8.0)
        direct = _add_batch(run, ALPHA)
        proposal = _add_batch(run, BETA, source='proposal')
        self.assertEqual(ctx.batch_reserve_seconds_for(direct), 3.0)
        self.assertEqual(ctx.batch_reserve_seconds_for(proposal), 8.0)
        self.assertEqual(ctx.batch_reserve_seconds_for(None), 8.0)
        ctx.started_monotonic = monotonic() - 26
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'paused')
        self.assertEqual([c.status for c in run.commits], ['committed', 'pending'])
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(nest.preview_calls, [])

        # Sync mode (legacy client): the direct batch lands, the proposal one is skipped.
        ctx2, session2, run2, _store2, nest2 = _fixture(sync_mode=True, agent_run_hard_deadline_seconds=30, nest_timeout_seconds=1.0, openai_model_timeout_seconds=5.0)
        _add_batch(run2, ALPHA)
        _add_batch(run2, BETA, source='proposal')
        ctx2.started_monotonic = monotonic() - 26
        outcome = execute.run(ctx2, session2, run2)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual([c.status for c in run2.commits], ['committed', 'skipped'])
        self.assertEqual(run2.commits[1].error_code, 'SKIPPED_BUDGET')
        self.assertEqual(len(nest2.commit_calls), 1)

    def test_sync_mode_skips_batches_beyond_the_reserve(self):
        ctx, session, run, store, nest = _fixture(sync_mode=True, agent_run_hard_deadline_seconds=30, nest_timeout_seconds=1.0, openai_model_timeout_seconds=5.0)
        _add_batch(run, ALPHA)
        _add_batch(run, BETA)
        nest.commit_hook = lambda _n, _r, _p: setattr(ctx, 'started_monotonic', monotonic() - 100)
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual([c.status for c in run.commits], ['committed', 'skipped'])
        self.assertEqual(run.commits[1].error_code, 'SKIPPED_BUDGET')

    def test_cancel_mid_execute_skips_remaining_then_reports_cancelled(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA)
        _add_batch(run, BETA)
        nest.commit_hook = lambda _n, _r, _p: store.put_side_key(ctx.cancel_key, 1, 900)
        outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertTrue(outcome.cancelled)
        self.assertEqual([c.status for c in run.commits], ['committed', 'skipped'])
        self.assertEqual(run.commits[1].error_code, 'CANCELLED')
        self.assertEqual(len(nest.commit_calls), 1)

    def test_handle_roadmap_mismatch_fails_the_batch_before_preview(self):
        ctx, session, run, store, nest = _fixture()
        session.metadata.recent_resolved_targets = [
            RecentResolvedTarget(node_id=BETA_EPIC, node_type='epic', title='Beta epic', roadmap_id=BETA)
        ]
        _add_batch(
            run, ALPHA,
            source='proposal',
            operations=[RoadmapOperation(op='update_node', node_type='epic', node_id=BETA_EPIC, patch={'title': 'x'})],
        )
        execute.run(ctx, session, run)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'HANDLE_ROADMAP_MISMATCH'))
        self.assertEqual(nest.preview_calls, [])
        self.assertEqual(nest.commit_calls, [])


class MaterializeTests(unittest.TestCase):
    def _plan_session(self):
        session = roadmap_session()
        session.metadata.pending_plan = PendingPlan(
            source_user_message='plan',
            summary='Growth plan',
            kind='plan',
            targets=[{'roadmap_id': ALPHA, 'roadmap_title': 'Alpha', 'proposed_hierarchy': [{'title': 'Growth', 'features': [{'title': 'Signups', 'tasks': []}]}]}],
            proposed_hierarchy=[{'title': 'Growth', 'features': [{'title': 'Signups', 'tasks': []}]}],
        )
        return session

    def test_materialize_stages_then_previews_and_commits(self):
        ctx, session, run, store, nest = _fixture(self._plan_session())
        run.plan_id = session.metadata.pending_plan.plan_id
        with patched_llm([tool_resp('stage_edits', stage_args([
            {'op': 'add_epic', 'temp_id': 'temp_e1', 'data': {'title': 'Growth'}},
            {'op': 'add_feature', 'parent_ref': 'temp_e1', 'data': {'title': 'Signups'}},
        ], roadmap_id=ALPHA))]):
            outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(run.batches[0].needs_materialize, False)
        self.assertEqual(len(run.batches[0].operations), 2)
        self.assertEqual(len(nest.preview_calls), 1)
        self.assertEqual(run.commits[0].status, 'committed')
        self.assertIsNone(session.metadata.pending_plan)
        call = FakeLLM.calls[0]
        self.assertEqual(call['prompt_cache_key'], f'roadmap:{ALPHA}')
        self.assertIn('stage_edits', call['tools'])
        self.assertEqual(call['kwargs'].get('reasoning_effort'), 'medium')
        system = call['messages'][0]['content']
        self.assertIn('Phase: execute', system)
        self.assertIn('- Epic: Growth', system)
        self.assertIn('- Feature: Signups', system)
        self.assertEqual(run.phase_usage['execute']['turns'], 1)

    def test_materialize_pauses_with_a_transcript_and_resumes(self):
        ctx, session, run, store, nest = _fixture(self._plan_session(), agent_run_hard_deadline_seconds=30, nest_timeout_seconds=1.0, openai_model_timeout_seconds=5.0)
        run.plan_id = session.metadata.pending_plan.plan_id

        clock_offset = [0.0]

        def _slow_first_turn():
            # The first model turn eats the whole budget: the mini loop must
            # pause BEFORE turn 2 (never mid-call) and keep the batch pending.
            clock_offset[0] = 100.0
            return tool_resp('search_nodes', {'query': 'growth'})

        with patched_llm([_slow_first_turn]), patch(
            'app.core.engine.loop.monotonic', side_effect=lambda: monotonic() + clock_offset[0]
        ):
            outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'paused')
        batch = run.batches[0]
        self.assertIsNotNone(batch.materialize_transcript_key)
        self.assertTrue(batch.needs_materialize)
        self.assertEqual(run.commits[0].status, 'pending')
        self.assertEqual(nest.commit_calls, [])
        stored = store.get_side_key(batch.materialize_transcript_key)
        self.assertEqual([item['type'] for item in stored], ['function_call', 'function_call_output'])

        ctx.started_monotonic = monotonic()
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(1, 'Growth'), roadmap_id=ALPHA))]):
            outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(run.commits[0].status, 'committed')
        self.assertIsNone(batch.materialize_transcript_key)
        # The resumed call replayed the transcript instead of re-reading.
        types = [m.get('type') for m in FakeLLM.calls[0]['messages'] if m.get('type')]
        self.assertEqual(types, ['function_call', 'function_call_output'])

    def test_materialize_budget_fails_the_batch(self):
        ctx, session, run, store, nest = _fixture(self._plan_session(), agent_execute_max_turns=1)
        run.plan_id = session.metadata.pending_plan.plan_id
        with patched_llm([tool_resp('search_nodes', {'query': 'growth'})]):
            execute.run(ctx, session, run)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'MATERIALIZE_FAILED'))
        self.assertEqual(nest.commit_calls, [])
        self.assertIsNotNone(session.metadata.pending_plan)  # nothing landed; confirm again resumes


class RepairTests(unittest.TestCase):
    def _issues(self):
        return {
            'preview_id': 'p',
            'revision_token': 'tok-1',
            'validation_issues': [
                {'code': 'NODE_NOT_FOUND', 'severity': 'error', 'path': 'operations.0.parent_id', 'message': 'Parent not found.'}
            ],
        }

    def test_repair_runs_once_then_commits_with_the_repaired_ops(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA, source='proposal', operations=[RoadmapOperation(op='add_feature', parent_id=BETA_EPIC, data={'title': 'F'})])
        commit = runs.ensure_commit_records(run)[0]
        first_hash = commit.operations_hash
        nest.preview_results = [self._issues(), {'preview_id': 'p2', 'revision_token': 'tok-2', 'validation_issues': []}]
        with patched_llm([tool_resp('stage_edits', stage_args([{'op': 'add_feature', 'parent_ref': 'E1', 'data': {'title': 'F'}}], roadmap_id=ALPHA))]):
            outcome = execute.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'executed')
        self.assertEqual(len(nest.preview_calls), 2)
        self.assertEqual(len(FakeLLM.calls), 1)
        self.assertEqual(FakeLLM.calls[0]['tools'], ['stage_edits'])
        self.assertIn('Parent not found.', FakeLLM.calls[0]['messages'][0]['content'])
        self.assertEqual(commit.status, 'committed')
        self.assertNotEqual(commit.operations_hash, first_hash)
        self.assertEqual(nest.commit_calls[0]['payload']['operations'][0]['parent_id'], ALPHA_EPIC)
        self.assertEqual(nest.commit_calls[0]['payload']['revision_token'], 'tok-2')

    def test_second_invalid_preview_fails_validation(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA, source='proposal')
        nest.preview_results = [self._issues(), self._issues()]
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(1), roadmap_id=ALPHA))]):
            execute.run(ctx, session, run)
        self.assertEqual(len(nest.preview_calls), 2)
        self.assertEqual((run.commits[0].status, run.commits[0].error_code), ('failed', 'VALIDATION_FAILED'))
        self.assertEqual(run.commits[0].error_message, 'Parent not found.')
        self.assertEqual(nest.commit_calls, [])

    def test_stale_preview_refreshes_the_token_once(self):
        ctx, session, run, store, nest = _fixture()
        _add_batch(run, ALPHA, source='revert', operations=[RoadmapOperation(op='delete_node', node_type='epic', node_id=ALPHA_EPIC)])
        nest.preview_results = [_stale(), {'preview_id': 'p', 'revision_token': 'tok-fresh', 'validation_issues': []}]
        execute.run(ctx, session, run)
        self.assertEqual(len(nest.preview_calls), 2)
        self.assertEqual(nest.commit_calls[0]['payload']['revision_token'], 'tok-fresh')
        self.assertEqual(run.commits[0].status, 'committed')


class HelperTests(unittest.TestCase):
    def test_skip_remaining_only_touches_pending(self):
        run = runs.new_run(roadmap_session(), trace_id='t', user_message='x')
        _add_batch(run, ALPHA)
        _add_batch(run, BETA)
        first, second = runs.ensure_commit_records(run)
        first.status = 'committed'
        execute.skip_remaining(run, 'CANCELLED', 'skipped')
        self.assertEqual([first.status, second.status], ['committed', 'skipped'])
        self.assertEqual(run.execute_cursor, 2)

    def test_batches_from_a_workspace_plan_default_to_materialize(self):
        session = workspace_session()
        session.metadata.pending_plan = PendingPlan(
            source_user_message='x', summary='s', kind='plan',
            targets=[{'roadmap_id': ALPHA, 'proposed_hierarchy': [{'title': 'E'}]}, {'roadmap_id': BETA, 'proposed_hierarchy': [{'title': 'E'}]}],
        )
        run = runs.new_run(session, trace_id='t', user_message='x', phase='execute', plan_id=session.metadata.pending_plan.plan_id)
        created = execute.ensure_batches_from_plan(session, run)
        self.assertEqual([b.roadmap_id for b in created], [ALPHA, BETA])
        self.assertTrue(all(b.needs_materialize for b in created))
        self.assertEqual(sorted(run.focus_roadmap_ids), sorted([ALPHA, BETA]))


if __name__ == '__main__':
    unittest.main()
