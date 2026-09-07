"""Verify phase: the deterministic check matrix, the reply written by the
staging loop with the commit result as its tool output, and the staged
message as the fallback when that continuation is unavailable."""

from __future__ import annotations

import json
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


def _committed(run, roadmap_id, title, *, created=1, token='tok-after', history=True, attempts=1, message='Added Growth.', operations=None):
    batch = RunBatch(
        roadmap_id=roadmap_id,
        roadmap_title=title,
        operations=operations or [RoadmapOperation(op='add_epic', data={'title': 'G'})],
        assistant_message=message,
    )
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


def _failed(run, roadmap_id, title, status='failed', message='Added Growth.'):
    batch = RunBatch(roadmap_id=roadmap_id, roadmap_title=title, operations=[RoadmapOperation(op='add_epic', data={'title': 'G'})], assistant_message=message)
    run.batches.append(batch)
    run.commits.append(RunCommit(batch_id=batch.batch_id, roadmap_id=roadmap_id, status=status, error_code='STALE_REVISION', error_message='stale'))
    return batch


def _staged(ctx, session, run, batch, *, call_id='call_stage_1', extra_calls=()):
    """Persist the staging turn's transcript the way investigate does."""
    batch.call_ids = [call_id]
    transcript = [
        {'type': 'function_call', 'call_id': cid, 'name': 'get_node_details', 'arguments': '{}'}
        for cid in extra_calls
    ]
    transcript.append({'type': 'function_call', 'call_id': call_id, 'name': 'stage_edits', 'arguments': '{"operations": []}'})
    key = ctx.transcript_key(session.session_id, run.run_id, 'staged')
    assert ctx.put_transcript(key, transcript)
    run.staged_transcript_key = key
    return key


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
        self.assertIn(f'Committed 1 change to [Alpha](proyekto://roadmap/{ALPHA})', report.summary)

    def test_partial_and_failed(self):
        _ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        _failed(run, BETA, 'Beta')
        report = verify.deterministic_report(session, run)
        self.assertEqual(report.status, 'partial')
        self.assertIn(f'[Beta](proyekto://roadmap/{BETA}) failed: stale', report.summary)
        failed_run = runs.new_run(session, trace_id='t', user_message='x')
        _failed(failed_run, ALPHA, 'Alpha')
        _failed(failed_run, BETA, 'Beta', status='skipped')
        report = verify.deterministic_report(session, failed_run)
        self.assertEqual(report.status, 'failed')
        self.assertIn(f'[Beta](proyekto://roadmap/{BETA}) was skipped', report.summary)

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


class LoopReplyTests(unittest.TestCase):
    """The model that staged the edit gets the commit result as its tool
    output and writes the reply in the same loop: no report prompt, no tools."""

    def test_reply_comes_from_the_staging_loop_with_the_commit_as_tool_output(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        key = _staged(ctx, session, run, batch, extra_calls=('call_read_1',))
        reply = f'Added [G](proyekto://epic/n1) to [Alpha](proyekto://roadmap/{ALPHA}).'
        with patched_llm([text_resp(reply)]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'verified')
        self.assertEqual(outcome.assistant_message, reply)
        self.assertEqual(run.verify.summary, reply)
        self.assertEqual(run.verify.report_mode, 'loop')
        self.assertEqual(FakeLLM.calls[0]['tools'], [])
        messages = FakeLLM.calls[0]['messages']
        system = messages[0]['content']
        self.assertNotIn('Phase: verify', system)
        self.assertNotIn('# Outcome', system)
        calls = [m for m in messages if m.get('type') == 'function_call']
        outputs = {m['call_id']: json.loads(m['output']) for m in messages if m.get('type') == 'function_call_output'}
        self.assertEqual([m['call_id'] for m in calls], ['call_read_1', 'call_stage_1'])
        self.assertEqual(set(outputs), {'call_read_1', 'call_stage_1'})
        self.assertEqual(outputs['call_read_1']['status'], 'not_run')
        staged = outputs['call_stage_1']
        self.assertEqual(staged['status'], 'committed')
        self.assertFalse(staged['undo'])
        self.assertEqual(staged['roadmap']['link'], f'[Alpha](proyekto://roadmap/{ALPHA})')
        self.assertEqual(staged['impacted_items'][0]['link'], '[G](proyekto://epic/n1)')
        self.assertEqual(messages[-1]['role'], 'system')
        self.assertEqual(messages[-1]['content'], verify.REPORT_INSTRUCTION)
        # The transcript is consumed once.
        self.assertIsNone(ctx.get_transcript(key))
        self.assertIsNone(run.staged_transcript_key)
        self.assertEqual(run.phase_usage['verify']['turns'], 1)

    def test_failed_commit_is_reported_as_failed_in_the_tool_output(self):
        ctx, session, run, _nest = _fixture()
        batch = _failed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        with patched_llm([text_resp("The edit didn't land: the roadmap changed underneath me.")]):
            outcome = verify.run(ctx, session, run)
        output = json.loads(next(m for m in FakeLLM.calls[0]['messages'] if m.get('type') == 'function_call_output')['output'])
        self.assertEqual((output['status'], output['error_message']), ('failed', 'stale'))
        self.assertIn('Nothing from this batch was applied', output['note'])
        self.assertEqual(outcome.assistant_message, "The edit didn't land: the roadmap changed underneath me.")
        self.assertEqual(run.verify.report_mode, 'loop')

    def test_no_op_operations_are_flagged_in_the_tool_output(self):
        # Production run 7fc01b90: 2 operations, 1 item changed (the other task
        # was already in the requested status) — reported as "2 changes".
        ctx, session, run, _nest = _fixture()
        batch = _committed(
            run, ALPHA, 'Alpha',
            operations=[
                RoadmapOperation(op='update_node', node_type='task', node_id='t1', patch={'status': 'done'}),
                RoadmapOperation(op='update_node', node_type='task', node_id='t2', patch={'status': 'in_progress'}),
            ],
        )
        payload = verify.commit_outcome_payload(session, run.commits[0], batch)
        self.assertEqual(payload['operations_count'], 2)
        self.assertIn('1 of the 2 operations produced no change', payload['note'])

    def test_without_a_transcript_the_staged_message_is_the_reply(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha', message='Added Growth to Alpha')
        with patched_llm([text_resp('never called')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.assistant_message, 'Added Growth to Alpha.')
        self.assertEqual(run.verify.report_mode, 'staged')

    def test_staged_messages_and_failures_combine(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha', message='Added Growth.')
        _failed(run, BETA, 'Beta')
        with patched_llm([]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, f'Added Growth. [Beta](proyekto://roadmap/{BETA}) failed: stale.')
        self.assertEqual(run.verify.status, 'partial')
        self.assertEqual(run.verify.report_mode, 'staged')

    def test_a_batch_without_a_message_falls_back_to_the_status_sentence(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha', message='')
        with patched_llm([]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, f'Committed 1 change to [Alpha](proyekto://roadmap/{ALPHA}).')
        self.assertEqual(run.verify.report_mode, 'deterministic')

    def test_provider_failure_falls_back_to_the_staged_message(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        with patched_llm([ProviderDown('down')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, 'Added Growth.')
        self.assertEqual(run.verify.report_mode, 'staged')
        self.assertEqual(run.verify.status, 'verified')

    def test_past_soft_budget_skips_the_continuation_and_drops_the_transcript(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        key = _staged(ctx, session, run, batch)
        ctx.started_monotonic = monotonic() - 10_000
        with patched_llm([text_resp('never called')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.assistant_message, 'Added Growth.')
        self.assertIsNone(ctx.get_transcript(key))
        self.assertEqual(run.verify.summary, outcome.assistant_message)

    def test_a_reply_that_calls_a_tool_falls_back_to_the_staged_message(self):
        ctx, session, run, nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        with patched_llm([tool_resp('stage_edits', {'assistant_message': 'again', 'operations': []})]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, 'Added Growth.')
        self.assertEqual(run.verify.report_mode, 'staged')
        self.assertEqual(nest.commit_calls, [])

    def test_a_stale_transcript_is_ignored(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        batch.call_ids = ['call_from_another_run']
        with patched_llm([text_resp('never called')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.assistant_message, 'Added Growth.')

    def test_nothing_to_verify_skips_the_model(self):
        ctx, session, run, _nest = _fixture()
        with patched_llm([]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, verify.NOTHING_TO_VERIFY_MESSAGE)
        self.assertEqual(FakeLLM.calls, [])


class UndoRunReplyTests(unittest.TestCase):
    """An undo run replies through the same loop that called revert_changes;
    without that transcript the deterministic confirmation states what was
    restored."""

    def _undo_run(self):
        ctx, session, run, nest = _fixture()
        batch = RunBatch(
            roadmap_id=ALPHA,
            roadmap_title='Alpha',
            source='revert',
            assistant_message='Reverted: assigned Target task.',
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
        return ctx, session, run, nest, batch

    def test_undo_reply_comes_from_the_loop_with_an_undo_tool_output(self):
        ctx, session, run, _nest, batch = self._undo_run()
        _staged(ctx, session, run, batch, call_id='call_revert_1')
        with patched_llm([text_resp('Undone — [Target task](proyekto://task/t1) is back with its previous assignee.')]):
            outcome = verify.run(ctx, session, run)
        output = json.loads(next(m for m in FakeLLM.calls[0]['messages'] if m.get('type') == 'function_call_output')['output'])
        self.assertTrue(output['undo'])
        self.assertIn('restored to their previous state', output['note'])
        self.assertEqual(output['semantic_diff_summary'], {'ASSIGNEE_CHANGED': 1})
        self.assertEqual(outcome.assistant_message, 'Undone — [Target task](proyekto://task/t1) is back with its previous assignee.')
        self.assertEqual(run.verify.report_mode, 'loop')

    def test_undo_without_a_transcript_confirms_what_was_restored(self):
        ctx, session, run, _nest, _batch = self._undo_run()
        with patched_llm([text_resp("I can't undo that from here.")]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(outcome.assistant_message, f'Undid the last change on [Alpha](proyekto://roadmap/{ALPHA}) — restored task [Target task](proyekto://task/t1).')
        self.assertEqual(run.verify.report_mode, 'deterministic')

    def test_failed_undo_falls_back_to_the_status_summary(self):
        _ctx, session, run, _nest, _batch = self._undo_run()
        run.commits[0].status = 'failed'
        run.commits[0].error_message = 'stale'
        summary = verify.undo_summary(session, run)
        self.assertIn(f'[Alpha](proyekto://roadmap/{ALPHA}) failed: stale', summary)


PRODUCTION_REFUSAL = (
    "I can’t apply roadmap edits from this session right now. If you want, I can still list the "
    "Yachatdac tasks that should be moved to in progress so you can confirm the exact set."
)


class ReportContradictionTests(unittest.TestCase):
    """A reply that contradicts a landed commit never reaches the user."""

    def test_refusal_after_a_commit_is_rejected_for_the_staged_message(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        with patched_llm([text_resp(PRODUCTION_REFUSAL)]):
            with self.assertLogs('app.core.runtime.phases.verify', level='WARNING') as logs:
                outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.kind, 'verified')
        self.assertEqual(outcome.assistant_message, 'Added Growth.')
        self.assertEqual(run.verify.report_mode, 'rejected')
        self.assertEqual(run.verify.summary, outcome.assistant_message)
        self.assertTrue(any('verify_report_rejected' in line.lower() for line in logs.output))

    def test_reasons(self):
        ctx, session, run, _nest = _fixture()
        _committed(run, ALPHA, 'Alpha')
        self.assertEqual(verify.report_contradicts_outcome(PRODUCTION_REFUSAL, run), 'SESSION_EXCUSE')
        self.assertEqual(verify.report_contradicts_outcome("I cannot make that change to the roadmap.", run), 'REFUSAL_AFTER_COMMIT')
        self.assertEqual(verify.report_contradicts_outcome("I'm unable to update those tasks.", run), 'REFUSAL_AFTER_COMMIT')
        self.assertEqual(verify.report_contradicts_outcome('No changes were made to Alpha.', run), 'DENIES_CHANGES')
        self.assertIsNone(verify.report_contradicts_outcome('I moved 20 tasks in [Alpha](proyekto://roadmap/x) to in progress.', run))
        self.assertIsNone(verify.report_contradicts_outcome("Done. You can't miss the new epic at the top.", run))

    def test_honest_text_and_failed_runs_are_untouched(self):
        ctx, session, run, _nest = _fixture()
        batch = _committed(run, ALPHA, 'Alpha')
        _staged(ctx, session, run, batch)
        with patched_llm([text_resp('I moved every Alpha task to in progress.')]):
            outcome = verify.run(ctx, session, run)
        self.assertEqual(outcome.assistant_message, 'I moved every Alpha task to in progress.')
        self.assertEqual(run.verify.report_mode, 'loop')
        ctx, session, failed_run, _nest = _fixture()
        batch = _failed(failed_run, ALPHA, 'Alpha')
        _staged(ctx, session, failed_run, batch)
        self.assertIsNone(verify.report_contradicts_outcome(PRODUCTION_REFUSAL, failed_run))
        with patched_llm([text_resp("I couldn't apply the edit: the roadmap changed underneath me.")]):
            outcome = verify.run(ctx, session, failed_run)
        self.assertEqual(outcome.assistant_message, "I couldn't apply the edit: the roadmap changed underneath me.")
        self.assertEqual(failed_run.verify.report_mode, 'loop')


if __name__ == '__main__':
    unittest.main()
