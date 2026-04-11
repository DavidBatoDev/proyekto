import asyncio
import logging
from types import SimpleNamespace
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
            '11111111-1111-1111-1111-111111111111': {
                'id': '11111111-1111-1111-1111-111111111111',
                'type': 'epic',
                'title': 'Auth Epic',
                'status': 'in_progress',
            },
        }
        assignees = {
            't1': 'u1',
            't2': 'u1',
            't3': 'u2',
        }
        priorities = {
            't1': 'medium',
            't2': 'low',
            't3': 'high',
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
            'assignee_id': assignees.get(node_id),
            'priority': priorities.get(node_id),
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
        self.assertIn('get_tasks_by_parent', context_tool_names)
        self.assertNotIn('get_features', context_tool_names)
        self.assertNotIn('get_children', context_tool_names)
        self.assertNotIn('get_tasks_by_feature', context_tool_names)
        self.assertNotIn('get_tasks_by_epic', context_tool_names)
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
        self.assertIn('bulk_update_tasks_by_parent', edit_tool_names)
        self.assertIn('bulk_update_tasks_by_filter', edit_tool_names)
        self.assertIn('plan_roadmap_operations', edit_tool_names)

        resolve_tool = next(
            tool for tool in context_tools
            if str(tool.get('function', {}).get('name') or '') == 'resolve_node_reference'
        )
        resolve_props = (
            resolve_tool.get('function', {})
            .get('parameters', {})
            .get('properties', {})
        )
        self.assertIn('auto_correct', resolve_props)
        self.assertIn('fuzzy', resolve_props)

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

    def test_bulk_update_tasks_by_parent_feature_skips_noop_updates(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_type': 'feature',
                'parent_id': 'f1',
                'status': 'done',
                'include_completed': True,
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].get('node_id'), 't1')
        self.assertEqual(result.get('parent_type'), 'feature')
        self.assertEqual(result.get('matched_task_count'), 2)
        self.assertEqual(result.get('updated_task_count'), 1)
        self.assertEqual(result.get('total_child_task_count'), 2)
        self.assertEqual(result.get('eligible_task_count'), 2)
        self.assertEqual(result.get('already_target_status_count'), 1)
        self.assertEqual(result.get('excluded_completed_count'), 0)

    def test_bulk_update_tasks_by_parent_epic_updates_nested_tasks(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_type': 'epic',
                'parent_id': '11111111-1111-1111-1111-111111111111',
                'status': 'in_review',
                'include_completed': True,
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 3)
        self.assertEqual(
            [op.get('node_id') for op in operations],
            ['t1', 't2', 't3'],
        )
        self.assertEqual(result.get('matched_task_count'), 3)
        self.assertEqual(result.get('updated_task_count'), 3)

    def test_bulk_update_tasks_by_parent_excludes_completed_by_default(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_type': 'feature',
                'parent_id': 'f1',
                'status': 'in_review',
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual([op.get('node_id') for op in operations], ['t1'])
        self.assertEqual(result.get('matched_task_count'), 1)
        self.assertEqual(result.get('total_child_task_count'), 2)
        self.assertEqual(result.get('eligible_task_count'), 1)
        self.assertEqual(result.get('excluded_completed_count'), 1)
        self.assertEqual(result.get('already_target_status_count'), 0)

    def test_bulk_update_tasks_by_parent_include_completed_true_updates_done(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_type': 'feature',
                'parent_id': 'f1',
                'status': 'in_review',
                'include_completed': True,
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual([op.get('node_id') for op in operations], ['t1', 't2'])
        self.assertEqual(result.get('matched_task_count'), 2)
        self.assertEqual(result.get('total_child_task_count'), 2)
        self.assertEqual(result.get('eligible_task_count'), 2)
        self.assertEqual(result.get('excluded_completed_count'), 0)
        self.assertEqual(result.get('already_target_status_count'), 0)

    def test_bulk_update_tasks_by_parent_rejects_invalid_parent_type(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_type': 'roadmap',
                'parent_id': 'r1',
                'status': 'done',
            },
            self.session_context,
        )
        error = result.get('error')
        self.assertIsInstance(error, dict)
        assert isinstance(error, dict)
        self.assertEqual(error.get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(error.get('arg_name'), 'parent_type')

    def test_bulk_update_tasks_by_filter_updates_by_parent_and_status_filter(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_filter',
            {
                'roadmap_id': 'r1',
                'filters': {
                    'parent_type': 'feature',
                    'parent_id': 'f1',
                    'status': 'todo',
                },
                'update': {'status': 'in_review'},
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].get('op'), 'mark_status')
        self.assertEqual(operations[0].get('node_id'), 't1')

    def test_bulk_update_tasks_by_filter_defaults_to_excluding_completed(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_filter',
            {
                'roadmap_id': 'r1',
                'filters': {
                    'assignee_id': 'u1',
                },
                'update': {'priority': 'high'},
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0].get('op'), 'update_node')
        self.assertEqual(operations[0].get('node_id'), 't1')
        self.assertEqual((operations[0].get('patch') or {}).get('priority'), 'high')
        self.assertFalse((result.get('filters') or {}).get('include_completed'))

    def test_bulk_update_tasks_by_filter_rejects_empty_update_object(self) -> None:
        result = self.executor.execute(
            'bulk_update_tasks_by_filter',
            {
                'roadmap_id': 'r1',
                'filters': {'status': 'todo'},
                'update': {},
            },
            self.session_context,
        )
        error = result.get('error')
        self.assertIsInstance(error, dict)
        assert isinstance(error, dict)
        self.assertEqual(error.get('code'), 'INVALID_ARGUMENT')
        self.assertEqual(error.get('arg_name'), 'update')

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

    def test_update_task_assignee_accepts_unassign_token(self) -> None:
        result = self.executor.execute(
            'update_task_assignee',
            {
                'roadmap_id': 'r1',
                'task_id': 't1',
                'assignee_id': 'unassign',
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 1)
        self.assertEqual((operations[0].get('patch') or {}).get('assignee_id'), None)

    def test_bulk_assign_tasks_accepts_null_for_unassign(self) -> None:
        result = self.executor.execute(
            'bulk_assign_tasks',
            {
                'roadmap_id': 'r1',
                'task_ids': ['t1', 't2'],
                'assignee_id': None,
            },
            self.session_context,
        )
        operations = result.get('operations')
        self.assertIsInstance(operations, list)
        assert isinstance(operations, list)
        self.assertEqual(len(operations), 2)
        self.assertTrue(
            all((op.get('patch') or {}).get('assignee_id') is None for op in operations)
        )

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

    def test_resolve_node_reference_relaxes_typed_search_when_empty(self) -> None:
        observed_node_types: list[str | None] = []

        async def _context_search(
            roadmap_id: str,
            query: str,
            node_type: str | None,
            limit: int | None,
            auth_header: str | None,
            trace_id: str | None = None,
        ) -> dict:
            observed_node_types.append(node_type)
            if node_type == 'epic':
                return {'matches': []}
            if query == 'Autenthication System':
                return {
                    'matches': [
                        {
                            'id': '123e4567-e89b-12d3-a456-426614174000',
                            'type': 'feature',
                            'title': 'Authentication System',
                        }
                    ]
                }
            return {'matches': []}

        executor = ContextToolsExecutor(
            settings=get_settings().model_copy(
                update={'agent_resolve_parallel_variants_enabled': False}
            ),
            logger=logging.getLogger('context-tools-intent-tests-resolve-fallback'),
            nest_client=SimpleNamespace(context_search=_context_search),
            run_async_context_call=self._run_async,
        )
        result = executor.execute(
            'resolve_node_reference',
            {
                'roadmap_id': 'r1',
                'label': 'Autenthication System',
                'node_type': 'epic',
                'auto_correct': False,
                'fuzzy': False,
                'limit': 5,
            },
            self.session_context,
        )

        self.assertEqual(result.get('status'), 'unique')
        selected = result.get('selected')
        self.assertIsInstance(selected, dict)
        assert isinstance(selected, dict)
        self.assertEqual(selected.get('type'), 'feature')
        self.assertTrue(bool(result.get('type_relaxed')))
        self.assertEqual(observed_node_types, ['epic', None])

    def test_resolve_node_reference_relaxed_single_weak_match_does_not_auto_select(self) -> None:
        observed_node_types: list[str | None] = []

        async def _context_search(
            roadmap_id: str,
            query: str,
            node_type: str | None,
            limit: int | None,
            auth_header: str | None,
            trace_id: str | None = None,
        ) -> dict:
            observed_node_types.append(node_type)
            if node_type == 'epic':
                return {'matches': []}
            if query == 'Autenthication System':
                return {
                    'matches': [
                        {
                            'id': '123e4567-e89b-12d3-a456-426614174111',
                            'type': 'feature',
                            'title': 'Auth UX',
                            'score': 0.71,
                        }
                    ]
                }
            return {'matches': []}

        executor = ContextToolsExecutor(
            settings=get_settings().model_copy(
                update={'agent_resolve_parallel_variants_enabled': False}
            ),
            logger=logging.getLogger('context-tools-intent-tests-resolve-weak-relaxed'),
            nest_client=SimpleNamespace(context_search=_context_search),
            run_async_context_call=self._run_async,
        )
        result = executor.execute(
            'resolve_node_reference',
            {
                'roadmap_id': 'r1',
                'label': 'Autenthication System',
                'node_type': 'epic',
                'auto_correct': False,
                'fuzzy': False,
                'limit': 5,
            },
            self.session_context,
        )

        self.assertEqual(result.get('status'), 'not_found')
        self.assertIsNone(result.get('selected'))
        self.assertTrue(bool(result.get('type_relaxed')))
        self.assertEqual(observed_node_types, ['epic', None])

    def test_resolve_node_reference_unique_feature_returns_one_hop_subgraph(self) -> None:
        async def _context_search(
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
                        'id': 'f1',
                        'type': 'feature',
                        'title': 'Authentication System',
                        'parent_id': 'e1',
                        'parent_title': 'User Management',
                        'score': 0.99,
                    }
                ]
            }

        async def _context_children(
            roadmap_id: str,
            node_id: str,
            limit: int | None,
            auth_header: str | None,
            trace_id: str | None = None,
        ) -> dict:
            self.assertEqual(node_id, 'f1')
            return {
                'children': [
                    {'id': 't1', 'type': 'task', 'title': 'Login API', 'status': 'todo'},
                    {'id': 't2', 'type': 'task', 'title': 'JWT Validation', 'status': 'in_progress'},
                ]
            }

        executor = ContextToolsExecutor(
            settings=get_settings().model_copy(
                update={'agent_resolve_parallel_variants_enabled': False}
            ),
            logger=logging.getLogger('context-tools-intent-tests-resolve-subgraph-feature'),
            nest_client=SimpleNamespace(
                context_search=_context_search,
                context_children=_context_children,
                context_node_details=lambda **_kwargs: {'id': 'unused'},
                context_features=lambda **_kwargs: {'children': []},
            ),
            run_async_context_call=self._run_async,
        )
        result = executor.execute(
            'resolve_node_reference',
            {
                'roadmap_id': 'r1',
                'label': 'Authentication System',
                'auto_correct': False,
                'fuzzy': False,
                'limit': 5,
            },
            self.session_context,
        )

        self.assertEqual(result.get('status'), 'unique')
        node = result.get('node')
        self.assertIsInstance(node, dict)
        assert isinstance(node, dict)
        self.assertEqual(node.get('id'), 'f1')
        self.assertEqual(node.get('type'), 'feature')
        parent = result.get('parent')
        self.assertIsInstance(parent, dict)
        assert isinstance(parent, dict)
        self.assertEqual(parent.get('id'), 'e1')
        self.assertEqual(parent.get('type'), 'epic')
        self.assertEqual(parent.get('title'), 'User Management')
        children = result.get('children')
        self.assertIsInstance(children, list)
        assert isinstance(children, list)
        self.assertEqual([item.get('id') for item in children], ['t1', 't2'])
        self.assertEqual([item.get('status') for item in children], ['todo', 'in_progress'])

        resolved_subgraph = result.get('resolved_subgraph')
        self.assertIsInstance(resolved_subgraph, dict)
        assert isinstance(resolved_subgraph, dict)
        self.assertEqual((resolved_subgraph.get('node') or {}).get('id'), 'f1')

    def test_resolve_node_reference_unique_task_returns_parent_without_children(self) -> None:
        async def _context_search(
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
                        'title': 'Login API',
                        'parent_id': 'f1',
                        'parent_title': 'Authentication System',
                        'score': 0.99,
                    }
                ]
            }

        executor = ContextToolsExecutor(
            settings=get_settings().model_copy(
                update={'agent_resolve_parallel_variants_enabled': False}
            ),
            logger=logging.getLogger('context-tools-intent-tests-resolve-subgraph-task'),
            nest_client=SimpleNamespace(
                context_search=_context_search,
                context_children=lambda **_kwargs: {'children': []},
                context_node_details=lambda **_kwargs: {'id': 'unused'},
                context_features=lambda **_kwargs: {'children': []},
            ),
            run_async_context_call=self._run_async,
        )
        result = executor.execute(
            'resolve_node_reference',
            {
                'roadmap_id': 'r1',
                'label': 'Login API',
                'auto_correct': False,
                'fuzzy': False,
                'limit': 5,
            },
            self.session_context,
        )

        self.assertEqual(result.get('status'), 'unique')
        parent = result.get('parent')
        self.assertIsInstance(parent, dict)
        assert isinstance(parent, dict)
        self.assertEqual(parent.get('id'), 'f1')
        self.assertEqual(parent.get('type'), 'feature')
        self.assertNotIn('children', result)

    def test_resolve_node_reference_ambiguous_does_not_enrich_subgraph(self) -> None:
        call_counts = {'children': 0, 'features': 0, 'details': 0}

        async def _context_search(
            roadmap_id: str,
            query: str,
            node_type: str | None,
            limit: int | None,
            auth_header: str | None,
            trace_id: str | None = None,
        ) -> dict:
            return {
                'matches': [
                    {'id': 'f1', 'type': 'feature', 'title': 'Authentication System', 'score': 0.89},
                    {'id': 'f2', 'type': 'feature', 'title': 'Authentication Services', 'score': 0.86},
                ]
            }

        async def _context_children(**_kwargs) -> dict:
            call_counts['children'] += 1
            return {'children': []}

        async def _context_features(**_kwargs) -> dict:
            call_counts['features'] += 1
            return {'children': []}

        async def _context_node_details(**_kwargs) -> dict:
            call_counts['details'] += 1
            return {}

        executor = ContextToolsExecutor(
            settings=get_settings().model_copy(
                update={'agent_resolve_parallel_variants_enabled': False}
            ),
            logger=logging.getLogger('context-tools-intent-tests-resolve-subgraph-ambiguous'),
            nest_client=SimpleNamespace(
                context_search=_context_search,
                context_children=_context_children,
                context_features=_context_features,
                context_node_details=_context_node_details,
            ),
            run_async_context_call=self._run_async,
        )
        result = executor.execute(
            'resolve_node_reference',
            {
                'roadmap_id': 'r1',
                'label': 'Authentication',
                'auto_correct': False,
                'fuzzy': False,
                'limit': 5,
            },
            self.session_context,
        )

        self.assertEqual(result.get('status'), 'ambiguous')
        self.assertNotIn('resolved_subgraph', result)
        self.assertNotIn('children', result)
        self.assertEqual(call_counts, {'children': 0, 'features': 0, 'details': 0})

    def test_get_tasks_by_parent_for_feature_filters_by_status(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_id': 'f1',
                'parent_type': 'feature',
                'status': 'todo',
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t1'])

    def test_get_tasks_by_parent_infers_epic_type_from_parent_details(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_id': '11111111-1111-1111-1111-111111111111',
                'status': 'done',
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t2', 't3'])

    def test_get_tasks_by_parent_excludes_completed_by_default(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_id': 'f1',
                'parent_type': 'feature',
                'status': 'all',
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t1'])
        self.assertFalse(bool(result.get('include_completed')))

    def test_get_tasks_by_parent_excludes_completed_when_requested(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_parent',
            {
                'roadmap_id': 'r1',
                'parent_id': 'f1',
                'parent_type': 'feature',
                'include_completed': False,
                'status': 'all',
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t1'])

    def test_legacy_get_tasks_by_feature_still_executes(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_feature',
            {
                'roadmap_id': 'r1',
                'feature_id': 'f1',
                'status': 'all',
                'limit': 10,
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t1', 't2'])

    def test_legacy_get_tasks_by_epic_still_executes(self) -> None:
        result = self.executor.execute(
            'get_tasks_by_epic',
            {
                'roadmap_id': 'r1',
                'epic_id': '11111111-1111-1111-1111-111111111111',
                'status': 'done',
                'limit': 10,
            },
            self.session_context,
        )
        tasks = result.get('tasks')
        self.assertIsInstance(tasks, list)
        assert isinstance(tasks, list)
        self.assertEqual([item.get('id') for item in tasks], ['t2', 't3'])

    def test_legacy_get_children_still_executes(self) -> None:
        result = self.executor.execute(
            'get_children',
            {
                'roadmap_id': 'r1',
                'parent_id': '11111111-1111-1111-1111-111111111111',
                'limit': 10,
            },
            self.session_context,
        )
        children = result.get('children')
        self.assertIsInstance(children, list)
        assert isinstance(children, list)
        self.assertEqual(children, [])

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
                'bulk_update_tasks_by_parent',
                {
                    'roadmap_id': 'r1',
                    'parent_type': 'feature',
                    'parent_id': 'f1',
                    'status': 'in_review',
                    'include_completed': True,
                },
                [('mark_status', 'task'), ('mark_status', 'task')],
            ),
            (
                'bulk_update_tasks_by_filter',
                {
                    'roadmap_id': 'r1',
                    'filters': {
                        'parent_type': 'feature',
                        'parent_id': 'f1',
                        'status': 'todo',
                    },
                    'update': {'status': 'in_review'},
                },
                [('mark_status', 'task')],
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
