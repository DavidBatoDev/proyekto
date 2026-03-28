import logging
import unittest
from types import SimpleNamespace

from app.core.config import get_settings
from app.core.llm.context_answer_service import ContextAnswerService
from app.core.response_cache import ContextAnswerCache


class _FakeProviderOrchestrator:
    def __init__(self) -> None:
        self.calls = 0

    def call(self, fn, trace_context=None):  # noqa: ANN001
        self.calls += 1
        adapter = SimpleNamespace()
        return fn(adapter)


class ContextAnswerServiceCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = get_settings()
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

        service, cache, _provider, build_key = self._service(execute_tool)
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

        self.assertEqual(calls['resolve'], 2)
        self.assertIn('Please choose one', first['assistant_message'])
        self.assertIsNotNone(first.get('pending_context_resolution'))
        self.assertIn('Please choose one', second['assistant_message'])
        cache_key = build_key(
            roadmap_id=session_context['roadmap_id'],
            user_message=message,
            roadmap_updated_token=None,
            actor_id=None,
        )
        self.assertIsNone(cache.get(cache_key))

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
            if name == 'get_features':
                calls['features'] += 1
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'UNKNOWN'}}

        service, _cache, _provider, _build_key = self._service(execute_tool)
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

        self.assertIn('Features under "Platform Foundation"', first['assistant_message'])
        self.assertEqual(second['assistant_message'], first['assistant_message'])
        self.assertEqual(calls['resolve'], 1)
        self.assertEqual(calls['features'], 1)
        self.assertEqual(second.get('provider_used'), 'rule_based')
        self.assertFalse(second.get('fallback_used'))
        self.assertIsNone(second.get('provider_error_code'))

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
            user_message='Can you give me the tasks assigned to me?',
            system_prompt='system',
            session_context=session_context,
            history_messages=[],
            intent_type='question',
        )

        self.assertEqual(calls['my_tasks'], 1)
        self.assertEqual(provider.calls, 0)
        self.assertEqual(response.get('parse_mode'), 'deterministic_context_my_tasks')
        self.assertIn('Tasks assigned to Alice (open):', response.get('assistant_message', ''))


if __name__ == '__main__':
    unittest.main()
