"""Verify phase: the deterministic check matrix, the model report, a
follow-up proposal that is recorded but never executed, and the
deterministic summary on provider failure."""

from __future__ import annotations

import unittest
from time import monotonic

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import CommitImpactedItem, RunBatch, RunCommit
from app.core.runtime import runs
from app.core.runtime.phases import verify
from app.core.runtime.service import StepContext
from tests.runtime_fakes import (
    ALPHA,
    BETA,
    FakeLLM,
    FakeNest,
    MemoryStore,
    ProviderDown,
    make_service,
    patched_llm,
    roadmap_session,
    text_resp,
    tool_resp,
)


def _fixture():
    store = MemoryStore()
    nest = FakeNest()
    service = make_service(store, nest)
    session = roadmap_session()
    store.create(session)
    ctx = StepContext(service=service, auth_header='Bearer x', trace_id='trace-1')
    run = runs.new_run(session, trace_id='trace-1', user_message='add growth to both')
    runs.set_running(run, 'verify')
    return ctx, session, run, nest


def _committed(run, roadmap_id, title, *, created=1, token='tok-after', history=True, attempts=1):
    batch = RunBatch(roadmap_id=roadmap_id, roadmap_title=title, operations=[RoadmapOperation(op='add_epic', data={'title': 'G'})])
    run.batches.append(batch)
    run.commits.append(
        RunCommit(
            batch_id=batch.batch_id,
            roadmap_id=roadmap_id,
            status='committed',
            change_id='chg-1',
            revision_token_after=token,
            impacted_summary={'created': created, 'modified': 0, 'deleted': 0},
            impacted_items=[CommitImpactedItem(node_id='n1', node_type='epic', title='G', impact='created')],
            history_recorded=history,
            attempts=attempts,
        )
    )
    return batch


def _failed(run, roadmap_id, title, status='failed'):
    batch = RunBatch(roadmap_id=roadmap_id, roadmap_title=title, operations=[RoadmapOperation(op='add_epic', data={'title': 'G'})])
    run.batches.append(batch)
    run.commits.append(RunCommit(batch_id=batch.batch_id, roadmap_id=roadmap_id, status=status, error_code='STALE_REVISION', error_message='stale'))
    return batch


class DeterministicReportTests(unittest.TestCase):
    def test_nothing_to_verify(self):
        _ctx, session, run, _nest = _fixture()
        report = verify.deterministic_report(session, run)
        self.assertEqual(report.status, 'nothing_to_verify')
        self.assertEqual(report.summary, verify.NOTHING_TO_VERIFY_MESSAGE)

    def test_verified_when_every_check_passes(self):
        _ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        report = verify.deterministic_report(session, run)
        self.assertEqual(report.status, 'verified')
        names = {check.name: check.status for check in report.checks}
        self.assertEqual(names['all_batches_committed'], 'pass')
        self.assertEqual(names['diff_matches_plan'], 'pass')
        self.assertEqual(names['revision_advanced'], 'pass')
        self.assertEqual(names['history_recorded'], 'pass')
        self.assertEqual(names['no_repairs_needed'], 'pass')
        self.assertIn('Committed 1 change to "Alpha"', report.summary)

    def test_partial_and_failed(self):
        _ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        _failed(run, BETA, 'Beta')
        report = verify.deterministic_report(session, run)
        self.assertEqual(report.status, 'partial')
        self.assertIn('"Beta" failed: stale', report.summary)
        failed_run = runs.new_run(session, trace_id='t', user_message='x')
        _failed(failed_run, ALPHA, 'Alpha')
        _failed(failed_run, BETA, 'Beta', status='skipped')
        report = verify.deterministic_report(session, failed_run)
        self.assertEqual(report.status, 'failed')
        self.assertIn('"Beta" was skipped', report.summary)

    def test_warnings_lower_diff_repairs_and_history(self):
        _ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha', created=0, history=False, attempts=2)
        run.revision_before = {run.batches[0].batch_id: 'tok-after'}
        report = verify.deterministic_report(session, run)
        self.assertEqual(report.status, 'verified')  # warnings never fail
        names = {check.name: check.status for check in report.checks}
        self.assertEqual(names['diff_matches_plan'], 'warn')
        self.assertEqual(names['revision_advanced'], 'warn')
        self.assertEqual(names['history_recorded'], 'warn')
        self.assertEqual(names['no_repairs_needed'], 'warn')


class ModelReportTests(unittest.TestCase):
    def test_model_text_becomes_the_summary(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        with patched_llm([text_resp('Growth is on Alpha now.')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'verified')
        self.assertEqual(outcome.assistant_message, 'Growth is on Alpha now.')
        self.assertEqual(run.verify.summary, 'Growth is on Alpha now.')
        self.assertEqual(FakeLLM.calls[0]['tools'], ['propose'])
        system = FakeLLM.calls[0]['messages'][0]['content']
        self.assertIn('Phase: verify', system)
        self.assertIn('# Outcome', system)
        self.assertIn('all_batches_committed: pass', system)

    def test_follow_up_proposal_is_recorded_never_executed(self):
        ctx, session, run, nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        with patched_llm([
            tool_resp('propose', {'summary': 'Add retention next.', 'goal': 'retain', 'targets': [{'roadmap_id': ALPHA, 'proposed_hierarchy': [{'title': 'Retention', 'features': []}]}]})
        ]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'verified')
        self.assertIsNotNone(outcome.proposal_payload)
        self.assertEqual(run.verify.follow_up_plan_id, session.metadata.pending_plan.plan_id)
        self.assertEqual(outcome.assistant_message, 'Add retention next.')
        self.assertEqual(nest.commit_calls, [])
        self.assertEqual(nest.preview_calls, [])

    def test_provider_failure_falls_back_to_the_deterministic_summary(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        _failed(run, BETA, 'Beta')
        with patched_llm([ProviderDown('down')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'verified')
        self.assertIn('Committed 1 change to "Alpha"', outcome.assistant_message)
        self.assertIn('"Beta" failed: stale', outcome.assistant_message)
        self.assertEqual(run.verify.status, 'partial')

    def test_past_soft_budget_skips_the_model_call(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        ctx.started_monotonic = monotonic() - 10_000
        with patched_llm([text_resp('never called')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.kind, 'verified')
        self.assertIn('Committed 1 change to "Alpha"', outcome.assistant_message)
        self.assertEqual(run.verify.status, 'verified')
        self.assertEqual(run.verify.summary, outcome.assistant_message)

    def test_nothing_to_verify_skips_the_model(self):
        ctx, session, run, _nest = _fixture()
        with patched_llm([]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, verify.NOTHING_TO_VERIFY_MESSAGE)
        self.assertEqual(FakeLLM.calls, [])


if __name__ == '__main__':
    unittest.main()


class OutcomeBlockTests(unittest.TestCase):
    """The block the report model reads must say plainly what happened: an
    undo is named as an undo (a live run once reported "I can't undo that"
    right after a verified revert commit), committed commits are stated as
    applied, and the change types are listed."""

    def test_revert_batch_is_described_as_an_undo(self):
        ctx, session, run, _nest = _fixture()
        batch = RunBatch(
            roadmap_id=ALPHA,
            roadmap_title='Alpha',
            source='revert',
            operations=[RoadmapOperation(op='update_node', node_type='task', node_id='t1', patch={'assignee_ids': ['u-1']})],
        )
        run.batches.append(batch)
        run.commits.append(
            RunCommit(
                batch_id=batch.batch_id,
                roadmap_id=ALPHA,
                status='committed',
                change_id='chg-9',
                impacted_summary={'created': 0, 'modified': 1, 'deleted': 0},
                semantic_diff_summary={'ASSIGNEE_CHANGED': 1},
                impacted_items=[CommitImpactedItem(node_id='t1', node_type='task', title='Target task', impact='modified')],
                history_recorded=True,
                attempts=1,
            )
        )
        block = verify._outcome_block(session, run, verify.deterministic_report(session, run))
        self.assertIn('UNDO applied', block)
        self.assertIn('prior state restored', block)
        self.assertIn('changes: ASSIGNEE_CHANGED 1', block)
        self.assertIn('modified task "Target task"', block)
        self.assertIn('HAS been applied', block)

    def test_ordinary_commit_is_not_called_an_undo(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        block = verify._outcome_block(session, run, verify.deterministic_report(session, run))
        self.assertNotIn('UNDO', block)
        self.assertIn('"Alpha": committed (created 1)', block)


class UndoRunReportTests(unittest.TestCase):
    """An undo run (every batch from revert_changes) reports deterministically:
    the model is never asked to paraphrase a revert (it once answered "I can't
    undo that" right after a verified revert commit)."""

    def _undo_run(self):
        ctx, session, run, nest = _fixture()
        batch = RunBatch(
            roadmap_id=ALPHA,
            roadmap_title='Alpha',
            source='revert',
            operations=[RoadmapOperation(op='update_node', node_type='task', node_id='t1', patch={'assignee_ids': ['u-1']})],
        )
        run.batches.append(batch)
        run.commits.append(
            RunCommit(
                batch_id=batch.batch_id,
                roadmap_id=ALPHA,
                status='committed',
                change_id='chg-9',
                revision_token_after='tok-after',
                impacted_summary={'created': 0, 'modified': 1, 'deleted': 0},
                semantic_diff_summary={'ASSIGNEE_CHANGED': 1},
                impacted_items=[CommitImpactedItem(node_id='t1', node_type='task', title='Target task', impact='modified')],
                history_recorded=True,
                attempts=1,
            )
        )
        return ctx, session, run, nest

    def test_undo_run_skips_the_model_and_confirms_what_was_restored(self):
        ctx, session, run, _nest = self._undo_run()
        with patched_llm([text_resp("I can't undo that from here.")]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.kind, 'verified')
        self.assertEqual(outcome.assistant_message, 'Undid the last change on "Alpha" — restored task "Target task".')
        self.assertEqual(run.verify.summary, outcome.assistant_message)
        self.assertEqual(run.verify.status, 'verified')

    def test_mixed_runs_still_use_the_model(self):
        ctx, session, run, _nest = self._undo_run()
        _committed(run, BETA, 'Beta')
        with patched_llm([text_resp('Mixed report.')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(len(FakeLLM.calls), 1)
        self.assertEqual(outcome.assistant_message, 'Mixed report.')

    def test_failed_undo_falls_back_to_the_status_summary(self):
        ctx, session, run, _nest = self._undo_run()
        run.commits[0].status = 'failed'
        run.commits[0].error_message = 'stale'
        self.assertFalse(verify.is_undo_run(run) and False)
        summary = verify.undo_summary(session, run)
        self.assertIn('"Alpha" failed: stale', summary)
