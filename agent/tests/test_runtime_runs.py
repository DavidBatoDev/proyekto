"""Run lifecycle helpers, the checkpoint policy boundaries (D4) and the
orchestrator's transition table."""

from __future__ import annotations

import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch, RunCommit
from app.core.contracts.sessions import AgentSession
from app.core.runtime import orchestrator, runs, terminal
from app.core.runtime.results import PhaseOutcome
from app.core.runtime.service import StepContext
from tests.runtime_fakes import ALPHA, ALPHA_EPIC, BETA, MemoryStore, make_service, roadmap_session, settings_with, workspace_session


def _batch(roadmap_id, count, *, delete=False, source='stage_edits'):
    ops = [RoadmapOperation(op='add_epic', data={'title': f'E{i}'}) for i in range(count)]
    if delete:
        ops.append(RoadmapOperation(op='delete_node', node_type='epic', node_id=ALPHA_EPIC))
    return RunBatch(roadmap_id=roadmap_id, operations=ops, source=source)


class RunLifecycleTests(unittest.TestCase):
    def test_new_run_opens_a_segment_on_the_focus(self):
        session = roadmap_session()
        run = runs.new_run(session, trace_id='t-1', user_message='hi')
        self.assertEqual((run.status, run.phase, run.next), ('running', 'investigate', 'continue'))
        self.assertEqual(run.focus_roadmap_ids, [ALPHA])
        self.assertEqual([s.trace_id for s in run.segments], ['t-1'])
        self.assertTrue(runs.segment_is_open(run))
        self.assertEqual(run.scope.key, session.scope.key)

    def test_segments_and_mutators(self):
        run = runs.new_run(workspace_session(), trace_id='t-1', user_message='hi')
        self.assertEqual(run.focus_roadmap_ids, [])
        runs.set_awaiting(run, 'clarifier', clarifier={'question': 'q'}, asked_in_phase='investigate')
        self.assertEqual((run.status, run.next, run.checkpoint, run.asked_in_phase), ('awaiting_user', 'await_user', 'clarifier', 'investigate'))
        self.assertTrue(runs.end_segment(run, 'clarifier'))
        self.assertFalse(runs.end_segment(run, 'again'))
        runs.start_segment(run, 't-2', from_phase='investigate')
        self.assertEqual(run.trace_id, 't-2')
        self.assertEqual(len(run.segments), 2)
        runs.set_running(run, 'execute')
        self.assertEqual((run.status, run.phase, run.checkpoint), ('running', 'execute', None))
        runs.set_failed(run, 'X', 'boom', final_message='sorry')
        self.assertTrue(runs.is_terminal(run))
        self.assertEqual(run.error.code, 'X')
        self.assertEqual(run.final_message, 'sorry')

    def test_archive_keeps_last_five(self):
        session = roadmap_session()
        for index in range(7):
            run = runs.new_run(session, trace_id=f't-{index}', user_message='x')
            runs.set_done(run, 'ok')
            runs.archive_run(session, run)
        self.assertEqual(len(session.metadata.run_history), 5)
        self.assertEqual(session.metadata.run_history[0].trace_ids, ['t-6'])

    def test_commit_records_are_created_once_per_batch(self):
        run = runs.new_run(roadmap_session(), trace_id='t', user_message='x')
        run.batches = [_batch(ALPHA, 1), _batch(BETA, 1)]
        created = runs.ensure_commit_records(run)
        self.assertEqual(len(created), 2)
        self.assertEqual(runs.ensure_commit_records(run), [])
        self.assertTrue(runs.has_pending_commits(run))
        self.assertEqual(created[0].operations_hash, run.batches[0].operations_hash)
        self.assertNotEqual(created[0].idempotency_key, created[1].idempotency_key)

    def test_run_view_and_commit_views(self):
        session = roadmap_session()
        run = runs.new_run(session, trace_id='t', user_message='x')
        run.batches = [_batch(ALPHA, 2)]
        runs.ensure_commit_records(run)
        view = runs.run_view(session, run)
        self.assertEqual(view.batches[0].operations_count, 2)
        self.assertIsNone(view.commits[0].operations)
        step_views = runs.commit_views(session, run, step_batch_ids={run.batches[0].batch_id})
        self.assertEqual(len(step_views[0].operations), 2)
        payload = runs.run_view_payload(session, run)
        self.assertEqual(payload['run_id'], run.run_id)
        self.assertNotIn('operations', payload['commits'][0])


class CheckpointPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = settings_with()

    def test_roadmap_scope_focus_up_to_ninety_executes_deletes_included(self):
        session = roadmap_session()
        decision, reason = runs.checkpoint_decision(session, [_batch(ALPHA, 89, delete=True)], self.settings)
        self.assertEqual((decision, reason), ('execute', 'focus_roadmap'))
        decision, reason = runs.checkpoint_decision(session, [_batch(ALPHA, 91)], self.settings)
        self.assertEqual((decision, reason), ('propose', 'too_many_operations'))

    def test_roadmap_scope_non_focus_proposes(self):
        decision, reason = runs.checkpoint_decision(roadmap_session(), [_batch(BETA, 1)], self.settings)
        self.assertEqual((decision, reason), ('propose', 'non_focus_roadmap'))

    def test_multi_roadmap_proposes_in_any_scope(self):
        batches = [_batch(ALPHA, 1), _batch(BETA, 1)]
        self.assertEqual(runs.checkpoint_decision(roadmap_session(), batches, self.settings)[0], 'propose')
        self.assertEqual(runs.checkpoint_decision(workspace_session(), batches, self.settings)[1], 'multi_roadmap')

    def test_workspace_scope_boundaries(self):
        session = workspace_session()
        self.assertEqual(runs.checkpoint_decision(session, [_batch(ALPHA, 15)], self.settings)[0], 'execute')
        self.assertEqual(runs.checkpoint_decision(session, [_batch(ALPHA, 16)], self.settings), ('propose', 'too_many_operations'))
        self.assertEqual(runs.checkpoint_decision(session, [_batch(ALPHA, 1, delete=True)], self.settings), ('propose', 'contains_delete'))

    def test_tunables_move_the_boundaries(self):
        settings = settings_with(agent_direct_edit_max_operations=2, agent_direct_edit_max_operations_focus=1)
        self.assertEqual(runs.checkpoint_decision(workspace_session(), [_batch(ALPHA, 3)], settings)[0], 'propose')
        self.assertEqual(runs.checkpoint_decision(roadmap_session(), [_batch(ALPHA, 2)], settings)[0], 'propose')


class _Fixture:
    def __init__(self, session: AgentSession | None = None, **setting_updates):
        self.store = MemoryStore()
        self.service = make_service(self.store, settings=settings_with(**setting_updates))
        self.session = session or roadmap_session()
        self.store.create(self.session)
        self.ctx = StepContext(service=self.service, auth_header='Bearer x', trace_id='trace-1')
        self.run = runs.new_run(self.session, trace_id='trace-1', user_message='do it')
        self.session.metadata.run = self.run

    def apply(self, outcome: PhaseOutcome):
        orchestrator.apply_transition(self.ctx, self.session, self.run, outcome)
        return self.run


class TransitionTableTests(unittest.TestCase):
    def test_investigate_chat_is_done(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='chat', assistant_message='Two epics.'))
        self.assertEqual((run.status, run.next, run.final_message), ('done', 'done', 'Two epics.'))

    def test_investigate_clarifier_awaits_user(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='clarifier', assistant_message='Which?', clarifier={'question': 'Which?', 'options': ['A']}))
        self.assertEqual((run.status, run.checkpoint, run.asked_in_phase), ('awaiting_user', 'clarifier', 'investigate'))
        self.assertEqual(run.clarifier['question'], 'Which?')
        self.assertEqual(fx.ctx.clarifier_card['question'], 'Which?')

    def test_investigate_budget_is_done_with_the_budget_card(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='budget'))
        self.assertEqual(run.status, 'done')
        self.assertEqual(run.final_message, terminal.BUDGET_MESSAGE)
        self.assertEqual(fx.ctx.clarifier_card['reason'], 'budget_exhausted')

    def test_investigate_batches_on_focus_go_to_execute(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='batches', assistant_message='Added.', batches=[_batch(ALPHA, 2)]))
        self.assertEqual((run.status, run.phase), ('running', 'execute'))
        self.assertEqual(len(run.batches), 1)
        self.assertEqual(run.batches[0].source, 'stage_edits')
        self.assertEqual(fx.ctx.step_batch_ids, {run.batches[0].batch_id})
        self.assertEqual(fx.session.staged_operations_version, 1)

    def test_investigate_batches_on_other_roadmap_become_an_edits_proposal(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='batches', assistant_message='Beta edit.', batches=[_batch(BETA, 1)]))
        self.assertEqual((run.status, run.checkpoint, run.phase), ('awaiting_user', 'proposal', 'propose'))
        plan = fx.session.metadata.pending_plan
        self.assertEqual(plan.kind, 'edits')
        self.assertEqual(plan.run_id, run.run_id)
        self.assertEqual(run.plan_id, plan.plan_id)
        self.assertEqual(run.batches, [])
        self.assertEqual(fx.ctx.proposal_payload['kind'], 'edits')

    def test_investigate_revert_bypasses_the_gate(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='revert', assistant_message='Reverted.', batches=[_batch(ALPHA, 0, delete=True, source='revert')]))
        self.assertEqual((run.status, run.phase), ('running', 'execute'))
        self.assertEqual(run.batches[0].source, 'revert')

    def test_paused_continues_or_times_out_in_sync_mode(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='paused'))
        self.assertEqual((run.status, run.next), ('running', 'continue'))
        sync = _Fixture()
        sync.ctx.sync_mode = True
        run = sync.apply(PhaseOutcome(kind='paused'))
        self.assertEqual((run.status, run.error.code), ('failed', 'RUN_TIMEOUT'))

    def test_cancelled_clears_the_pending_plan(self):
        fx = _Fixture()
        from app.core.contracts.sessions import PendingPlan

        fx.session.metadata.pending_plan = PendingPlan(source_user_message='x', proposed_hierarchy=[{'title': 'E'}])
        run = fx.apply(PhaseOutcome(kind='cancelled'))
        self.assertEqual(run.status, 'cancelled')
        self.assertIsNone(fx.session.metadata.pending_plan)

    def test_execute_executed_goes_to_verify(self):
        fx = _Fixture()
        runs.set_running(fx.run, 'execute')
        run = fx.apply(PhaseOutcome(kind='executed'))
        self.assertEqual((run.status, run.phase), ('running', 'verify'))
        cancelled = _Fixture()
        runs.set_running(cancelled.run, 'execute')
        run = cancelled.apply(PhaseOutcome(kind='executed', cancelled=True))
        self.assertTrue(run.cancel_requested)
        self.assertEqual(run.phase, 'verify')

    def test_verify_verified_is_done_or_cancelled(self):
        fx = _Fixture()
        runs.set_running(fx.run, 'verify')
        run = fx.apply(PhaseOutcome(kind='verified', assistant_message='Report.'))
        self.assertEqual((run.status, run.final_message), ('done', 'Report.'))
        self.assertTrue(fx.ctx.verify_reported)
        cancelled = _Fixture()
        runs.set_running(cancelled.run, 'verify')
        cancelled.run.cancel_requested = True
        run = cancelled.apply(PhaseOutcome(kind='verified', assistant_message='Partial.'))
        self.assertEqual((run.status, run.final_message), ('cancelled', 'Partial.'))

    def test_verify_follow_up_proposal_awaits_user(self):
        fx = _Fixture()
        from app.core.contracts.sessions import PendingPlan

        fx.session.metadata.pending_plan = PendingPlan(plan_id='follow-1', source_user_message='x', proposed_hierarchy=[{'title': 'E'}])
        runs.set_running(fx.run, 'verify')
        run = fx.apply(PhaseOutcome(kind='verified', assistant_message='Report.', proposal_payload={'plan_id': 'follow-1'}, intent_type='roadmap_plan'))
        self.assertEqual((run.status, run.checkpoint, run.plan_id), ('awaiting_user', 'proposal', 'follow-1'))

    def test_error_fails_with_fallback_telemetry(self):
        fx = _Fixture()
        run = fx.apply(PhaseOutcome(kind='error', error={'code': 'provider_error', 'message': 'x'}))
        self.assertEqual((run.status, run.error.code), ('failed', 'provider_error'))
        self.assertEqual(run.final_message, terminal.PROVIDER_FAILURE_MESSAGE)
        self.assertEqual((fx.ctx.provider_used, fx.ctx.fallback_used, fx.ctx.provider_error_code), ('rule_based', True, 'v2_provider_error'))

    def test_proposal_error_retries_investigate_once_then_gives_up(self):
        fx = _Fixture(workspace_session())
        first = fx.apply(PhaseOutcome(kind='proposal', proposal_payload={'summary': 's', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E'}]}, intent_type='roadmap_plan'))
        self.assertEqual((first.status, first.phase), ('running', 'investigate'))
        self.assertIn('PROPOSAL_TARGET_REQUIRED', getattr(first, 'feedback_note', ''))
        second = fx.apply(PhaseOutcome(kind='proposal', proposal_payload={'summary': 's', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E'}]}, intent_type='roadmap_plan'))
        self.assertEqual(second.status, 'done')
        self.assertIn("couldn't record that proposal", second.final_message)


if __name__ == '__main__':
    unittest.main()
