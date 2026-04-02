import logging
import unittest
from datetime import datetime
from types import SimpleNamespace
import re
import time
import asyncio

from fastapi import HTTPException

from app.api.routes import sessions as sessions_routes
from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    CreateSessionRequest,
    PendingContextResolution,
    PendingDisambiguation,
    ResolverCandidate,
    SessionMetadata,
)
from app.core.llm.client import PlanningResult
from app.core.llm.client import LLMPlanner
from app.core.orchestration.agent_service import AgentService, MessagePlanningOutcome
from app.core.session_store import SessionStoreUnavailableError


class _FakeNestClient:
    def __init__(self, response: dict) -> None:
        self._response = response
        self.actor_calls = 0

    def context_search(self, **_kwargs):  # sync by design for this unit test
        return self._response

    def context_actor(self, **_kwargs):  # sync by design for this unit test
        self.actor_calls += 1
        return {
            'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
            'display_name': 'Alice',
            'roadmap_role': 'editor',
            'locale': None,
            'timezone': None,
        }


class AgentSafetyTests(unittest.TestCase):
    def _service(self, search_response: dict) -> AgentService:
        service = object.__new__(AgentService)
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._nest_client = _FakeNestClient(search_response)
        service._run_async_call = lambda value: value
        return service

    def _planning(self) -> PlanningResult:
        return PlanningResult(
            assistant_message='fallback',
            operations=[],
            parse_mode='rule_based_edit',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='missing_tool_call',
            tokens_input=None,
            tokens_output=None,
            tokens_total=None,
        )

    def _session_with_pending(self) -> AgentSession:
        return AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_disambiguation=PendingDisambiguation(
                    kind='rename_node',
                    label='Legacy Epic',
                    node_type='epic',
                    new_title='Legacy Epic Renamed',
                    candidates=[
                        ResolverCandidate(
                            id='old-node-id',
                            type='epic',
                            title='Legacy Epic',
                        )
                    ],
                )
            ),
        )

    def test_new_rename_intent_has_priority_over_pending_selection(self) -> None:
        service = self._service(
            {
                'matches': [
                    {
                        'id': 'new-node-id',
                        'type': 'epic',
                        'title': 'Platform Foundation',
                    }
                ]
            }
        )
        session = self._session_with_pending()

        result = service._apply_deterministic_resolution(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-1',
        )

        self.assertEqual(result.parse_mode, 'deterministic_resolver_rename')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].node_id, 'new-node-id')
        self.assertEqual(result.operations[0].patch, {'title': 'Platform Foundation1'})
        self.assertIsNone(session.metadata.pending_disambiguation)

    def test_strict_selection_consumes_pending_only(self) -> None:
        service = self._service({'matches': []})
        session = self._session_with_pending()

        result = service._apply_deterministic_resolution(
            session=session,
            user_message='option 1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-2',
        )

        self.assertEqual(result.parse_mode, 'deterministic_disambiguation_selected')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].node_id, 'old-node-id')
        self.assertEqual(result.operations[0].patch, {'title': 'Legacy Epic Renamed'})
        self.assertIsNone(session.metadata.pending_disambiguation)

    def test_backend_close_scores_keep_ambiguity(self) -> None:
        service = self._service(
            {
                'matches': [
                    {'id': 'n1', 'type': 'epic', 'title': 'Platform Foundation', 'score': 1.0},
                    {'id': 'n2', 'type': 'epic', 'title': 'Platform Foundation v2', 'score': 0.93},
                ]
            }
        )
        session = AgentSession(roadmap_id='roadmap-1')
        result = service._apply_deterministic_resolution(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-3',
        )
        self.assertEqual(result.parse_mode, 'deterministic_resolver_disambiguation')
        self.assertEqual(len(result.operations), 0)
        self.assertIsNotNone(session.metadata.pending_disambiguation)

    def test_ensure_actor_context_refreshes_when_authenticated(self) -> None:
        service = self._service({'matches': []})
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='stale-actor',
                    display_name='Stale',
                    roadmap_role='owner',
                    actor_context_source='backend_context_actor',
                )
            ),
        )

        service._ensure_actor_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-refresh',
        )

        self.assertIsNotNone(session.metadata.actor_context)
        assert session.metadata.actor_context is not None
        self.assertEqual(
            session.metadata.actor_context.actor_id,
            'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
        )

    def test_ensure_actor_context_clears_when_no_auth_header(self) -> None:
        service = self._service({'matches': []})
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    display_name='Alice',
                    roadmap_role='editor',
                    actor_context_source='backend_context_actor',
                )
            ),
        )

        service._ensure_actor_context(
            session=session,
            auth_header=None,
            trace_id='trace-clear',
        )

        self.assertIsNone(session.metadata.actor_context)

    def test_ensure_actor_context_keeps_previous_backend_snapshot_on_failure(self) -> None:
        service = self._service({'matches': []})

        def fail_context_actor(**_kwargs):
            raise HTTPException(status_code=503, detail='service unavailable')

        service._nest_client.context_actor = fail_context_actor  # type: ignore[attr-defined]
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    display_name='Alice',
                    roadmap_role='editor',
                    actor_context_source='backend_context_actor',
                )
            ),
        )

        service._ensure_actor_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-fail-keep',
        )

        self.assertIsNotNone(session.metadata.actor_context)
        assert session.metadata.actor_context is not None
        self.assertEqual(
            session.metadata.actor_context.actor_id,
            'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
        )

    def test_ensure_actor_context_clears_after_consecutive_failures(self) -> None:
        service = self._service({'matches': []})

        def fail_context_actor(**_kwargs):
            raise HTTPException(status_code=503, detail='service unavailable')

        service._nest_client.context_actor = fail_context_actor  # type: ignore[attr-defined]
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    display_name='Alice',
                    roadmap_role='editor',
                    actor_context_source='backend_context_actor',
                )
            ),
        )

        service._ensure_actor_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-fail-1',
        )
        self.assertIsNotNone(session.metadata.actor_context)

        service._ensure_actor_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-fail-2',
        )
        self.assertIsNone(session.metadata.actor_context)

    def test_build_session_context_serializes_datetime_fields(self) -> None:
        service = self._service({'matches': []})
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    display_name='Alice',
                    roadmap_role='editor',
                    actor_context_source='backend_context_actor',
                    fetched_at=datetime(2026, 3, 28, 19, 26, 26),
                ),
                pending_context_resolution=PendingContextResolution(
                    kind='my_tasks',
                    resolution_id='res-123',
                    label='Assigned to me',
                    created_at=datetime(2026, 3, 28, 19, 26, 27),
                ),
            ),
        )

        context = service._build_session_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-json-context',
        )

        actor_context = context['actor_context']
        pending_context = context['pending_context_resolution']
        self.assertIsInstance(actor_context, dict)
        self.assertIsInstance(pending_context, dict)
        assert isinstance(actor_context, dict)
        assert isinstance(pending_context, dict)
        self.assertIsInstance(actor_context['fetched_at'], str)
        self.assertIsInstance(pending_context['created_at'], str)

    def test_fastpath_rename_returns_single_operation(self) -> None:
        service = self._service(
            {
                'matches': [
                    {
                        'id': 'new-node-id',
                        'type': 'epic',
                        'title': 'Platform Foundation',
                    }
                ]
            }
        )
        session = AgentSession(roadmap_id='roadmap-1')
        result, bypass_reason = service._try_deterministic_edit_fastpath(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation 1',
            auth_header=None,
            trace_id='trace-fastpath-rename',
            session_context={'roadmap_id': 'roadmap-1'},
        )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertIsNone(bypass_reason)
        self.assertEqual(result.parse_mode, 'deterministic_fastpath_rename')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].node_id, 'new-node-id')
        self.assertEqual(result.route_lane, 'deterministic_edit_fastpath')

    def test_fastpath_bypasses_on_ambiguous_target(self) -> None:
        service = self._service(
            {
                'matches': [
                    {'id': 'n1', 'type': 'epic', 'title': 'Platform Foundation', 'score': 1.0},
                    {'id': 'n2', 'type': 'epic', 'title': 'Platform Foundation Core', 'score': 0.92},
                ]
            }
        )
        session = AgentSession(roadmap_id='roadmap-1')
        result, bypass_reason = service._try_deterministic_edit_fastpath(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation 1',
            auth_header=None,
            trace_id='trace-fastpath-ambiguous',
            session_context={'roadmap_id': 'roadmap-1'},
        )
        self.assertIsNone(result)
        self.assertEqual(bypass_reason, 'rename_target_ambiguous_or_not_found')

    def test_fastpath_rename_strips_leading_pronouns(self) -> None:
        service = self._service(
            {
                'matches': [
                    {
                        'id': 'new-node-id',
                        'type': 'epic',
                        'title': 'Platform Foundation',
                    }
                ]
            }
        )
        session = AgentSession(roadmap_id='roadmap-1')
        result, bypass_reason = service._try_deterministic_edit_fastpath(
            session=session,
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            auth_header=None,
            trace_id='trace-fastpath-pronoun',
            session_context={'roadmap_id': 'roadmap-1'},
        )
        self.assertIsNotNone(result)
        self.assertIsNone(bypass_reason)

    def test_fastpath_move_uses_move_node_contract(self) -> None:
        calls = {'count': 0}

        class _SequenceNestClient:
            def context_search(self, **_kwargs):
                calls['count'] += 1
                if calls['count'] == 1:
                    return {
                        'matches': [
                            {
                                'id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                                'type': 'feature',
                                'title': 'Roadmap JSON Editor',
                            }
                        ]
                    }
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'Platform Foundation',
                        }
                    ]
                }

        service = object.__new__(AgentService)
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._nest_client = _SequenceNestClient()
        service._run_async_call = lambda value: value
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        result, bypass_reason = service._try_deterministic_edit_fastpath(
            session=session,
            user_message='Move Roadmap JSON Editor feature under Platform Foundation epic',
            auth_header=None,
            trace_id='trace-fastpath-move',
            session_context={'roadmap_id': 'roadmap-1'},
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertIsNone(bypass_reason)
        self.assertEqual(result.parse_mode, 'deterministic_fastpath_move')
        self.assertEqual(len(result.operations), 1)
        operation = result.operations[0]
        self.assertEqual(operation.op.value, 'move_node')
        self.assertEqual(operation.node_id, '4848e4ec-fabf-4002-a703-714e938d6c04')
        self.assertEqual(operation.new_parent_id, 'dad5697a-8962-4f80-8bc3-8a964edd8e56')
        self.assertIsNone(operation.patch)

    def test_plan_message_bypasses_fastpath_when_search_sla_exceeded(self) -> None:
        class _SlowNestClient:
            async def context_search(self, **_kwargs):
                await asyncio.sleep(0.2)
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'Platform Foundation',
                        }
                    ]
                }

            async def context_actor(self, **_kwargs):
                return {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'locale': None,
                    'timezone': None,
                }

        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Rename epic "Platform Foundation" to "Platform Foundation 1".',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'deterministic_fastpath_search_sla_ms': 10}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _FakePlanner()
        service._nest_client = _SlowNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(roadmap_id='roadmap-1')
        started = time.perf_counter()
        outcome = service.plan_message(
            session=session,
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header='Bearer test-token',
            trace_id='trace-fastpath-sla',
        )
        elapsed_ms = (time.perf_counter() - started) * 1000

        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.fastpath_bypass_reason, 'deterministic_search_sla_exceeded')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(len(outcome.operations), 1)
        self.assertLess(elapsed_ms, 150)

    def test_plan_message_blocks_invalid_uuid_operation_before_staging(self) -> None:
        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Rename epic Platform Foundation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='not-a-uuid',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(
                    SimpleNamespace(role=role, content=content)
                )

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        service = object.__new__(AgentService)
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _FakePlanner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(roadmap_id='roadmap-1')
        outcome = service.plan_message(
            session=session,
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-invalid-op',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'deterministic_invalid_operation_blocked')
        self.assertEqual(len(session.operations), 0)
        self.assertTrue(outcome.invalid_operation_detected)
        self.assertEqual(outcome.invalid_operation_reason, 'update_node.node_id_invalid_uuid')
        self.assertEqual(outcome.invalid_operation_index, 0)


class SessionRouteSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_store_unavailable_response_is_sanitized(self) -> None:
        def _raise_store_error():
            raise SessionStoreUnavailableError('get', 'dns failure: internal-hostname')

        with self.assertRaises(HTTPException) as raised:
            await sessions_routes._run_store_call(_raise_store_error)

        exc = raised.exception
        self.assertEqual(exc.status_code, 503)
        self.assertEqual(exc.detail.get('code'), 'SERVICE_UNAVAILABLE')
        self.assertTrue(exc.detail.get('retryable'))
        self.assertNotIn('reason', exc.detail)

    async def test_create_session_sanitizes_actor_context_metadata(self) -> None:
        captured = {'session': None}

        class _FakeStore:
            def create(self, session):
                captured['session'] = session

        original_get_runtime = sessions_routes._get_agent_runtime_async
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        try:
            payload = CreateSessionRequest(
                roadmap_id='55e431e2-e416-468c-a973-94d97280e97d',
                metadata={
                    'actor_context': {
                        'actor_id': 'spoofed',
                        'roadmap_role': 'owner',
                    },
                    'other_metadata': {'keep': True},
                },
            )
            await sessions_routes.create_session(payload)
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]

        session = captured['session']
        self.assertIsNotNone(session)
        assert session is not None
        self.assertIsNone(session.metadata.actor_context)
        self.assertEqual(session.metadata.other_metadata, {'keep': True})

    async def test_artifact_preview_error_is_normalized(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.artifacts = [
            sessions_routes.RoadmapPreviewArtifact(
                roadmap_id=session.roadmap_id,
                preview_id='preview-1',
                title='Artifact',
                summary='summary',
            )
        ]
        session.artifacts[0].artifact_id = 'artifact-1'

        async def _fake_get_preview(**_kwargs):
            raise HTTPException(
                status_code=503,
                detail={
                    'detail': {
                        'error': {
                            'code': 'UPSTREAM_TIMEOUT',
                            'message': 'Preview service timeout',
                        }
                    }
                },
            )

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_get_preview = sessions_routes._nest_client.get_preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((object(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.get_preview = _fake_get_preview  # type: ignore[assignment]
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.get_artifact_preview(
                    session_id='session-1',
                    artifact_id='artifact-1',
                    request=SimpleNamespace(headers={}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.get_preview = original_get_preview  # type: ignore[assignment]

        exc = raised.exception
        self.assertEqual(exc.status_code, 503)
        self.assertIsInstance(exc.detail, dict)
        detail = exc.detail
        self.assertEqual(detail.get('code'), 'UPSTREAM_TIMEOUT')
        self.assertEqual(detail.get('message'), 'Preview service timeout')
        self.assertIn('retryable', detail)
        self.assertEqual(detail.get('upstream_status'), 503)

    async def test_artifact_preview_self_heals_on_preview_not_found(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 3
        session.revision_token = 'rt-1'
        session.artifacts = [
            sessions_routes.RoadmapPreviewArtifact(
                roadmap_id=session.roadmap_id,
                preview_id='preview-stale',
                title='Artifact',
                summary='summary',
            )
        ]
        session.artifacts[0].artifact_id = 'artifact-1'

        updated_sessions: list[AgentSession] = []

        class _FakeStore:
            def update(self, updated_session):
                updated_sessions.append(updated_session)

        async def _fake_get_preview(**_kwargs):
            raise HTTPException(
                status_code=404,
                detail={'message': 'Preview not found'},
            )

        async def _fake_preview(**_kwargs):
            return {
                'preview_id': 'preview-regenerated',
                'revision_token': 'rt-2',
                'candidate_snapshot': {'id': 'roadmap-1'},
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_get_preview = sessions_routes._nest_client.get_preview
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.get_preview = _fake_get_preview  # type: ignore[assignment]
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            result = await sessions_routes.get_artifact_preview(
                session_id='session-1',
                artifact_id='artifact-1',
                request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.get_preview = original_get_preview  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        self.assertEqual(result.preview.get('preview_id'), 'preview-regenerated')
        self.assertEqual(result.artifact.preview_id, 'preview-regenerated')
        self.assertEqual(session.latest_preview_id, 'preview-regenerated')
        self.assertEqual(session.revision_token, 'rt-2')
        self.assertEqual(len(updated_sessions), 1)

    async def test_artifact_preview_self_heal_failure_returns_normalized_error(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.artifacts = [
            sessions_routes.RoadmapPreviewArtifact(
                roadmap_id=session.roadmap_id,
                preview_id='preview-stale',
                title='Artifact',
                summary='summary',
            )
        ]
        session.artifacts[0].artifact_id = 'artifact-1'

        class _FakeStore:
            def update(self, _updated_session):
                return None

        async def _fake_get_preview(**_kwargs):
            raise HTTPException(
                status_code=404,
                detail={'message': 'Preview not found'},
            )

        async def _fake_preview(**_kwargs):
            raise HTTPException(
                status_code=503,
                detail={'message': 'Preview regeneration failed'},
            )

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_get_preview = sessions_routes._nest_client.get_preview
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.get_preview = _fake_get_preview  # type: ignore[assignment]
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.get_artifact_preview(
                    session_id='session-1',
                    artifact_id='artifact-1',
                    request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.get_preview = original_get_preview  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        exc = raised.exception
        self.assertEqual(exc.status_code, 503)
        detail = exc.detail
        self.assertIsInstance(detail, dict)
        self.assertEqual(detail.get('message'), 'Preview regeneration failed')
        self.assertEqual(detail.get('upstream_status'), 503)

    async def test_send_message_auto_preview_failure_marks_preview_unavailable(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]

        class _FakeStore:
            def update(self, _session):
                return None

        class _FakeAgentService:
            def plan_message(self, _session, _message, _replace, _auth_header, _trace_id):
                return MessagePlanningOutcome(
                    session=session,
                    assistant_message='Rename epic Platform Foundation.',
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    operations=session.operations,
                    preview_available=True,
                    preview_recommended=True,
                    staged_operations_version=1,
                    staged_operations_count=1,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=10,
                    tokens_output=5,
                    tokens_total=15,
                    route_lane='llm_edit_plan',
                    fastpath_bypass_reason=None,
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

        async def _fake_preview(**_kwargs):
            raise HTTPException(
                status_code=400,
                detail={
                    'detail': {
                        'error': {
                            'code': 'INVALID_OPERATION',
                            'message': 'operations.0.node_id must be a UUID',
                        }
                    }
                },
            )

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Rename my Platform Foundation to Platform Foundation 1',
                    auto_preview=True,
                ),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        self.assertFalse(response.preview_available)
        self.assertFalse(response.preview_recommended)
        self.assertEqual(len(response.operations), 1)

    async def test_send_message_auto_preview_success_includes_inline_preview(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]

        class _FakeStore:
            def update(self, _session):
                return None

        class _FakeAgentService:
            def plan_message(self, _session, _message, _replace, _auth_header, _trace_id):
                return MessagePlanningOutcome(
                    session=session,
                    assistant_message='Rename epic Platform Foundation.',
                    parse_mode='deterministic_fastpath_rename',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    operations=session.operations,
                    preview_available=True,
                    preview_recommended=True,
                    staged_operations_version=1,
                    staged_operations_count=1,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=None,
                    tokens_output=None,
                    tokens_total=None,
                    route_lane='deterministic_edit_fastpath',
                    fastpath_bypass_reason=None,
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

        async def _fake_preview(**_kwargs):
            return {
                'preview_id': 'preview-inline-1',
                'revision_token': 'rev-2',
                'base_updated_at': '2026-04-02T15:00:00.000Z',
                'semantic_diff': {'summary': {'NODE_UPDATED': 1}, 'changes': []},
                'validation_issues': [],
                'candidate_snapshot': {'id': '55e431e2-e416-468c-a973-94d97280e97d'},
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Rename my Platform Foundation to Platform Foundation 1',
                    auto_preview=True,
                ),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        self.assertTrue(response.preview_available)
        self.assertEqual(len(response.artifacts), 1)
        inline_preview = response.artifacts[0].inline_preview
        self.assertIsInstance(inline_preview, dict)
        assert isinstance(inline_preview, dict)
        self.assertEqual(inline_preview.get('preview_id'), 'preview-inline-1')

    async def test_send_message_inline_preview_skipped_when_payload_too_large(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]
        observed_events: list[tuple[str, dict]] = []

        class _FakeStore:
            def update(self, _session):
                return None

        class _FakeAgentService:
            def plan_message(self, _session, _message, _replace, _auth_header, _trace_id):
                return MessagePlanningOutcome(
                    session=session,
                    assistant_message='Rename epic Platform Foundation.',
                    parse_mode='deterministic_fastpath_rename',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    operations=session.operations,
                    preview_available=True,
                    preview_recommended=True,
                    staged_operations_version=1,
                    staged_operations_count=1,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=None,
                    tokens_output=None,
                    tokens_total=None,
                    route_lane='deterministic_edit_fastpath',
                    fastpath_bypass_reason=None,
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

        async def _fake_preview(**_kwargs):
            return {
                'preview_id': 'preview-inline-oversized',
                'revision_token': 'rev-2',
                'base_updated_at': '2026-04-02T15:00:00.000Z',
                'semantic_diff': {'summary': {'NODE_UPDATED': 1}, 'changes': []},
                'validation_issues': [],
                'candidate_snapshot': {'id': '55e431e2-e416-468c-a973-94d97280e97d'},
            }

        def _capture_log_event(_logger, event, **kwargs):
            observed_events.append((event, kwargs))

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_preview = sessions_routes._nest_client.preview
        original_log_event = sessions_routes.log_event
        original_inline_max = sessions_routes.settings.inline_preview_max_bytes
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        sessions_routes.log_event = _capture_log_event  # type: ignore[assignment]
        sessions_routes.settings.inline_preview_max_bytes = 64
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Rename my Platform Foundation to Platform Foundation 1',
                    auto_preview=True,
                ),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]
            sessions_routes.log_event = original_log_event  # type: ignore[assignment]
            sessions_routes.settings.inline_preview_max_bytes = original_inline_max

        self.assertTrue(response.preview_available)
        self.assertEqual(len(response.artifacts), 1)
        self.assertIsNone(response.artifacts[0].inline_preview)

        message_completed_events = [
            payload
            for event_name, payload in observed_events
            if event_name == 'message_completed'
        ]
        self.assertTrue(message_completed_events)
        latest = message_completed_events[-1]
        self.assertTrue(latest.get('inline_preview_skipped_due_to_size'))
        self.assertIsInstance(latest.get('inline_preview_size_bytes'), int)

    async def test_preview_session_propagates_trace_id_to_nest_preview(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]
        observed = {'trace_id': None}

        class _FakeStore:
            def update(self, _session):
                return None

        async def _fake_preview(**kwargs):
            observed['trace_id'] = kwargs.get('trace_id')
            return {
                'preview_id': 'preview-manual-1',
                'revision_token': 'rev-2',
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            response = await sessions_routes.preview_session(
                session_id='session-1',
                payload=sessions_routes.PreviewRequest(),
                request=SimpleNamespace(headers={'X-Trace-Id': 'trace-manual-preview'}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(response['preview'].get('preview_id'), 'preview-manual-1')
        self.assertEqual(observed['trace_id'], 'trace-manual-preview')

    async def test_preview_session_generates_trace_id_when_missing_header(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        observed = {'trace_id': None}

        class _FakeStore:
            def update(self, _session):
                return None

        async def _fake_preview(**kwargs):
            observed['trace_id'] = kwargs.get('trace_id')
            return {'preview_id': 'preview-manual-2', 'revision_token': 'rev-2'}

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_preview = sessions_routes._nest_client.preview
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.preview = _fake_preview  # type: ignore[assignment]
        try:
            await sessions_routes.preview_session(
                session_id='session-1',
                payload=sessions_routes.PreviewRequest(),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.preview = original_preview  # type: ignore[assignment]

        self.assertIsNotNone(observed['trace_id'])


async def _async_runtime_result(value):
    return value


class PlannerContextSafetyTests(unittest.TestCase):
    def _planner(self) -> LLMPlanner:
        planner = object.__new__(LLMPlanner)
        planner._settings = get_settings()
        planner._logger = logging.getLogger('planner-context-safety-tests')
        planner._nest_client = SimpleNamespace()
        planner._run_async_context_call = lambda value: value
        return planner

    def test_invalid_parent_id_returns_invalid_uuid_error(self) -> None:
        planner = self._planner()
        result = planner._execute_context_tool(
            'get_children',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'parent_id': 'invalid-parent-id',
                'limit': 10,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )
        self.assertIn('error', result)
        self.assertEqual(result['error']['code'], 'INVALID_UUID')

    def test_deterministic_features_fast_path_composes_response(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'selected': {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'title': 'Platform Foundation',
                    },
                }
            if name == 'get_features':
                return {
                    'children': [
                        {'id': '1', 'type': 'feature', 'title': 'Authentication'},
                        {'id': '2', 'type': 'feature', 'title': 'Billing'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_features_answer(
            user_message='What are the features of Platform Foundation?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-fast',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Features under "Platform Foundation"', outcome.answer)
        self.assertIn('- Authentication', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_features_ambiguity_sets_pending_resolution(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'ambiguous',
                    'resolution_id': 'res-123',
                    'matches': [
                        {'id': '1', 'type': 'epic', 'title': 'Platform Foundation'},
                        {'id': '2', 'type': 'epic', 'title': 'Platform Foundation Core'},
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_features_answer(
            user_message='What are the features of the epic Platform Foundation?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-ambiguous',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Please choose one', outcome.answer)
        self.assertIsNotNone(outcome.pending_context_resolution)
        assert outcome.pending_context_resolution is not None
        self.assertEqual(outcome.pending_context_resolution.get('resolution_id'), 'res-123')
        self.assertFalse(outcome.clear_pending_context_resolution)

    def test_pending_resolution_selection_short_circuits_provider(self) -> None:
        planner = self._planner()
        observed_choice = {'value': None}

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                observed_choice['value'] = args.get('choice')
                if args.get('choice') == 1:
                    return {
                        'children': [
                            {'id': 'f1', 'type': 'feature', 'title': 'Authentication'},
                            {'id': 'f2', 'type': 'feature', 'title': 'Billing'},
                        ]
                    }
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-123',
                    'label': 'Platform Foundation',
                    'node_type': 'epic',
                    'option_choices': [1, 2],
                },
            },
            trace_id='trace-select',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertEqual(observed_choice['value'], 1)
        self.assertIn('Features under "Platform Foundation"', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_pending_selection_uses_backend_choice_mapping(self) -> None:
        planner = self._planner()
        observed_choice = {'value': None}

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                observed_choice['value'] = args.get('choice')
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-123',
                    'label': 'Platform Foundation',
                    'node_type': 'epic',
                    'option_choices': [3, 4],
                },
            },
            trace_id='trace-select-mapped',
        )
        self.assertIsNotNone(outcome)
        self.assertEqual(observed_choice['value'], 3)

    def test_deterministic_tasks_fast_path_composes_response(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                self.assertEqual(args.get('node_type'), 'feature')
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                        'title': 'Authentication System',
                    },
                }
            if name == 'get_children':
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Design auth DB schema'},
                        {'id': 't2', 'type': 'task', 'title': 'Implement login API'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_tasks_answer(
            user_message='What are the tasks for the Authentication System?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-tasks',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Tasks under "Authentication System"', outcome.answer)
        self.assertIn('- Design auth DB schema', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_pending_resolution_selection_supports_tasks_kind(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                self.assertEqual(args.get('choice'), 1)
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Design auth DB schema'},
                    ]
                }
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='option 1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'tasks_of_feature',
                    'resolution_id': 'res-task-123',
                    'label': 'Authentication System',
                    'node_type': 'feature',
                },
            },
            trace_id='trace-task-select',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Tasks under "Authentication System"', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_my_tasks_missing_actor_clears_pending_context_resolution(self) -> None:
        planner = self._planner()

        def fake_execute(_name: str, _args: dict, _ctx: dict):
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('my_tasks')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            user_message='What tasks are assigned to me?',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-old',
                    'label': 'Old label',
                    'node_type': 'epic',
                },
            },
            trace_id='trace-my-tasks-missing-actor',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_epics_fast_path_without_ids(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'title': 'Platform Foundation',
                            'status': 'in_progress',
                            'feature_count': 2,
                        },
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('epics_in_roadmap')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('This roadmap has 1 epic', outcome.answer)
        self.assertIn('Platform Foundation', outcome.answer)
        self.assertNotIn('id:', outcome.answer.lower())
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_epics_fast_path_with_ids(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'title': 'Platform Foundation',
                            'status': 'in_progress',
                            'feature_count': 2,
                        },
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('epics_in_roadmap')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=True,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics-ids',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('id: dad5697a-8962-4f80-8bc3-8a964edd8e56', outcome.answer.lower())

    def test_deterministic_epics_matcher_and_summary_failure_fallback(self) -> None:
        planner = self._planner()
        match = planner._match_deterministic_context_intent('Tell me all the epics in this roadmap')
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.parse_mode, 'deterministic_context_epics')
        self.assertEqual(label, '')

        def fake_execute(_name: str, _args: dict, _ctx: dict):
            return {'error': {'code': 'CONTEXT_TOOL_FAILED'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics-fallback',
        )
        self.assertIsNone(outcome)

    def test_global_overview_matcher_detects_compound_roadmap_query(self) -> None:
        planner = self._planner()
        match = planner._match_global_overview_intent(
            'Tell me all the epics, features and tasks of this roadmap'
        )
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.parse_mode, 'deterministic_context_overview')
        self.assertEqual(label, '')

    def test_generic_label_redirects_to_overview_without_resolver(self) -> None:
        planner = self._planner()
        called_tools: list[str] = []

        def fake_execute(name: str, _args: dict, _ctx: dict):
            called_tools.append(name)
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [],
                }
            return {'children': []}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('tasks_of_feature')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='this roadmap',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-generic-label',
        )
        self.assertIsNotNone(outcome)
        self.assertIn('get_roadmap_summary', called_tools)
        self.assertNotIn('resolve_node_reference', called_tools)

    def test_overview_call_budget_truncates_output(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e2', 'title': 'Epic B', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e3', 'title': 'Epic C', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e4', 'title': 'Epic D', 'status': 'todo', 'feature_count': 3},
                    ],
                }
            if name == 'get_features':
                return {
                    'children': [
                        {'id': f"{args['epic_id']}-f1", 'type': 'feature', 'title': 'Feature 1'},
                        {'id': f"{args['epic_id']}-f2", 'type': 'feature', 'title': 'Feature 2'},
                        {'id': f"{args['epic_id']}-f3", 'type': 'feature', 'title': 'Feature 3'},
                    ]
                }
            if name == 'get_children':
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Task 1'},
                        {'id': 't2', 'type': 'task', 'title': 'Task 2'},
                        {'id': 't3', 'type': 'task', 'title': 'Task 3'},
                        {'id': 't4', 'type': 'task', 'title': 'Task 4'},
                        {'id': 't5', 'type': 'task', 'title': 'Task 5'},
                        {'id': 't6', 'type': 'task', 'title': 'Task 6'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview-budget',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Results were truncated for performance', outcome.answer)

    def test_global_overview_query_bypasses_pending_selection(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [{'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 0}],
                }
            if name == 'get_features':
                return {'children': []}
            if name == 'get_children':
                return {'children': []}
            if name == 'get_children_from_resolution':
                return {'error': {'code': 'SHOULD_NOT_BE_CALLED'}}
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        overview_match = planner._match_global_overview_intent('I meant this overall roadmap')
        self.assertIsNotNone(overview_match)
        assert overview_match is not None
        intent, label = overview_match
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=False,
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'tasks_of_feature',
                    'resolution_id': 'res-task-123',
                    'label': 'Authentication System',
                    'node_type': 'feature',
                },
            },
            trace_id='trace-overview-pending',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_overview_tool_error_returns_none_for_provider_fallback(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [{'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 1}],
                }
            if name == 'get_features':
                return {'error': {'code': 'CONTEXT_TOOL_FAILED'}}
            return {'children': []}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview-fallback',
        )
        self.assertIsNone(outcome)


if __name__ == '__main__':
    unittest.main()
