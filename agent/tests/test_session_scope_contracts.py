"""Session scope + run contracts: SessionScope validation, the AgentSession
legacy-roadmap_id derivation, the widened API models, the run models in
contracts/runs.py, and the clamped run tunables in config.py."""

from __future__ import annotations

import json
import unittest

from pydantic import ValidationError

from app.core.config import Settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import (
    CommitImpactedItem,
    ContextRef,
    ResolvedRef,
    RunBatch,
    RunBatchView,
    RunCommit,
    RunCommitView,
    RunError,
    RunState,
    RunSummary,
    RunView,
    VerifyCheck,
    VerifyReport,
    compute_operations_hash,
    operations_contain_delete,
)
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    AppliedChange,
    ChangeGroup,
    CreateSessionRequest,
    CreateSessionResponse,
    MessageRequest,
    MessageResponse,
    PendingPlan,
    PlanTarget,
    ProposedEpic,
    RecentResolvedTarget,
    RoadmapContext,
    SessionMetadata,
    SessionScope,
    TraceEventsResponse,
)
from app.core.contracts import sessions as sessions_module

_UUID = '5ebdbb85-1234-4abc-8def-0123456789ab'


def _roadmap_scope(roadmap_id: str = 'roadmap-1') -> SessionScope:
    return SessionScope(kind='roadmap', roadmap_id=roadmap_id)


def _workspace_scope(workspace_id: str = 'workspace-1') -> SessionScope:
    return SessionScope(kind='workspace', workspace_id=workspace_id)


def _op(op: str = 'add_epic', title: str | None = None, **extra: object) -> RoadmapOperation:
    payload: dict[str, object] = {'op': op}
    if op == 'add_epic':
        payload['data'] = {'title': title or 'Epic'}
    payload.update(extra)
    return RoadmapOperation.model_validate(payload)


class SessionScopeTests(unittest.TestCase):
    def test_roadmap_scope_key_and_focus(self) -> None:
        scope = _roadmap_scope('r-1')
        self.assertEqual(scope.key, 'roadmap:r-1')
        self.assertEqual(scope.focus_roadmap_id, 'r-1')

    def test_workspace_scope_key_has_no_focus(self) -> None:
        scope = _workspace_scope('w-1')
        self.assertEqual(scope.key, 'workspace:w-1')
        self.assertIsNone(scope.focus_roadmap_id)
        self.assertIsNone(scope.roadmap_id)

    def test_roadmap_scope_requires_roadmap_id(self) -> None:
        with self.assertRaises(ValidationError):
            SessionScope(kind='roadmap')
        with self.assertRaises(ValidationError):
            SessionScope(kind='roadmap', roadmap_id='   ')

    def test_workspace_scope_requires_workspace_id(self) -> None:
        with self.assertRaises(ValidationError):
            SessionScope(kind='workspace')

    def test_scope_rejects_the_other_kinds_id(self) -> None:
        with self.assertRaises(ValidationError):
            SessionScope(kind='roadmap', roadmap_id='r', workspace_id='w')
        with self.assertRaises(ValidationError):
            SessionScope(kind='workspace', workspace_id='w', roadmap_id='r')

    def test_scope_rejects_unknown_kind(self) -> None:
        with self.assertRaises(ValidationError):
            SessionScope(kind='project', roadmap_id='r')

    def test_scope_is_reexported_from_sessions_module(self) -> None:
        from app.core.contracts import runs as runs_module

        self.assertIs(sessions_module.SessionScope, runs_module.SessionScope)
        self.assertIs(sessions_module.CommitImpactedItem, runs_module.CommitImpactedItem)


class AgentSessionScopeTests(unittest.TestCase):
    def test_legacy_roadmap_id_fixture_derives_roadmap_scope(self) -> None:
        session = AgentSession(roadmap_id='roadmap-legacy')
        self.assertEqual(session.scope.kind, 'roadmap')
        self.assertEqual(session.scope.roadmap_id, 'roadmap-legacy')
        self.assertEqual(session.roadmap_id, 'roadmap-legacy')
        self.assertEqual(session.focus_roadmap_id, 'roadmap-legacy')
        self.assertIsNone(session.owner_key)

    def test_scope_only_mirrors_roadmap_id(self) -> None:
        session = AgentSession(scope=_roadmap_scope('r-9'))
        self.assertEqual(session.roadmap_id, 'r-9')

    def test_workspace_session_has_no_roadmap_id(self) -> None:
        session = AgentSession(scope=_workspace_scope('w-1'), owner_key='user-1')
        self.assertIsNone(session.roadmap_id)
        self.assertIsNone(session.focus_roadmap_id)
        self.assertEqual(session.owner_key, 'user-1')

    def test_scope_wins_over_a_disagreeing_roadmap_id(self) -> None:
        session = AgentSession(scope=_workspace_scope('w-1'), roadmap_id='stale')
        self.assertIsNone(session.roadmap_id)
        session = AgentSession(scope=_roadmap_scope('r-new'), roadmap_id='r-old')
        self.assertEqual(session.roadmap_id, 'r-new')

    def test_session_without_scope_or_roadmap_id_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            AgentSession()
        with self.assertRaises(ValidationError):
            AgentSession(roadmap_id='')

    def test_pre_scope_redis_document_loads(self) -> None:
        # A document serialized before scopes existed: no `scope`, singular
        # caches, the three dead pending models, a retired field.
        legacy_doc = {
            'session_id': 'sess-legacy',
            'roadmap_id': 'roadmap-old',
            'base_revision': 3,
            'revision_token': 'tok',
            'operations': [],
            'staged_operations_version': 2,
            'version': 7,
            'artifacts': [],
            'messages': [{'role': 'user', 'content': 'hi'}],
            'metadata': {
                'pending_edit_context': None,
                'pending_context_resolution': None,
                'roadmap_overview_summary': 'Roadmap: ...',
                'roadmap_handle_map': {'E1': {'id': 'x', 'type': 'epic', 'title': 'T'}},
                'unknown_future_field': {'kept': True},
            },
        }
        session = AgentSession.model_validate_json(json.dumps(legacy_doc))
        self.assertEqual(session.scope.key, 'roadmap:roadmap-old')
        self.assertEqual(session.roadmap_id, 'roadmap-old')
        self.assertEqual(session.version, 7)
        self.assertEqual(session.metadata.roadmap_overview_summary, 'Roadmap: ...')
        self.assertEqual(session.metadata.roadmaps, {})
        self.assertEqual(session.metadata.next_handle_prefix_index, 1)
        self.assertIsNone(session.metadata.run)
        self.assertEqual(session.metadata.run_history, [])
        self.assertIsNone(session.metadata.workspace_context)

    def test_json_round_trip_keeps_scope_and_owner(self) -> None:
        session = AgentSession(scope=_workspace_scope('w-2'), owner_key='Guest g-1')
        session.metadata.roadmaps['r-1'] = RoadmapContext(
            roadmap_id='r-1', title='Alpha', handle_prefix='R2'
        )
        session.metadata.run = RunState(trace_id='trace-1', scope=session.scope)
        restored = AgentSession.model_validate_json(session.model_dump_json())
        self.assertEqual(restored.scope, session.scope)
        self.assertEqual(restored.owner_key, 'Guest g-1')
        self.assertEqual(restored.metadata.roadmaps['r-1'].handle_prefix, 'R2')
        self.assertFalse(restored.metadata.roadmaps['r-1'].is_focus)
        assert restored.metadata.run is not None
        self.assertEqual(restored.metadata.run.run_id, session.metadata.run.run_id)


class MetadataAdditiveFieldTests(unittest.TestCase):
    def test_roadmap_context_defaults(self) -> None:
        context = RoadmapContext(roadmap_id='r-1')
        self.assertTrue(context.is_focus)
        self.assertEqual(context.handle_map, {})
        self.assertIsNone(context.revision_token)
        self.assertIsNotNone(context.loaded_at)

    def test_actor_context_roadmap_role_is_optional(self) -> None:
        actor = ActorContext(actor_id='u-1')
        self.assertIsNone(actor.roadmap_role)
        self.assertEqual(ActorContext(actor_id='u-1', roadmap_role='editor').roadmap_role, 'editor')

    def test_recent_target_and_changes_gain_roadmap_id(self) -> None:
        target = RecentResolvedTarget(node_id='n', node_type='epic')
        self.assertIsNone(target.roadmap_id)
        change = AppliedChange(node_id='n', node_type='epic', change_type='NODE_ADDED', roadmap_id='r-1')
        self.assertEqual(change.roadmap_id, 'r-1')
        group = ChangeGroup(change_id='c-1', roadmap_id='r-1', run_id='run-1', changes=[change])
        self.assertEqual((group.roadmap_id, group.run_id), ('r-1', 'run-1'))
        self.assertIsNone(ChangeGroup().run_id)

    def test_pending_plan_defaults_and_targets(self) -> None:
        plan = PendingPlan(source_user_message='plan it')
        self.assertEqual(plan.kind, 'plan')
        self.assertEqual(plan.targets, [])
        self.assertIsNone(plan.run_id)

        edits = PendingPlan(
            source_user_message='delete the old epic',
            kind='edits',
            run_id='run-1',
            targets=[
                PlanTarget(
                    roadmap_id='r-1',
                    roadmap_title='Alpha',
                    operations=[_op('delete_node', node_id='e-1')],
                    summary_lines=["Delete epic 'Old'"],
                    operations_count=1,
                    contains_delete=True,
                )
            ],
        )
        self.assertEqual(edits.kind, 'edits')
        self.assertFalse(edits.targets[0].committed)
        self.assertEqual(edits.targets[0].operations_count, 1)
        # Legacy card mirror stays available (empty for a delete-only edits plan).
        self.assertEqual(edits.proposed_hierarchy, [])

        with self.assertRaises(ValidationError):
            PendingPlan(source_user_message='x', kind='wide')

    def test_plan_target_hierarchy_for_plan_kind(self) -> None:
        target = PlanTarget(roadmap_id='r-1', proposed_hierarchy=[ProposedEpic(title='Q3')])
        self.assertIsNone(target.operations)
        self.assertEqual(target.proposed_hierarchy[0].title, 'Q3')

    def test_metadata_extra_allow_still_holds(self) -> None:
        metadata = SessionMetadata.model_validate({'future_field': 1, 'next_handle_prefix_index': 4})
        self.assertEqual(metadata.next_handle_prefix_index, 4)
        self.assertEqual(metadata.model_dump()['future_field'], 1)


class CreateSessionContractTests(unittest.TestCase):
    def test_scope_body(self) -> None:
        request = CreateSessionRequest(scope={'kind': 'workspace', 'workspace_id': 'w-1'})
        self.assertEqual(request.resolved_scope.key, 'workspace:w-1')
        self.assertIsNone(request.roadmap_id)

    def test_legacy_roadmap_id_body_derives_roadmap_scope(self) -> None:
        request = CreateSessionRequest(roadmap_id='roadmap-1', metadata={'brain_version': 'v2'})
        self.assertIsNone(request.scope)
        self.assertEqual(request.resolved_scope, _roadmap_scope('roadmap-1'))

    def test_neither_scope_nor_roadmap_id_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            CreateSessionRequest()
        with self.assertRaises(ValidationError):
            CreateSessionRequest(roadmap_id='  ')

    def test_both_present_must_agree(self) -> None:
        agreeing = CreateSessionRequest(scope=_roadmap_scope('r-1'), roadmap_id='r-1')
        self.assertEqual(agreeing.resolved_scope.roadmap_id, 'r-1')
        with self.assertRaises(ValidationError):
            CreateSessionRequest(scope=_roadmap_scope('r-1'), roadmap_id='r-2')
        with self.assertRaises(ValidationError):
            CreateSessionRequest(scope=_workspace_scope('w-1'), roadmap_id='r-1')

    def test_response_derives_scope_from_legacy_roadmap_id(self) -> None:
        session = AgentSession(roadmap_id='r-1')
        # Today's route builds the response without `scope`.
        response = CreateSessionResponse(
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            created_at=session.created_at,
        )
        self.assertEqual(response.scope, _roadmap_scope('r-1'))
        self.assertEqual(response.roadmap_id, 'r-1')
        payload = response.model_dump(mode='json')
        self.assertEqual(payload['scope'], {'kind': 'roadmap', 'roadmap_id': 'r-1', 'workspace_id': None})

    def test_response_workspace_scope_mirrors_null_roadmap_id(self) -> None:
        session = AgentSession(scope=_workspace_scope('w-1'))
        response = CreateSessionResponse(
            session_id=session.session_id,
            scope=session.scope,
            created_at=session.created_at,
        )
        self.assertIsNone(response.roadmap_id)
        self.assertIn('roadmap_id', response.model_dump())


class MessageContractTests(unittest.TestCase):
    def test_message_request_defaults_are_legacy_sync(self) -> None:
        request = MessageRequest(message='hi')
        self.assertEqual(request.refs, [])
        self.assertEqual(request.capabilities, [])
        self.assertFalse(request.supports_continue)

    def test_message_request_with_refs_and_continue(self) -> None:
        request = MessageRequest(
            message='in @Alpha add an epic',
            refs=[{'kind': 'roadmap', 'id': _UUID.upper(), 'label': 'Alpha'}],
            capabilities=['continue'],
        )
        self.assertTrue(request.supports_continue)
        self.assertEqual(request.refs[0].id, _UUID)
        self.assertEqual(request.refs[0].dedupe_key, ('roadmap', _UUID))

    def test_message_request_caps_refs_at_twenty(self) -> None:
        refs = [{'kind': 'task', 'id': f'task-{index}'} for index in range(21)]
        with self.assertRaises(ValidationError):
            MessageRequest(message='x', refs=refs)
        self.assertEqual(len(MessageRequest(message='x', refs=refs[:20]).refs), 20)

    def test_message_request_rejects_unknown_capability(self) -> None:
        with self.assertRaises(ValidationError):
            MessageRequest(message='x', capabilities=['stream'])

    def test_context_ref_validation(self) -> None:
        with self.assertRaises(ValidationError):
            ContextRef(kind='epic', id='   ')
        with self.assertRaises(ValidationError):
            ContextRef(kind='epic', id='x' * 129)
        with self.assertRaises(ValidationError):
            ContextRef(kind='sprint', id='abc')
        ref = ContextRef(kind='feature', id='  feature-1 ', label='  ' + 'L' * 200)
        self.assertEqual(ref.id, 'feature-1')
        assert ref.label is not None
        self.assertEqual(len(ref.label), 120)
        self.assertIsNone(ContextRef(kind='feature', id='f', label='   ').label)

    def test_message_response_is_a_strict_superset(self) -> None:
        response = MessageResponse(
            session_id='s',
            assistant_message='ok',
            parse_mode='chat',
            intent_type='general_question',
            response_mode='chat',
            operations=[],
            staged_operations_version=0,
            staged_operations_count=0,
        )
        self.assertEqual(response.commits, [])
        self.assertIsNone(response.run)
        self.assertIn('commits', response.model_dump())
        self.assertIn('run', response.model_dump())

    def test_message_response_carries_run_and_commits(self) -> None:
        scope = _roadmap_scope('r-1')
        run = RunState(trace_id='t-1', scope=scope, status='done', next='done', phase='verify')
        view = RunView(
            run_id=run.run_id,
            trace_id='t-1',
            status='done',
            phase='verify',
            next='done',
            scope=scope,
            created_at=run.created_at,
            updated_at=run.updated_at,
        )
        response = MessageResponse(
            session_id='s',
            assistant_message='done',
            parse_mode='run_report',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            operations=[],
            staged_operations_version=1,
            staged_operations_count=2,
            commits=[RunCommitView(batch_id='b', roadmap_id='r-1', status='committed', operations=[_op()])],
            run=view,
        )
        assert response.run is not None
        self.assertEqual(response.run.next, 'done')
        self.assertEqual(len(response.commits[0].operations or []), 1)

    def test_trace_events_response_additive_fields(self) -> None:
        legacy = TraceEventsResponse(trace_id='t', next_seq=0)
        self.assertIsNone(legacy.run_id)
        self.assertIsNone(legacy.phase)
        widened = TraceEventsResponse(trace_id='t', next_seq=3, run_id='run-1', phase='execute')
        self.assertEqual((widened.run_id, widened.phase), ('run-1', 'execute'))


class RunContractTests(unittest.TestCase):
    def test_run_state_defaults(self) -> None:
        run = RunState(trace_id='t', scope=_workspace_scope('w-1'))
        self.assertEqual(len(run.run_id), 36)
        self.assertEqual((run.status, run.phase, run.next), ('running', 'investigate', 'continue'))
        self.assertFalse(run.is_terminal)
        self.assertEqual(run.step, 0)
        self.assertEqual(run.execute_cursor, 0)
        self.assertFalse(run.batches_truncated)
        self.assertIsNone(run.checkpoint)
        self.assertIsNone(run.error)
        for status in ('done', 'failed', 'cancelled'):
            self.assertTrue(RunState(trace_id='t', scope=run.scope, status=status).is_terminal)

    def test_run_state_rejects_unknown_literals(self) -> None:
        scope = _roadmap_scope()
        with self.assertRaises(ValidationError):
            RunState(trace_id='t', scope=scope, phase='plan')
        with self.assertRaises(ValidationError):
            RunState(trace_id='t', scope=scope, status='paused')
        with self.assertRaises(ValidationError):
            RunState(trace_id='t', scope=scope, next='retry')
        with self.assertRaises(ValidationError):
            RunState(trace_id='t', scope=scope, checkpoint='approval')

    def test_run_batch_fills_hash_and_delete_flag(self) -> None:
        ops = [_op(), _op('delete_node', node_id='e-1')]
        batch = RunBatch(roadmap_id='r-1', operations=ops)
        self.assertEqual(batch.operations_count, 2)
        self.assertTrue(batch.contains_delete)
        self.assertEqual(batch.operations_hash, compute_operations_hash(ops))
        self.assertEqual(batch.source, 'stage_edits')
        self.assertFalse(batch.needs_materialize)

        empty = RunBatch(roadmap_id='r-1', source='proposal', needs_materialize=True)
        self.assertIsNone(empty.operations_hash)
        self.assertFalse(empty.contains_delete)

    def test_run_batch_refresh_hash_after_mutation(self) -> None:
        batch = RunBatch(roadmap_id='r-1', operations=[_op()])
        before = batch.operations_hash
        batch.operations.append(_op('delete_node', node_id='e-2'))
        self.assertEqual(batch.operations_hash, before)
        after = batch.refresh_operations_hash()
        self.assertNotEqual(after, before)
        self.assertTrue(batch.contains_delete)

    def test_operations_hash_is_stable_and_order_sensitive(self) -> None:
        first = [_op(title='A'), _op(title='B')]
        self.assertEqual(compute_operations_hash(first), compute_operations_hash(list(first)))
        self.assertEqual(
            compute_operations_hash(first),
            compute_operations_hash([op.model_dump(mode='json', exclude_none=True) for op in first]),
        )
        self.assertNotEqual(compute_operations_hash(first), compute_operations_hash(list(reversed(first))))

    def test_operations_contain_delete_handles_dicts_and_models(self) -> None:
        self.assertTrue(operations_contain_delete([{'op': 'delete_node'}]))
        self.assertFalse(operations_contain_delete([{'op': 'add_epic'}, _op()]))
        self.assertFalse(operations_contain_delete([]))

    def test_run_commit_has_hash_but_no_operations(self) -> None:
        commit = RunCommit(batch_id='b', roadmap_id='r-1', operations_hash='abc')
        self.assertEqual(commit.status, 'pending')
        self.assertEqual(commit.attempts, 0)
        self.assertEqual(len(commit.idempotency_key), 36)
        self.assertIsNone(commit.history_recorded)
        self.assertNotIn('operations', RunCommit.model_fields)
        self.assertNotIn('committed_operations', RunCommit.model_fields)

    def test_commit_view_attaches_operations_only_when_asked(self) -> None:
        batch = RunBatch(roadmap_id='r-1', roadmap_title='Alpha', operations=[_op()])
        commit = RunCommit(
            batch_id=batch.batch_id,
            roadmap_id='r-1',
            status='committed',
            change_id='c-1',
            impacted_items=[CommitImpactedItem(node_id='n', node_type='epic', impact='created')],
            impacted_summary={'created': 1},
            history_recorded=True,
        )
        without = RunCommitView.from_commit(commit, batch)
        self.assertIsNone(without.operations)
        self.assertEqual(without.operations_count, 1)
        self.assertEqual(without.roadmap_title, 'Alpha')
        self.assertTrue(without.history_recorded)
        with_ops = RunCommitView.from_commit(commit, batch, project_id='p-1', include_operations=True)
        self.assertEqual(len(with_ops.operations or []), 1)
        self.assertEqual(with_ops.project_id, 'p-1')
        orphan = RunCommitView.from_commit(commit)
        self.assertEqual(orphan.operations_count, 0)
        self.assertIsNone(orphan.roadmap_title)

    def test_batch_view_projection(self) -> None:
        batch = RunBatch(roadmap_id='r-1', operations=[_op('delete_node', node_id='x')], source='revert')
        view = RunBatchView.from_batch(batch)
        self.assertEqual(view.operations_count, 1)
        self.assertTrue(view.contains_delete)
        self.assertEqual(view.source, 'revert')
        self.assertNotIn('operations', RunBatchView.model_fields)

    def test_run_view_never_carries_operations_field_on_batches(self) -> None:
        self.assertNotIn('batches_truncated', RunView.model_fields)
        self.assertNotIn('execute_cursor', RunView.model_fields)
        self.assertNotIn('loop_transcript_key', RunView.model_fields)

    def test_run_summary_from_state(self) -> None:
        scope = _roadmap_scope('r-1')
        run = RunState(trace_id='t-2', scope=scope, status='failed', phase='execute')
        run.segments = []
        run.commits = [
            RunCommit(batch_id='a', roadmap_id='r-1', status='committed'),
            RunCommit(batch_id='b', roadmap_id='r-2', status='failed'),
            RunCommit(batch_id='c', roadmap_id='r-1', status='committed'),
        ]
        run.error = RunError(code='COMMIT_FAILED', message='boom')
        summary = RunSummary.from_state(run)
        self.assertEqual(summary.trace_ids, ['t-2'])
        self.assertEqual(summary.committed_roadmap_ids, ['r-1'])
        self.assertEqual(summary.error_code, 'COMMIT_FAILED')
        self.assertEqual(summary.status, 'failed')

    def test_verify_report_shapes(self) -> None:
        report = VerifyReport(
            status='partial',
            checks=[VerifyCheck(name='all_batches_committed', status='fail', detail='1 of 2')],
            summary='Committed Alpha; Beta failed.',
        )
        self.assertIsNone(report.follow_up_plan_id)
        with self.assertRaises(ValidationError):
            VerifyReport(status='ok')
        with self.assertRaises(ValidationError):
            VerifyCheck(name='x', status='skip')

    def test_resolved_ref_tolerates_extra_backend_fields(self) -> None:
        ref = ResolvedRef.model_validate(
            {
                'kind': 'feature',
                'id': 'f-1',
                'accessible': True,
                'title': 'Login flow',
                'roadmap_id': 'r-1',
                'parent_chain': [{'kind': 'epic', 'id': 'e-1', 'title': 'Auth', 'extra': 1}],
                'unexpected': 'ignored',
            }
        )
        self.assertTrue(ref.accessible)
        self.assertEqual(ref.parent_chain[0].title, 'Auth')
        denied = ResolvedRef(kind='task', id='t-1', error_code='NOT_FOUND')
        self.assertFalse(denied.accessible)


class RunTunablesTests(unittest.TestCase):
    def _settings(self, **overrides: object) -> Settings:
        return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]

    def test_defaults_match_the_plan(self) -> None:
        settings = self._settings()
        self.assertEqual(settings.agent_run_step_budget_seconds, 90.0)
        self.assertEqual(settings.agent_run_hard_deadline_seconds, 165.0)
        self.assertEqual(settings.agent_run_max_steps, 8)
        self.assertEqual(settings.agent_run_lock_ttl_seconds, 300)
        self.assertEqual(settings.agent_run_transcript_ttl_seconds, 900)
        self.assertEqual(settings.agent_direct_edit_max_operations, 15)
        self.assertEqual(settings.agent_direct_edit_max_operations_focus, 90)
        self.assertEqual(settings.agent_execute_max_turns, 4)
        self.assertEqual(settings.agent_execute_max_tool_calls, 10)
        self.assertEqual(settings.agent_max_loaded_roadmaps, 6)
        self.assertEqual(settings.agent_max_refs_per_message, 20)
        self.assertEqual(settings.openai_model_timeout_seconds, 90.0)
        self.assertEqual(settings.redis_trace_key_prefix, 'roadmap:ai:trace')
        self.assertEqual(settings.agent_trace_ttl_seconds, 900)
        self.assertEqual(settings.agent_trace_flush_every_events, 5)
        self.assertEqual(settings.agent_trace_flush_interval_seconds, 0.5)

    def test_clamps(self) -> None:
        settings = self._settings(
            AGENT_RUN_STEP_BUDGET_SECONDS='1',
            AGENT_RUN_HARD_DEADLINE_SECONDS='9999',
            AGENT_RUN_MAX_STEPS='0',
            AGENT_RUN_LOCK_TTL_SECONDS='5',
            AGENT_RUN_TRANSCRIPT_TTL_SECONDS='99999',
            AGENT_DIRECT_EDIT_MAX_OPERATIONS='-4',
            AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS='500',
            AGENT_EXECUTE_MAX_TURNS='99',
            AGENT_EXECUTE_MAX_TOOL_CALLS='0',
            AGENT_MAX_LOADED_ROADMAPS='0',
            AGENT_MAX_REFS_PER_MESSAGE='40',
            OPENAI_MODEL_TIMEOUT_SECONDS='1',
            REDIS_TRACE_KEY_PREFIX='  custom:trace:  ',
            AGENT_TRACE_TTL_SECONDS='1',
            AGENT_TRACE_FLUSH_EVERY_EVENTS='0',
            AGENT_TRACE_FLUSH_INTERVAL_SECONDS='0',
        )
        self.assertEqual(settings.agent_run_step_budget_seconds, 10.0)
        self.assertEqual(settings.agent_run_hard_deadline_seconds, 280.0)
        self.assertEqual(settings.agent_run_max_steps, 1)
        self.assertEqual(settings.agent_run_lock_ttl_seconds, 60)
        self.assertEqual(settings.agent_run_transcript_ttl_seconds, 14400)
        self.assertEqual(settings.agent_direct_edit_max_operations, 0)
        self.assertEqual(settings.agent_direct_edit_max_operations_focus, 200)
        self.assertEqual(settings.agent_execute_max_turns, 16)
        self.assertEqual(settings.agent_execute_max_tool_calls, 1)
        self.assertEqual(settings.agent_max_loaded_roadmaps, 1)
        self.assertEqual(settings.agent_max_refs_per_message, 25)
        self.assertEqual(settings.openai_model_timeout_seconds, 5.0)
        self.assertEqual(settings.redis_trace_key_prefix, 'custom:trace')
        self.assertEqual(settings.agent_trace_ttl_seconds, 60)
        self.assertEqual(settings.agent_trace_flush_every_events, 1)
        self.assertEqual(settings.agent_trace_flush_interval_seconds, 0.05)

    def test_hard_deadline_never_below_step_budget(self) -> None:
        settings = self._settings(
            AGENT_RUN_STEP_BUDGET_SECONDS='120',
            AGENT_RUN_HARD_DEADLINE_SECONDS='60',
        )
        self.assertEqual(settings.agent_run_hard_deadline_seconds, 120.0)

    def test_batch_reserve_derives_from_timeouts(self) -> None:
        settings = self._settings(OPENAI_MODEL_TIMEOUT_SECONDS='90', NEST_TIMEOUT_SECONDS='20')
        self.assertEqual(settings.agent_run_batch_reserve_seconds, 150.0)

    def test_blank_trace_prefix_falls_back(self) -> None:
        self.assertEqual(self._settings(REDIS_TRACE_KEY_PREFIX='  ').redis_trace_key_prefix, 'roadmap:ai:trace')


if __name__ == '__main__':
    unittest.main()
