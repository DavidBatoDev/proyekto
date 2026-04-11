import logging
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.config import get_settings
from app.core.llm.context.context_answer_service import ContextAnswerService
from app.core.llm.providers.base import ProviderAdapterError
from app.core.response_cache import ContextAnswerCache


class _FakeProviderOrchestrator:
    def __init__(self) -> None:
        self.calls = 0

    def call(self, fn, trace_context=None):  # noqa: ANN001
        self.calls += 1
        class _Adapter:
            def answer_with_tools(
                self,
                *,
                system_prompt,
                question_prompt,
                history_messages,
                tools,
                tool_executor,
                max_tool_turns,
            ):
                return 'provider answer'

            def generate_chat_reply(self, *, system_prompt, user_message, history_messages):
                return '{"status_scope":"open","confidence":"high","clarifier_prompt":null}'

        value = fn(_Adapter())
        return SimpleNamespace(
            value=value,
            provider_used='openai',
            fallback_used=False,
            provider_error_code=None,
            tokens_input=10,
            tokens_output=5,
            tokens_total=15,
        )


class ContextAnswerServiceCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = get_settings().model_copy(
            update={'agent_llm_first_mode_enabled': True}
        )
        self.logger = logging.getLogger('context-answer-service-tests')

    def _service(self, execute_tool):
        cache = ContextAnswerCache(ttl_seconds=60)
        provider = _FakeProviderOrchestrator()

        def build_key(
            *,
            roadmap_id: str,
            user_message: str,
            roadmap_updated_token,
            actor_id=None,
        ):
            return f'{roadmap_id}:{roadmap_updated_token}:{actor_id}:{user_message}'

        service = ContextAnswerService(
            settings=self.settings,
            logger=self.logger,
            provider_orchestrator=provider,
            context_answer_cache=cache,
            execute_context_tool=execute_tool,
            build_context_cache_key=build_key,
            chat_fallback_builder=lambda message, _intent: f'fallback:{message}',
        )
        return service, cache, provider, build_key

    @staticmethod
    def _orchestrator_call_with_fake_adapter(
        *,
        tool_sequence: list[tuple[str, dict]],
        final_answer: str = 'final answer',
    ):
        def _call(operation, trace_context=None):  # noqa: ANN001
            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    for name, args in tool_sequence:
                        tool_executor(name, args)
                    return final_answer

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=10,
                tokens_output=5,
                tokens_total=15,
            )

        return _call

    def test_ambiguous_deterministic_response_is_not_cached(self) -> None:
        calls = {'resolve': 0}

        def execute_tool(name: str, _args: dict, _context: dict):
            if name == 'resolve_node_reference':
                calls['resolve'] += 1
                return {
                    'status': 'ambiguous',
                    'resolution_id': 'res-123',
                    'matches': [
                        {'id': '1', 'type': 'epic', 'title': 'Platform Foundation'},
                        {'id': '2', 'type': 'epic', 'title': 'Platform Foundation Core'},
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, cache, provider, build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                (
                    'resolve_node_reference',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'label': 'Platform Foundation',
                        'node_type': 'epic',
                        'limit': 5,
                    },
                )
            ],
            final_answer='LLM handled roadmap lookup.',
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-ambiguous',
        }
        message = 'What are the features of the epic Platform Foundation?'

        first = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )
        second = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(calls['resolve'], 1)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(first['assistant_message'], 'LLM handled roadmap lookup.')
        self.assertIsNone(first.get('provider_error_code'))
        self.assertEqual(second['assistant_message'], first['assistant_message'])
        self.assertIsNone(second.get('provider_error_code'))
        self.assertEqual(first.get('route_lane'), 'discovery_lane')
        self.assertEqual(second.get('route_lane'), 'discovery_lane')
        cache_key = build_key(
            roadmap_id=session_context['roadmap_id'],
            user_message=message,
            roadmap_updated_token=None,
            actor_id=None,
        )
        self.assertIsNotNone(cache.get(cache_key))

    def test_terminal_deterministic_response_uses_cache(self) -> None:
        calls = {'resolve': 0, 'features': 0}

        def execute_tool(name: str, _args: dict, _context: dict):
            if name == 'resolve_node_reference':
                calls['resolve'] += 1
                return {
                    'status': 'unique',
                    'selected': {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'title': 'Platform Foundation',
                    },
                }
            if name == 'get_features_by_epic':
                calls['features'] += 1
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                (
                    'resolve_node_reference',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'label': 'Platform Foundation',
                        'node_type': 'epic',
                        'limit': 5,
                    },
                ),
                (
                    'get_features_by_epic',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'epic_id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'limit': 100,
                    },
                ),
            ],
            final_answer='Authentication',
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-terminal',
        }
        message = 'What are the features of Platform Foundation?'

        first = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )
        second = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertIn('Authentication', first['assistant_message'])
        self.assertEqual(second['assistant_message'], first['assistant_message'])
        self.assertEqual(calls['resolve'], 1)
        self.assertEqual(calls['features'], 1)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(second.get('provider_used'), 'openai')
        self.assertFalse(second.get('fallback_used'))
        self.assertIsNone(second.get('provider_error_code'))
        self.assertEqual(second.get('parse_mode'), 'openai_context_tools')
        self.assertEqual(second.get('route_lane'), 'discovery_lane')

    def test_provider_response_cache_preserves_provider_metadata(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'error': {'code': 'UNUSED'}}

        service, _cache, provider, _build_key = self._service(execute_tool)

        provider_result = SimpleNamespace(
            value='provider answer',
            provider_used='openai',
            fallback_used=True,
            provider_error_code='transient_error',
            tokens_input=120,
            tokens_output=30,
            tokens_total=150,
        )
        service._provider_orchestrator.call = lambda fn, trace_context=None: provider_result  # type: ignore[assignment]

        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-provider',
        }
        message = 'Why is this roadmap delayed?'

        first = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )
        self.assertEqual(first.get('provider_used'), 'openai')
        self.assertEqual(first.get('tokens_total'), 150)

        # After first call, switch provider to fail-hard to verify second response is cache-served.
        service._provider_orchestrator.call = lambda fn, trace_context=None: (_ for _ in ()).throw(  # type: ignore[assignment]
            AssertionError('provider should not be called on cache hit')
        )
        second = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )
        self.assertEqual(second.get('assistant_message'), 'provider answer')
        self.assertEqual(second.get('provider_used'), 'openai')
        self.assertTrue(second.get('fallback_used'))
        self.assertEqual(second.get('provider_error_code'), 'transient_error')
        self.assertEqual(second.get('tokens_total'), 150)

    def test_my_tasks_deterministic_path_bypasses_provider_loop(self) -> None:
        calls = {'my_tasks': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                self.assertEqual(args.get('status'), 'open')
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Implement login API',
                            'status': 'in_progress',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        }
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                (
                    'get_tasks_assigned_to_me',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'status': 'open',
                        'limit': 100,
                    },
                )
            ],
            final_answer='Open tasks listed.',
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        response = service.generate(
            user_message='Can you give me my open tasks?',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(calls['my_tasks'], 1)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(response.get('parse_mode'), 'openai_context_tools')
        self.assertIn('Open tasks listed.', response.get('assistant_message', ''))

    def test_my_tasks_all_the_tasks_phrase_stays_deterministic(self) -> None:
        calls = {'my_tasks': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                self.assertEqual(args.get('status'), 'all')
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Implement login API',
                            'status': 'done',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        }
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                (
                    'get_tasks_assigned_to_me',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'status': 'all',
                        'limit': 100,
                    },
                )
            ],
            final_answer='All tasks listed.',
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks-all-the',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        response = service.generate(
            user_message='Tell me all the tasks that are assigned to me',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='roadmap_query',
        )

        self.assertEqual(calls['my_tasks'], 1)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(response.get('parse_mode'), 'openai_context_tools')
        self.assertIn('All tasks listed.', response.get('assistant_message', ''))

    def test_my_tasks_deterministic_response_bypasses_cache(self) -> None:
        calls = {'my_tasks': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                self.assertEqual(args.get('status'), 'open')
                if calls['my_tasks'] == 1:
                    return {'tasks': []}
                return {
                    'tasks': [
                        {
                            'id': 't2',
                            'type': 'task',
                            'title': 'Review release checklist',
                            'status': 'in_progress',
                            'feature_title': 'Release Ops',
                            'epic_title': 'Delivery Excellence',
                        }
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                (
                    'get_tasks_assigned_to_me',
                    {
                        'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                        'status': 'open',
                        'limit': 100,
                    },
                )
            ],
            final_answer='Open tasks snapshot.',
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks-no-cache',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        message = 'What are my pending tasks?'

        first = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='roadmap_query',
        )
        second = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='roadmap_query',
        )

        self.assertEqual(provider.calls, 0)
        self.assertEqual(calls['my_tasks'], 1)
        self.assertEqual(first.get('assistant_message'), second.get('assistant_message'))

    def test_compound_my_tasks_query_routes_to_llm_and_bypasses_cache(self) -> None:
        calls = {'provider': 0, 'my_tasks': 0, 'summary': 0}
        roadmap_id = '55e431e2-e416-468c-a973-94d97280e97d'

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                self.assertEqual(args.get('roadmap_id'), roadmap_id)
                self.assertEqual(args.get('status'), 'open')
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Setup persona switching logic',
                            'status': 'todo',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        }
                    ]
                }
            if name == 'get_roadmap_summary':
                calls['summary'] += 1
                self.assertEqual(args.get('roadmap_id'), roadmap_id)
                return {
                    'roadmap_id': roadmap_id,
                    'epics': [
                        {
                            'id': 'e1',
                            'title': 'Platform Foundation',
                            'status': 'in_progress',
                            'feature_count': 3,
                        }
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def provider_call(operation, trace_context=None):  # noqa: ANN001
            calls['provider'] += 1

            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    tool_executor(
                        'get_tasks_assigned_to_me',
                        {'roadmap_id': roadmap_id, 'status': 'open', 'limit': 100},
                    )
                    tool_executor('get_roadmap_summary', {'roadmap_id': roadmap_id})
                    return (
                        f'provider-call-{calls["provider"]}: '
                        'You have 1 open task and the roadmap has 1 active epic.'
                    )

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=50,
                tokens_output=20,
                tokens_total=70,
            )

        service._provider_orchestrator.call = provider_call  # type: ignore[assignment]
        session_context = {
            'roadmap_id': roadmap_id,
            'trace_id': 'trace-compound-query',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        message = 'What are my pending tasks and tell me more about my roadmap'

        first = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='roadmap_query',
        )
        second = service.generate(
            user_message=message,
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='roadmap_query',
        )

        self.assertEqual(calls['provider'], 1)
        self.assertEqual(calls['my_tasks'], 1)
        self.assertEqual(calls['summary'], 1)
        self.assertEqual(first.get('route_lane'), 'discovery_lane')
        self.assertEqual(first.get('parse_mode'), 'openai_context_tools')
        self.assertEqual(first.get('provider_used'), 'openai')
        self.assertIn('provider-call-1', first.get('assistant_message', ''))
        self.assertEqual(second.get('assistant_message'), first.get('assistant_message'))

    def test_compound_router_detects_my_tasks_plus_roadmap_meta_clause(self) -> None:
        should_route = ContextAnswerService._should_route_compound_query_to_llm(
            user_message='What are my pending tasks and tell me more about my roadmap',
            matched_pending_kind='my_tasks',
        )
        self.assertTrue(should_route)

    def test_compound_router_ignores_single_capability_with_qualifier(self) -> None:
        should_route = ContextAnswerService._should_route_compound_query_to_llm(
            user_message='What are my pending tasks and include IDs',
            matched_pending_kind='my_tasks',
        )
        self.assertFalse(should_route)

    def test_compound_router_detects_cross_capability_clauses(self) -> None:
        should_route = ContextAnswerService._should_route_compound_query_to_llm(
            user_message='Show features of Platform Foundation and tasks of Authentication System',
            matched_pending_kind='features_of_epic',
        )
        self.assertTrue(should_route)

    def test_my_tasks_rich_query_uses_synthesis(self) -> None:
        calls = {'my_tasks': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                self.assertEqual(args.get('status'), 'open')
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Implement login API',
                            'status': 'in_progress',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        }
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        provider_result = SimpleNamespace(
            value='Grouped tasks by epic and feature.',
            provider_used='openai',
            fallback_used=False,
            provider_error_code=None,
            tokens_input=40,
            tokens_output=20,
            tokens_total=60,
        )
        service._provider_orchestrator.call = lambda fn, trace_context=None: provider_result  # type: ignore[assignment]
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks-rich',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        response = service.generate(
            user_message='Show my open tasks as well as parent feature and epic',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(calls['my_tasks'], 0)
        self.assertEqual(response.get('assistant_message'), 'Grouped tasks by epic and feature.')
        self.assertEqual(response.get('provider_used'), 'openai')
        self.assertEqual(response.get('parse_mode'), 'openai_context_tools')
        self.assertEqual(response.get('tokens_total'), 60)

    def test_my_tasks_rich_query_synthesis_failure_falls_back_to_deterministic(self) -> None:
        calls = {'my_tasks': 0}

        def execute_tool(name: str, _args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                calls['my_tasks'] += 1
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Implement login API',
                            'status': 'in_progress',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        }
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = lambda fn, trace_context=None: (_ for _ in ()).throw(  # type: ignore[assignment]
            ProviderAdapterError(
                provider='openai',
                code='provider_timeout',
                message='timeout',
            )
        )
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks-rich-fallback',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        response = service.generate(
            user_message='Show my open tasks as well as parent feature and epic',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(calls['my_tasks'], 0)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(response.get('provider_used'), 'rule_based')
        self.assertEqual(response.get('parse_mode'), 'llm_first_context_outage')
        self.assertIn('Temporary AI provider issue', response.get('assistant_message', ''))

    def test_my_tasks_ambiguous_scope_uses_discovery_and_executes_all(self) -> None:
        observed = {'status': None}

        def execute_tool(name: str, args: dict, _context: dict):
            if name == 'get_tasks_assigned_to_me':
                observed['status'] = args.get('status')
                return {
                    'tasks': [
                        {
                            'id': 't1',
                            'type': 'task',
                            'title': 'Implement login API',
                            'status': 'in_progress',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        },
                        {
                            'id': 't2',
                            'type': 'task',
                            'title': 'Archive legacy auth flow',
                            'status': 'done',
                            'feature_title': 'Authentication System',
                            'epic_title': 'Platform Foundation',
                        },
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def discovery_call(operation, trace_context=None):  # noqa: ANN001
            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    tool_executor(
                        'get_tasks_assigned_to_me',
                        {
                            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                            'status': 'all',
                            'limit': 100,
                        },
                    )
                    return 'All tasks with mixed statuses.'

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=10,
                tokens_output=5,
                tokens_total=15,
            )

        service._provider_orchestrator.call = discovery_call  # type: ignore[assignment]
        session_context = {
            'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
            'trace_id': 'trace-my-tasks-discovery-all',
            'actor_context': {
                'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                'display_name': 'Alice',
                'roadmap_role': 'editor',
                'actor_context_source': 'backend_context_actor',
            },
        }
        response = service.generate(
            user_message='Tell me all the task that are assigned to me',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(observed['status'], 'all')
        self.assertEqual(response.get('route_lane'), 'discovery_lane')
        self.assertEqual(response.get('parse_mode'), 'openai_context_tools')
        self.assertIn('All tasks with mixed statuses.', response.get('assistant_message', ''))

    def test_my_tasks_discovery_low_confidence_returns_specific_parse_mode(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'error': {'code': 'UNUSED'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def discovery_call(operation, trace_context=None):  # noqa: ANN001
            raise ProviderAdapterError(
                provider='openai',
                code='provider_timeout',
                message='timeout',
            )

        service._provider_orchestrator.call = discovery_call  # type: ignore[assignment]
        response = service.generate(
            user_message='Tasks assigned to me please',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-my-tasks-low-confidence',
                'actor_context': {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'actor_context_source': 'backend_context_actor',
                },
            },
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(response.get('parse_mode'), 'llm_first_context_outage')
        self.assertEqual(response.get('provider_error_code'), 'provider_timeout')
        self.assertEqual(response.get('discovery_stop_reason'), 'provider_error')
        self.assertTrue(response.get('clarifier_returned'))

    def test_my_tasks_discovery_invalid_payload_returns_specific_parse_mode(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'error': {'code': 'UNUSED'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def discovery_call(operation, trace_context=None):  # noqa: ANN001
            raise ProviderAdapterError(
                provider='openai',
                code='provider_timeout',
                message='timeout',
            )

        service._provider_orchestrator.call = discovery_call  # type: ignore[assignment]
        response = service.generate(
            user_message='Tasks assigned to me please',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-my-tasks-invalid-payload',
                'actor_context': {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'actor_context_source': 'backend_context_actor',
                },
            },
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(response.get('parse_mode'), 'llm_first_context_outage')
        self.assertEqual(response.get('provider_error_code'), 'provider_timeout')
        self.assertEqual(response.get('discovery_stop_reason'), 'provider_error')
        self.assertTrue(response.get('clarifier_returned'))

    def test_my_tasks_discovery_provider_error_returns_specific_parse_mode(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'error': {'code': 'UNUSED'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def discovery_call(operation, trace_context=None):  # noqa: ANN001
            raise ProviderAdapterError(
                provider='openai',
                code='provider_timeout',
                message='timeout',
            )

        service._provider_orchestrator.call = discovery_call  # type: ignore[assignment]
        response = service.generate(
            user_message='Tasks assigned to me please',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-my-tasks-provider-error',
                'actor_context': {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'actor_context_source': 'backend_context_actor',
                },
            },
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(response.get('parse_mode'), 'llm_first_context_outage')
        self.assertEqual(response.get('provider_error_code'), 'provider_timeout')
        self.assertEqual(response.get('discovery_stop_reason'), 'provider_error')
        self.assertTrue(response.get('clarifier_returned'))

    def test_context_discovery_budget_exhaustion_returns_clarifier(self) -> None:
        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                ('get_roadmap_summary', {'roadmap_id': 'r1'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'a'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'b'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'c'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'd'}),
            ]
        )

        with patch('app.core.llm.context.context_answer_service.log_event') as mocked_log_event:
            response = service.generate(
                user_message='What are roadmap details?',
                system_prompt='system',
                session_context={
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'trace_id': 'trace-budget',
                },
                history_messages=[],
                intent_type='question',
            )

        self.assertEqual(response.get('parse_mode'), 'deterministic_context_budget_exhausted')
        self.assertTrue(response.get('clarifier_returned'))
        self.assertEqual(response.get('discovery_calls_used'), 4)
        self.assertEqual(response.get('discovery_stop_reason'), 'budget_exhausted')
        self.assertIn('Do you want me to focus', response.get('assistant_message', ''))
        self.assertTrue(
            any(
                call.args[1] == 'context_discovery_stopped'
                for call in mocked_log_event.call_args_list
            )
        )

    def test_context_discovery_repeat_limit_returns_clarifier(self) -> None:
        execution_count = {'count': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            execution_count['count'] += 1
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._provider_orchestrator.call = self._orchestrator_call_with_fake_adapter(  # type: ignore[assignment]
            tool_sequence=[
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'}),
                ('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'}),
            ]
        )

        response = service.generate(
            user_message='Find this repeatedly',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-repeat',
            },
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(response.get('parse_mode'), 'deterministic_context_repeat_limit_exhausted')
        self.assertEqual(response.get('discovery_stop_reason'), 'repeat_limit_exhausted')
        self.assertTrue(response.get('clarifier_returned'))
        self.assertEqual(execution_count['count'], 2)

    def test_context_discovery_provider_max_turns_returns_budget_clarifier(self) -> None:
        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)

        def _call(_operation, trace_context=None):  # noqa: ANN001
            raise ProviderAdapterError(
                provider='openai',
                code='max_tool_turns_exceeded',
                message='OpenAI context answer loop reached max tool turns.',
                tokens_input=21,
                tokens_output=8,
                tokens_total=29,
            )

        service._provider_orchestrator.call = _call  # type: ignore[assignment]

        response = service.generate(
            user_message='Summarize roadmap details',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-provider-max-turns',
            },
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(response.get('parse_mode'), 'deterministic_context_budget_exhausted')
        self.assertEqual(response.get('provider_error_code'), 'max_tool_turns_exceeded')
        self.assertEqual(response.get('discovery_stop_reason'), 'tool_budget_exhausted')
        self.assertTrue(response.get('clarifier_returned'))
        self.assertEqual(response.get('tokens_total'), 29)

    def test_llm_first_mode_bypasses_deterministic_tasks_fastpath(self) -> None:
        calls = {'provider': 0}

        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._settings = service._settings.model_copy(
            update={'agent_llm_first_mode_enabled': True}
        )

        def provider_call(operation, trace_context=None):  # noqa: ANN001
            calls['provider'] += 1

            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    return 'LLM handled this.'

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=10,
                tokens_output=6,
                tokens_total=16,
            )

        service._provider_orchestrator.call = provider_call  # type: ignore[assignment]
        response = service.generate(
            user_message='Can you suggest a better name for all the tasks in the System Archtecture and React Implementation',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-llm-first-bypass',
            },
            history_messages=[],
            intent_type='roadmap_query',
        )

        self.assertEqual(calls['provider'], 1)
        self.assertEqual(response.get('parse_mode'), 'openai_context_tools')
        self.assertEqual(response.get('route_lane'), 'discovery_lane')
        self.assertEqual(response.get('assistant_message'), 'LLM handled this.')

    def test_llm_first_mode_returns_outage_clarifier_on_provider_error(self) -> None:
        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._settings = service._settings.model_copy(
            update={'agent_llm_first_mode_enabled': True}
        )

        def provider_call(operation, trace_context=None):  # noqa: ANN001
            raise ProviderAdapterError(
                provider='openai',
                code='provider_timeout',
                message='timeout',
                tokens_input=21,
                tokens_output=8,
                tokens_total=29,
            )

        service._provider_orchestrator.call = provider_call  # type: ignore[assignment]
        response = service.generate(
            user_message='What are the tasks in Platform Foundation?',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-llm-first-outage',
            },
            history_messages=[],
            intent_type='roadmap_query',
        )

        self.assertEqual(response.get('parse_mode'), 'llm_first_context_outage')
        self.assertEqual(response.get('provider_error_code'), 'provider_timeout')
        self.assertTrue(response.get('clarifier_returned'))
        self.assertIn('Temporary AI provider issue', response.get('assistant_message', ''))

    def test_discovery_guard_state_is_request_local(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'ok': True}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        first_guard, first_state = service._build_discovery_guard(
            session_context={'roadmap_id': 'roadmap-1', 'trace_id': 'trace-1'},
            trace_id='trace-1',
        )
        second_guard, second_state = service._build_discovery_guard(
            session_context={'roadmap_id': 'roadmap-1', 'trace_id': 'trace-2'},
            trace_id='trace-2',
        )

        first_guard('search_nodes', {'roadmap_id': 'r1', 'query': 'alpha'})
        second_guard('search_nodes', {'roadmap_id': 'r1', 'query': 'beta'})
        first_guard('search_nodes', {'roadmap_id': 'r1', 'query': 'gamma'})

        self.assertEqual(first_state.calls_used, 2)
        self.assertEqual(second_state.calls_used, 1)
        self.assertEqual(first_state.repeat_hits, 0)
        self.assertEqual(second_state.repeat_hits, 0)

    def test_discovery_guard_errors_use_neutral_provider_label(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'ok': True}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        guard, _state = service._build_discovery_guard(
            session_context={'roadmap_id': 'roadmap-1', 'trace_id': 'trace-provider'},
            trace_id='trace-provider',
        )

        with self.assertRaises(ProviderAdapterError) as raised:
            guard('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'})
            guard('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'})
            guard('search_nodes', {'roadmap_id': 'r1', 'query': 'repeat'})

        self.assertEqual(raised.exception.provider, 'orchestrator')
        self.assertEqual(raised.exception.code, 'discovery_repeat_limit_exhausted')

    def test_context_turns_never_below_discovery_budget(self) -> None:
        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._settings.max_context_tool_turns = 1
        service._settings.max_discovery_tool_calls = 4
        observed = {'max_tool_turns': None}

        def call(operation, trace_context=None):  # noqa: ANN001
            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    observed['max_tool_turns'] = max_tool_turns
                    return 'resolved'

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=1,
                tokens_output=1,
                tokens_total=2,
            )

        service._provider_orchestrator.call = call  # type: ignore[assignment]
        response = service.generate(
            user_message='This is ambiguous and should use discovery lane',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-turn-budget',
            },
            history_messages=[],
            intent_type='question',
        )
        self.assertEqual(observed['max_tool_turns'], 4)
        self.assertEqual(response.get('route_lane'), 'discovery_lane')

    def test_context_turns_never_exceed_discovery_budget(self) -> None:
        def execute_tool(name: str, args: dict, _context: dict):
            return {'ok': True, 'name': name, 'args': args}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        service._settings.max_context_tool_turns = 12
        service._settings.max_discovery_tool_calls = 4
        observed = {'max_tool_turns': None}

        def call(operation, trace_context=None):  # noqa: ANN001
            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    observed['max_tool_turns'] = max_tool_turns
                    return 'resolved'

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=1,
                tokens_output=1,
                tokens_total=2,
            )

        service._provider_orchestrator.call = call  # type: ignore[assignment]
        response = service.generate(
            user_message='This is ambiguous and should use discovery lane',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-turn-ceiling',
            },
            history_messages=[],
            intent_type='question',
        )
        self.assertEqual(observed['max_tool_turns'], 4)
        self.assertEqual(response.get('route_lane'), 'discovery_lane')

    def test_question_prompt_prefers_tasks_by_parent_for_scoped_listings(self) -> None:
        def execute_tool(_name: str, _args: dict, _context: dict):
            return {'ok': True}

        service, _cache, _provider, _build_key = self._service(execute_tool)
        observed = {'question_prompt': ''}

        def call(operation, trace_context=None):  # noqa: ANN001
            class _Adapter:
                def answer_with_tools(
                    self,
                    *,
                    system_prompt,
                    question_prompt,
                    history_messages,
                    tools,
                    tool_executor,
                    max_tool_turns,
                ):
                    observed['question_prompt'] = question_prompt
                    return 'resolved'

            value = operation(_Adapter())
            return SimpleNamespace(
                value=value,
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=1,
                tokens_output=1,
                tokens_total=2,
            )

        service._provider_orchestrator.call = call  # type: ignore[assignment]
        service.generate(
            user_message='Show all tasks under Agent Module',
            system_prompt='system',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'trace_id': 'trace-prompt-guidance',
            },
            history_messages=[],
            intent_type='question',
        )

        prompt = observed['question_prompt']
        self.assertIn('Use get_tasks_by_parent for scoped task listings', prompt)
        self.assertIn('parent_type="epic"', prompt)
        self.assertIn('include completed tasks', prompt)


if __name__ == '__main__':
    unittest.main()
