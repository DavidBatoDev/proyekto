"""Durable agent-state snapshot: build/exclusions, size trimming,
fingerprint stability, sanitizer pass-through, and the restore round-trip."""

import unittest

from app.api.routes.sessions_support.agent_state_snapshot import (
    MAX_SNAPSHOT_BYTES,
    build_agent_state_snapshot,
    snapshot_fingerprint,
)
from app.api.routes.sessions_support.common import sanitize_session_metadata
from app.core.contracts.sessions import (
    AgentSession,
    AppliedChange,
    PendingPlan,
    ProposedEpic,
    RecentResolvedTarget,
)


def _session_with_memory() -> AgentSession:
    session = AgentSession(roadmap_id='roadmap-snap')
    session.metadata.pending_plan = PendingPlan(
        summary='Add password reset',
        goal='Self-serve recovery',
        source_user_message='plan it',
        proposed_hierarchy=[ProposedEpic(title='Q3 Security')],
    )
    session.metadata.recent_resolved_targets = [
        RecentResolvedTarget(node_id=f'node-{index}', node_type='epic', title=f'E{index}')
        for index in range(15)
    ]
    session.metadata.recent_applied_changes = [
        AppliedChange(node_id=f'chg-{index}', node_type='epic', change_type='NODE_ADDED')
        for index in range(10)
    ]
    session.metadata.applied_change_ids = ['c1', 'c2']
    session.metadata.conversation_summary = 'Earlier we discussed the Q3 plan.'
    # Caches that must be EXCLUDED from the snapshot:
    session.metadata.roadmap_overview_summary = 'Roadmap: 2 epics ...'
    session.metadata.roadmap_handle_map = {'E1': {'id': 'x', 'type': 'epic', 'title': 'T'}}
    session.metadata.memory_notes = [{'id': 'm1', 'content': 'note', 'source': 'user_request'}]
    session.metadata.project_context = {
        'project': {'id': 'project-1', 'title': 'Secret Project'}
    }
    session.metadata.project_context_fetched_at = session.created_at
    return session


class SnapshotBuildTests(unittest.TestCase):
    def test_includes_memory_fields_and_excludes_caches(self) -> None:
        snapshot = build_agent_state_snapshot(_session_with_memory())
        assert snapshot is not None
        self.assertEqual(snapshot['snapshot_version'], 1)
        self.assertIn('pending_plan', snapshot)
        self.assertIn('recent_resolved_targets', snapshot)
        self.assertIn('recent_applied_changes', snapshot)
        self.assertIn('conversation_summary', snapshot)
        self.assertNotIn('roadmap_overview_summary', snapshot)
        self.assertNotIn('roadmap_handle_map', snapshot)
        self.assertNotIn('memory_notes', snapshot)
        self.assertNotIn('project_context', snapshot)
        self.assertNotIn('project_context_fetched_at', snapshot)
        self.assertNotIn('actor_context', snapshot)

    def test_empty_session_returns_none(self) -> None:
        self.assertIsNone(build_agent_state_snapshot(AgentSession(roadmap_id='r')))

    def test_oversized_snapshot_is_trimmed(self) -> None:
        session = _session_with_memory()
        # Blow past the cap with a huge pending plan rationale.
        session.metadata.pending_plan.rationale = 'x' * (MAX_SNAPSHOT_BYTES + 10_000)
        snapshot = build_agent_state_snapshot(session)
        # Either trimmed under the cap or skipped entirely — never oversized.
        if snapshot is not None:
            import json

            self.assertLessEqual(
                len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8')),
                MAX_SNAPSHOT_BYTES,
            )

    def test_fingerprint_ignores_saved_at(self) -> None:
        session = _session_with_memory()
        first = build_agent_state_snapshot(session)
        second = build_agent_state_snapshot(session)
        assert first is not None and second is not None
        self.assertNotEqual(first['saved_at'], second['saved_at'])
        self.assertEqual(snapshot_fingerprint(first), snapshot_fingerprint(second))

    def test_fingerprint_changes_when_memory_changes(self) -> None:
        session = _session_with_memory()
        before = snapshot_fingerprint(build_agent_state_snapshot(session))
        session.metadata.conversation_summary = 'Something new happened.'
        after = snapshot_fingerprint(build_agent_state_snapshot(session))
        self.assertNotEqual(before, after)


class SnapshotRestoreTests(unittest.TestCase):
    def test_snapshot_survives_sanitizer_and_revalidates(self) -> None:
        snapshot = build_agent_state_snapshot(_session_with_memory())
        assert snapshot is not None

        sanitized, stripped = sanitize_session_metadata(
            snapshot, actor_metadata_keys={'actor_context', 'actor_id'}
        )
        self.assertFalse(stripped)

        restored = AgentSession(roadmap_id='roadmap-restored', metadata=sanitized)
        assert restored.metadata.pending_plan is not None
        self.assertEqual(restored.metadata.pending_plan.summary, 'Add password reset')
        self.assertEqual(len(restored.metadata.recent_applied_changes), 10)
        self.assertEqual(
            restored.metadata.conversation_summary,
            'Earlier we discussed the Q3 plan.',
        )


if __name__ == '__main__':
    unittest.main()
