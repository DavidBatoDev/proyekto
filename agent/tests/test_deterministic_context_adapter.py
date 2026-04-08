import logging
import unittest

from app.core.config import get_settings
from app.core.llm.context.deterministic_context_adapter import DeterministicContextAdapter


class DeterministicContextAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = get_settings()
        self.logger = logging.getLogger('deterministic-context-adapter-tests')

    def test_features_wrapper_routes_and_formats(self) -> None:
        def execute_tool(name: str, _args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'selected': {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'title': 'Platform Foundation',
                    },
                }
            if name == 'get_features':
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'UNKNOWN'}}

        adapter = DeterministicContextAdapter(
            settings=self.settings,
            logger=self.logger,
            execute_context_tool=execute_tool,
        )
        outcome = adapter.try_deterministic_features_answer(
            user_message='What are the features of Platform Foundation?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-features',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Features under "Platform Foundation"', outcome.answer)

    def test_tasks_wrapper_routes_and_formats(self) -> None:
        def execute_tool(name: str, _args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                        'title': 'Authentication System',
                    },
                }
            if name == 'get_children':
                return {'children': [{'id': 't1', 'type': 'task', 'title': 'Implement login API'}]}
            return {'error': {'code': 'UNKNOWN'}}

        adapter = DeterministicContextAdapter(
            settings=self.settings,
            logger=self.logger,
            execute_context_tool=execute_tool,
        )
        outcome = adapter.try_deterministic_tasks_answer(
            user_message='What are the tasks for Authentication System?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-tasks',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Tasks under "Authentication System"', outcome.answer)

    def test_pending_selection_pass_through_shape(self) -> None:
        def execute_tool(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                self.assertEqual(args.get('choice'), 1)
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'UNKNOWN'}}

        adapter = DeterministicContextAdapter(
            settings=self.settings,
            logger=self.logger,
            execute_context_tool=execute_tool,
        )
        outcome = adapter.try_pending_context_selection(
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
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_matchers_and_normalizers_delegate(self) -> None:
        adapter = DeterministicContextAdapter(
            settings=self.settings,
            logger=self.logger,
            execute_context_tool=lambda *_args, **_kwargs: {'error': {'code': 'UNUSED'}},
        )

        overview = adapter.match_global_overview_intent(
            'Tell me all the epics, features and tasks of this roadmap'
        )
        self.assertIsNotNone(overview)
        self.assertEqual(adapter.normalize_context_label('the epic Platform Foundation?'), 'Platform Foundation')
        self.assertTrue(adapter.should_include_ids('show epics with ids'))


if __name__ == '__main__':
    unittest.main()
