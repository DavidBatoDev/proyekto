"""Staging onto the run: one batch per roadmap, same-roadmap calls merge in
order, per-roadmap signature dedupe (a retry or a second call cannot
double-apply an edit), and the session's staged version bumps once per batch
that actually added something."""

from __future__ import annotations

import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunCommit, RunState
from app.core.contracts.sessions import AgentSession
from app.core.runtime import staging

ALPHA = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
EPIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'


def _session_and_run():
    session = AgentSession(roadmap_id=ALPHA)
    run = RunState(trace_id='t', scope=session.scope, focus_roadmap_ids=[ALPHA])
    return session, run


def _add(title: str) -> RoadmapOperation:
    return RoadmapOperation(op='add_epic', data={'title': title})


class StageBatchTests(unittest.TestCase):
    def test_creates_one_batch_per_roadmap(self) -> None:
        session, run = _session_and_run()
        first = staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')], assistant_message='Added A.', roadmap_title='Alpha')
        second = staging.stage_batch(session, run, roadmap_id=BETA, operations=[_add('B')], assistant_message='Added B.')
        self.assertTrue(first.created and second.created)
        self.assertEqual([batch.roadmap_id for batch in run.batches], [ALPHA, BETA])
        self.assertEqual(run.batches[0].roadmap_title, 'Alpha')
        self.assertEqual(run.batches[0].assistant_message, 'Added A.')
        self.assertEqual(run.batches[0].source, 'stage_edits')
        self.assertIsNotNone(run.batches[0].operations_hash)
        self.assertEqual(session.staged_operations_version, 2)
        self.assertEqual(staging.staged_operation_count(run), 2)

    def test_same_roadmap_calls_merge_in_order_and_dedupe_by_signature(self) -> None:
        session, run = _session_and_run()
        staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A'), _add('B')], assistant_message='Added A and B.')
        hash_before = run.batches[0].operations_hash
        result = staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('B'), _add('C')], assistant_message='Added C.')
        self.assertFalse(result.created)
        self.assertEqual([op.data['title'] for op in result.added], ['C'])
        self.assertEqual(len(run.batches), 1)
        self.assertEqual([op.data['title'] for op in run.batches[0].operations], ['A', 'B', 'C'])
        self.assertEqual(run.batches[0].assistant_message, 'Added A and B. Added C.')
        self.assertNotEqual(run.batches[0].operations_hash, hash_before)
        self.assertEqual(session.staged_operations_version, 2)

    def test_exact_retry_adds_nothing_and_does_not_bump_the_version(self) -> None:
        session, run = _session_and_run()
        staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')])
        retry = staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')])
        self.assertFalse(retry.staged_changed)
        self.assertIs(retry.batch, run.batches[0])
        self.assertEqual(len(run.batches[0].operations), 1)
        self.assertEqual(session.staged_operations_version, 1)

    def test_dedupe_is_per_roadmap(self) -> None:
        session, run = _session_and_run()
        staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')])
        other = staging.stage_batch(session, run, roadmap_id=BETA, operations=[_add('A')])
        self.assertEqual(len(other.added), 1)
        self.assertEqual(len(run.batches), 2)

    def test_nothing_to_stage_and_no_batch_returns_none(self) -> None:
        session, run = _session_and_run()
        result = staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[])
        self.assertIsNone(result.batch)
        self.assertEqual(run.batches, [])
        self.assertEqual(session.staged_operations_version, 0)

    def test_a_batch_that_entered_execute_is_never_merged_into(self) -> None:
        session, run = _session_and_run()
        staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')])
        run.commits.append(RunCommit(batch_id=run.batches[0].batch_id, roadmap_id=ALPHA))
        result = staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('B')])
        self.assertTrue(result.created)
        self.assertEqual(len(run.batches), 2)
        self.assertEqual([op.data['title'] for op in run.batches[1].operations], ['B'])

    def test_sources_stay_separate_and_delete_is_flagged(self) -> None:
        session, run = _session_and_run()
        staging.stage_batch(session, run, roadmap_id=ALPHA, operations=[_add('A')], source='stage_edits')
        revert = staging.stage_batch(
            session, run, roadmap_id=ALPHA,
            operations=[RoadmapOperation(op='delete_node', node_id=EPIC)],
            source='revert',
        )
        self.assertTrue(revert.created)
        self.assertEqual([batch.source for batch in run.batches], ['stage_edits', 'revert'])
        self.assertFalse(run.batches[0].contains_delete)
        self.assertTrue(run.batches[1].contains_delete)


if __name__ == '__main__':
    unittest.main()
