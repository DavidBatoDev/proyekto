"""A delete commit must not seed (and must prune) the deleted node's stale id
in recent_resolved_targets — otherwise a later turn binds a title/deictic
reference to a dead id and the commit fails with "Target node was not found"
(notably right after a revert recreates nodes with fresh ids)."""

import unittest

from app.core.contracts.sessions import AgentSession, RecentResolvedTarget
from app.core.orchestration.context.recent_targets_manager import (
    prune_recent_targets_by_node_ids,
    record_recent_targets_from_preview,
)


def _fake_append(*, session, node_id, node_type, title=None, label=None, source='context_tool', **_):
    """Minimal stand-in for append_recent_resolved_target: dedupe by id+type."""
    nid = str(node_id or '').strip()
    ntype = str(node_type or '').strip().lower()
    if not nid or ntype not in {'epic', 'feature', 'task'}:
        return
    kept = [
        t for t in session.metadata.recent_resolved_targets
        if not (t.node_id == nid and t.node_type == ntype)
    ]
    kept.append(RecentResolvedTarget(node_id=nid, node_type=ntype, title=title, label=label, source=source))
    session.metadata.recent_resolved_targets = kept


class RecordFromPreviewPruneTests(unittest.TestCase):
    def _session_with_feature(self, node_id):
        session = AgentSession(roadmap_id='r')
        session.metadata.recent_resolved_targets = [
            RecentResolvedTarget(node_id=node_id, node_type='feature', title='RT Feature', source='context_tool'),
        ]
        return session

    def test_removed_node_is_pruned_not_reseeded(self) -> None:
        session = self._session_with_feature('feat-v1')
        commit_result = {
            'semantic_diff': {
                'changes': [
                    {'type': 'NODE_REMOVED', 'node': {'type': 'feature', 'id': 'feat-v1', 'title': 'RT Feature'}},
                ],
            },
        }
        record_recent_targets_from_preview(
            session=session, preview_result=commit_result,
            source='commit_semantic_diff', append_recent_resolved_target=_fake_append,
        )
        ids = {t.node_id for t in session.metadata.recent_resolved_targets}
        self.assertNotIn('feat-v1', ids)

    def test_added_node_is_recorded(self) -> None:
        session = AgentSession(roadmap_id='r')
        commit_result = {
            'semantic_diff': {
                'changes': [
                    {'type': 'NODE_ADDED', 'node': {'type': 'feature', 'id': 'feat-v2', 'title': 'RT Feature'}},
                ],
            },
        }
        record_recent_targets_from_preview(
            session=session, preview_result=commit_result,
            source='commit_semantic_diff', append_recent_resolved_target=_fake_append,
        )
        ids = {t.node_id for t in session.metadata.recent_resolved_targets}
        self.assertIn('feat-v2', ids)

    def test_delete_then_recreate_leaves_only_new_id(self) -> None:
        # The revert scenario: same title, old id removed + new id added.
        session = self._session_with_feature('feat-v1')
        commit_result = {
            'semantic_diff': {
                'changes': [
                    {'type': 'NODE_REMOVED', 'node': {'type': 'feature', 'id': 'feat-v1', 'title': 'RT Feature'}},
                    {'type': 'NODE_ADDED', 'node': {'type': 'feature', 'id': 'feat-v2', 'title': 'RT Feature'}},
                ],
            },
        }
        record_recent_targets_from_preview(
            session=session, preview_result=commit_result,
            source='commit_semantic_diff', append_recent_resolved_target=_fake_append,
        )
        ids = {t.node_id for t in session.metadata.recent_resolved_targets}
        self.assertEqual(ids, {'feat-v2'})


class PruneHelperTests(unittest.TestCase):
    def test_prune_by_node_ids(self) -> None:
        session = AgentSession(roadmap_id='r')
        session.metadata.recent_resolved_targets = [
            RecentResolvedTarget(node_id='a', node_type='epic', source='context_tool'),
            RecentResolvedTarget(node_id='b', node_type='feature', source='context_tool'),
        ]
        prune_recent_targets_by_node_ids(session, {'a'})
        ids = {t.node_id for t in session.metadata.recent_resolved_targets}
        self.assertEqual(ids, {'b'})

    def test_prune_noop_for_empty(self) -> None:
        session = AgentSession(roadmap_id='r')
        session.metadata.recent_resolved_targets = [
            RecentResolvedTarget(node_id='a', node_type='epic', source='context_tool'),
        ]
        prune_recent_targets_by_node_ids(session, set())
        self.assertEqual(len(session.metadata.recent_resolved_targets), 1)


if __name__ == '__main__':
    unittest.main()
