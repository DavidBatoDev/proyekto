import unittest
from datetime import datetime, timezone

from app.api.routes.sessions_support.auto_commit import (
    _refresh_recent_resolved_target_titles,
)
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, RecentResolvedTarget


def _session_with_targets(targets: list[RecentResolvedTarget]) -> AgentSession:
    session = AgentSession(roadmap_id='roadmap-1')
    session.metadata.recent_resolved_targets = targets
    return session


class RefreshRecentResolvedTargetTitlesTests(unittest.TestCase):
    def test_updates_title_for_renamed_epic(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic',
                title='PM module', label='PM module',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='update_node',
                node_id='epic-1',
                patch={'title': 'Project Management Module'},
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title,
            'Project Management Module',
        )

    def test_leaves_non_rename_update_alone(self) -> None:
        # update_node with a patch that isn't `title` → no refresh.
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic',
                title='PM module', label='PM module',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='update_node',
                node_id='epic-1',
                patch={'description': 'something else'},
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'PM module',
        )

    def test_ignores_non_update_node_operations(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic', title='PM module',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='delete_node', node_id='epic-1',
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'PM module',
        )

    def test_only_updates_matching_node_id(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic', title='Old A',
                created_at=datetime.now(timezone.utc),
            ),
            RecentResolvedTarget(
                node_id='epic-2', node_type='epic', title='Old B',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='update_node', node_id='epic-1',
                patch={'title': 'New A'},
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'New A',
        )
        self.assertEqual(
            session.metadata.recent_resolved_targets[1].title, 'Old B',
        )

    def test_handles_empty_operations_list(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic', title='Unchanged',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        _refresh_recent_resolved_target_titles(session, [])
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'Unchanged',
        )

    def test_no_op_when_no_matching_target(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic', title='Unchanged',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='update_node', node_id='epic-unknown',
                patch={'title': 'Shouldnt Propagate'},
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'Unchanged',
        )

    def test_skips_empty_or_whitespace_new_title(self) -> None:
        session = _session_with_targets([
            RecentResolvedTarget(
                node_id='epic-1', node_type='epic', title='Old',
                created_at=datetime.now(timezone.utc),
            ),
        ])
        operations = [
            RoadmapOperation(
                op='update_node', node_id='epic-1',
                patch={'title': '   '},
            ),
        ]
        _refresh_recent_resolved_target_titles(session, operations)
        self.assertEqual(
            session.metadata.recent_resolved_targets[0].title, 'Old',
        )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
