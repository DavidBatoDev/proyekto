import logging
import unittest
from types import SimpleNamespace

from app.core.config import get_settings
from app.core.llm.deterministic_context import (
    try_deterministic_list_answer,
    try_pending_context_selection,
)
from app.core.llm.deterministic_intents import get_deterministic_context_intent


class DeterministicContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.logger = logging.getLogger('deterministic-context-tests')
        self.settings = get_settings()

    def test_pending_selection_uses_backend_choice_mapping(self) -> None:
        observed = SimpleNamespace(choice=None)

        def fake_tool(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                observed.choice = args.get('choice')
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        outcome = try_pending_context_selection(
            user_message='1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-123',
                    'label': 'Platform Foundation',
                    'option_choices': [3, 4],
                },
            },
            trace_id='trace-pending',
            logger=self.logger,
            settings=self.settings,
            execute_context_tool=fake_tool,
        )
        self.assertIsNotNone(outcome)
        self.assertEqual(observed.choice, 3)

    def test_overview_truncation_hint_on_budget(self) -> None:
        def fake_tool(name: str, args: dict, _ctx: dict):
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

        intent = get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None

        outcome = try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview',
            logger=self.logger,
            settings=self.settings,
            execute_context_tool=fake_tool,
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Results were truncated for performance', outcome.answer)

    def test_overview_tool_error_returns_none(self) -> None:
        def fake_tool(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [{'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 1}],
                }
            if name == 'get_features':
                return {'error': {'code': 'CONTEXT_TOOL_FAILED'}}
            return {'children': []}

        intent = get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview-error',
            logger=self.logger,
            settings=self.settings,
            execute_context_tool=fake_tool,
        )
        self.assertIsNone(outcome)

    def test_my_tasks_deterministic_answer_uses_actor_context(self) -> None:
        observed = SimpleNamespace(status=None)

        def fake_tool(name: str, args: dict, _ctx: dict):
            if name == 'get_tasks_assigned_to_me':
                observed.status = args.get('status')
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

        intent = get_deterministic_context_intent('my_tasks')
        self.assertIsNotNone(intent)
        assert intent is not None

        outcome = try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            user_message='Show me all tasks assigned to me',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'actor_context': {
                    'actor_id': 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb',
                    'display_name': 'Alice',
                    'roadmap_role': 'editor',
                    'actor_context_source': 'backend_context_actor',
                },
            },
            trace_id='trace-my-tasks',
            logger=self.logger,
            settings=self.settings,
            execute_context_tool=fake_tool,
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertEqual(observed.status, 'all')
        self.assertIn('Tasks assigned to Alice (all):', outcome.answer)
        self.assertIn('- Implement login API', outcome.answer)

    def test_my_tasks_missing_actor_context_returns_guidance(self) -> None:
        def fake_tool(_name: str, _args: dict, _ctx: dict):
            return {'error': {'code': 'UNKNOWN'}}

        intent = get_deterministic_context_intent('my_tasks')
        self.assertIsNotNone(intent)
        assert intent is not None

        outcome = try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            user_message='What tasks are assigned to me?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-my-tasks-missing-actor',
            logger=self.logger,
            settings=self.settings,
            execute_context_tool=fake_tool,
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('could not confirm your actor context', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)


if __name__ == '__main__':
    unittest.main()
