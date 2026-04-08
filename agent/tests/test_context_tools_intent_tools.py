import asyncio
import logging
import unittest

from app.core.config import get_settings
from app.core.llm.context.context_tools_executor import ContextToolsExecutor
from app.core.tools.registry import get_context_tools, get_edit_mode_tools


class _FakeNestClient:
    async def context_summary(
        self,
        roadmap_id: str,
        preview_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        return {
            'roadmap_id': roadmap_id,
            'title': 'Roadmap',
            'description': 'Demo',
            'status': 'active',
            'epic_count': 1,
            'feature_count': 2,
            'task_count': 3,
            'epics': [
                {
                    'id': '11111111-1111-1111-1111-111111111111',
                    'title': 'Auth Epic',
                    'status': 'in_progress',
                    'priority': 'high',
                    'feature_count': 2,
                },
                {
                    'id': '22222222-2222-2222-2222-222222222222',
                    'title': 'Billing Epic',
                    'status': 'blocked',
                    'priority': 'critical',
                    'feature_count': 1,
                }
            ],
        }

    async def context_features(
        self,
        roadmap_id: str,
        epic_id: str,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        if epic_id != '11111111-1111-1111-1111-111111111111':
            return {'children': []}
        return {
            'children': [
                {'id': 'f1', 'type': 'feature', 'title': 'Login API', 'status': 'in_progress'},
                {'id': 'f2', 'type': 'feature', 'title': 'Sessions', 'status': 'blocked'},
            ]
        }

    async def context_children(
        self,
        roadmap_id: str,
        node_id: str,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        if node_id == 'f1':
            return {
                'children': [
                    {'id': 't1', 'type': 'task', 'title': 'Create login endpoint', 'status': 'todo'},
                    {'id': 't2', 'type': 'task', 'title': 'Add validation', 'status': 'done'},
                ]
            }
        if node_id == 'f2':
            return {
                'children': [
                    {'id': 't3', 'type': 'task', 'title': 'Session hardening', 'status': 'done'},
                ]
            }
        return {'children': []}

    async def context_node_details(
        self,
        roadmap_id: str,
        node_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        due_dates = {
            't1': '2026-04-05',
            't2': '2026-04-10',
            't3': '2026-03-28',
            'f1': {
                'id': 'f1',
                'type': 'feature',
                'title': 'Login API',
                'status': 'in_progress',
            },
        }
        known = due_dates.get(node_id)
        if isinstance(known, dict):
            return known
        return {
            'id': node_id,
            'type': 'task',
            'title': f'Task {node_id}',
            'status': 'todo' if node_id == 't1' else 'done',
            'due_date': due_dates.get(node_id),
        }

    async def context_search(
        self,
        roadmap_id: str,
        query: str,
        node_type: str | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        return {
            'matches': [
                {
                    'id': 't1',
                    'type': 'task',
                    'title': 'Create login endpoint',
                    'score': 0.98,
                }
            ]
        }

    async def context_children_from_resolution(
        self,
        roadmap_id: str,
        resolution_id: str,
        choice: int,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        return {'children': []}

    async def context_tasks_assigned_to_me(
        self,
        roadmap_id: str,
        status: str | None,
        limit: int | None,
        preview_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict:
        return {
            'tasks': [
                {
                    'id': 'ta1',
                    'type': 'task',
                    'title': 'My open task',
                    'status': 'in_progress',
                },
                {
                    'id': 'ta2',
                    'type': 'task',
                    'title': 'My review task',
                    'status': 'in_review',
                },
                {
                    'id': 'ta3',
                    'type': 'task',
                    'title': 'My done task',
                    'status': 'done',
                },
            ]
        }


class ContextToolIntentTests(unittest.TestCase):
    def setUp(self) -> None:
        settings = get_settings().model_copy(update={'agent_resolve_cache_ttl_seconds': 30})
        self.executor = ContextToolsExecutor(
            settings=settings,
            logger=logging.getLogger('context-tools-intent-tests'),
            nest_client=_FakeNestClient(),
            run_async_context_call=self._run_async,
        )
        self.session_context = {
            'roadmap_id': 'r1',
            'trace_id': 'trace-context-tools-intent-tests',
        }

    @staticmethod
    def _run_async(coro):
        if asyncio.iscoroutine(coro):
            return asyncio.run(coro)
        return coro

    def test_registry_exposes_new_query_and_helper_tools(self) -> None:
        context_tools = [tool for tool in get_context_tools() if isinstance(tool, dict)]
        context_tool_names = {
            str(tool.get('function', {}).get('name') or '')
            for tool in context_tools
        }
        edit_tool_names = {
            str(tool.get('function', {}).get('name') or '')
            for tool in get_edit_mode_tools()
            if isinstance(tool, dict)
        }

        self.assertIn('get_roadmap_overview', context_tool_names)
        self.assertIn('get_tasks_by_status', context_tool_names)
        tasks_by_status_tool = next(
            tool for tool in context_tools
            if str(tool.get('function', {}).get('name') or '') == 'get_tasks_by_status'
        )
        task_status_enum = (
            tasks_by_status_tool.get('function', {})
            .get('parameters', {})
            .get('properties', {})
            .get('status', {})
            .get('enum', [])
        )
        self.assertEqual(
            task_status_enum,
            ['todo', 'in_progress', 'in_review', 'done', 'blocked', 'all'],
        )
        self.assertIn('create_epic', edit_tool_names)
        self.assertIn('bulk_update_task_status', edit_tool_names)
        self.assertIn('plan_roadmap_operations', edit_tool_names)

    def test_create_epic_returns_add_epic_operation(self) -> None:
        result = self.executor.execute(
            'create_epic',
            {'roadmap_id': 'r1', 'title': 'Platform Reliability'},
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].get('op'), 'add_epic')
        self.assertEqual(operations[0].get('data', {}).get('title'), 'Platform Reliability')

    def test_bulk_status_update_and_reorder_helpers(self) -> None:
        bulk_result = self.executor.execute(
            'bulk_update_task_status',
            {
                'roadmap_id': 'r1',
                'task_ids': ['t1', 't2', 't3'],
                'status': 'done',
            },
            self.session_context,
        )
        bulk_ops = bulk_result.get('operations')
        self.assertIsInstance(bulk_ops, list)
        assert isinstance(bulk_ops, list)
        self.assertEqual(len(bulk_ops), 3)
        self.assertTrue(all(op.get('op') == 'mark_status' for op in bulk_ops))

        reorder_result = self.executor.execute(
            'reorder_tasks',
            {
                'roadmap_id': 'r1',
                'feature_id': 'f1',
                'task_ids': ['t2', 't1'],
            },
            self.session_context,
        )
        reorder_ops = reorder_result.get('operations')
        self.assertIsInstance(reorder_ops, list)
        assert isinstance(reorder_ops, list)
        self.assertEqual([op.get('position') for op in reorder_ops], [0, 1])
        self.assertEqual([op.get('node_id') for op in reorder_ops], ['t2', 't1'])

    def test_bulk_update_task_status_normalizes_common_status_aliases(self) -> None:
        result = self.executor.execute(
            'bulk_update_task_status',
            {
                'roadmap_id': 'r1',
                'task_ids': ['t1', 't2'],
                'status': 'In Review',
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 2)
        self.assertTrue(all(op.get('status') == 'in_review' for op in operations))

    def test_bulk_update_task_status_rejects_invalid_status(self) -> None:
        result = self.executor.execute(
            'bulk_update_task_status',
            {
                'roadmap_id': 'r1',
                'task_ids': ['t1', 't2'],
                'status': 'ready_for_qa',
            },
            self.session_context,
        )
        error = result.get('error')
        self.assertIsInstance(error, dict)
        assert isinstance(error, dict)
        self.assertEqual(error.get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(error.get('arg_name'), 'status')

    def test_update_task_status_rejects_invalid_status(self) -> None:
        result = self.executor.execute(
            'update_task_status',
            {
                'roadmap_id': 'r1',
                'task_id': 't1',
                'status': 'shipped',
            },
            self.session_context,
        )
        error = result.get('error')
        self.assertIsInstance(error, dict)
        assert isinstance(error, dict)
        self.assertEqual(error.get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(error.get('arg_name'), 'status')

    def test_get_tasks_by_status_filters_tasks(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_status',
            {'roadmap_id': 'r1', 'status': 'done', 'limit': 10},
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t2', 't3'])

    def test_get_features_by_epic_filters_by_explicit_status(self) -> None:
        result = self.executor.execute(
            'get_features_by_epic',
            {
                'roadmap_id': 'r1',
                'epic_id': '11111111-1111-1111-1111-111111111111',
                'status': 'blocked',
                'limit': 10,
            },
            self.session_context,
        )
        children = result.get('children')
        self.assertIsInstance(children, list)
        assert isinstance(children, list)
        self.assertEqual([item.get('id') for item in children], ['f2'])

    def test_get_epics_by_roadmap_filters_by_priority(self) -> None:
        result = self.executor.execute(
            'get_epics_by_roadmap',
            {'roadmap_id': 'r1', 'priority': 'critical', 'limit': 10},
            self.session_context,
        )
        epics = result.get('epics')
        self.assertIsInstance(epics, list)
        assert isinstance(epics, list)
        self.assertEqual([item.get('id') for item in epics], ['22222222-2222-2222-2222-222222222222'])

    def test_get_tasks_assigned_to_me_filters_by_explicit_status(self) -> None:
        result = self.executor.execute(
            'get_tasks_assigned_to_me',
            {'roadmap_id': 'r1', 'status': 'in_review', 'limit': 10},
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['ta2'])

    def test_get_overdue_tasks_excludes_completed_by_default(self) -> None:
        result = self.executor.execute(
            'get_overdue_tasks',
            {'roadmap_id': 'r1', 'reference_date': '2026-04-08', 'limit': 10},
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t1'])
        self.assertEqual(tasks[0].get('days_overdue'), 3)

    def test_get_roadmap_overview_includes_progress(self) -> None:
        result = self.executor.execute(
            'get_roadmap_overview',
            {'roadmap_id': 'r1', 'include_epics': True, 'max_epics': 1},
            self.session_context,
        )
        epics = result.get('epics')
        self.assertIsInstance(epics, list)
        assert isinstance(epics, list)
        self.assertEqual(len(epics), 1)
        progress = epics[0].get('progress')
        self.assertIsInstance(progress, dict)
        assert isinstance(progress, dict)
        self.assertEqual(progress.get('task_count'), 3)
        self.assertEqual(progress.get('done_task_count'), 2)

    def test_helper_tools_emit_canonical_operations(self) -> None:
        cases = [
            (
                'create_feature',
                {'roadmap_id': 'r1', 'epic_id': 'e1', 'title': 'Auth Flows'},
                [('add_feature', 'feature')],
            ),
            (
                'create_task',
                {
                    'roadmap_id': 'r1',
                    'feature_id': 'f1',
                    'title': 'Add MFA',
                    'priority': 'high',
                },
                [('add_task', 'task')],
            ),
            (
                'update_task_priority',
                {'roadmap_id': 'r1', 'task_id': 't1', 'priority': 'high'},
                [('update_node', 'task')],
            ),
            (
                'update_task_assignee',
                {
                    'roadmap_id': 'r1',
                    'task_id': 't1',
                    'assignee_id': 'u1',
                },
                [('update_node', 'task')],
            ),
            (
                'update_feature_status',
                {'roadmap_id': 'r1', 'feature_id': 'f1', 'status': 'blocked'},
                [('mark_status', 'feature')],
            ),
            (
                'update_epic_status',
                {'roadmap_id': 'r1', 'epic_id': 'e1', 'status': 'in_progress'},
                [('mark_status', 'epic')],
            ),
            (
                'update_titles',
                {
                    'roadmap_id': 'r1',
                    'node_type': 'task',
                    'node_id': 't1',
                    'title': 'Rename Task',
                },
                [('update_node', 'task')],
            ),
            (
                'delete_task',
                {'roadmap_id': 'r1', 'task_id': 't1'},
                [('delete_node', 'task')],
            ),
            (
                'delete_feature',
                {'roadmap_id': 'r1', 'feature_id': 'f1'},
                [('delete_node', 'feature')],
            ),
            (
                'delete_epic',
                {'roadmap_id': 'r1', 'epic_id': 'e1'},
                [('delete_node', 'epic')],
            ),
            (
                'move_task_to_feature',
                {
                    'roadmap_id': 'r1',
                    'task_id': 't1',
                    'feature_id': 'f2',
                    'position': 2,
                },
                [('move_node', 'task')],
            ),
            (
                'move_feature_to_epic',
                {
                    'roadmap_id': 'r1',
                    'feature_id': 'f2',
                    'epic_id': 'e1',
                },
                [('move_node', 'feature')],
            ),
            (
                'reorder_features',
                {
                    'roadmap_id': 'r1',
                    'epic_id': 'e1',
                    'feature_ids': ['f2', 'f1'],
                },
                [('move_node', 'feature'), ('move_node', 'feature')],
            ),
            (
                'reorder_epics',
                {'roadmap_id': 'r1', 'epic_ids': ['e2', 'e1']},
                [('move_node', 'epic'), ('move_node', 'epic')],
            ),
            (
                'bulk_assign_tasks',
                {
                    'roadmap_id': 'r1',
                    'task_ids': ['t1', 't2'],
                    'assignee_id': 'u1',
                },
                [('update_node', 'task'), ('update_node', 'task')],
            ),
            (
                'bulk_delete_tasks',
                {'roadmap_id': 'r1', 'task_ids': ['t1', 't2']},
                [('delete_node', 'task'), ('delete_node', 'task')],
            ),
            (
                'bulk_move_tasks_to_feature',
                {
                    'roadmap_id': 'r1',
                    'task_ids': ['t1', 't2'],
                    'feature_id': 'f2',
                    'start_position': 1,
                },
                [('move_node', 'task'), ('move_node', 'task')],
            ),
            (
                'bulk_update_feature_status',
                {
                    'roadmap_id': 'r1',
                    'feature_ids': ['f1', 'f2'],
                    'status': 'completed',
                },
                [('mark_status', 'feature'), ('mark_status', 'feature')],
            ),
            (
                'bulk_update_epic_status',
                {
                    'roadmap_id': 'r1',
                    'epic_ids': ['e1', 'e2'],
                    'status': 'completed',
                },
                [('mark_status', 'epic'), ('mark_status', 'epic')],
            ),
        ]

        for tool_name, args, expected in cases:
            with self.subTest(tool_name=tool_name):
                result = self.executor.execute(tool_name, args, self.session_context)
                operations = result.get('operations')
                self.assertIsInstance(operations, list)
                assert isinstance(operations, list)
                self.assertEqual(len(operations), len(expected))
                observed = [(op.get('op'), op.get('node_type')) for op in operations]
                self.assertEqual(observed, expected)

    def test_helper_tools_return_invalid_argument_for_missing_required_input(self) -> None:
        result = self.executor.execute(
            'create_feature',
            {'roadmap_id': 'r1', 'title': 'Missing Parent'},
            self.session_context,
        )
        error = result.get('error')
        self.assertIsInstance(error, dict)
        assert isinstance(error, dict)
        self.assertEqual(error.get('code'), 'INVALID_ARGUMENT')


if __name__ == '__main__':
    unittest.main()
