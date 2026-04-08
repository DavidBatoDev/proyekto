import unittest

from app.core.orchestration.react.react_planning_loop import _collect_resolved_node_ids


class ReactPlanningLoopTests(unittest.TestCase):
    def test_collect_resolved_node_ids_includes_task_and_match_ids(self) -> None:
        summary = [
            {
                'tool_name': 'get_tasks_by_feature',
                'feature_id': 'feature-1',
                'task_ids': ['task-1', 'task-2'],
                'tasks': [
                    {'id': 'task-3', 'title': 'Task 3', 'status': 'todo'},
                ],
            },
            {
                'tool_name': 'resolve_node_reference',
                'match_ids': ['epic-1'],
                'match_items': [{'id': 'feature-1'}],
            },
            {
                'tool_name': 'bulk_update_tasks_by_parent',
                'operation_node_ids': ['task-2', 'task-4'],
            },
        ]

        resolved_ids = _collect_resolved_node_ids(summary)

        self.assertEqual(
            resolved_ids,
            ['feature-1', 'task-1', 'task-2', 'task-3', 'epic-1', 'task-4'],
        )

    def test_collect_resolved_node_ids_limits_to_fifty_unique_items(self) -> None:
        summary = [
            {
                'tool_name': 'get_tasks_by_feature',
                'task_ids': [f'task-{index}' for index in range(80)],
            }
        ]

        resolved_ids = _collect_resolved_node_ids(summary)

        self.assertEqual(len(resolved_ids), 50)
        self.assertEqual(resolved_ids[0], 'task-0')
        self.assertEqual(resolved_ids[-1], 'task-49')


if __name__ == '__main__':
    unittest.main()
