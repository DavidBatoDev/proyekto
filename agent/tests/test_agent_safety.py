import logging
import os
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any
import re
import time
import asyncio

from fastapi import HTTPException

from app.api.routes import sessions as sessions_routes

# These tests exercise the legacy (pre-draft-graph) staging flow: they set
# up `session.operations` / `session.staged_operations_version` directly
# and assert on the same fields after `plan_message`. The production
# default and repo `.env` both enable draft-graph mode, which would
# silently redirect staged ops into `session.metadata.drafts[*]` and
# also raise `LEGACY_SESSION_UNSUPPORTED` on any pre-populated
# `session.operations`. Force the flags off here so the tests run in the
# mode they were authored for — using `os.environ[...] = ...` instead of
# `setdefault` because the test runner loads the repo `.env` first and
# `setdefault` would be a no-op against values already set there.
os.environ['AGENT_HYBRID_REACT_ENABLED'] = 'false'
os.environ['AGENT_DRAFT_GRAPH_ENABLED'] = 'false'

from app.core.config import get_settings, reload_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    CreateSessionRequest,
    DraftNode,
    PendingEditContext,
    PendingEditResolvedReferences,
    PendingContextResolution,
    RecentResolvedTarget,
    SessionMetadata,
)
from app.core.llm.client import PlanningResult
from app.core.llm.client import LLMPlanner
from app.core.llm.planning import planner_operation_flow
from app.core.llm.providers import ProviderAdapterError
from app.core.llm.providers.orchestrator import ProviderCallOutcome
from app.core.orchestration.agent_service import AgentService, MessagePlanningOutcome
from app.core.session_store import SessionStoreUnavailableError
from app.core.tools.registry import parse_plan_tool_args

reload_settings()


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
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._nest_client = _FakeNestClient(search_response)
        service._run_async_call = lambda value: value
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        return service

    def test_plan_message_routes_edit_turn_to_planner_lane(self) -> None:
        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared operations.',
                    operations=[RoadmapOperation(op='add_epic', data={'title': 'AI Module'})],
                    parse_mode='openai_edit_schema',
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
            user_message='Create epic AI Module',
            replace=False,
            auth_header=None,
            trace_id='trace-planner-lane',
        )

        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_edit_schema')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].op.value, 'add_epic')

    def test_plan_message_mixed_intent_passes_full_message_to_single_planner_call(self) -> None:
        class _MixedPlanner:
            def __init__(self) -> None:
                self.plan_inputs: list[str] = []

            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_inputs.append(user_message)
                lowered = user_message.lower()
                if lowered.startswith('tell me how many total tasks remain'):
                    return PlanningResult(
                        assistant_message='There will be 14 total tasks remaining.',
                        operations=[],
                        parse_mode='openai_context_answer',
                        intent_type='roadmap_query',
                        response_mode='chat',
                        preview_recommended=False,
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )
                return PlanningResult(
                    assistant_message='Prepared delete operations.',
                    operations=[
                        RoadmapOperation(
                            op='delete_node',
                            node_id='1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
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

        class _MixedNestClient:
            def __init__(self) -> None:
                self.preview_calls: list[dict[str, Any]] = []
                self.discard_calls: list[dict[str, Any]] = []
                self.actor_calls = 0

            def context_actor(self, **kwargs):
                self.actor_calls += 1
                return {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'locale': None,
                    'timezone': None,
                }

            def preview(self, **kwargs):
                self.preview_calls.append(kwargs)
                return {'preview_id': '123e4567-e89b-12d3-a456-426614174000'}

            def discard_preview(self, **kwargs):
                self.discard_calls.append(kwargs)
                return {'ok': True}

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        planner = _MixedPlanner()
        nest_client = _MixedNestClient()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = nest_client
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value
        session = AgentSession(
            roadmap_id='roadmap-1',
            base_revision=3,
            revision_token='rev-3',
        )

        outcome = service.plan_message(
            session=session,
            user_message=(
                'Delete top 2 todo tasks under API Security feature and '
                'tell me how many total tasks remain in this roadmap'
            ),
            replace=False,
            auth_header='Bearer token',
            trace_id='trace-mixed-query-followup',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertIn('Prepared delete operations.', outcome.assistant_message)
        self.assertNotIn('Draft-view answer after staging these edits:', outcome.assistant_message)
        self.assertNotIn('There will be 14 total tasks remaining.', outcome.assistant_message)
        self.assertEqual(len(planner.plan_inputs), 1)
        self.assertEqual(
            planner.plan_inputs[0],
            (
                'Delete top 2 todo tasks under API Security feature and '
                'tell me how many total tasks remain in this roadmap'
            ),
        )
        self.assertEqual(len(nest_client.preview_calls), 0)
        self.assertEqual(len(nest_client.discard_calls), 0)
        self.assertTrue(outcome.actor_fetch_attempted)
        self.assertEqual(nest_client.actor_calls, 1)

    def test_plan_message_mixed_intent_what_would_change_uses_planner_message_unchanged(self) -> None:
        class _MixedPlanner:
            def __init__(self) -> None:
                self.plan_inputs: list[str] = []

            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_inputs.append(user_message)
                return PlanningResult(
                    assistant_message='Prepared status updates.',
                    operations=[
                        RoadmapOperation(
                            op='mark_status',
                            node_type='task',
                            node_id='decf459b-c0d2-46b0-89ad-2c224d247c0b',
                            status='in_review',
                        ),
                        RoadmapOperation(
                            op='mark_status',
                            node_type='task',
                            node_id='5bc7047c-0b9e-4b07-bd86-b7b3145d3151',
                            status='in_review',
                        ),
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

        planner = _MixedPlanner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message=(
                'Mark all tasks in the Authentication System as in review and '
                'tell me what would change'
            ),
            replace=False,
            auth_header=None,
            trace_id='trace-mixed-query-deterministic-what-would-change',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(len(planner.plan_inputs), 1)
        self.assertIn('Prepared status updates.', outcome.assistant_message)
        self.assertNotIn('Draft-view answer after staging these edits:', outcome.assistant_message)
        self.assertNotIn('Options:', outcome.assistant_message)

    def test_plan_message_mixed_actor_query_fetches_actor_context(self) -> None:
        class _MixedPlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                lowered = user_message.lower()
                if lowered.startswith('tell me all the tasks'):
                    return PlanningResult(
                        assistant_message='Tasks assigned to Alice (all):\n- Implement login API',
                        operations=[],
                        parse_mode='context_my_tasks',
                        intent_type='roadmap_query',
                        response_mode='chat',
                        preview_recommended=False,
                        provider_used='rule_based',
                        fallback_used=False,
                        provider_error_code=None,
                    )
                return PlanningResult(
                    assistant_message='Prepared delete operations.',
                    operations=[
                        RoadmapOperation(
                            op='delete_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
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

        class _MixedNestClient:
            def __init__(self) -> None:
                self.actor_calls = 0
                self.preview_calls = 0

            def context_actor(self, **kwargs):
                self.actor_calls += 1
                return {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'locale': None,
                    'timezone': None,
                }

            def preview(self, **kwargs):
                self.preview_calls += 1
                return {'preview_id': '123e4567-e89b-12d3-a456-426614174000'}

            def discard_preview(self, **kwargs):
                return {'ok': True}

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _MixedPlanner()
        mixed_client = _MixedNestClient()
        service._nest_client = mixed_client
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Remove the Platform Foundation and tell me all the tasks that are assigned to me',
            replace=False,
            auth_header='Bearer token',
            trace_id='trace-mixed-actor-query',
        )

        self.assertTrue(outcome.actor_fetch_attempted)
        self.assertIsNone(outcome.actor_fetch_skipped_reason)
        self.assertEqual(mixed_client.actor_calls, 1)
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(mixed_client.preview_calls, 0)

    def test_detect_edit_continuation_trigger_accepts_common_phrase_variants(self) -> None:
        service = self._service({'matches': []})

        confirm_cases = [
            'Okay Confirm',
            'OKay proceed',
            'yes, proceed',
            'yes apply',
            'go ahead please',
            'confirm this',
            'proceed with this',
            'yes please proceed',
            'ok go ahead with it',
            'A',
            'No need',
        ]
        cancel_cases = [
            'cancel this',
            'stop it',
            'never mind this',
            'abort now',
        ]
        delegate_cases = [
            'You decide',
            'your call',
            'pick best one for me',
            'up to you please',
        ]

        for message in confirm_cases:
            self.assertEqual(
                service._detect_edit_continuation_trigger(message),
                'confirm',
                msg=f'Expected confirm trigger for: {message}',
            )

        for message in cancel_cases:
            self.assertEqual(
                service._detect_edit_continuation_trigger(message),
                'cancel',
                msg=f'Expected cancel trigger for: {message}',
            )
        for message in delegate_cases:
            self.assertEqual(
                service._detect_edit_continuation_trigger(message),
                'delegate',
                msg=f'Expected delegate trigger for: {message}',
            )

    def test_plan_message_short_option_a_with_pending_context_forces_edit_continuation(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.preview_calls = 0
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                self.preview_calls += 1
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Prepared add-task operations.',
                    operations=[
                        RoadmapOperation(
                            op='add_task',
                            parent_id='8b691fa2-c868-4562-be55-ae77f3208cac',
                            data={'title': 'Design ER diagram'},
                        ),
                        RoadmapOperation(
                            op='add_task',
                            parent_id='8b691fa2-c868-4562-be55-ae77f3208cac',
                            data={'title': 'Create migrations and seed data'},
                        ),
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

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='roadmap_edit_clarifier',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Add two more task to the Database Schema Setup',
                    default_title=None,
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='A',
            replace=False,
            auth_header=None,
            trace_id='trace-option-a-confirm',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'confirm')
        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(planner.preview_calls, 0)
        self.assertEqual(planner.plan_calls, 1)
        self.assertEqual(len(session.operations), 2)

    def test_plan_message_confirm_with_staged_operations_bypasses_context_answer(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Confirmed. Your staged edit operations are ready to apply.',
                    operations=[],
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'title': 'App Foundation'},
                )
            ],
        )
        session.staged_operations_version = 1

        outcome = service.plan_message(
            session=session,
            user_message='OKay proceed',
            replace=False,
            auth_header=None,
            trace_id='trace-staged-confirm',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'confirm')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertFalse(outcome.edit_guard_intervened)
        self.assertFalse(outcome.llm_skipped_for_simple_edit)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.staged_operations_version, 1)
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_repeated_equivalent_operation_is_deduped(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared rename operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'App Foundation'},
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'title': 'App Foundation'},
                )
            ],
        )
        session.staged_operations_version = 2

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to App Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-dedupe-rename',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(outcome.operations), 0)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.staged_operations_version, 2)

    def test_plan_message_reordered_tags_operation_is_deduped(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared tag update.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'tags': ['beta', 'alpha']},
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'tags': ['alpha', 'beta']},
                )
            ],
        )
        session.staged_operations_version = 2

        outcome = service.plan_message(
            session=session,
            user_message='Update tags on Platform Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-dedupe-tags',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(outcome.operations), 0)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.staged_operations_version, 2)

    def test_plan_message_create_prompt_uses_planner_not_deterministic_fastpath(self) -> None:
        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Which parent should this be under?',
                    operations=[],
                    parse_mode='openai_edit_schema_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

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
            user_message='Create AI Module here',
            replace=False,
            auth_header=None,
            trace_id='trace-create-planner',
        )

        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.operations, [])

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

    def test_run_async_call_uses_bridge_thread_when_loop_running(self) -> None:
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(update={'nest_timeout_seconds': 0.2})
        service._logger = logging.getLogger('agent-safety-tests')

        async def _payload():
            return {'ok': True}

        async def _invoke():
            return service._run_async_call(_payload())

        result = asyncio.run(_invoke())
        self.assertEqual(result, {'ok': True})

    def test_run_async_call_timeout_raises_structured_service_unavailable(self) -> None:
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(update={'nest_timeout_seconds': 0.1})
        service._logger = logging.getLogger('agent-safety-tests')

        async def _slow_payload():
            await asyncio.sleep(0.5)
            return {'ok': True}

        async def _invoke():
            with self.assertRaises(HTTPException) as raised:
                service._run_async_call(_slow_payload())
            self.assertEqual(raised.exception.status_code, 503)
            self.assertIsInstance(raised.exception.detail, dict)
            detail = raised.exception.detail
            assert isinstance(detail, dict)
            self.assertEqual(detail.get('code'), 'ASYNC_BRIDGE_UNAVAILABLE')
            self.assertTrue(bool(detail.get('retryable')))

        asyncio.run(_invoke())

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

    def test_build_session_context_includes_recent_resolved_targets(self) -> None:
        service = self._service({'matches': []})
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                recent_resolved_targets=[
                    RecentResolvedTarget(
                        node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        node_type='epic',
                        title='Platform Foundation',
                        label='Platform Foundation',
                        source='context_tool',
                        created_at=datetime.now() - timedelta(hours=1),
                    )
                ]
            ),
        )

        context = service._build_session_context(
            session=session,
            auth_header='Bearer test-token',
            trace_id='trace-recent-target-context',
        )

        recent_targets = context.get('recent_resolved_targets')
        self.assertIsInstance(recent_targets, list)
        assert isinstance(recent_targets, list)
        self.assertEqual(len(recent_targets), 1)
        self.assertEqual(
            recent_targets[0].get('node_id'),
            'dad5697a-8962-4f80-8bc3-8a964edd8e56',
        )
        self.assertEqual(recent_targets[0].get('node_type'), 'epic')
        self.assertIsInstance(recent_targets[0].get('created_at'), str)

    def test_plan_message_deictic_continuation_uses_recent_target_hint(self) -> None:
        test_case = self
        expected_parent_id = 'dad5697a-8962-4f80-8bc3-8a964edd8e56'
        planner_calls = {'count': 0}

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                raise AssertionError('Intent classification should be bypassed for forced deictic continuation')

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                test_case.assertEqual(user_message, 'Add Login feature inside that')
                assert isinstance(session_context, dict)
                test_case.assertTrue(bool(session_context.get('force_edit_continuation')))
                deictic_hint = session_context.get('deictic_parent_hint')
                test_case.assertIsInstance(deictic_hint, dict)
                assert isinstance(deictic_hint, dict)
                test_case.assertEqual(deictic_hint.get('node_id'), expected_parent_id)
                test_case.assertEqual(deictic_hint.get('node_type'), 'epic')
                return PlanningResult(
                    assistant_message='Prepared feature operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_feature',
                            parent_id=expected_parent_id,
                            data={'title': 'Login'},
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                recent_resolved_targets=[
                    RecentResolvedTarget(
                        node_id=expected_parent_id,
                        node_type='epic',
                        title='Platform Foundation',
                        label='Platform Foundation',
                        source='context_tool',
                    )
                ]
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Add Login feature inside that',
            replace=False,
            auth_header=None,
            trace_id='trace-deictic-recent-target',
        )

        self.assertEqual(planner_calls['count'], 1)
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.edit_continuation_trigger, 'correction')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].op.value, 'add_feature')
        self.assertEqual(session.operations[0].parent_id, expected_parent_id)

    def test_plan_message_deictic_ambiguity_returns_clarifier(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                raise AssertionError('Intent classification should be bypassed for forced deictic continuation')

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Which epic should I use as the parent?',
                    operations=[],
                    parse_mode='openai_edit_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code='deictic_target_ambiguous',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='deictic_target_ambiguous',
                    clarifier_options=['Use Platform Foundation', 'Use Roadmap Core', 'Cancel'],
                    needs_more_info=True,
                    stop_reason='insufficient_context',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        planner = _Planner()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                recent_resolved_targets=[
                    RecentResolvedTarget(
                        node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        node_type='epic',
                        title='Platform Foundation',
                        label='Platform Foundation',
                        source='context_tool',
                    ),
                    RecentResolvedTarget(
                        node_id='11111111-1111-1111-1111-111111111111',
                        node_type='epic',
                        title='Roadmap Core',
                        label='Roadmap Core',
                        source='context_tool',
                    ),
                ]
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Add Login feature inside that',
            replace=False,
            auth_header=None,
            trace_id='trace-deictic-ambiguous',
        )

        self.assertEqual(planner.plan_calls, 1)
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_edit_clarifier')
        self.assertEqual(outcome.edit_continuation_trigger, 'correction')
        self.assertEqual(len(outcome.operations), 0)
        self.assertEqual(len(session.operations), 0)
        self.assertIn('Which epic should I use as the parent?', outcome.assistant_message)

    def test_plan_message_deictic_ignores_expired_recent_targets(self) -> None:
        test_case = self
        stale_parent_id = '11111111-1111-1111-1111-111111111111'
        fresh_parent_id = 'dad5697a-8962-4f80-8bc3-8a964edd8e56'

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                raise AssertionError('Intent classification should be bypassed for forced deictic continuation')

            def plan(self, user_message, existing_operations, session_context=None):
                assert isinstance(session_context, dict)
                deictic_hint = session_context.get('deictic_parent_hint')
                test_case.assertIsInstance(deictic_hint, dict)
                assert isinstance(deictic_hint, dict)
                test_case.assertEqual(deictic_hint.get('node_id'), fresh_parent_id)
                return PlanningResult(
                    assistant_message='Prepared feature operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_feature',
                            parent_id=fresh_parent_id,
                            data={'title': 'Login'},
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        stale_created_at = datetime.now() - timedelta(hours=72)
        fresh_created_at = datetime.now() - timedelta(minutes=10)
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                recent_resolved_targets=[
                    RecentResolvedTarget(
                        node_id=stale_parent_id,
                        node_type='epic',
                        title='Legacy Epic',
                        label='Legacy Epic',
                        source='context_tool',
                        created_at=stale_created_at,
                    ),
                    RecentResolvedTarget(
                        node_id=fresh_parent_id,
                        node_type='epic',
                        title='Platform Foundation',
                        label='Platform Foundation',
                        source='context_tool',
                        created_at=fresh_created_at,
                    ),
                ]
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Add Login feature inside that',
            replace=False,
            auth_header=None,
            trace_id='trace-deictic-expired-target-prune',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].parent_id, fresh_parent_id)
        self.assertEqual(len(session.metadata.recent_resolved_targets), 1)
        self.assertEqual(session.metadata.recent_resolved_targets[0].node_id, fresh_parent_id)

    def test_plan_message_pending_confirm_stages_draft_operations(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Confirmed. I prepared the pending edit operations.',
                    operations=[
                        RoadmapOperation(op='add_epic', data={'title': 'AI Module'})
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

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_epic',
                    draft_operations=[
                        RoadmapOperation(op='add_epic', data={'title': 'AI Module'})
                    ],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='draft_ready',
                    source_user_message='Create AI Module',
                    default_title='AI Module',
                )
            ),
        )
        outcome = service.plan_message(
            session=session,
            user_message='Proceed',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-confirm',
        )

        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.edit_continuation_trigger, 'confirm')
        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].op.value, 'add_epic')
        self.assertIsNone(session.metadata.pending_edit_context)
        self.assertEqual(session.staged_operations_version, 1)
        self.assertFalse(outcome.edit_guard_intervened)
        self.assertFalse(outcome.llm_skipped_for_simple_edit)
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_pending_context_without_continuation_does_not_force_edit(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.preview_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                self.preview_calls += 1
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Here is your roadmap summary.',
                    operations=[],
                    parse_mode='openai_chat',
                    intent_type='question',
                    response_mode='chat',
                    preview_recommended=False,
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

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_task',
                    draft_operations=[],
                    required_fields=['parent'],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Create task under schema setup',
                    default_title='Design relational schema',
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Can you summarize the roadmap status?',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-context-non-continuation',
        )

        self.assertEqual(planner.preview_calls, 1)
        self.assertEqual(outcome.edit_continuation_trigger, 'side_query')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.route_lane, 'chat')
        self.assertEqual(outcome.parse_mode, 'openai_chat')
        self.assertIsNotNone(session.metadata.pending_edit_context)

    def test_plan_message_context_answer_edit_confirmation_sets_pending_edit_context(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_query', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message=(
                        'Do you want me to mark the "Authentication" feature '
                        'inside the "Agent core" epic as in_progress?'
                    ),
                    operations=[],
                    parse_mode='openai_context_tools',
                    intent_type='roadmap_query',
                    response_mode='chat',
                    preview_recommended=False,
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='I meant the Authentication inside Agent core epic',
            replace=False,
            auth_header=None,
            trace_id='trace-context-answer-confirm-handoff',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'openai_context_tools')
        pending_context = session.metadata.pending_edit_context
        self.assertIsNotNone(pending_context)
        assert pending_context is not None
        self.assertEqual(pending_context.intent_family, 'roadmap_edit_clarifier')
        self.assertEqual(pending_context.confirmation_mode, 'awaiting_clarification')
        self.assertEqual(
            pending_context.source_user_message,
            'I meant the Authentication inside Agent core epic',
        )

    def test_plan_message_pending_confirm_without_draft_avoids_context_answer_lane(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='There is already one task under this feature. Do you want me to add both?',
                    operations=[],
                    parse_mode='openai_context_tools',
                    intent_type='unclear',
                    response_mode='chat',
                    preview_recommended=False,
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_feature',
                    draft_operations=[],
                    required_fields=['parent'],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Create a schema setup task',
                    default_title='Design relational schema',
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Proceed',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-confirm-no-draft',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'confirm')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(
            outcome.parse_mode,
            'pending_edit_confirm_handoff',
        )
        self.assertEqual(
            outcome.provider_error_code,
            'pending_edit_confirm_requires_edit_plan',
        )
        self.assertEqual(len(session.operations), 0)
        self.assertIsNotNone(session.metadata.pending_edit_context)
        self.assertTrue(outcome.edit_guard_intervened)

    def test_plan_message_persists_hybrid_clarifier_trace_in_pending_context(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Which platform node should I target?',
                    operations=[],
                    parse_mode='openai_edit_schema_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
                    clarifier_reason='insufficient_context',
                    clarifier_options=['Provide node label', 'Provide the exact name', 'Cancel'],
                    draft_action='continue',
                    tool_plan=[
                        {
                            'tool_name': 'resolve_node_reference',
                            'args': {'label': 'Platform Foundation'},
                        }
                    ],
                    needs_more_info=True,
                    stop_reason='insufficient_context',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-loop-trace',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        pending_context = session.metadata.pending_edit_context
        self.assertIsNotNone(pending_context)
        assert pending_context is not None
        self.assertEqual(pending_context.last_planner_stop_reason, 'insufficient_context')
        self.assertTrue(bool(pending_context.last_planner_needs_more_info))
        self.assertEqual(pending_context.last_planner_draft_action, 'continue')
        self.assertEqual(len(pending_context.last_tool_plan_summary), 1)
        self.assertEqual(
            pending_context.last_tool_plan_summary[0].get('tool_name'),
            'resolve_node_reference',
        )
        self.assertIn('label', pending_context.last_tool_plan_summary[0].get('arg_keys', []))

    def test_plan_message_stop_reason_conflict_blocks_staging(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared operation but context is still ambiguous.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[
                        {
                            'tool_name': 'resolve_node_reference',
                            'args': {'label': 'Platform Foundation'},
                        }
                    ],
                    needs_more_info=False,
                    stop_reason='insufficient_context',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-stop-reason-conflict',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'planner_stop_reason_handoff')
        self.assertEqual(outcome.provider_error_code, 'planner_stop_reason_conflict')
        self.assertEqual(len(outcome.operations), 0)
        self.assertEqual(len(session.operations), 0)
        self.assertTrue(outcome.edit_guard_intervened)
        self.assertEqual(outcome.react_terminal_action, 'clarify')

    def test_plan_message_rename_shape_guard_blocks_non_rename_operations(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared an operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_epic',
                            data={'title': 'Unexpected Epic'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-rename-shape-guard',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'rename_shape_handoff')
        self.assertEqual(outcome.provider_error_code, 'rename_shape_guard_blocked')
        self.assertEqual(len(outcome.operations), 0)
        self.assertEqual(len(session.operations), 0)
        self.assertTrue(outcome.edit_guard_intervened)

    def test_plan_message_rename_shape_guard_recovers_from_resolved_tool_summary(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared an operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_epic',
                            data={'title': 'Unexpected Epic'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
                    react_tool_observation_summary=[
                        {
                            'tool_name': 'resolve_node_reference',
                            'status': 'unique',
                            'label': 'Product Management and AI Module',
                            'selected_id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        }
                    ],
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message=(
                'Also rename my Product Management and AI Module '
                'to PM Module and Artificial Intelligence Module'
            ),
            replace=False,
            auth_header=None,
            trace_id='trace-rename-shape-recovery',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.parse_mode, 'rename_shape_recovered')
        self.assertEqual(outcome.provider_error_code, None)
        self.assertEqual(len(outcome.operations), 1)
        self.assertEqual(outcome.operations[0].op.value, 'update_node')
        self.assertEqual(
            outcome.operations[0].patch,
            {'title': 'PM Module and Artificial Intelligence Module'},
        )
        self.assertTrue(outcome.edit_guard_intervened)

    def test_plan_message_guard_intervention_keeps_context_and_invalidates_retry_state(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared an operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_epic',
                            data={'title': 'Unexpected Epic'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='draft_ready',
                    source_user_message='Rename Platform Foundation to Platform Foundation 1',
                    resolver_hints={
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'Platform Foundation',
                        'rename_to_title': 'Platform Foundation 1',
                        'intent_version': 2,
                        'hint_intent_version': 2,
                        'hint_staged_operations_version': 0,
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-guard-context-invalidate',
        )

        self.assertTrue(outcome.edit_guard_intervened)
        pending_context = session.metadata.pending_edit_context
        self.assertIsNotNone(pending_context)
        assert pending_context is not None
        self.assertEqual(pending_context.draft_operations, [])
        self.assertEqual(pending_context.confirmation_mode, 'awaiting_clarification')
        self.assertEqual(pending_context.last_guard_reason, 'rename_shape_guard_blocked')
        hints = pending_context.resolver_hints or {}
        self.assertNotIn('rename_from_label', hints)
        self.assertFalse(bool(hints.get('retry_autostage_eligible')))

    def test_plan_message_react_loop_replans_until_ready_to_stage(self) -> None:
        planner_calls = {'count': 0}

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                if planner_calls['count'] == 1:
                    return PlanningResult(
                        assistant_message='Prepared operation but still unresolved.',
                        operations=[
                            RoadmapOperation(
                                op='update_node',
                                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                                patch={'title': 'Platform Foundation 1'},
                            )
                        ],
                        parse_mode='openai_edit_schema',
                        intent_type='roadmap_edit',
                        response_mode='edit_plan',
                        preview_recommended=True,
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                        draft_action='continue',
                        tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                        needs_more_info=False,
                        stop_reason='insufficient_context',
                    )
                return PlanningResult(
                    assistant_message='Prepared operation and ready to stage.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
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
            update={
                'agent_hybrid_react_enabled': True,
                'agent_edit_planner_max_attempts': 2,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-react-loop-replan',
        )

        self.assertEqual(planner_calls['count'], 2)
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.stop_reason, 'ready_to_stage')
        self.assertEqual(outcome.react_terminal_action, 'execute')
        self.assertEqual(len(outcome.operations), 1)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(outcome.phase_timings.get('react_loop_turns'), 2)
        self.assertEqual(outcome.phase_timings.get('react_loop_budget'), 2)
        self.assertEqual(outcome.phase_timings.get('react_loop_termination_reason'), 'ready_to_stage')
        self.assertEqual(outcome.react_loop_turns, 2)
        self.assertEqual(outcome.react_loop_budget, 2)
        self.assertEqual(outcome.react_loop_termination_reason, 'ready_to_stage')

    def test_plan_message_react_loop_replans_after_tool_budget_observation(self) -> None:
        planner_calls = {'count': 0}
        second_turn_context = {
            'has_observation': False,
            'provider_error_code': None,
            'resolved_node_ids': [],
        }

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                if planner_calls['count'] == 2 and isinstance(session_context, dict):
                    prior_observation = session_context.get('_react_loop_observation')
                    if isinstance(prior_observation, dict):
                        second_turn_context['has_observation'] = True
                        second_turn_context['provider_error_code'] = prior_observation.get(
                            'provider_error_code'
                        )
                        resolved_node_ids = prior_observation.get('resolved_node_ids')
                        if isinstance(resolved_node_ids, list):
                            second_turn_context['resolved_node_ids'] = resolved_node_ids

                if planner_calls['count'] == 1:
                    return PlanningResult(
                        assistant_message='Collected partial context; retrying planning with observations.',
                        operations=[],
                        parse_mode='deterministic_react_tool_budget_replan',
                        intent_type='roadmap_edit',
                        response_mode='edit_plan',
                        preview_recommended=False,
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code='max_tool_turns_exceeded',
                        draft_action='continue',
                        tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                        needs_more_info=True,
                        stop_reason='tool_budget_exhausted',
                        llm_calls_used=1,
                        react_tool_observation_summary=[
                            {
                                'tool_name': 'resolve_node_reference',
                                'selected_id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                                'status': 'unique',
                            }
                        ],
                    )

                return PlanningResult(
                    assistant_message='Prepared operation and ready to stage.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
                    llm_calls_used=1,
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
            update={
                'agent_hybrid_react_enabled': True,
                'agent_edit_planner_max_attempts': 2,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Remove 3 todo tasks in the Roadmap JSON Editor',
            replace=False,
            auth_header=None,
            trace_id='trace-react-tool-budget-replan',
        )

        self.assertEqual(planner_calls['count'], 2)
        self.assertTrue(second_turn_context['has_observation'])
        self.assertEqual(second_turn_context['provider_error_code'], 'max_tool_turns_exceeded')
        self.assertIn(
            '4848e4ec-fabf-4002-a703-714e938d6c04',
            second_turn_context['resolved_node_ids'],
        )
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.stop_reason, 'ready_to_stage')
        self.assertEqual(outcome.react_terminal_action, 'execute')
        self.assertEqual(len(outcome.operations), 1)
        self.assertEqual(outcome.phase_timings.get('react_loop_turns'), 2)
        self.assertEqual(outcome.phase_timings.get('react_loop_termination_reason'), 'ready_to_stage')

    def test_plan_message_react_loop_budget_exhaustion_sets_clarify_terminal(self) -> None:
        planner_calls = {'count': 0}

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                return PlanningResult(
                    assistant_message='Prepared operation but still unresolved.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                    needs_more_info=False,
                    stop_reason='insufficient_context',
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
            update={
                'agent_hybrid_react_enabled': True,
                'agent_edit_planner_max_attempts': 2,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-react-loop-budget-exhaustion',
        )

        self.assertEqual(planner_calls['count'], 2)
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'planner_stop_reason_handoff')
        self.assertEqual(outcome.provider_error_code, 'planner_stop_reason_conflict')
        self.assertEqual(outcome.react_terminal_action, 'clarify')
        self.assertEqual(outcome.react_loop_turns, 2)
        self.assertEqual(outcome.react_loop_budget, 2)
        self.assertEqual(outcome.react_loop_termination_reason, 'budget_exhausted')
        self.assertEqual(outcome.phase_timings.get('react_loop_termination_reason'), 'budget_exhausted')

    def test_plan_message_joint_llm_budget_caps_react_loop(self) -> None:
        planner_calls = {'count': 0}

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                return PlanningResult(
                    assistant_message='Prepared operation but still unresolved.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[{'tool_name': 'resolve_node_reference', 'args': {}}],
                    needs_more_info=False,
                    stop_reason='insufficient_context',
                    llm_calls_used=4,
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
            update={
                'agent_hybrid_react_enabled': True,
                'agent_edit_planner_max_attempts': 4,
                'agent_max_total_llm_calls_per_message': 5,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-react-joint-llm-budget',
        )

        self.assertEqual(planner_calls['count'], 2)
        self.assertEqual(outcome.phase_timings.get('llm_calls_budget'), 5)
        self.assertEqual(outcome.phase_timings.get('llm_calls_used'), 5)
        self.assertEqual(outcome.phase_timings.get('llm_calls_remaining'), 0)
        self.assertEqual(outcome.react_loop_termination_reason, 'llm_call_budget_exhausted')
        self.assertEqual(outcome.phase_timings.get('react_loop_termination_reason'), 'llm_call_budget_exhausted')

    def test_plan_message_pending_cancel_clears_context(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Okay, cancelled.',
                    operations=[],
                    parse_mode='openai_edit_schema_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='cannot_proceed',
                    clarifier_reason='user_cancelled',
                    clarifier_options=['Start a new edit'],
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_epic',
                    draft_operations=[
                        RoadmapOperation(op='add_epic', data={'title': 'AI Module'})
                    ],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='draft_ready',
                    source_user_message='Create AI Module',
                    default_title='AI Module',
                )
            ),
        )
        outcome = service.plan_message(
            session=session,
            user_message='Cancel',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-cancel',
        )

        self.assertEqual(outcome.parse_mode, 'openai_edit_schema_clarifier')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.edit_continuation_trigger, 'cancel')
        self.assertEqual(outcome.react_terminal_action, 'cancel')
        self.assertEqual(len(session.operations), 0)
        self.assertIsNone(session.metadata.pending_edit_context)

    def test_plan_message_pending_correction_replaces_stale_operations(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared corrected feature create operation.',
                    operations=[
                        RoadmapOperation(
                            op='add_feature',
                            parent_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            data={'title': 'Schema module feature'},
                        )
                    ],
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='revise',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[RoadmapOperation(op='add_epic', data={'title': 'Wrong Epic'})],
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_feature',
                    draft_operations=[],
                    required_fields=['parent'],
                    resolved_references=PendingEditResolvedReferences(
                        epic_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        epic_label='Roadmap and Project Management Module',
                    ),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Create Schema module feature here',
                    default_title='Schema module feature',
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message=(
                'I meant it should be a new feature inside '
                'Roadmap and Project Management Module'
            ),
            replace=False,
            auth_header=None,
            trace_id='trace-pending-correction',
        )

        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.edit_continuation_trigger, 'correction')
        self.assertEqual(len(session.operations), 1)
        op = session.operations[0]
        self.assertEqual(op.op.value, 'add_feature')
        self.assertEqual(op.parent_id, 'dad5697a-8962-4f80-8bc3-8a964edd8e56')
        self.assertEqual(op.data, {'title': 'Schema module feature'})
        self.assertIsNone(session.metadata.pending_edit_context)
        self.assertEqual(session.staged_operations_version, 1)

    def test_plan_message_correction_with_staged_ops_forces_edit_continuation_without_pending(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared corrected operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 2'},
                        )
                    ],
                    parse_mode='openai_tool_calling',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='revise',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='11111111-1111-1111-1111-111111111111',
                    patch={'title': 'Old Title'},
                )
            ],
        )

        outcome = service.plan_message(
            session=session,
            user_message='I meant rename it to Platform Foundation 2',
            replace=False,
            auth_header=None,
            trace_id='trace-correction-no-pending',
        )

        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.edit_continuation_trigger, 'correction')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].patch, {'title': 'Platform Foundation 2'})

    def test_plan_message_followup_without_pending_or_staged_ops_does_not_force_edit(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Can you clarify what to proceed with?',
                    operations=[],
                    parse_mode='openai_chat',
                    intent_type='unclear',
                    response_mode='chat',
                    preview_recommended=False,
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Proceed',
            replace=False,
            auth_header=None,
            trace_id='trace-proceed-no-context',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'confirm')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.route_lane, 'chat')
        self.assertEqual(len(session.operations), 0)

    def test_detect_edit_continuation_trigger_retry_tokens(self) -> None:
        service = self._service({'matches': []})
        self.assertEqual(service._detect_edit_continuation_trigger('Can you try again?'), 'retry')
        self.assertEqual(service._detect_edit_continuation_trigger('retry please'), 'retry')
        self.assertEqual(service._detect_edit_continuation_trigger('again'), 'retry')

    def test_plan_message_pending_delegate_autostages_rename(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Prepared delegated rename operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Agent Runtime'},
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

        class _DelegateNestClient:
            def context_search(self, **kwargs):
                query = str(kwargs.get('query') or '').strip().lower()
                if 'agent' in query or 'module' in query:
                    return {
                        'matches': [
                            {
                                'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                                'type': 'epic',
                                'title': 'Agent Module',
                                'confidence': 0.99,
                            }
                        ]
                    }
                return {'matches': []}

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _DelegateNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='actor-1',
                    roadmap_role='editor',
                ),
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my Agent Module to something better',
                    default_title=None,
                    awaiting_field='rename_title',
                    target_hint='Agent Module',
                    resolver_hints={
                        'intent_version': 1,
                        'hint_intent_version': 1,
                        'hint_staged_operations_version': 0,
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'Agent Module',
                        'expected_node_type': 'epic',
                    },
                ),
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='You decide',
            replace=False,
            auth_header='Bearer token',
            trace_id='trace-pending-delegate-rename',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'delegate')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].op.value, 'update_node')
        self.assertEqual(session.operations[0].patch, {'title': 'Agent Runtime'})
        self.assertEqual(outcome.phase_timings.get('pending_followup_kind'), 'delegate')
        self.assertEqual(outcome.phase_timings.get('pending_followup_auto_apply_attempted'), 0)
        self.assertEqual(outcome.phase_timings.get('pending_followup_auto_apply_outcome'), 'routed_to_llm')
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_pending_slot_value_autostages_rename(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Prepared slot-value rename operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Autonomous Orchestration'},
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

        class _SlotNestClient:
            def context_search(self, **kwargs):
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'Agent Module',
                            'confidence': 0.99,
                        }
                    ]
                }

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _SlotNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my Agent Module to something better',
                    default_title=None,
                    awaiting_field='rename_title',
                    target_hint='Agent Module',
                    resolver_hints={
                        'intent_version': 1,
                        'hint_intent_version': 1,
                        'hint_staged_operations_version': 0,
                        'rename_from_label': 'Agent Module',
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Autonomous Orchestration',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-slot-rename',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'slot_value')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.operations[0].patch, {'title': 'Autonomous Orchestration'})
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_pending_delegate_fails_closed_on_ambiguous_target(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='I found multiple matches. Please tell me the exact current label.',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code='insufficient_context',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='insufficient_context',
                    clarifier_options=['Provide exact label', 'Refine target', 'Cancel'],
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        class _AmbiguousNestClient:
            def context_search(self, **kwargs):
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'Agent Module',
                            'confidence': 0.95,
                        },
                        {
                            'id': 'ab65697a-8962-4f80-8bc3-8a964edd8e57',
                            'type': 'epic',
                            'title': 'Agent Modules',
                            'confidence': 0.93,
                        },
                    ]
                }

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _AmbiguousNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(actor_id='actor-1', roadmap_role='editor'),
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my Agent Module to something better',
                    default_title=None,
                    awaiting_field='rename_title',
                    target_hint='Agent Module',
                    resolver_hints={'rename_from_label': 'Agent Module'},
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='You decide',
            replace=False,
            auth_header='Bearer token',
            trace_id='trace-pending-delegate-ambiguous',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'delegate')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.provider_error_code, 'insufficient_context')
        self.assertEqual(len(session.operations), 0)
        self.assertIsNotNone(session.metadata.pending_edit_context)
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_pending_delegate_blocks_without_editor_role(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Please provide the exact new title before I continue.',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code='insufficient_context',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='insufficient_context',
                    clarifier_options=['Provide exact title', 'Provide exact target', 'Cancel'],
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my Agent Module to something better',
                    default_title=None,
                    awaiting_field='rename_title',
                    target_hint='Agent Module',
                    resolver_hints={'rename_from_label': 'Agent Module'},
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='You decide',
            replace=False,
            auth_header=None,
            trace_id='trace-pending-delegate-role-blocked',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'delegate')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.provider_error_code, 'insufficient_context')
        self.assertEqual(len(session.operations), 0)
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_pending_delegate_duplicate_does_not_restage_operation(self) -> None:
        class _Planner:
            def __init__(self) -> None:
                self.plan_calls = 0

            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                self.plan_calls += 1
                return PlanningResult(
                    assistant_message='Prepared delegated rename operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Agent Runtime'},
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

        class _DelegateNestClient:
            def context_search(self, **kwargs):
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'Agent Module',
                            'confidence': 0.99,
                        }
                    ]
                }

        planner = _Planner()
        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = planner
        service._nest_client = _DelegateNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'title': 'Agent Runtime'},
                )
            ],
            metadata=SessionMetadata(
                actor_context=ActorContext(actor_id='actor-1', roadmap_role='editor'),
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my Agent Module to something better',
                    default_title=None,
                    awaiting_field='rename_title',
                    target_hint='Agent Module',
                    resolver_hints={'rename_from_label': 'Agent Module'},
                )
            ),
        )
        session.staged_operations_version = 1

        outcome = service.plan_message(
            session=session,
            user_message='You decide',
            replace=False,
            auth_header='Bearer token',
            trace_id='trace-pending-delegate-duplicate',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'delegate')
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.provider_error_code, None)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(planner.plan_calls, 1)

    def test_plan_message_retry_non_rename_persists_signal_and_falls_back_to_planner(self) -> None:
        planner_calls = {'count': 0}

        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                planner_calls['count'] += 1
                return PlanningResult(
                    assistant_message='Please confirm the exact parent target.',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
                    clarifier_reason='insufficient_context',
                    clarifier_options=['Provide parent node', 'Provide the exact name', 'Cancel'],
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_task',
                    draft_operations=[],
                    required_fields=['parent'],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Create task under Platform Foundation',
                    default_title='Create migration job',
                    resolver_hints={
                        'intent_version': 1,
                        'hint_intent_version': 1,
                        'hint_staged_operations_version': 0,
                        'retry_autostage_eligible': False,
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='retry',
            replace=False,
            auth_header=None,
            trace_id='trace-retry-non-rename-contract',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'retry')
        self.assertEqual(planner_calls['count'], 1)
        pending_context = session.metadata.pending_edit_context
        self.assertIsNotNone(pending_context)
        assert pending_context is not None
        self.assertIsNone(pending_context.last_retry_blocked_reason)
        self.assertIsNone(pending_context.last_retry_blocked_intent_family)
        self.assertEqual(outcome.response_mode, 'chat')

    def test_plan_message_pending_retry_autostages_single_rename_match(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='fallback clarifier',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        class _RetryNestClient:
            def context_search(self, **kwargs):
                query = str(kwargs.get('query') or '').strip().lower()
                if query in {'app foundation', 'foundation'}:
                    return {
                        'matches': [
                            {
                                'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                                'type': 'epic',
                                'title': 'App  Foundation',
                                'confidence': 0.95,
                            }
                        ]
                    }
                return {'matches': []}

        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _RetryNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my App Foundation to Platform Foundation',
                    default_title=None,
                    resolver_hints={
                        'intent_version': 1,
                        'hint_intent_version': 1,
                        'hint_staged_operations_version': 0,
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'App Foundation',
                        'rename_to_title': 'Platform Foundation',
                        'expected_node_type': 'epic',
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Can you try again?',
            replace=False,
            auth_header=None,
            trace_id='trace-retry-autostage',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'retry')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling_clarifier')
        self.assertEqual(len(session.operations), 0)
        self.assertIsNone(outcome.provider_error_code)
        self.assertFalse(outcome.retry_autostage_applied)
        self.assertIsNone(outcome.retry_tool_calls_used)

    def test_plan_message_retry_blocks_on_staged_version_mismatch(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='fallback clarifier',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            staged_operations_version=3,
            metadata=SessionMetadata(
                active_draft_id='draft-1',
                drafts={
                    'draft-1': DraftNode(
                        draft_id='draft-1',
                        draft_version=3,
                        operations=[],
                    )
                },
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my App Foundation to Platform Foundation',
                    default_title=None,
                    resolver_hints={
                        'intent_version': 2,
                        'hint_intent_version': 2,
                        'hint_staged_operations_version': 2,
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'App Foundation',
                        'rename_to_title': 'Platform Foundation',
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='retry',
            replace=False,
            auth_header=None,
            trace_id='trace-retry-staged-version-mismatch',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'retry')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertIsNone(outcome.provider_error_code)
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling_clarifier')
        self.assertEqual(len(session.operations), 0)

    def test_plan_message_retry_blocks_when_staged_version_hint_missing(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='fallback clarifier',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            staged_operations_version=2,
            metadata=SessionMetadata(
                active_draft_id='draft-1',
                drafts={
                    'draft-1': DraftNode(
                        draft_id='draft-1',
                        draft_version=2,
                        operations=[],
                    )
                },
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my App Foundation to Platform Foundation',
                    default_title=None,
                    resolver_hints={
                        'intent_version': 2,
                        'hint_intent_version': 2,
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'App Foundation',
                        'rename_to_title': 'Platform Foundation',
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='retry',
            replace=False,
            auth_header=None,
            trace_id='trace-retry-staged-hint-missing',
        )

        self.assertEqual(outcome.edit_continuation_trigger, 'retry')
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertIsNone(outcome.provider_error_code)
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling_clarifier')
        self.assertEqual(len(session.operations), 0)

    def test_plan_message_retry_ambiguous_returns_numbered_id_choices(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('question', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='fallback clarifier',
                    operations=[],
                    parse_mode='openai_tool_calling_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    clarifier_action='ask_clarifier',
                )

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        class _RetryNestClient:
            def context_search(self, **kwargs):
                query = str(kwargs.get('query') or '').lower()
                if query in {'app foundation', 'foundation'}:
                    return {
                        'matches': [
                            {
                                'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                                'type': 'epic',
                                'title': 'App Foundation',
                                'confidence': 0.95,
                            },
                            {
                                'id': '11111111-1111-1111-1111-111111111111',
                                'type': 'epic',
                                'title': 'App Foundation Core',
                                'confidence': 0.92,
                            },
                        ]
                    }
                return {'matches': []}

        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _RetryNestClient()
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        service._run_async_call = lambda value: value

        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='rename_node',
                    draft_operations=[],
                    required_fields=[],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Rename my App Foundation to Platform Foundation',
                    default_title=None,
                    resolver_hints={
                        'intent_version': 1,
                        'hint_intent_version': 1,
                        'hint_staged_operations_version': 0,
                        'retry_autostage_eligible': True,
                        'rename_from_label': 'App Foundation',
                        'rename_to_title': 'Platform Foundation',
                    },
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='try again',
            replace=False,
            auth_header=None,
            trace_id='trace-retry-ambiguous',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertIsNone(outcome.provider_error_code)
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling_clarifier')
        self.assertEqual(outcome.assistant_message, 'fallback clarifier')
        self.assertEqual(len(session.operations), 0)

    def test_set_pending_context_normalizes_intent_family_alias(self) -> None:
        service = self._service({'matches': []})
        session = AgentSession(roadmap_id='roadmap-1')
        context = PendingEditContext(
            intent_family='rename_node',
            draft_operations=[],
            required_fields=[],
            resolved_references=PendingEditResolvedReferences(),
            confirmation_mode='awaiting_clarification',
            source_user_message='Rename something',
            default_title=None,
        )
        context.intent_family = 'rename'  # type: ignore[assignment]
        service._set_pending_edit_context(
            session=session,
            context=context,
            event='set',
            trace_id='trace-intent-family-normalize',
        )
        assert session.metadata.pending_edit_context is not None
        self.assertEqual(session.metadata.pending_edit_context.intent_family, 'rename_node')

    def test_pending_edit_context_model_normalizes_legacy_intent_family(self) -> None:
        context = PendingEditContext.model_validate(
            {
                'intent_family': 'rename',
                'draft_operations': [],
                'required_fields': [],
                'resolved_references': {},
                'confirmation_mode': 'awaiting_clarification',
                'source_user_message': 'Rename X to Y',
                'default_title': None,
            }
        )
        self.assertEqual(context.intent_family, 'rename_node')

    def test_build_resolver_hints_correction_keeps_retry_autostage_disabled(self) -> None:
        service = self._service({'matches': []})
        planning = PlanningResult(
            assistant_message='I can apply that correction.',
            operations=[],
            parse_mode='openai_tool_calling_clarifier',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='openai',
            fallback_used=False,
            provider_error_code=None,
        )

        hints = service._build_resolver_hints(
            existing_hints={
                'intent_version': 2,
                'hint_intent_version': 2,
                'hint_staged_operations_version': 1,
                'retry_autostage_eligible': True,
                'rename_from_label': 'App Foundation',
                'rename_to_title': 'Platform Foundation',
            },
            user_message='Actually, rename App Foundation to Platform Foundation V2',
            planning=planning,
            edit_continuation_trigger='correction',
            intent_family='rename_node',
            staged_operations_version=1,
            rename_intent=('App Foundation', 'Platform Foundation V2'),
        )

        assert hints is not None
        self.assertFalse(bool(hints.get('retry_autostage_eligible')))
        self.assertEqual(hints.get('intent_version'), 3)
        self.assertEqual(hints.get('hint_intent_version'), 3)

    def test_build_resolver_hints_rename_does_not_force_expected_type(self) -> None:
        service = self._service({'matches': []})
        planning = PlanningResult(
            assistant_message='Prepared retry metadata.',
            operations=[],
            parse_mode='openai_tool_calling_clarifier',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='openai',
            fallback_used=False,
            provider_error_code=None,
        )

        hints = service._build_resolver_hints(
            existing_hints={},
            user_message='Rename Foundation to Platform Foundation',
            planning=planning,
            edit_continuation_trigger=None,
            intent_family='rename_node',
            staged_operations_version=0,
            rename_intent=('Foundation', 'Platform Foundation'),
        )

        assert hints is not None
        self.assertNotIn('expected_node_type', hints)
        self.assertTrue(bool(hints.get('retry_autostage_eligible')))

    def test_plan_message_revise_action_replaces_and_increments_staged_version(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared replacement rename operation.',
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
                    draft_action='revise',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='11111111-1111-1111-1111-111111111111',
                    patch={'title': 'Old'},
                )
            ],
        )
        session.staged_operations_version = 3

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-revise-increments-version',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.staged_operations_version, 4)

    def test_plan_message_hybrid_mode_ignores_replace_flag_without_revise(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared append operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation 1'},
                        )
                    ],
                    parse_mode='openai_edit_schema',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
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
            update={
                'agent_hybrid_react_enabled': True,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='11111111-1111-1111-1111-111111111111',
                    patch={'title': 'Existing Title'},
                )
            ],
        )
        session.staged_operations_version = 3

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=True,
            auth_header=None,
            trace_id='trace-hybrid-ignore-legacy-replace',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 2)
        self.assertEqual(session.staged_operations_version, 4)

    def test_plan_message_replace_flag_is_ignored_uses_append_mode(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared append operation.',
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='11111111-1111-1111-1111-111111111111',
                    patch={'title': 'Existing Title'},
                )
            ],
        )
        session.staged_operations_version = 3

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=True,
            auth_header=None,
            trace_id='trace-replace-flag-ignored',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(len(session.operations), 2)
        self.assertEqual(session.staged_operations_version, 4)

    def test_plan_message_initializes_root_draft_graph_from_legacy_operations(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                raise AssertionError('Planner should not run for staged confirm continuation')

        class _FakeStore:
            def append_message(self, session, role, content):
                session.messages.append(SimpleNamespace(role=role, content=content))

            def update(self, _session):
                return None

            def get(self, _session_id):
                return None

        service = object.__new__(AgentService)
        service._settings = get_settings().model_copy(
            update={
                'agent_draft_graph_enabled': True,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(
            roadmap_id='roadmap-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='11111111-1111-1111-1111-111111111111',
                    patch={'title': 'Legacy Title'},
                )
            ],
        )
        session.staged_operations_version = 2

        with self.assertRaises(HTTPException) as raised:
            service.plan_message(
                session=session,
                user_message='Proceed',
                replace=False,
                auth_header=None,
                trace_id='trace-legacy-graph-init',
            )

        exc = raised.exception
        self.assertEqual(exc.status_code, 409)
        self.assertIsInstance(exc.detail, dict)
        detail = exc.detail
        self.assertEqual(detail.get('code'), 'LEGACY_SESSION_UNSUPPORTED')

    def test_plan_message_edit_plan_updates_active_draft_and_legacy_versions(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation'},
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
            update={
                'agent_draft_graph_enabled': True,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(roadmap_id='roadmap-1')

        outcome = service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-draft-version-sync',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertIsNotNone(session.metadata.active_draft_id)
        active_draft = session.metadata.drafts[session.metadata.active_draft_id]
        self.assertEqual(active_draft.draft_version, 1)
        self.assertEqual(len(active_draft.operations), 1)
        self.assertEqual(outcome.active_draft_version, 1)
        self.assertEqual(outcome.staged_operations_version, 1)
        self.assertEqual(outcome.staged_operations_count, 1)

    def test_plan_message_restaging_reactivates_non_active_draft_status(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared operation.',
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            patch={'title': 'Platform Foundation'},
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
            update={
                'agent_draft_graph_enabled': True,
            }
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(roadmap_id='roadmap-1')
        session.metadata.active_draft_id = 'draft-1'
        session.metadata.drafts = {
            'draft-1': DraftNode(
                draft_id='draft-1',
                draft_version=0,
                status='abandoned',
                operations=[],
            )
        }

        service.plan_message(
            session=session,
            user_message='Rename Platform Foundation',
            replace=False,
            auth_header=None,
            trace_id='trace-draft-reactivate',
        )

        active_draft = session.metadata.drafts['draft-1']
        self.assertEqual(active_draft.status, 'active')

    def test_context_answer_guard_blocks_pseudo_operation_payload(self) -> None:
        service = self._service({'matches': []})
        guarded = service._apply_context_answer_output_guard(
            planning=PlanningResult(
                assistant_message=(
                    "Got it. Planned operations (won't be applied here): "
                    '[{"action":"create","type":"feature","parent_id":"x"}]'
                ),
                operations=[],
                parse_mode='openai_context_tools',
                intent_type='unclear',
                response_mode='chat',
                preview_recommended=False,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
            ),
            pending_edit_context_present=True,
        )

        self.assertEqual(guarded.parse_mode, 'context_answer_handoff')
        self.assertEqual(guarded.intent_type, 'roadmap_edit')
        self.assertEqual(
            guarded.provider_error_code,
            'context_answer_operation_payload_blocked',
        )

    def test_plan_message_context_answer_guard_sets_edit_guard_metric(self) -> None:
        class _Planner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('unclear', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message=(
                        'Planned operations (won\'t be applied here): '
                        '[{"action":"create","type":"task","parent_id":"x"}]'
                    ),
                    operations=[],
                    parse_mode='openai_context_tools',
                    intent_type='unclear',
                    response_mode='chat',
                    preview_recommended=False,
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
            update={'agent_hybrid_react_enabled': True}
        )
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _Planner()
        service._nest_client = _FakeNestClient({'matches': []})
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_edit_context=PendingEditContext(
                    intent_family='create_task',
                    draft_operations=[],
                    required_fields=['parent'],
                    resolved_references=PendingEditResolvedReferences(),
                    confirmation_mode='awaiting_clarification',
                    source_user_message='Create task under schema setup',
                    default_title='Design relational schema',
                )
            ),
        )

        outcome = service.plan_message(
            session=session,
            user_message='Proceed with this',
            replace=False,
            auth_header=None,
            trace_id='trace-context-guard-metric',
        )

        self.assertEqual(
            outcome.provider_error_code,
            'pending_edit_confirm_requires_edit_plan',
        )
        self.assertTrue(outcome.edit_guard_intervened)

    def test_plan_message_routes_rename_to_llm_planner(self) -> None:
        class _FakeNestClient:
            def __init__(self) -> None:
                self.actor_calls = 0

            async def context_actor(self, **_kwargs):
                self.actor_calls += 1
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
                    assistant_message='Rename epic Platform Foundation.',
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
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _FakePlanner()
        fake_client = _FakeNestClient()
        service._nest_client = fake_client
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(roadmap_id='roadmap-1')
        outcome = service.plan_message(
            session=session,
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header='Bearer test-token',
            trace_id='trace-fastpath-sla',
        )

        self.assertEqual(outcome.route_lane, 'llm_edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertFalse(outcome.llm_skipped_for_simple_edit)
        self.assertTrue(outcome.actor_fetch_attempted)
        self.assertIsNone(outcome.actor_fetch_skipped_reason)
        self.assertEqual(fake_client.actor_calls, 1)
        self.assertEqual(len(outcome.operations), 1)

    def test_validate_operation_contract_blocks_add_epic_without_title(self) -> None:
        service = self._service({'matches': []})
        validation_error = service._validate_operation_contract(
            [RoadmapOperation(op='add_epic', data={})]
        )
        self.assertIsNotNone(validation_error)
        assert validation_error is not None
        self.assertEqual(validation_error['reason'], 'add_epic.data.title_missing')

    def test_parse_plan_tool_args_normalizes_add_operation_name_alias(self) -> None:
        _, operations = parse_plan_tool_args(
            {
                'assistant_message': 'Create epic',
                'operations': [
                    {
                        'op': 'add_epic',
                        'data': {'name': 'AI Module'},
                    }
                ],
            }
        )
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].data, {'title': 'AI Module'})

    def test_plan_message_fetches_actor_for_actor_dependent_turn(self) -> None:
        class _ActorAwareNestClient:
            def __init__(self) -> None:
                self.actor_calls = 0

            async def context_actor(self, **_kwargs):
                self.actor_calls += 1
                return {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'locale': None,
                    'timezone': None,
                }

        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_query', True)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Here are your open tasks.',
                    operations=[],
                    parse_mode='rule_based_chat',
                    intent_type='roadmap_query',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
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
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _FakePlanner()
        actor_client = _ActorAwareNestClient()
        service._nest_client = actor_client
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        session = AgentSession(roadmap_id='roadmap-1')
        outcome = service.plan_message(
            session=session,
            user_message='What are my pending tasks?',
            replace=False,
            auth_header='Bearer test-token',
            trace_id='trace-actor-dependent',
        )

        self.assertEqual(outcome.response_mode, 'chat')
        self.assertTrue(outcome.actor_fetch_attempted)
        self.assertIsNone(outcome.actor_fetch_skipped_reason)
        self.assertIsInstance(outcome.actor_fetch_ms, int)
        self.assertEqual(actor_client.actor_calls, 1)

    def test_plan_message_missing_auth_clears_stale_actor_context_when_skipped(self) -> None:
        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Rename epic Platform Foundation.',
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
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._store = _FakeStore()
        service._planner = _FakePlanner()
        fake_nest = _FakeNestClient({'matches': []})
        service._nest_client = fake_nest
        service._actor_refresh_failures_key = 'actor_context_refresh_failures'
        service._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )
        session = AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                actor_context=ActorContext(
                    actor_id='stale-actor',
                    display_name='Stale',
                    roadmap_role='owner',
                    actor_context_source='backend_context_actor',
                ),
            ),
        )
        outcome = service.plan_message(
            session=session,
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            replace=False,
            auth_header=None,
            trace_id='trace-missing-auth',
        )

        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertFalse(outcome.actor_fetch_attempted)
        self.assertEqual(outcome.actor_fetch_skipped_reason, 'missing_auth_header')
        self.assertIsNone(session.metadata.actor_context)
        self.assertEqual(fake_nest.actor_calls, 0)

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
        self.assertEqual(outcome.parse_mode, 'invalid_operation_contract_handoff')
        self.assertEqual(len(session.operations), 0)
        self.assertTrue(outcome.invalid_operation_detected)
        self.assertEqual(outcome.invalid_operation_reason, 'update_node.node_id_invalid_uuid')
        self.assertEqual(outcome.invalid_operation_index, 0)

    def test_plan_message_allows_alias_prefixed_temp_refs(self) -> None:
        class _FakePlanner:
            def preview_intent_classification(self, user_message, session_context=None):
                return ('roadmap_edit', False)

            def plan(self, user_message, existing_operations, session_context=None):
                return PlanningResult(
                    assistant_message='Prepared create chain.',
                    operations=[
                        RoadmapOperation(
                            op='add_epic',
                            temp_id='temp-epic-agent-module',
                            data={'title': 'Agent Module'},
                        ),
                        RoadmapOperation(
                            op='add_feature',
                            temp_id='temp-feature-system-architecture',
                            parent_ref='temp-epic-agent-module',
                            data={'title': 'System Architecture'},
                        ),
                        RoadmapOperation(
                            op='add_task',
                            temp_id='temp-task-system-architecture-1',
                            parent_ref='temp-feature-system-architecture',
                            data={'title': 'System Architecture Task 1'},
                        ),
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
            user_message='Create epic Agent Module with feature and task',
            replace=False,
            auth_header=None,
            trace_id='trace-alias-temp-refs',
        )

        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.parse_mode, 'openai_tool_calling')
        self.assertFalse(outcome.invalid_operation_detected)
        self.assertEqual(outcome.provider_error_code, None)
        self.assertEqual(len(outcome.operations), 3)
        self.assertEqual(len(session.operations), 3)


class ConfigCompatibilityTests(unittest.TestCase):
    def test_react_prefixed_planner_aliases_override_legacy_names(self) -> None:
        previous_values = {
            'AGENT_REACT_REPAIR_RETRIES': os.environ.get('AGENT_REACT_REPAIR_RETRIES'),
            'AGENT_REACT_MAX_ATTEMPTS': os.environ.get('AGENT_REACT_MAX_ATTEMPTS'),
            'AGENT_EDIT_PLANNER_REPAIR_RETRIES': os.environ.get('AGENT_EDIT_PLANNER_REPAIR_RETRIES'),
            'AGENT_EDIT_PLANNER_MAX_ATTEMPTS': os.environ.get('AGENT_EDIT_PLANNER_MAX_ATTEMPTS'),
        }

        try:
            os.environ['AGENT_REACT_REPAIR_RETRIES'] = '2'
            os.environ['AGENT_REACT_MAX_ATTEMPTS'] = '3'
            os.environ['AGENT_EDIT_PLANNER_REPAIR_RETRIES'] = '1'
            os.environ['AGENT_EDIT_PLANNER_MAX_ATTEMPTS'] = '1'

            reload_settings()
            settings = get_settings()

            self.assertEqual(settings.agent_edit_planner_repair_retries, 2)
            self.assertEqual(settings.agent_edit_planner_max_attempts, 3)
            self.assertEqual(settings.agent_react_repair_retries, 2)
            self.assertEqual(settings.agent_react_max_attempts, 3)
        finally:
            for key, value in previous_values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reload_settings()

    def test_total_llm_call_budget_setting_reads_and_clamps_bounds(self) -> None:
        previous_value = os.environ.get('AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE')

        try:
            os.environ['AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE'] = '40'
            reload_settings()
            settings = get_settings()
            self.assertEqual(settings.agent_max_total_llm_calls_per_message, 16)

            os.environ['AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE'] = '0'
            reload_settings()
            settings = get_settings()
            self.assertEqual(settings.agent_max_total_llm_calls_per_message, 1)

            os.environ['AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE'] = '5'
            reload_settings()
            settings = get_settings()
            self.assertEqual(settings.agent_max_total_llm_calls_per_message, 5)
        finally:
            if previous_value is None:
                os.environ.pop('AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE', None)
            else:
                os.environ['AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE'] = previous_value
            reload_settings()

    def test_strict_mutation_authority_setting_reads_from_env(self) -> None:
        previous_value = os.environ.get('AGENT_STRICT_MUTATION_AUTHORITY_ENABLED')

        try:
            os.environ['AGENT_STRICT_MUTATION_AUTHORITY_ENABLED'] = 'true'
            reload_settings()
            settings = get_settings()
            self.assertTrue(settings.agent_strict_mutation_authority_enabled)

            os.environ['AGENT_STRICT_MUTATION_AUTHORITY_ENABLED'] = 'false'
            reload_settings()
            settings = get_settings()
            self.assertFalse(settings.agent_strict_mutation_authority_enabled)
        finally:
            if previous_value is None:
                os.environ.pop('AGENT_STRICT_MUTATION_AUTHORITY_ENABLED', None)
            else:
                os.environ['AGENT_STRICT_MUTATION_AUTHORITY_ENABLED'] = previous_value
            reload_settings()


class SessionRouteSafetyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._original_agent_draft_graph_enabled = sessions_routes.settings.agent_draft_graph_enabled
        self._original_agent_async_auto_commit_enabled = (
            sessions_routes.settings.agent_async_auto_commit_enabled
        )
        sessions_routes.settings.agent_draft_graph_enabled = False
        sessions_routes.settings.agent_async_auto_commit_enabled = False

    def tearDown(self) -> None:
        sessions_routes.settings.agent_draft_graph_enabled = (
            self._original_agent_draft_graph_enabled
        )
        sessions_routes.settings.agent_async_auto_commit_enabled = (
            self._original_agent_async_auto_commit_enabled
        )

    def test_preview_binding_helpers_are_removed_from_route_module(self) -> None:
        self.assertFalse(hasattr(sessions_routes, 'PreviewFingerprintBinding'))
        self.assertFalse(hasattr(sessions_routes, '_resolve_snapshot_for_binding'))

    async def test_store_unavailable_response_is_sanitized(self) -> None:
        def _raise_store_error():
            raise SessionStoreUnavailableError('get', 'dns failure: internal-hostname')

        with self.assertRaises(HTTPException) as raised:
            await sessions_routes._run_store_call(_raise_store_error)

        exc = raised.exception
        self.assertEqual(exc.status_code, 503)
        self.assertEqual(exc.detail.get('code'), 'SESSION_STORE_UNAVAILABLE')
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

    async def test_artifact_preview_endpoint_is_removed(self) -> None:
        self.assertFalse(hasattr(sessions_routes, 'get_artifact_preview'))

    async def test_preview_artifact_contract_is_removed(self) -> None:
        self.assertFalse(hasattr(sessions_routes, 'RoadmapPreviewArtifact'))

    async def test_build_commit_artifact_uses_commit_contract(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        artifact = sessions_routes._build_commit_artifact(
            session,
            {
                'change_id': '4cf13eb2-01fc-4b58-b5f4-d43fa7154f7a',
                'semantic_diff': {'summary': {'NODE_UPDATED': 1}, 'changes': []},
                'candidate_snapshot': {'id': session.roadmap_id},
            },
            status='applied',
        )

        self.assertIsNotNone(artifact)
        assert artifact is not None
        self.assertEqual(artifact.type, 'roadmap_commit')
        self.assertFalse(hasattr(artifact, 'preview_id'))

    async def test_send_message_auto_commit_failure_raises_http_exception(self) -> None:
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                    resolve_cache_hits=7,
                    resolve_cache_misses=3,
                    resolve_dedup_hits=2,
                )

        async def _fake_commit(**_kwargs):
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
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.send_message(
                    session_id='session-1',
                    payload=sessions_routes.MessageRequest(
                        message='Rename my Platform Foundation to Platform Foundation 1',
                    ),
                    request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(raised.exception.status_code, 400)

    async def test_send_message_auto_commit_success_includes_inline_commit_payload(self) -> None:
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                    resolve_cache_hits=7,
                    resolve_cache_misses=3,
                    resolve_dedup_hits=2,
                )

        async def _fake_commit(**_kwargs):
            return {
                'change_id': '4cf13eb2-01fc-4b58-b5f4-d43fa7154f7a',
                'revision_token': 'rev-2',
                'semantic_diff': {'summary': {'NODE_UPDATED': 1}, 'changes': []},
                'candidate_snapshot': {'id': '55e431e2-e416-468c-a973-94d97280e97d'},
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Rename my Platform Foundation to Platform Foundation 1',
                ),
                request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertFalse(hasattr(response, 'preview_available'))
        self.assertFalse(hasattr(response, 'preview_recommended'))
        self.assertEqual(response.staged_operations_count, 0)
        self.assertEqual(len(response.artifacts), 1)
        self.assertEqual(response.artifacts[0].status, 'applied')
        inline_commit = response.artifacts[0].inline_commit
        self.assertIsInstance(inline_commit, dict)
        assert isinstance(inline_commit, dict)
        self.assertEqual(
            inline_commit.get('change_id'),
            '4cf13eb2-01fc-4b58-b5f4-d43fa7154f7a',
        )
        self.assertEqual(inline_commit.get('revision_token'), 'rev-2')

    async def test_send_message_async_auto_commit_enqueues_background_task(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='add_epic',
                data={'title': 'AI Module'},
            )
        ]
        update_calls = 0
        commit_calls = 0
        scheduled_calls = 0

        class _FakeStore:
            def update(self, _session):
                nonlocal update_calls
                update_calls += 1
                return None

        class _FakeAgentService:
            def plan_message(self, _session, _message, _replace, _auth_header, _trace_id):
                return MessagePlanningOutcome(
                    session=session,
                    assistant_message='Create epic AI Module.',
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

        async def _fake_commit(**_kwargs):
            nonlocal commit_calls
            commit_calls += 1
            await asyncio.sleep(0)
            return {
                'change_id': '2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85',
                'revision_token': 'rev-2',
                'semantic_diff': {'summary': {'NODE_ADDED': 1}, 'changes': []},
                'candidate_snapshot': {'id': '55e431e2-e416-468c-a973-94d97280e97d'},
            }

        def _capture_schedule(coro):
            nonlocal scheduled_calls
            scheduled_calls += 1
            coro.close()
            return None

        original_async_flag = sessions_routes.settings.agent_async_auto_commit_enabled
        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        original_schedule = sessions_routes._schedule_auto_commit_task
        sessions_routes.settings.agent_async_auto_commit_enabled = True
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        sessions_routes._schedule_auto_commit_task = _capture_schedule  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Create Epic called AI Module',
                ),
                request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            )
        finally:
            sessions_routes.settings.agent_async_auto_commit_enabled = original_async_flag
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]
            sessions_routes._schedule_auto_commit_task = original_schedule  # type: ignore[assignment]

        self.assertEqual(scheduled_calls, 1)
        self.assertEqual(commit_calls, 0)
        self.assertEqual(update_calls, 0)
        self.assertEqual(response.staged_operations_count, 1)
        self.assertEqual(response.staged_operations_version, 1)
        self.assertEqual(len(response.artifacts), 0)

    async def test_send_message_auto_commit_records_recent_targets_from_commit_result(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='add_epic',
                data={'title': 'AI Module'},
            )
        ]

        captured_node_ids: list[str] = []

        class _FakeStore:
            def update(self, _session):
                return None

        class _FakeAgentService:
            def plan_message(self, _session, _message, _replace, _auth_header, _trace_id):
                return MessagePlanningOutcome(
                    session=session,
                    assistant_message='Create epic AI Module.',
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

            def record_recent_targets_from_preview(
                self,
                *,
                session: AgentSession,
                preview_result: dict,
                source: str,
            ) -> None:
                semantic_diff = preview_result.get('semantic_diff')
                changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
                if isinstance(changes, list) and changes and isinstance(changes[0], dict):
                    node_payload = changes[0].get('node')
                    if isinstance(node_payload, dict):
                        node_id = str(node_payload.get('id') or '').strip()
                        if node_id:
                            captured_node_ids.append(node_id)

        committed_node_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

        async def _fake_commit(**_kwargs):
            return {
                'change_id': '2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85',
                'revision_token': 'rev-3',
                'semantic_diff': {
                    'summary': {'NODE_ADDED': 1},
                    'changes': [
                        {
                            'type': 'NODE_ADDED',
                            'node': {
                                'id': committed_node_id,
                                'type': 'epic',
                                'title': 'AI Module',
                            },
                        }
                    ],
                },
                'candidate_snapshot': {
                    'id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'roadmap_epics': [
                        {'id': committed_node_id, 'title': 'AI Module'},
                    ],
                },
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Create Epic called AI Module',
                ),
                request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertFalse(hasattr(response, 'preview_available'))
        self.assertEqual(len(response.artifacts), 1)
        self.assertEqual(captured_node_ids, [committed_node_id])
        self.assertIn('2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85', session.metadata.applied_change_ids)

    async def test_send_message_auto_commit_failure_emits_error_metadata(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.base_revision = 1
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='add_epic',
                data={'title': 'AI Module'},
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
                    assistant_message='Create epic AI Module.',
                    parse_mode='deterministic_fastpath_create_epic',
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                )

        async def _fake_commit(**_kwargs):
            raise HTTPException(
                status_code=400,
                detail={
                    'detail': {
                        'error': {
                            'code': 'INVALID_OPERATION',
                            'message': 'operations.0.data.title is required',
                        }
                    }
                },
            )

        def _capture_log_event(_logger, event, **kwargs):
            observed_events.append((event, kwargs))

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        original_log_event = sessions_routes.log_event
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        sessions_routes.log_event = _capture_log_event  # type: ignore[assignment]
        try:
            with self.assertRaises(HTTPException):
                await sessions_routes.send_message(
                    session_id='session-1',
                    payload=sessions_routes.MessageRequest(
                        message='Create a new Epic called "AI Module"',
                    ),
                    request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]
            sessions_routes.log_event = original_log_event  # type: ignore[assignment]

        message_completed_events = [
            payload
            for event_name, payload in observed_events
            if event_name == 'message_completed'
        ]
        self.assertTrue(message_completed_events)
        latest = message_completed_events[-1]
        self.assertEqual(latest.get('auto_commit_error_code'), 'INVALID_OPERATION')
        self.assertFalse(latest.get('auto_commit_error_retryable'))
        self.assertEqual(latest.get('auto_commit_error_upstream_status'), 400)

    async def test_send_message_auto_commit_inline_payload_not_size_limited(self) -> None:
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
                    phase_timings={},
                    invalid_operation_detected=False,
                    invalid_operation_reason=None,
                    invalid_operation_index=None,
                    resolve_cache_hits=7,
                    resolve_cache_misses=3,
                    resolve_dedup_hits=2,
                )

        async def _fake_commit(**_kwargs):
            return {
                'change_id': '68f92439-f4e5-4320-a9fd-9797f699a669',
                'revision_token': 'rev-2',
                'semantic_diff': {'summary': {'NODE_UPDATED': 1}, 'changes': []},
                'candidate_snapshot': {
                    'id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'blob': 'x' * 4096,
                },
            }

        def _capture_log_event(_logger, event, **kwargs):
            observed_events.append((event, kwargs))

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        original_log_event = sessions_routes.log_event
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        sessions_routes.log_event = _capture_log_event  # type: ignore[assignment]
        try:
            response = await sessions_routes.send_message(
                session_id='session-1',
                payload=sessions_routes.MessageRequest(
                    message='Rename my Platform Foundation to Platform Foundation 1',
                ),
                request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]
            sessions_routes.log_event = original_log_event  # type: ignore[assignment]

        self.assertFalse(hasattr(response, 'preview_available'))
        self.assertEqual(len(response.artifacts), 1)
        self.assertIsInstance(response.artifacts[0].inline_commit, dict)

        message_completed_events = [
            payload
            for event_name, payload in observed_events
            if event_name == 'message_completed'
        ]
        self.assertTrue(message_completed_events)
        latest = message_completed_events[-1]
        self.assertFalse(latest.get('inline_commit_skipped_due_to_size'))
        self.assertIsInstance(latest.get('inline_commit_size_bytes'), int)
        self.assertEqual(latest.get('resolve_cache_hits'), 7)
        self.assertEqual(latest.get('resolve_cache_misses'), 3)
        self.assertEqual(latest.get('resolve_dedup_hits'), 2)

    async def test_preview_session_endpoint_removed(self) -> None:
        self.assertFalse(hasattr(sessions_routes, 'preview_session'))

    async def test_preview_request_contract_removed(self) -> None:
        self.assertFalse(hasattr(sessions_routes, 'PreviewRequest'))

    async def test_message_request_ignores_legacy_auto_preview_field(self) -> None:
        request_model = sessions_routes.MessageRequest.model_validate(
            {
                'message': 'Rename Platform Foundation',
                'auto_preview': True,
            }
        )

        self.assertEqual(request_model.message, 'Rename Platform Foundation')
        self.assertNotIn('auto_preview', request_model.model_dump())

    async def test_commit_request_ignores_legacy_preview_selector_field(self) -> None:
        request_model = sessions_routes.CommitRequest.model_validate(
            {
                'preview_id': 'preview-obsolete-1',
            }
        )

        self.assertNotIn('preview_id', request_model.model_dump())

    async def test_commit_session_uses_active_draft_snapshot(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.metadata.active_draft_id = 'draft-active'
        session.metadata.drafts = {
            'draft-active': DraftNode(
                draft_id='draft-active',
                draft_version=3,
                status='active',
                operations=[
                    RoadmapOperation(
                        op='update_node',
                        node_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        patch={'title': 'Active Draft'},
                    )
                ],
            ),
            'draft-branch': DraftNode(
                draft_id='draft-branch',
                draft_version=2,
                operations=[
                    RoadmapOperation(
                        op='update_node',
                        node_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                        patch={'title': 'Branch Draft'},
                    )
                ],
            ),
        }
        observed_payloads: list[dict[str, Any]] = []
        updated_sessions: list[AgentSession] = []

        class _FakeStore:
            def update(self, updated_session):
                updated_sessions.append(updated_session)

        class _FakeAgentService:
            def ensure_draft_graph_initialized(self, _session):
                return None

            def get_active_draft(self, candidate_session):
                active_draft_id = candidate_session.metadata.active_draft_id
                assert isinstance(active_draft_id, str)
                return candidate_session.metadata.drafts[active_draft_id]

        async def _fake_commit(**kwargs):
            observed_payloads.append(dict(kwargs.get('payload') or {}))
            return {'revision_token': 'rev-4'}

        original_graph_enabled = sessions_routes.settings.agent_draft_graph_enabled
        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes.settings.agent_draft_graph_enabled = True
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.commit_session(
                session_id='session-1',
                payload=sessions_routes.CommitRequest(),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes.settings.agent_draft_graph_enabled = original_graph_enabled
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(len(observed_payloads), 1)
        observed_operations = observed_payloads[0].get('operations')
        self.assertIsInstance(observed_operations, list)
        assert isinstance(observed_operations, list)
        self.assertEqual(observed_operations[0].get('node_id'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        self.assertEqual(session.metadata.applied_draft_commits[-1].draft_id, 'draft-active')
        self.assertEqual(session.metadata.applied_draft_commits[-1].draft_version, 3)
        self.assertEqual(len(updated_sessions), 1)

    async def test_discard_session_requires_change_id_without_applied_commits(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'

        class _FakeStore:
            def update(self, _session):
                raise AssertionError('Store update should not run when change_id is missing')

        class _FakeAgentService:
            pass

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.discard_session(
                    session_id='session-1',
                    payload=sessions_routes.DiscardRequest(),
                    request=SimpleNamespace(headers={}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]

        exc = raised.exception
        self.assertEqual(exc.status_code, 400)
        self.assertIsInstance(exc.detail, dict)
        self.assertEqual(exc.detail.get('code'), 'MISSING_CHANGE_ID')

    async def test_commit_session_rejects_empty_operations(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'

        class _FakeStore:
            def update(self, _session):
                raise AssertionError('Store update should not run for empty operations commits')

        class _FakeAgentService:
            pass

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.commit_session(
                    session_id='session-1',
                    payload=sessions_routes.CommitRequest(),
                    request=SimpleNamespace(headers={}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]

        exc = raised.exception
        self.assertEqual(exc.status_code, 400)
        self.assertIsInstance(exc.detail, dict)
        self.assertEqual(exc.detail.get('code'), 'EMPTY_OPERATIONS')

    async def test_commit_session_propagates_upstream_not_found(self) -> None:
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
                raise AssertionError('Store update should not run for failed upstream commit')

        async def _fake_commit(**_kwargs):
            raise HTTPException(status_code=404, detail={'message': 'Change not found'})

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            with self.assertRaises(HTTPException) as raised:
                await sessions_routes.commit_session(
                    session_id='session-1',
                    payload=sessions_routes.CommitRequest(),
                    request=SimpleNamespace(headers={}),
                )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        exc = raised.exception
        self.assertEqual(exc.status_code, 404)
        self.assertIsInstance(exc.detail, dict)
        self.assertEqual(exc.detail.get('message'), 'Change not found')

    async def test_commit_session_records_applied_change_id_after_success(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.revision_token = 'rev-1'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]
        updated_sessions: list[AgentSession] = []

        class _FakeStore:
            def update(self, updated_session):
                updated_sessions.append(updated_session)

        async def _fake_commit(**_kwargs):
            return {
                'change_id': '2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85',
                'revision_token': 'rev-2',
            }

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.commit_session(
                session_id='session-1',
                payload=sessions_routes.CommitRequest(),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(session.revision_token, 'rev-2')
        self.assertIn('2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85', session.metadata.applied_change_ids)
        self.assertEqual(len(session.metadata.applied_draft_commits), 1)
        self.assertEqual(
            session.metadata.applied_draft_commits[0].change_id,
            '2d8f6290-a5c7-4a2d-8b8f-29e5b8bc6d85',
        )
        self.assertEqual(session.metadata.applied_draft_commits[0].status, 'applied')
        self.assertFalse(hasattr(session.metadata.applied_draft_commits[0], 'preview_id'))
        self.assertEqual(len(updated_sessions), 1)

    async def test_commit_session_with_payload_operations_uses_active_draft_identity(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.metadata.active_draft_id = 'draft-active'
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                patch={'title': 'Existing Session Staged Op'},
            )
        ]
        payload_operations = [
            RoadmapOperation(
                op='update_node',
                node_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                patch={'title': 'Payload Commit Op'},
            )
        ]
        observed_payloads: list[dict[str, Any]] = []
        updated_sessions: list[AgentSession] = []

        class _FakeStore:
            def update(self, updated_session):
                updated_sessions.append(updated_session)

        async def _fake_commit(**kwargs):
            observed_payloads.append(dict(kwargs.get('payload') or {}))
            return {'revision_token': 'rev-2'}

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.commit_session(
                session_id='session-1',
                payload=sessions_routes.CommitRequest(operations=payload_operations),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(len(observed_payloads), 1)
        observed_operations = observed_payloads[0].get('operations')
        self.assertIsInstance(observed_operations, list)
        assert isinstance(observed_operations, list)
        self.assertEqual(observed_operations[0].get('node_id'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
        self.assertEqual(session.metadata.applied_draft_commits[-1].draft_id, 'draft-active')
        self.assertEqual(session.metadata.applied_draft_commits[-1].draft_version, 0)
        self.assertEqual(
            session.operations[0].node_id,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        )
        self.assertEqual(len(updated_sessions), 1)

    async def test_commit_session_graph_mode_reuses_selected_draft_as_post_commit_head(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.metadata.active_draft_id = 'draft-1'
        session.metadata.drafts = {
            'draft-1': DraftNode(
                draft_id='draft-1',
                draft_version=2,
                status='active',
                operations=[
                    RoadmapOperation(
                        op='update_node',
                        node_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        patch={'title': 'Version 2'},
                    )
                ],
            )
        }
        updated_sessions: list[AgentSession] = []

        class _FakeStore:
            def update(self, updated_session):
                updated_sessions.append(updated_session)

        class _FakeAgentService:
            def ensure_draft_graph_initialized(self, _session):
                return None

            def get_active_draft(self, candidate_session):
                active_draft_id = candidate_session.metadata.active_draft_id
                assert isinstance(active_draft_id, str)
                return candidate_session.metadata.drafts[active_draft_id]

        async def _fake_commit(**_kwargs):
            return {
                'change_id': '68f92439-f4e5-4320-a9fd-9797f699a669',
                'revision_token': 'rev-2',
            }

        original_graph_enabled = sessions_routes.settings.agent_draft_graph_enabled
        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes.settings.agent_draft_graph_enabled = True
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), _FakeAgentService()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.commit_session(
                session_id='session-1',
                payload=sessions_routes.CommitRequest(),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes.settings.agent_draft_graph_enabled = original_graph_enabled
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(session.metadata.active_draft_id, 'draft-1')
        self.assertEqual(session.metadata.draft_head_ids, ['draft-1'])
        self.assertEqual(session.metadata.drafts['draft-1'].status, 'active')
        self.assertEqual(session.metadata.drafts['draft-1'].operations, [])
        self.assertEqual(session.metadata.drafts['draft-1'].draft_version, 3)
        self.assertEqual(len(updated_sessions), 1)

    async def test_commit_session_with_strict_preview_setting_enabled_succeeds(self) -> None:
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

        async def _fake_commit(**_kwargs):
            return {'revision_token': 'rev-2'}

        original_get_runtime = sessions_routes._get_agent_runtime_async
        original_get_session = sessions_routes._get_session_or_404_async
        original_commit = sessions_routes._nest_client.commit
        sessions_routes._get_agent_runtime_async = (  # type: ignore[assignment]
            lambda: _async_runtime_result((_FakeStore(), object()))
        )
        sessions_routes._get_session_or_404_async = (  # type: ignore[assignment]
            lambda _service, _session_id: _async_runtime_result(session)
        )
        sessions_routes._nest_client.commit = _fake_commit  # type: ignore[assignment]
        try:
            response = await sessions_routes.commit_session(
                session_id='session-1',
                payload=sessions_routes.CommitRequest(),
                request=SimpleNamespace(headers={}),
            )
        finally:
            sessions_routes._get_agent_runtime_async = original_get_runtime  # type: ignore[assignment]
            sessions_routes._get_session_or_404_async = original_get_session  # type: ignore[assignment]
            sessions_routes._nest_client.commit = original_commit  # type: ignore[assignment]

        self.assertEqual(response['session_id'], 'session-1')
        self.assertEqual(session.revision_token, 'rev-2')


async def _async_runtime_result(value):
    return value


class PlannerContextSafetyTests(unittest.TestCase):
    def _planner(self) -> LLMPlanner:
        class _ProviderOrchestrator:
            def call(self, operation, *, trace_context=None):
                phase = str((trace_context or {}).get('phase') or '')

                def _generate_chat_reply(**_kwargs):
                    if phase == 'edit_clarifier':
                        return (
                            '{"action":"ask_clarifier","reason":"insufficient_context",'
                            '"question":"Which exact change should I apply?",'
                            '"options":["Create epic","Rename node","Cancel"]}'
                        )
                    return 'Stub chat reply'

                adapter = SimpleNamespace(generate_chat_reply=_generate_chat_reply)
                return ProviderCallOutcome(
                    value=operation(adapter),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner = object.__new__(LLMPlanner)
        planner._settings = get_settings().model_copy(
            update={
                'agent_strict_mutation_authority_enabled': False,
            }
        )
        planner._logger = logging.getLogger('planner-context-safety-tests')
        planner._nest_client = SimpleNamespace()
        planner._run_async_context_call = lambda value: value
        planner._prompt_repository = SimpleNamespace(
            build_system_prompt=lambda mode, context: f'{mode}:{context}'
        )
        planner._provider_orchestrator = _ProviderOrchestrator()
        planner._build_history_messages = (
            lambda _session_context, max_messages=None: []
        )
        planner._rule_based_chat_response = lambda _user_message, _intent_type: 'rule-based fallback'
        return planner

    def test_classify_intent_honors_forced_edit_continuation_override(self) -> None:
        planner = self._planner()
        state = planner._classify_intent(
            {
                'user_message': 'Can you try again?',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-force-override',
                    'force_edit_continuation': True,
                    'force_edit_continuation_reason': 'retry',
                },
            }
        )
        self.assertEqual(state.get('intent_type'), 'roadmap_edit')
        self.assertEqual(state.get('parse_mode'), 'deterministic_edit_continuation_override')
        self.assertFalse(bool(state.get('is_roadmap_question')))

    def test_compose_dynamic_system_prompt_includes_react_observation_keys(self) -> None:
        planner = self._planner()
        state = planner._compose_dynamic_system_prompt(
            {
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'base_revision': 12,
                    'revision_token': 'rev-token',
                    'recent_messages': [],
                    'trace_id': 'trace-prompt-react-observation',
                    '_react_loop_turn': 2,
                    '_react_loop_budget': 4,
                    '_react_loop_observation': {
                        'stop_reason': 'insufficient_context',
                        'tool_plan_steps': 1,
                    },
                    '_react_tool_observation_summary': [
                        {
                            'tool_name': 'resolve_node_reference',
                            'status': 'ambiguous',
                        }
                    ],
                },
            }
        )

        system_prompt = str(state.get('system_prompt') or '')
        self.assertIn('react_loop_turn', system_prompt)
        self.assertIn('react_loop_budget', system_prompt)
        self.assertIn('react_loop_observation', system_prompt)
        self.assertIn('react_tool_observation_summary', system_prompt)

    def test_heuristic_intent_classifies_task_reassignment_as_edit(self) -> None:
        planner = self._planner()
        intent = planner._heuristic_intent(
            'Reassign all tasks in this roadmap to me regardless of existing owners'
        )
        self.assertEqual(intent, 'roadmap_edit')

    def test_heuristic_intent_classifies_confirm_action(self) -> None:
        planner = self._planner()
        intent = planner._heuristic_intent('yes go ahead')
        self.assertEqual(intent, 'confirm_action')

    def test_classify_intent_promotes_roadmap_question_to_roadmap_query(self) -> None:
        planner = self._planner()
        state = planner._classify_intent(
            {
                'user_message': 'What tasks are overdue?',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-roadmap-query-promotion',
                },
            }
        )
        self.assertEqual(state.get('intent_type'), 'roadmap_query')
        self.assertTrue(bool(state.get('is_roadmap_question')))

    def test_classify_intent_promotes_question_style_edit_to_roadmap_edit(self) -> None:
        planner = self._planner()
        state = planner._classify_intent(
            {
                'user_message': 'Can you make all tasks in Agent Module done?',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-question-style-edit-promotion',
                },
            }
        )
        self.assertEqual(state.get('intent_type'), 'roadmap_edit')
        self.assertFalse(bool(state.get('is_roadmap_question')))
        self.assertEqual(state.get('parse_mode'), 'heuristic_question_style_edit_override')
        self.assertTrue(bool(state.get('question_style_edit_promoted')))

    def test_compose_dynamic_system_prompt_routes_roadmap_query_mode(self) -> None:
        planner = self._planner()
        state = planner._compose_dynamic_system_prompt(
            {
                'intent_type': 'roadmap_query',
                'existing_operations': [],
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-query-mode',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'chat')
        self.assertEqual(state.get('tool_mode'), 'context_answer')
        self.assertTrue(str(state.get('system_prompt') or '').startswith('query:'))

    def test_compose_dynamic_system_prompt_guards_informational_operation_question(self) -> None:
        planner = self._planner()
        state = planner._compose_dynamic_system_prompt(
            {
                'intent_type': 'roadmap_edit',
                'user_message': 'How do we mark all tasks done?',
                'existing_operations': [],
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-edit-informational-guard',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'edit_plan')
        self.assertEqual(state.get('tool_mode'), 'edit_plan')
        self.assertTrue(str(state.get('system_prompt') or '').startswith('edit:'))
        self.assertFalse(bool(state.get('edit_to_clarifier_guarded')))

    def test_generate_chat_reply_returns_clarifier_for_guarded_edit_question(self) -> None:
        planner = self._planner()
        state = planner._generate_chat_reply(
            {
                'intent_type': 'roadmap_edit',
                'edit_to_clarifier_guarded': True,
                'user_message': 'How do we mark all tasks done?',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-edit-clarifier-guard-chat',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'chat')
        self.assertEqual(state.get('parse_mode'), 'openai_chat')
        self.assertEqual(state.get('assistant_message'), 'Stub chat reply')
        self.assertEqual(len(state.get('planned_operations') or []), 0)

    def test_generate_chat_reply_confirm_without_context_is_rule_based(self) -> None:
        planner = self._planner()
        state = planner._generate_chat_reply(
            {
                'intent_type': 'confirm_action',
                'confirm_without_context': True,
                'user_message': 'Yes apply',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-confirm-without-context',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'chat')
        self.assertEqual(state.get('parse_mode'), 'confirm_action_missing_context')
        self.assertEqual(state.get('provider_used'), 'rule_based')
        self.assertEqual(state.get('provider_error_code'), 'confirm_action_missing_context')
        self.assertEqual(state.get('assistant_message'), 'rule-based fallback')
        self.assertEqual(len(state.get('planned_operations') or []), 0)

    def test_compose_dynamic_system_prompt_routes_roadmap_plan_mode(self) -> None:
        planner = self._planner()
        # Pin the plan-proposal flag off so this legacy-routing assertion is
        # deterministic regardless of local .env. The plan-proposal routing is
        # covered separately in test_plan_proposal_routing.py.
        planner._settings.agent_plan_proposal_enabled = False
        state = planner._compose_dynamic_system_prompt(
            {
                'intent_type': 'roadmap_plan',
                'existing_operations': [],
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-plan-mode',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'edit_plan')
        self.assertEqual(state.get('tool_mode'), 'plan_only')
        self.assertTrue(str(state.get('system_prompt') or '').startswith('plan:'))

    def test_compose_dynamic_system_prompt_confirm_without_context_stays_chat(self) -> None:
        planner = self._planner()
        state = planner._compose_dynamic_system_prompt(
            {
                'intent_type': 'confirm_action',
                'existing_operations': [],
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-confirm-no-context',
                },
            }
        )

        self.assertEqual(state.get('response_mode'), 'chat')
        self.assertEqual(state.get('tool_mode'), 'none')
        self.assertTrue(str(state.get('system_prompt') or '').startswith('chat:'))

    def test_resolve_node_reference_uses_normalized_query_variant(self) -> None:
        planner = self._planner()
        observed_queries: list[str] = []

        def _context_search(**kwargs):
            query = str(kwargs.get('query') or '')
            observed_queries.append(query)
            if query == 'App Foundation':
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'App  Foundation',
                        }
                    ]
                }
            return {'matches': []}

        planner._nest_client = SimpleNamespace(context_search=_context_search)
        result = planner._execute_context_tool(
            'resolve_node_reference',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'label': '  "App   Foundation"  ',
                'limit': 10,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )
        self.assertIn('App Foundation', observed_queries)
        self.assertEqual(len(observed_queries), 1)
        self.assertEqual(result.get('status'), 'unique')
        selected = result.get('selected') or {}
        self.assertEqual(selected.get('id'), 'dad5697a-8962-4f80-8bc3-8a964edd8e56')

    def test_resolve_node_reference_parallel_variants_enabled_executes_multiple_queries(self) -> None:
        planner = self._planner()
        observed_queries: list[str] = []

        def _context_search(**kwargs):
            query = str(kwargs.get('query') or '')
            observed_queries.append(query)
            if query == 'App Foundation':
                return {
                    'matches': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'type': 'epic',
                            'title': 'App Foundation',
                        }
                    ]
                }
            return {'matches': []}

        planner._nest_client = SimpleNamespace(context_search=_context_search)
        planner._settings = planner._settings.model_copy(
            update={'agent_resolve_parallel_variants_enabled': True}
        )
        planner._context_tools_executor = None
        result = planner._execute_context_tool(
            'resolve_node_reference',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'label': '  "App   Foundation"  ',
                'limit': 10,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )

        self.assertIn('App Foundation', observed_queries)
        self.assertGreaterEqual(len(observed_queries), 2)
        self.assertEqual(result.get('status'), 'unique')
        selected = result.get('selected') or {}
        self.assertEqual(selected.get('id'), 'dad5697a-8962-4f80-8bc3-8a964edd8e56')

    def test_resolve_node_reference_skips_generic_fallback_term(self) -> None:
        planner = self._planner()
        observed_queries: list[str] = []

        def _context_search(**kwargs):
            query = str(kwargs.get('query') or '')
            observed_queries.append(query)
            return {'matches': []}

        planner._nest_client = SimpleNamespace(context_search=_context_search)
        result = planner._execute_context_tool(
            'resolve_node_reference',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'label': 'Autenthication System',
                'node_type': 'epic',
                'limit': 5,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )

        self.assertEqual(result.get('status'), 'not_found')
        self.assertNotIn('System', observed_queries)
        self.assertIn('Autenthication System', observed_queries)

    def test_resolve_node_reference_fuzzy_epic_fallback_handles_typo(self) -> None:
        planner = self._planner()
        observed_queries: list[str] = []
        summary_calls = {'value': 0}

        def _context_search(**kwargs):
            query = str(kwargs.get('query') or '')
            observed_queries.append(query)
            return {'matches': []}

        def _context_summary(**_kwargs):
            summary_calls['value'] += 1
            return {
                'epics': [
                    {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'title': 'Authentication System',
                        'status': 'in_progress',
                        'feature_count': 2,
                    },
                    {
                        'id': '58e1cd84-703d-4ce3-97da-77a7908f8e9f',
                        'title': 'Billing System',
                        'status': 'todo',
                        'feature_count': 1,
                    },
                ]
            }

        planner._nest_client = SimpleNamespace(
            context_search=_context_search,
            context_summary=_context_summary,
        )
        result = planner._execute_context_tool(
            'resolve_node_reference',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'label': 'Autenthication System',
                'node_type': 'epic',
                'limit': 5,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )

        self.assertIn('Autenthication System', observed_queries)
        self.assertEqual(summary_calls['value'], 1)
        self.assertEqual(result.get('status'), 'unique')
        selected = result.get('selected') or {}
        self.assertEqual(selected.get('id'), 'dad5697a-8962-4f80-8bc3-8a964edd8e56')

    def test_resolve_node_reference_dedupes_within_single_session_context(self) -> None:
        planner = self._planner()
        call_count = 0

        def _context_search(**_kwargs):
            nonlocal call_count
            call_count += 1
            return {
                'matches': [
                    {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'type': 'epic',
                        'title': 'AI Module',
                    }
                ]
            }

        planner._nest_client = SimpleNamespace(context_search=_context_search)
        session_context = {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'}
        args = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'label': 'AI Module',
            'node_type': 'epic',
            'limit': 5,
        }

        first = planner._execute_context_tool('resolve_node_reference', args, session_context)
        second = planner._execute_context_tool('resolve_node_reference', args, session_context)

        self.assertEqual(call_count, 1)
        self.assertEqual(first.get('status'), 'unique')
        self.assertEqual(second.get('status'), 'unique')

    def test_resolve_node_reference_uses_short_lived_lookup_cache_across_contexts(self) -> None:
        planner = self._planner()
        call_count = 0

        def _context_search(**_kwargs):
            nonlocal call_count
            call_count += 1
            return {
                'matches': [
                    {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'type': 'epic',
                        'title': 'AI Module',
                    }
                ]
            }

        planner._nest_client = SimpleNamespace(context_search=_context_search)
        planner._settings = planner._settings.model_copy(
            update={'agent_resolve_cache_ttl_seconds': 30}
        )
        planner._context_tools_executor = None

        args = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'label': 'AI Module',
            'node_type': 'epic',
            'limit': 5,
        }
        first_context = {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'}
        second_context = {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'}

        first = planner._execute_context_tool('resolve_node_reference', args, first_context)
        second = planner._execute_context_tool('resolve_node_reference', args, second_context)

        self.assertEqual(call_count, 1)
        self.assertEqual(first.get('status'), 'unique')
        self.assertEqual(second.get('status'), 'unique')

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

    def test_context_answer_non_my_tasks_uses_llm_lane(self) -> None:
        planner = self._planner()
        cache = {}

        class _FakeCache:
            def get(self, key):
                return cache.get(key)

            def set(self, key, value):
                cache[key] = value

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value='Here are the features under Platform Foundation.',
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        planner._context_answer_cache = _FakeCache()
        planner._build_context_cache_key = lambda **_kwargs: 'cache-key'
        planner._execute_context_tool = lambda _n, _a, _c: {'error': {'code': 'UNUSED'}}
        planner._chat_fallback_builder = lambda _msg, _intent: 'fallback'

        result = planner._generate_context_answer(
            {
                'user_message': 'What are the features of Platform Foundation?',
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-context-llm-lane',
                },
                'intent_type': 'question',
            }
        )

        self.assertEqual(result.get('provider_used'), 'openai')
        self.assertEqual(result.get('parse_mode'), 'openai_context_tools')
        self.assertEqual(result.get('route_lane'), 'discovery_lane')

    def test_plan_operations_missing_tool_call_uses_edit_clarifier_lane(self) -> None:
        planner = self._planner()
        call_count = {'value': 0}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    raise ProviderAdapterError(
                        provider='openai',
                        code='missing_tool_call',
                        message='OpenAI did not return any tool call while planning operations.',
                    )
                return ProviderCallOutcome(
                    value=(
                        'Do you want me to create a new epic named "AI Module" at the roadmap root?',
                        [],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Create AI Module here',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d', 'trace_id': 'trace-clarifier'},
            }
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')
        self.assertEqual(result.get('provider_error_code'), 'missing_tool_call')
        self.assertEqual(result.get('planned_operations'), [])
        self.assertEqual(result.get('clarifier_action'), 'ask_clarifier')
        self.assertEqual(result.get('draft_action'), 'continue')
        self.assertEqual(result.get('tool_plan'), [])
        self.assertTrue(bool(result.get('needs_more_info')))
        self.assertEqual(result.get('stop_reason'), 'awaiting_user_input')
        self.assertNotIn('Options:', str(result.get('assistant_message')))

    def test_plan_operations_react_invalid_shape_retries_once(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    return ProviderCallOutcome(
                        value='not valid json',
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )
                return ProviderCallOutcome(
                    value=('Need one more detail to continue safely.', []),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Create feature AI Module',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-react-retry',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')
        self.assertEqual(result.get('planned_operations'), [])
        self.assertEqual(result.get('clarifier_action'), 'ask_clarifier')
        self.assertEqual(result.get('planner_schema_invalid_attempts'), 1)
        self.assertTrue(result.get('planner_repair_attempted'))

    def test_plan_operations_missing_tool_call_repair_prompt_includes_guidance(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        captured_prompts: list[str] = []
        captured_tool_names: list[list[str]] = []

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    raise ProviderAdapterError(
                        provider='openai',
                        code='missing_tool_call',
                        message='OpenAI did not return any tool call while planning operations.',
                    )

                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured_prompts.append(planner_prompt)
                        captured_tool_names.append(
                            [
                                str(tool.get('function', {}).get('name') or '')
                                for tool in tools
                                if isinstance(tool, dict)
                            ]
                        )
                        return ('Which exact node should I rename?', [])

                return ProviderCallOutcome(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Rename PM Module',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-missing-tool-call-repair-guidance',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(captured_prompts), 1)
        self.assertIn(
            'IMPORTANT REPAIR: Your previous response did not call plan_roadmap_operations.',
            captured_prompts[0],
        )
        self.assertEqual(captured_tool_names, [['plan_roadmap_operations']])
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_missing_tool_call_then_empty_clarifier_skips_bulk_synthesis_for_relaxed_resolution(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        helper_calls: list[dict[str, Any]] = []

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'type_relaxed': True,
                    'resolve_source': 'type_relaxed',
                    'resolve_diagnostics': {
                        'candidate_count': 1,
                        'selected_confidence': 0.98,
                        'second_confidence': None,
                        'confidence_margin': None,
                    },
                    'selected': {
                        'id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                        'type': 'feature',
                        'title': 'Authentication System',
                        'confidence': 0.98,
                    },
                    'matches': [
                        {
                            'id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                            'type': 'feature',
                            'title': 'Authentication System',
                            'confidence': 0.98,
                        }
                    ],
                }
            if name == 'bulk_update_tasks_by_parent':
                helper_calls.append(dict(args))
                return {
                    'operations': [
                        {
                            'op': 'mark_status',
                            'node_type': 'task',
                            'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'status': 'in_review',
                        }
                    ],
                    'matched_task_count': 1,
                    'updated_task_count': 1,
                }
            return {'error': {'code': 'UNKNOWN'}}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:

                    class _AdapterFirstAttempt:
                        def plan_operations_with_tools(
                            self,
                            *,
                            system_prompt,
                            planner_prompt,
                            history_messages,
                            tools,
                            tool_executor,
                            max_tool_turns,
                        ):
                            tool_executor(
                                'resolve_node_reference',
                                {
                                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                                    'label': 'Autenthication System',
                                    'node_type': 'epic',
                                    'limit': 5,
                                },
                            )
                            raise ProviderAdapterError(
                                provider='openai',
                                code='missing_tool_call',
                                message='OpenAI did not return any tool call while planning operations.',
                            )

                    return ProviderCallOutcome(
                        value=operation(_AdapterFirstAttempt()),
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )

                class _AdapterSecondAttempt:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        return ('Please confirm exact target.', [])

                return ProviderCallOutcome(
                    value=operation(_AdapterSecondAttempt()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Mark all tasks in the Autenthication System as in review',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-missing-tool-call-bulk-relaxed-skip',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(helper_calls), 0)
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_plan_operations_invalid_payload_repair_prompt_includes_error_detail(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        captured_prompts: list[str] = []

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    raise ProviderAdapterError(
                        provider='openai',
                        code='invalid_operation_payload',
                        message='Invalid operation payload at index 0: mark_status.status_missing',
                    )

                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured_prompts.append(planner_prompt)
                        return ('Prepared operations.', [])

                return ProviderCallOutcome(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Mark all tasks in Authentication as in review',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-invalid-payload-repair-guidance',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(captured_prompts), 1)
        self.assertIn(
            'IMPORTANT REPAIR: Your previous tool-call payload failed schema validation.',
            captured_prompts[0],
        )
        self.assertIn(
            'Use existing resolved IDs and avoid repeating discovery tools unless IDs are still missing.',
            captured_prompts[0],
        )
        self.assertIn(
            'For assignment updates, use patch.assignee_id (never assignee).',
            captured_prompts[0],
        )
        self.assertIn(
            'When assigning to "me", use actor_context.actor_id from runtime context.',
            captured_prompts[0],
        )
        self.assertIn(
            'Validation detail: Invalid operation payload at index 0: mark_status.status_missing',
            captured_prompts[0],
        )
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_plan_operations_invalid_enum_payload_retries_without_narrowing_tools(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        captured_prompts: list[str] = []
        captured_tool_names: list[list[str]] = []

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    raise ProviderAdapterError(
                        provider='openai',
                        code='invalid_operation_payload',
                        message=(
                            'Invalid operation payload at index 0 (op=bulk_update_tasks_by_parent): '
                            "[{'type': 'enum', 'loc': ('op',), 'msg': \"Input should be 'add_epic'\"}]"
                        ),
                    )

                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured_prompts.append(planner_prompt)
                        captured_tool_names.append(
                            [
                                str(tool.get('function', {}).get('name') or '')
                                for tool in tools
                                if isinstance(tool, dict)
                            ]
                        )
                        return ('Need one detail.', [])

                return ProviderCallOutcome(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Mark all tasks in Authentication System as done',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-invalid-enum-planning-only-retry',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(captured_tool_names), 1)
        retry_tool_names = captured_tool_names[0]
        self.assertIn('plan_roadmap_operations', retry_tool_names)
        self.assertGreater(
            len(retry_tool_names),
            1,
            'retry should keep the full tool envelope; enum violations are '
            'prevented at sampling by strict-mode, not by runtime narrowing.',
        )
        self.assertEqual(len(captured_prompts), 1)
        self.assertIn('Allowed operation op values:', captured_prompts[0])
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_plan_operations_logs_explicit_planning_tool_boundary(self) -> None:
        planner = self._planner()
        captured_planning_tool_events: list[tuple[str, dict[str, Any]]] = []

        def _capture_log_event(_logger, event, **kwargs):
            if kwargs.get('tool_name') == 'plan_roadmap_operations':
                captured_planning_tool_events.append((event, kwargs))

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        return (
                            'Prepared operations.',
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
                        )

                return ProviderCallOutcome(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        original_log_event = planner_operation_flow.log_event
        planner_operation_flow.log_event = _capture_log_event  # type: ignore[assignment]

        try:
            result = planner._plan_operations(
                {
                    'user_message': 'Mark task as in review',
                    'existing_operations': [],
                    'system_prompt': 'system',
                    'session_context': {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'trace_id': 'trace-planning-tool-boundary',
                    },
                }
            )
        finally:
            planner_operation_flow.log_event = original_log_event  # type: ignore[assignment]

        planning_events = [name for name, _ in captured_planning_tool_events]
        self.assertIn('tool_call_requested', planning_events)
        self.assertIn('tool_call_result', planning_events)
        requested = [item for item in captured_planning_tool_events if item[0] == 'tool_call_requested']
        self.assertTrue(requested)
        self.assertEqual(requested[0][1].get('tool_args', {}).get('operations_count'), 1)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_task_intent_retries_when_plan_targets_parent_status(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        captured_prompts: list[str] = []
        captured_tool_names: list[list[str]] = []

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'type_relaxed': False,
                    'selected': {
                        'id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                        'type': 'feature',
                        'title': 'Authentication System',
                    },
                    'matches': [
                        {
                            'id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                            'type': 'feature',
                            'title': 'Authentication System',
                        }
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    class _AdapterFirstAttempt:
                        def plan_operations_with_tools(
                            self,
                            *,
                            system_prompt,
                            planner_prompt,
                            history_messages,
                            tools,
                            tool_executor,
                            max_tool_turns,
                        ):
                            tool_executor(
                                'resolve_node_reference',
                                {
                                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                                    'label': 'Autenthication System',
                                    'allowed_node_types': ['feature', 'epic'],
                                    'fuzzy': True,
                                    'auto_correct': True,
                                    'limit': 5,
                                },
                            )
                            return (
                                'Prepared an operation.',
                                [
                                    {
                                        'op': 'mark_status',
                                        'node_type': 'feature',
                                        'node_id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                                        'status': 'in_review',
                                    }
                                ],
                            )

                    return ProviderCallOutcome(
                        value=operation(_AdapterFirstAttempt()),
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )

                class _AdapterSecondAttempt:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured_prompts.append(planner_prompt)
                        captured_tool_names.append(
                            [
                                str(tool.get('function', {}).get('name') or '')
                                for tool in tools
                                if isinstance(tool, dict)
                            ]
                        )
                        return (
                            'Prepared task operations.',
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
                        )

                return ProviderCallOutcome(
                    value=operation(_AdapterSecondAttempt()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'mark all tasks in my Autenthication System as in review',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-bulk-task-parent-status-retry',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(captured_prompts), 1)
        self.assertIn('BULK TASK STATUS CONTRACT REPAIR:', captured_prompts[0])
        self.assertTrue(captured_tool_names)
        self.assertIn('bulk_update_tasks_by_parent', captured_tool_names[0])
        self.assertIn('plan_roadmap_operations', captured_tool_names[0])
        self.assertEqual(result.get('response_mode'), 'edit_plan')
        planned_ops = result.get('planned_operations') or []
        self.assertEqual(len(planned_ops), 1)
        self.assertEqual(planned_ops[0].node_type.value, 'task')
        self.assertEqual(planned_ops[0].op.value, 'mark_status')

    def test_plan_operations_missing_tool_call_retry_adds_ordered_todo_delete_policy(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}
        captured_prompt = {'value': ''}
        captured_tool_names: list[list[str]] = []

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                        'type': 'feature',
                        'title': 'Roadmap JSON Editor',
                    },
                }
            if name == 'get_children':
                return {
                    'children': [
                        {
                            'id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'title': 'Todo Task 1',
                            'status': 'todo',
                            'type': 'task',
                        },
                        {
                            'id': 'c12347aa-ef79-4313-aabd-8db137ccbaaf',
                            'title': 'Done Task',
                            'status': 'done',
                            'type': 'task',
                        },
                        {
                            'id': 'd4d5ff11-8ec7-4fa6-a1fc-9b50be24a1a3',
                            'title': 'Todo Task 2',
                            'status': 'todo',
                            'type': 'task',
                        },
                        {
                            'id': 'e5a52172-cdc9-4e9a-bf11-2f0d5a0f4f84',
                            'title': 'Todo Feature',
                            'status': 'todo',
                            'type': 'feature',
                        },
                        {
                            'id': 'f6ee1d09-e4c1-4f2f-92d9-7ea6e89e64f2',
                            'title': 'Todo Task 3',
                            'status': 'todo',
                            'type': 'task',
                        },
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:

                    class _AdapterFirstAttempt:
                        def plan_operations_with_tools(
                            self,
                            *,
                            system_prompt,
                            planner_prompt,
                            history_messages,
                            tools,
                            tool_executor,
                            max_tool_turns,
                        ):
                            tool_executor(
                                'resolve_node_reference',
                                {
                                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                                    'label': 'Roadmap JSON Editor',
                                    'limit': 10,
                                },
                            )
                            tool_executor(
                                'get_children',
                                {
                                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                                    'parent_id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                                    'limit': 100,
                                },
                            )
                            raise ProviderAdapterError(
                                provider='openai',
                                code='missing_tool_call',
                                message='OpenAI did not return any tool call while planning operations.',
                            )

                    return ProviderCallOutcome(
                        value=operation(_AdapterFirstAttempt()),
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )

                class _AdapterSecondAttempt:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured_prompt['value'] = planner_prompt
                        captured_tool_names.append(
                            [
                                str(tool.get('function', {}).get('name') or '')
                                for tool in tools
                                if isinstance(tool, dict)
                            ]
                        )
                        return ('Need one more detail.', [])

                return ProviderCallOutcome(
                    value=operation(_AdapterSecondAttempt()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        planner._provider_orchestrator = _FakeOrchestrator()

        result = planner._plan_operations(
            {
                'user_message': 'Remove 3 todo tasks in the Roadmap JSON Editor',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-missing-tool-call-todo-delete-policy',
                },
            }
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(captured_tool_names, [['plan_roadmap_operations']])
        prompt_text = str(captured_prompt.get('value') or '')
        self.assertIn('RETRY TOOL OBSERVATION SUMMARY:', prompt_text)
        self.assertIn('DETERMINISTIC TODO DELETE SELECTION POLICY:', prompt_text)
        self.assertIn('Select the first 3 candidates in listed order', prompt_text)
        self.assertIn('b026e967-54c3-4f11-9c49-b95a680aa2a7', prompt_text)
        self.assertIn('d4d5ff11-8ec7-4fa6-a1fc-9b50be24a1a3', prompt_text)
        self.assertIn('f6ee1d09-e4c1-4f2f-92d9-7ea6e89e64f2', prompt_text)
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_plan_operations_react_execute_returns_operations(self) -> None:
        planner = self._planner()

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value=(
                        'Create epic AI Module.',
                        [
                            {
                                'op': 'add_epic',
                                'data': {'title': 'AI Module'},
                            }
                        ],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=10,
                    tokens_output=20,
                    tokens_total=30,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Create epic AI Module',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-react-execute',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling')
        self.assertEqual(result.get('stop_reason'), 'ready_to_stage')
        self.assertEqual(result.get('draft_action'), 'continue')
        planned_ops = result.get('planned_operations') or []
        self.assertEqual(len(planned_ops), 1)
        self.assertEqual(planned_ops[0].op.value, 'add_epic')
        self.assertEqual(planned_ops[0].data, {'title': 'AI Module'})

    def test_plan_operations_deictic_parent_hint_repairs_invalid_parent_id(self) -> None:
        planner = self._planner()

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value=(
                        'Prepared feature operations.',
                        [
                            {
                                'op': 'add_feature',
                                'parent_id': 'that-epic',
                                'data': {'title': 'Login'},
                            }
                        ],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Add Login feature inside that',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-parent-hint-repair',
                    'deictic_parent_hint': {
                        'node_id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'node_type': 'epic',
                        'title': 'Platform Foundation',
                    },
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('stop_reason'), 'ready_to_stage')
        planned_ops = result.get('planned_operations') or []
        self.assertEqual(len(planned_ops), 1)
        self.assertEqual(planned_ops[0].op.value, 'add_feature')
        self.assertEqual(
            planned_ops[0].parent_id,
            'dad5697a-8962-4f80-8bc3-8a964edd8e56',
        )

    def test_plan_operations_parent_ref_chain_does_not_trigger_parent_uuid_clarifier(self) -> None:
        planner = self._planner()

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value=(
                        'Prepared create operations.',
                        [
                            {
                                'op': 'add_epic',
                                'temp_id': 'tmp_epic_1',
                                'data': {'title': 'Identity Platform'},
                            },
                            {
                                'op': 'add_feature',
                                'temp_id': 'tmp_feature_1',
                                'parent_ref': 'tmp_epic_1',
                                'data': {'title': 'Authentication'},
                            },
                            {
                                'op': 'add_feature',
                                'temp_id': 'tmp_feature_2',
                                'parent_ref': 'tmp_epic_1',
                                'data': {'title': 'Authorization'},
                            },
                        ],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Create Identity Platform epic with Authentication and Authorization features',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-parent-ref-chain',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('stop_reason'), 'ready_to_stage')
        self.assertEqual(result.get('provider_error_code'), None)
        planned_ops = result.get('planned_operations') or []
        self.assertEqual(len(planned_ops), 3)
        self.assertEqual(
            [operation.op.value for operation in planned_ops],
            ['add_epic', 'add_feature', 'add_feature'],
        )
        self.assertEqual(planned_ops[1].parent_ref, 'tmp_epic_1')
        self.assertEqual(planned_ops[2].parent_ref, 'tmp_epic_1')

    def test_plan_operations_auto_generates_tasks_per_feature_for_hierarchical_create(self) -> None:
        planner = self._planner()

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value=(
                        'Prepared create operations.',
                        [
                            {
                                'op': 'add_epic',
                                'temp_id': 'tmp_epic_1',
                                'data': {'title': 'Identity Platform'},
                            },
                            {
                                'op': 'add_feature',
                                'parent_ref': 'tmp_epic_1',
                                'data': {'title': 'Authentication'},
                            },
                            {
                                'op': 'add_feature',
                                'parent_ref': 'tmp_epic_1',
                                'data': {'title': 'Authorization'},
                            },
                        ],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': (
                    'Create epic Identity Platform with features Authentication and '
                    'Authorization and tree tasks each'
                ),
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-hierarchical-create-completion',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('stop_reason'), 'ready_to_stage')
        planned_ops = result.get('planned_operations') or []
        self.assertEqual(len(planned_ops), 9)

        epic_ops = [operation for operation in planned_ops if operation.op.value == 'add_epic']
        feature_ops = [operation for operation in planned_ops if operation.op.value == 'add_feature']
        task_ops = [operation for operation in planned_ops if operation.op.value == 'add_task']
        self.assertEqual(len(epic_ops), 1)
        self.assertEqual(len(feature_ops), 2)
        self.assertEqual(len(task_ops), 6)

        feature_temp_ids = [str(operation.temp_id or '') for operation in feature_ops]
        self.assertEqual(feature_temp_ids, ['tmp_feature_1', 'tmp_feature_2'])
        self.assertEqual(
            sum(1 for operation in task_ops if operation.parent_ref == 'tmp_feature_1'),
            3,
        )
        self.assertEqual(
            sum(1 for operation in task_ops if operation.parent_ref == 'tmp_feature_2'),
            3,
        )

        task_titles = {
            str((operation.data or {}).get('title') or '')
            for operation in task_ops
            if isinstance(operation.data, dict)
        }
        self.assertSetEqual(
            task_titles,
            {
                'Authentication Task 1',
                'Authentication Task 2',
                'Authentication Task 3',
                'Authorization Task 1',
                'Authorization Task 2',
                'Authorization Task 3',
            },
        )

    def test_plan_operations_react_clarifies_on_empty_operations(self) -> None:
        planner = self._planner()

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                return ProviderCallOutcome(
                    value=('What exact change should I stage?', []),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Do the edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-react-empty-operations',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')
        self.assertEqual(result.get('planned_operations'), [])
        self.assertEqual(result.get('clarifier_action'), 'ask_clarifier')
        self.assertEqual(result.get('planner_schema_invalid_attempts'), 0)
        self.assertFalse(bool(result.get('planner_repair_attempted')))
        self.assertTrue(bool(result.get('needs_more_info')))
        self.assertEqual(result.get('stop_reason'), 'awaiting_user_input')

    def test_plan_operations_react_tuple_wrong_arity_retries_then_clarifies(self) -> None:
        # 3-tuples carrying (assistant_message, operations, clarifier_options)
        # are now the legitimate planner output shape. This test exercises a
        # truly malformed arity (4-tuple) that still must trigger a retry.
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                if call_count['value'] == 1:
                    return ProviderCallOutcome(
                        value=('oops', [], [], 'unexpected-fourth-item'),
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                    )
                return ProviderCallOutcome(
                    value=('Which node should I update?', []),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Rename platform foundation',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-react-wrong-arity',
                },
            }
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')
        self.assertEqual(result.get('planned_operations'), [])
        self.assertEqual(result.get('planner_schema_invalid_attempts'), 1)
        self.assertTrue(result.get('planner_repair_attempted'))

    def test_plan_operations_react_three_tuple_with_clarifier_options_is_accepted(self) -> None:
        """Regression: the arity gate at planner_operation_flow.py used to
        reject 3-tuples even though the consumer already unpacked them.
        That caused the vague-value preflight clarifier flow to fail
        schema-validation twice and return a generic provider_outage
        message to the user. The 3-tuple must be accepted on the first
        attempt without any schema_invalid retry.
        """
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        call_count = {'value': 0}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                call_count['value'] += 1
                return ProviderCallOutcome(
                    value=(
                        'What should the new title be?',
                        [],
                        [
                            'Career readiness & interview skills',
                            'Interview & job application toolkit',
                            'Career readiness, portfolio & interviews',
                            'Technical interview and career prep',
                        ],
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Rename my last epic to something better',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-react-three-tuple',
                },
            }
        )

        self.assertEqual(call_count['value'], 1)
        self.assertEqual(result.get('planned_operations'), [])
        self.assertEqual(result.get('planner_schema_invalid_attempts'), 0)
        self.assertFalse(bool(result.get('planner_repair_attempted')))

    def test_plan_operations_react_max_tool_turns_exceeded_returns_replan_state(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={'agent_edit_planner_max_attempts': 2}
        )
        edit_plan_attempts = {'value': 0}
        clarifier_attempts = {'value': 0}

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                phase = (trace_context or {}).get('phase')
                if phase == 'edit_plan':
                    edit_plan_attempts['value'] += 1
                    raise ProviderAdapterError(
                        provider='openai',
                        code='max_tool_turns_exceeded',
                        message='Reached max tool turns while resolving targets.',
                    )
                clarifier_attempts['value'] += 1
                return ProviderCallOutcome(
                    value=(
                        '{"action":"ask_clarifier","reason":"discovery_budget_exhausted",'
                        '"question":"I could not resolve the target in time. Which exact node should I rename?",'
                        '"options":["Use exact label","Provide the exact name","Cancel"]}'
                    ),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Rename my platform foundation',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-llm-first-tool-budget',
                },
            }
        )

        self.assertEqual(edit_plan_attempts['value'], 1)
        self.assertEqual(clarifier_attempts['value'], 0)
        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('parse_mode'), 'deterministic_react_tool_budget_replan')
        self.assertEqual(result.get('provider_error_code'), 'max_tool_turns_exceeded')
        self.assertEqual(result.get('stop_reason'), 'tool_budget_exhausted')
        self.assertTrue(bool(result.get('needs_more_info')))
        self.assertIsNone(result.get('clarifier_action'))
        self.assertEqual(result.get('planned_operations'), [])

    def test_plan_operations_followup_turn_caps_tool_budget_and_adds_guidance(self) -> None:
        planner = self._planner()
        planner._settings = planner._settings.model_copy(
            update={
                'max_edit_tool_turns': 6,
                'agent_edit_planner_max_attempts': 1,
            }
        )
        captured: dict[str, Any] = {
            'max_tool_turns': None,
            'planner_prompt': None,
            'tool_names': None,
        }

        class _FakeOrchestrator:
            def call(self, operation, trace_context=None):
                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                    ):
                        captured['max_tool_turns'] = max_tool_turns
                        captured['planner_prompt'] = planner_prompt
                        captured['tool_names'] = [
                            str(tool.get('function', {}).get('name') or '')
                            for tool in tools
                            if isinstance(tool, dict)
                        ]
                        return ('Can you confirm exact tasks to remove?', [])

                return ProviderCallOutcome(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                )

        planner._provider_orchestrator = _FakeOrchestrator()
        result = planner._plan_operations(
            {
                'user_message': 'Remove 3 todo tasks in the Roadmap JSON Editor',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-followup-turn-budget',
                    '_react_loop_turn': 2,
                    '_react_loop_observation': {
                        'provider_error_code': 'max_tool_turns_exceeded',
                        'resolved_node_ids': [
                            '4848e4ec-fabf-4002-a703-714e938d6c04',
                        ],
                    },
                },
            }
        )

        self.assertEqual(captured['max_tool_turns'], 3)
        prompt_text = str(captured.get('planner_prompt') or '')
        self.assertIn('ALL CONTEXT BELOW IS ALREADY RESOLVED.', prompt_text)
        self.assertIn(
            'Do not call resolve_node_reference or get_children again for the same target.',
            prompt_text,
        )
        self.assertIn('call plan_roadmap_operations exactly once', prompt_text)
        self.assertEqual(captured.get('tool_names'), ['plan_roadmap_operations'])
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_summarize_react_tool_observations_includes_children_and_node_details(self) -> None:
        planner = self._planner()
        summary = planner._summarize_react_tool_observations(
            [
                {
                    'tool_name': 'get_children',
                    'args': {
                        'parent_id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                        'node_id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                    },
                    'result': {
                        'children': [
                            {
                                'id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                'title': 'Todo Task 1',
                                'status': 'todo',
                            },
                            {
                                'id': 'c12347aa-ef79-4313-aabd-8db137ccbaaf',
                                'title': 'Todo Task 2',
                                'status': 'done',
                            },
                        ]
                    },
                },
                {
                    'tool_name': 'resolve_node_reference',
                    'args': {'label': 'Roadmap JSON Editor'},
                    'result': {
                        'matches': [
                            {
                                'id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                                'title': 'Roadmap JSON Editor',
                                'type': 'feature',
                                'status': 'todo',
                            }
                        ]
                    },
                },
                {
                    'tool_name': 'get_node_details',
                    'args': {'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7'},
                    'result': {
                        'id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                        'type': 'task',
                        'title': 'Todo Task 1',
                        'status': 'todo',
                    },
                },
                {
                    'tool_name': 'get_tasks_by_feature',
                    'args': {'feature_id': '4848e4ec-fabf-4002-a703-714e938d6c04'},
                    'result': {
                        'feature_id': '4848e4ec-fabf-4002-a703-714e938d6c04',
                        'tasks': [
                            {
                                'id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                'title': 'Todo Task 1',
                                'status': 'todo',
                            },
                            {
                                'id': 'c12347aa-ef79-4313-aabd-8db137ccbaaf',
                                'title': 'Todo Task 2',
                                'status': 'done',
                            },
                        ],
                    },
                },
            ]
        )

        self.assertEqual(len(summary), 4)
        children_summary = summary[0]
        resolve_summary = summary[1]
        node_summary = summary[2]
        tasks_summary = summary[3]

        self.assertEqual(children_summary.get('children_count'), 2)
        self.assertEqual(
            children_summary.get('queried_node_id'),
            '4848e4ec-fabf-4002-a703-714e938d6c04',
        )
        self.assertEqual(
            children_summary.get('child_ids'),
            [
                'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                'c12347aa-ef79-4313-aabd-8db137ccbaaf',
            ],
        )
        self.assertEqual(
            (children_summary.get('children') or [])[0].get('title'),
            'Todo Task 1',
        )
        self.assertEqual(
            (children_summary.get('child_statuses') or {}).get('b026e967-54c3-4f11-9c49-b95a680aa2a7'),
            'todo',
        )
        self.assertEqual(resolve_summary.get('match_count'), 1)
        self.assertEqual(
            (resolve_summary.get('match_items') or [])[0].get('id'),
            '4848e4ec-fabf-4002-a703-714e938d6c04',
        )
        self.assertEqual(node_summary.get('node_id'), 'b026e967-54c3-4f11-9c49-b95a680aa2a7')
        self.assertEqual(node_summary.get('node_type'), 'task')
        self.assertEqual(node_summary.get('node_status'), 'todo')
        self.assertEqual(node_summary.get('node_title'), 'Todo Task 1')
        self.assertEqual(tasks_summary.get('feature_id'), '4848e4ec-fabf-4002-a703-714e938d6c04')
        self.assertEqual(
            tasks_summary.get('task_ids'),
            [
                'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                'c12347aa-ef79-4313-aabd-8db137ccbaaf',
            ],
        )
        self.assertEqual(
            (tasks_summary.get('task_statuses') or {}).get('b026e967-54c3-4f11-9c49-b95a680aa2a7'),
            'todo',
        )


if __name__ == '__main__':
    unittest.main()




