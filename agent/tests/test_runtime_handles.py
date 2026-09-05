"""Roadmap handles across several loaded roadmaps: the widened handle regex
(`R2.E1`), the merged (collision-free) handle map with roadmap attribution,
the per-roadmap readers, and the batch-vs-roadmap guard."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, RecentResolvedTarget, RoadmapContext
from app.core.runtime import handles, tool_exec
from app.core.tools.registry import _HANDLE_TOKEN_PATTERN

ALPHA = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
EPIC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
FEAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
MILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
EPIC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
FEAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
TASK_X = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _session() -> AgentSession:
    session = AgentSession(roadmap_id=ALPHA)
    session.metadata.roadmaps[ALPHA] = RoadmapContext(
        roadmap_id=ALPHA,
        title='Alpha',
        overview_summary='Roadmap: "Alpha"',
        overview_fetched_at=_now(),
        handle_map={
            'E1': {'id': EPIC_A, 'type': 'epic', 'title': 'Growth', 'roadmap_id': ALPHA},
            'E1.F1': {'id': FEAT_A, 'type': 'feature', 'title': 'Login', 'roadmap_id': ALPHA},
            'M1': {'id': MILE_A, 'type': 'milestone', 'title': 'Launch', 'roadmap_id': ALPHA},
        },
    )
    session.metadata.roadmaps[BETA] = RoadmapContext(
        roadmap_id=BETA,
        title='Beta',
        handle_prefix='R2',
        overview_summary='Roadmap: "Beta"',
        overview_fetched_at=_now(),
        handle_map={
            # Entries without roadmap_id (older cache) get stamped by the merge.
            'R2.E1': {'id': EPIC_B, 'type': 'epic', 'title': 'Billing'},
            'R2.E1.F1': {'id': FEAT_B, 'type': 'feature', 'title': 'Invoices'},
        },
    )
    return session


class HandleRegexTests(unittest.TestCase):
    def test_accepts_bare_and_prefixed_handles(self) -> None:
        for token in ('E1', 'E12', 'E1.F2', 'M1', 'R2.E1', 'R2.E1.F3', 'R12.M1', 'R1.E10.F20'):
            self.assertIsNotNone(_HANDLE_TOKEN_PATTERN.match(token), token)

    def test_rejects_prefix_alone_and_other_shapes(self) -> None:
        for token in ('R2', 'R2.', 'F1', 'E1.F2.T3', 'RE1', 'E', 'R.E1', 'e1', 'E1F2', 'R2.M1.F1'):
            self.assertIsNone(_HANDLE_TOKEN_PATTERN.match(token), token)


class MergedHandleMapTests(unittest.TestCase):
    def test_union_keeps_bare_and_prefixed_keys_and_stamps_roadmap_id(self) -> None:
        merged = handles.merged_handle_map(_session())
        self.assertEqual(set(merged), {'E1', 'E1.F1', 'M1', 'R2.E1', 'R2.E1.F1'})
        self.assertEqual(merged['E1']['roadmap_id'], ALPHA)
        self.assertEqual(merged['R2.E1']['roadmap_id'], BETA)
        self.assertEqual(merged['R2.E1.F1'], {'id': FEAT_B, 'type': 'feature', 'title': 'Invoices', 'roadmap_id': BETA})

    def test_merge_does_not_mutate_the_cached_maps(self) -> None:
        session = _session()
        handles.merged_handle_map(session)
        self.assertNotIn('roadmap_id', session.metadata.roadmaps[BETA].handle_map['R2.E1'])

    def test_per_roadmap_readers_use_that_roadmaps_own_map(self) -> None:
        session = _session()
        beta_map = handles.handle_map_for_roadmap(session, BETA)
        self.assertEqual(handles.live_epic_titles(beta_map), frozenset({'billing'}))
        self.assertEqual(handles.node_types_by_id(beta_map), {EPIC_B: 'epic', FEAT_B: 'feature'})
        self.assertEqual(handles.handle_map_for_roadmap(session, 'unknown'), {})
        self.assertEqual(handles.handle_for_node_id(beta_map, FEAT_B), 'R2.E1.F1')
        self.assertIsNone(handles.handle_for_node_id(beta_map, EPIC_A))

    def test_prefix_labels(self) -> None:
        session = _session()
        self.assertEqual(handles.roadmap_prefix_label(session, ALPHA), '(focus)')
        self.assertEqual(handles.roadmap_prefix_label(session, BETA), '(R2)')


class NodeRoadmapIndexTests(unittest.TestCase):
    def test_index_covers_handles_and_recent_targets_with_roadmap(self) -> None:
        merged = handles.merged_handle_map(_session())
        targets = [
            RecentResolvedTarget(node_id=TASK_X, node_type='task', roadmap_id=BETA),
            RecentResolvedTarget(node_id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1', node_type='task'),
        ]
        index = handles.node_roadmap_index(merged, targets)
        self.assertEqual(index[EPIC_A], (ALPHA, 'E1'))
        self.assertEqual(index[EPIC_B], (BETA, 'R2.E1'))
        self.assertEqual(index[TASK_X], (BETA, None))
        # Pre-migration targets (no roadmap_id) are not indexed -> they pass.
        self.assertNotIn('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', index)


class ValidateBatchRoadmapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = _session()
        self.merged = handles.merged_handle_map(self.session)
        self.titles = {ALPHA: 'Alpha', BETA: 'Beta'}
        self.prefixes = {ALPHA: None, BETA: 'R2'}

    def _validate(self, operations, roadmap_id, **kwargs):
        return handles.validate_batch_roadmap(
            operations,
            roadmap_id,
            self.merged,
            roadmap_titles=self.titles,
            roadmap_prefixes=self.prefixes,
            **kwargs,
        )

    def test_same_roadmap_passes(self) -> None:
        ops = [
            RoadmapOperation(op='update_node', node_id=EPIC_A, patch={'title': 'x'}),
            RoadmapOperation(op='add_feature', parent_id=EPIC_A, data={'title': 'New'}),
        ]
        self.assertIsNone(self._validate(ops, ALPHA))

    def test_known_id_from_another_roadmap_is_rejected_with_a_corrective_message(self) -> None:
        ops = [RoadmapOperation(op='update_node', node_id=FEAT_B, patch={'title': 'x'})]
        message = self._validate(ops, ALPHA)
        assert message is not None
        self.assertTrue(message.startswith('HANDLE_ROADMAP_MISMATCH:'))
        self.assertIn('"R2.E1.F1" belongs to roadmap "Beta" (R2)', message)
        self.assertIn('not the batch\'s roadmap "Alpha"', message)
        self.assertIn(f'Use roadmap_id="{BETA}" for that operation.', message)

    def test_focus_id_staged_against_another_roadmap_names_the_focus(self) -> None:
        ops = [RoadmapOperation(op='delete_node', node_id=EPIC_A)]
        message = self._validate(ops, BETA)
        assert message is not None
        self.assertIn('"E1" belongs to roadmap "Alpha" (focus)', message)
        self.assertIn(f'Use roadmap_id="{ALPHA}"', message)

    def test_parent_and_targets_fields_are_checked(self) -> None:
        by_parent = [RoadmapOperation(op='add_feature', parent_id=EPIC_B, data={'title': 'x'})]
        self.assertIsNotNone(self._validate(by_parent, ALPHA))
        by_targets = [RoadmapOperation(op='shift_dates', targets=[MILE_A], delta_days=3)]
        self.assertIsNotNone(self._validate(by_targets, BETA))
        self.assertIsNone(self._validate(by_targets, ALPHA))

    def test_unknown_uuid_and_untracked_recent_target_pass(self) -> None:
        ops = [RoadmapOperation(op='delete_node', node_id=TASK_X)]
        self.assertIsNone(self._validate(ops, ALPHA))
        legacy = [RecentResolvedTarget(node_id=TASK_X, node_type='task')]
        self.assertIsNone(self._validate(ops, ALPHA, recent_targets=legacy))

    def test_recent_target_with_roadmap_is_enforced(self) -> None:
        ops = [RoadmapOperation(op='delete_node', node_id=TASK_X)]
        tracked = [RecentResolvedTarget(node_id=TASK_X, node_type='task', roadmap_id=BETA)]
        message = self._validate(ops, ALPHA, recent_targets=tracked)
        assert message is not None
        self.assertIn(f'node {TASK_X} belongs to roadmap "Beta" (R2)', message)
        self.assertIsNone(self._validate(ops, BETA, recent_targets=tracked))

    def test_no_roadmap_or_no_index_passes(self) -> None:
        ops = [RoadmapOperation(op='delete_node', node_id=EPIC_B)]
        self.assertIsNone(self._validate(ops, None))
        self.assertIsNone(handles.validate_batch_roadmap(ops, ALPHA, {}))
        self.assertIsNone(handles.validate_batch_roadmap([], ALPHA, self.merged))


class InterpretStageEditsAcrossRoadmapsTests(unittest.TestCase):
    """End to end: prefixed handles expand through the merged map and the
    batch is checked against the roadmap it targets."""

    def setUp(self) -> None:
        self.session = _session()
        self.merged = handles.merged_handle_map(self.session)

    def _interpret(self, args, expected):
        return tool_exec.interpret_stage_edits(
            args,
            self.merged,
            None,
            expected,
            roadmap_titles={ALPHA: 'Alpha', BETA: 'Beta'},
            roadmap_prefixes={ALPHA: None, BETA: 'R2'},
        )

    def test_prefixed_handle_expands_and_matches_its_roadmap(self) -> None:
        parsed = self._interpret(
            {
                'assistant_message': 'Renamed Billing.',
                'roadmap_id': BETA,
                'operations': [{'op': 'update_node', 'node_id': 'R2.E1', 'patch': {'title': 'Payments'}}],
            },
            BETA,
        )
        self.assertIsInstance(parsed, tool_exec.PlanToolParsed)
        assert isinstance(parsed, tool_exec.PlanToolParsed)
        self.assertEqual(parsed.operations[0].node_id, EPIC_B)
        self.assertEqual(parsed.roadmap_id, BETA)

    def test_call_roadmap_id_defaults_to_the_expected_one(self) -> None:
        parsed = self._interpret(
            {
                'assistant_message': 'ok',
                'operations': [{'op': 'update_node', 'node_id': 'E1', 'patch': {'title': 'x'}}],
            },
            ALPHA,
        )
        assert isinstance(parsed, tool_exec.PlanToolParsed)
        self.assertEqual(parsed.roadmap_id, ALPHA)
        self.assertEqual(parsed.operations[0].node_id, EPIC_A)

    def test_handle_from_another_roadmap_is_a_mismatch_error(self) -> None:
        error = self._interpret(
            {
                'assistant_message': 'oops',
                'roadmap_id': ALPHA,
                'operations': [{'op': 'update_node', 'node_id': 'R2.E1', 'patch': {'title': 'x'}}],
            },
            ALPHA,
        )
        self.assertIsInstance(error, tool_exec.PlanToolError)
        assert isinstance(error, tool_exec.PlanToolError)
        self.assertEqual(error.code, 'HANDLE_ROADMAP_MISMATCH')
        self.assertIn('R2.E1', error.message)

    def test_different_roadmap_than_expected_is_rejected(self) -> None:
        error = self._interpret(
            {
                'assistant_message': 'x',
                'roadmap_id': BETA,
                'operations': [{'op': 'add_epic', 'data': {'title': 'New'}}],
            },
            ALPHA,
        )
        assert isinstance(error, tool_exec.PlanToolError)
        self.assertEqual(error.code, 'ROADMAP_MISMATCH')

    def test_hallucinated_roadmap_id_is_rejected(self) -> None:
        error = self._interpret(
            {
                'assistant_message': 'x',
                'roadmap_id': 'Beta',
                'operations': [{'op': 'add_epic', 'data': {'title': 'New'}}],
            },
            None,
        )
        assert isinstance(error, tool_exec.PlanToolError)
        self.assertEqual(error.code, 'INVALID_ROADMAP_ID')


if __name__ == '__main__':
    unittest.main()
