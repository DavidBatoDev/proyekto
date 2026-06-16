import unittest

from app.core.contracts.sessions import AgentSession, AppliedChange
from app.core.orchestration.context.applied_changes_log import (
    MAX_APPLIED_CHANGES,
    format_recent_applied_changes,
    record_applied_changes_from_commit,
    summarize_change_group,
)


def _session() -> AgentSession:
    return AgentSession(roadmap_id='roadmap-1')


def _title_change(node_id: str, from_title: str, to_title: str) -> dict:
    return {
        'type': 'TITLE_CHANGED',
        'node': {'type': 'epic', 'id': node_id},
        'from': {'title': from_title},
        'to': {'title': to_title},
    }


class RecordAppliedChangesFromCommitTests(unittest.TestCase):
    def test_records_title_change(self) -> None:
        session = _session()
        commit_result = {
            'semantic_diff': {
                'changes': [_title_change('epic-1', 'PM module', 'Project Management Module')],
            },
        }
        added = record_applied_changes_from_commit(session, commit_result)
        self.assertEqual(added, 1)
        self.assertEqual(len(session.metadata.recent_applied_changes), 1)
        entry = session.metadata.recent_applied_changes[0]
        self.assertEqual(entry.node_id, 'epic-1')
        self.assertEqual(entry.node_type, 'epic')
        self.assertEqual(entry.change_type, 'TITLE_CHANGED')
        self.assertEqual(entry.change_from, {'title': 'PM module'})
        self.assertEqual(entry.change_to, {'title': 'Project Management Module'})
        self.assertEqual(entry.title, 'Project Management Module')

    def test_prepends_newest_entries_and_caps(self) -> None:
        session = _session()
        # Pre-seed 9 existing entries so the newest will push total to 11,
        # triggering a cap back to MAX_APPLIED_CHANGES (10).
        session.metadata.recent_applied_changes = [
            AppliedChange(
                node_id=f'node-{idx}',
                node_type='epic',
                change_type='TITLE_CHANGED',
                change_from={'title': f'Old {idx}'},
                change_to={'title': f'New {idx}'},
                title=f'New {idx}',
            )
            for idx in range(9)
        ]
        commit_result = {
            'semantic_diff': {
                'changes': [
                    _title_change('new-a', 'A old', 'A new'),
                    _title_change('new-b', 'B old', 'B new'),
                ],
            },
        }
        added = record_applied_changes_from_commit(session, commit_result)
        self.assertEqual(added, 2)
        self.assertEqual(
            len(session.metadata.recent_applied_changes), MAX_APPLIED_CHANGES,
        )
        # Newest first ordering — the two freshly-added entries come first.
        self.assertEqual(
            session.metadata.recent_applied_changes[0].node_id, 'new-a',
        )
        self.assertEqual(
            session.metadata.recent_applied_changes[1].node_id, 'new-b',
        )

    def test_ignores_malformed_changes(self) -> None:
        session = _session()
        commit_result = {
            'semantic_diff': {
                'changes': [
                    None,
                    {},
                    {'type': 'TITLE_CHANGED'},  # missing node
                    {'node': {'id': 'e-1', 'type': 'epic'}},  # missing type
                    _title_change('e-2', 'a', 'b'),
                ],
            },
        }
        added = record_applied_changes_from_commit(session, commit_result)
        self.assertEqual(added, 1)
        self.assertEqual(
            session.metadata.recent_applied_changes[0].node_id, 'e-2',
        )

    def test_no_op_when_semantic_diff_missing(self) -> None:
        session = _session()
        self.assertEqual(
            record_applied_changes_from_commit(session, {}), 0,
        )
        self.assertEqual(session.metadata.recent_applied_changes, [])

    def test_populates_change_id_from_commit_result(self) -> None:
        session = _session()
        commit_result = {
            'change_id': 'chg-abc-123',
            'semantic_diff': {
                'changes': [
                    _title_change('epic-1', 'Old', 'New'),
                    _title_change('epic-2', 'A', 'B'),
                ],
            },
        }
        record_applied_changes_from_commit(session, commit_result)
        entries = session.metadata.recent_applied_changes
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].change_id, 'chg-abc-123')
        self.assertEqual(entries[1].change_id, 'chg-abc-123')

    def test_change_id_is_none_when_commit_result_omits_it(self) -> None:
        session = _session()
        commit_result = {
            'semantic_diff': {
                'changes': [_title_change('epic-1', 'Old', 'New')],
            },
        }
        record_applied_changes_from_commit(session, commit_result)
        self.assertIsNone(
            session.metadata.recent_applied_changes[0].change_id,
        )

    def test_normalizes_change_type_casing(self) -> None:
        session = _session()
        commit_result = {
            'semantic_diff': {
                'changes': [
                    {
                        'type': 'title_changed',
                        'node': {'type': 'Epic', 'id': 'e-1'},
                        'from': {'title': 'a'},
                        'to': {'title': 'b'},
                    }
                ],
            },
        }
        record_applied_changes_from_commit(session, commit_result)
        entry = session.metadata.recent_applied_changes[0]
        self.assertEqual(entry.change_type, 'TITLE_CHANGED')
        self.assertEqual(entry.node_type, 'epic')


class FormatRecentAppliedChangesTests(unittest.TestCase):
    def test_renders_title_change(self) -> None:
        changes = [
            AppliedChange(
                node_id='epic-1',
                node_type='epic',
                change_type='TITLE_CHANGED',
                change_from={'title': 'PM module'},
                change_to={'title': 'Project Management Module'},
                title='Project Management Module',
            ),
        ]
        rendered = format_recent_applied_changes(changes)
        assert rendered is not None
        self.assertIn(
            '1. Renamed epic "PM module" → "Project Management Module" (id: epic-1)',
            rendered,
        )

    def test_renders_multiple_types(self) -> None:
        changes = [
            AppliedChange(
                node_id='epic-1',
                node_type='epic',
                change_type='TITLE_CHANGED',
                change_from={'title': 'A'},
                change_to={'title': 'B'},
                title='B',
            ),
            AppliedChange(
                node_id='task-1',
                node_type='task',
                change_type='STATUS_CHANGED',
                change_from={'status': 'todo'},
                change_to={'status': 'done'},
                title='Finish login',
            ),
            AppliedChange(
                node_id='epic-2',
                node_type='epic',
                change_type='NODE_ADDED',
                change_to={'title': 'New epic'},
                title='New epic',
            ),
        ]
        rendered = format_recent_applied_changes(changes)
        assert rendered is not None
        self.assertIn('1. Renamed epic "A" → "B"', rendered)
        self.assertIn('status: todo → done', rendered)
        self.assertIn('Created epic "New epic"', rendered)

    def test_returns_none_for_empty(self) -> None:
        self.assertIsNone(format_recent_applied_changes([]))
        self.assertIsNone(format_recent_applied_changes(None))


class SummarizeChangeGroupTests(unittest.TestCase):
    def test_single_change_strips_node_id(self) -> None:
        summary = summarize_change_group([
            AppliedChange(
                node_id='epic-1', node_type='epic', change_type='TITLE_CHANGED',
                change_from={'title': 'Old'}, change_to={'title': 'New'}, title='New',
            ),
        ])
        self.assertEqual(summary, 'Renamed epic "Old" → "New"')
        self.assertNotIn('id:', summary)

    def test_multiple_changes_group_counts(self) -> None:
        changes = [
            AppliedChange(node_id=f'e-{i}', node_type='epic',
                          change_type='NODE_REMOVED', change_from={}, title=f'E{i}')
            for i in range(2)
        ] + [
            AppliedChange(node_id=f'f-{i}', node_type='feature',
                          change_type='NODE_REMOVED', change_from={}, title=f'F{i}')
            for i in range(3)
        ]
        self.assertEqual(summarize_change_group(changes), 'Deleted 2 epics, 3 features')

    def test_falls_back_to_untitled_when_missing(self) -> None:
        changes = [
            AppliedChange(
                node_id='task-1',
                node_type='task',
                change_type='STATUS_CHANGED',
                change_from={'status': 'todo'},
                change_to={'status': 'done'},
                # no title
            ),
        ]
        rendered = format_recent_applied_changes(changes)
        assert rendered is not None
        self.assertIn('"(untitled)"', rendered)


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
