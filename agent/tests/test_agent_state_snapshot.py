"""Durable agent-state snapshot (v2): build/exclusions, the size ladder
incl. the run fields, fingerprint stability (volatile run fields excluded),
sanitizer pass-through, the restore round-trip and the push target by scope."""

import asyncio
import json
import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch, RunCommit, RunState, RunSummary
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    AppliedChange,
    PendingPlan,
    ProposedEpic,
    RecentResolvedTarget,
    RoadmapContext,
)
from app.core.runtime.snapshot import (
    MAX_SNAPSHOT_BYTES,
    SNAPSHOT_VERSION,
    build_agent_state_snapshot,
    push_agent_state_snapshot,
    sanitize_session_metadata,
    snapshot_fingerprint,
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
    session.metadata.roadmaps['roadmap-snap'] = RoadmapContext(
        roadmap_id='roadmap-snap',
        overview_summary='Roadmap: 2 epics ...',
        handle_map={'E1': {'id': 'x', 'type': 'epic', 'title': 'T'}},
        memory_notes=[{'id': 'm1', 'content': 'note', 'source': 'user_request'}],
        project_context={'project': {'id': 'project-1', 'title': 'Secret Project'}},
        project_context_fetched_at=session.created_at,
    )
    session.metadata.workspace_context = {'workspace': {'id': 'ws', 'name': 'Acme'}}
    session.metadata.actor_context = ActorContext(actor_id='u-1', display_name='Ana')
    return session


def _run(session: AgentSession, *, ops: int = 2) -> RunState:
    run = RunState(trace_id='trace-1', scope=session.scope, user_message='apply', phase='execute')
    batch = RunBatch(
        roadmap_id='roadmap-snap',
        operations=[RoadmapOperation(op='add_epic', data={'title': f'E{i}'}) for i in range(ops)],
        source='proposal',
    )
    run.batches.append(batch)
    run.commits.append(RunCommit(batch_id=batch.batch_id, roadmap_id='roadmap-snap', attempts=1))
    return run


class SnapshotBuildTests(unittest.TestCase):
    def test_includes_memory_fields_and_excludes_caches(self) -> None:
        session = _session_with_memory()
        session.metadata.run = _run(session)
        session.metadata.run_history = [RunSummary(run_id='old', status='done', phase='verify')]
        snapshot = build_agent_state_snapshot(session)
        assert snapshot is not None
        self.assertEqual(snapshot['snapshot_version'], SNAPSHOT_VERSION)
        self.assertEqual(SNAPSHOT_VERSION, 2)
        for field in ('pending_plan', 'recent_resolved_targets', 'recent_applied_changes', 'conversation_summary', 'run', 'run_history'):
            self.assertIn(field, snapshot)
        for field in ('roadmaps', 'workspace_context', 'actor_context', 'next_handle_prefix_index', 'roadmap_overview_summary', 'memory_notes', 'project_context'):
            self.assertNotIn(field, snapshot)
        self.assertEqual(snapshot['run']['batches'][0]['operations'][0]['op'], 'add_epic')

    def test_empty_session_returns_none(self) -> None:
        self.assertIsNone(build_agent_state_snapshot(AgentSession(roadmap_id='r')))

    def test_oversized_snapshot_is_trimmed(self) -> None:
        session = _session_with_memory()
        # Blow past the cap with a huge pending plan rationale.
        session.metadata.pending_plan.rationale = 'x' * (MAX_SNAPSHOT_BYTES + 10_000)
        snapshot = build_agent_state_snapshot(session)
        # Either trimmed under the cap or skipped entirely — never oversized.
        if snapshot is not None:
            self.assertLessEqual(
                len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8')),
                MAX_SNAPSHOT_BYTES,
            )

    def test_run_ladder_drops_operations_and_flags_truncation(self) -> None:
        session = AgentSession(roadmap_id='roadmap-snap')
        session.metadata.run = _run(session, ops=1500)
        session.metadata.run_history = [RunSummary(run_id=f'r{i}', status='done', phase='verify') for i in range(5)]
        snapshot = build_agent_state_snapshot(session)
        assert snapshot is not None
        self.assertLessEqual(len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8')), MAX_SNAPSHOT_BYTES)
        run = snapshot['run']
        self.assertEqual(run['batches'][0]['operations'], [])
        self.assertTrue(run['batches_truncated'])
        self.assertEqual(run['status'], 'running')  # a live run is kept (reports RUN_STATE_LOST)
        self.assertLessEqual(len(snapshot.get('run_history', [])), 3)
        restored = AgentSession(roadmap_id='roadmap-snap', metadata=snapshot)
        self.assertTrue(restored.metadata.run.batches_truncated)

    def test_run_ladder_drops_a_terminal_run_entirely(self) -> None:
        session = AgentSession(roadmap_id='roadmap-snap')
        run = _run(session, ops=1500)
        run.status = 'done'
        run.final_message = 'y' * (MAX_SNAPSHOT_BYTES + 100)
        session.metadata.run = run
        snapshot = build_agent_state_snapshot(session)
        self.assertIsNone(snapshot if snapshot is None else snapshot.get('run'))

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

    def test_fingerprint_ignores_volatile_run_fields(self) -> None:
        session = _session_with_memory()
        session.metadata.run = _run(session)
        before = snapshot_fingerprint(build_agent_state_snapshot(session))
        run = session.metadata.run
        run.step += 1
        run.tokens = {'input': 500}
        run.phase_usage = {'investigate': {'turns': 3, 'tool_calls': 4}}
        from datetime import datetime, timedelta

        run.updated_at = datetime.now() + timedelta(seconds=5)
        self.assertEqual(snapshot_fingerprint(build_agent_state_snapshot(session)), before)
        run.commits[0].status = 'committed'
        self.assertNotEqual(snapshot_fingerprint(build_agent_state_snapshot(session)), before)


class SnapshotRestoreTests(unittest.TestCase):
    def test_snapshot_survives_sanitizer_and_revalidates(self) -> None:
        session = _session_with_memory()
        session.metadata.run = _run(session)
        snapshot = build_agent_state_snapshot(session)
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
        self.assertEqual(restored.metadata.run.run_id, session.metadata.run.run_id)
        self.assertEqual(len(restored.metadata.run.batches[0].operations), 2)
        self.assertEqual(restored.metadata.run.commits[0].attempts, 1)

    def test_v1_snapshot_still_loads(self) -> None:
        v1 = {
            'snapshot_version': 1,
            'saved_at': '2026-01-01T00:00:00+00:00',
            'pending_plan': {'summary': 'old', 'goal': 'g', 'source_user_message': 'x', 'proposed_hierarchy': [{'title': 'E'}]},
            'pending_edit_context': {'anything': True},
            'pending_context_resolution': {'label': 'x'},
        }
        restored = AgentSession(roadmap_id='r', metadata=v1)
        self.assertEqual(restored.metadata.pending_plan.summary, 'old')
        self.assertIsNone(restored.metadata.run)


class _Nest:
    def __init__(self):
        self.calls = []

    async def put_session_agent_state(self, **kwargs):
        self.calls.append(('roadmap', kwargs))
        return {}

    async def put_workspace_session_agent_state(self, **kwargs):
        self.calls.append(('workspace', kwargs))
        return {}


class SnapshotPushTests(unittest.TestCase):
    def test_push_target_follows_the_scope(self) -> None:
        nest = _Nest()
        roadmap = AgentSession(roadmap_id='r-1')
        workspace = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        asyncio.run(push_agent_state_snapshot(nest_client=nest, scope=roadmap.scope, session_id='s', snapshot={'a': 1}, auth_header='Bearer t', trace_id=None))
        asyncio.run(push_agent_state_snapshot(nest_client=nest, scope=workspace.scope, session_id='s', snapshot={'a': 1}, auth_header='Bearer t', trace_id=None))
        self.assertEqual([kind for kind, _ in nest.calls], ['roadmap', 'workspace'])
        self.assertEqual(nest.calls[0][1]['roadmap_id'], 'r-1')
        self.assertEqual(nest.calls[1][1]['workspace_id'], 'ws-1')
        self.assertEqual(nest.calls[1][1]['payload'], {'agent_state': {'a': 1}})


if __name__ == '__main__':
    unittest.main()
