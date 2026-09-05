"""Every task-list read returns the assignee set: `_collect_tasks_for_epic`
(behind get_tasks_by_epic / get_tasks_by_status / get_overdue_tasks) passes
`assignee_id` / `assignee_ids` through from the backend's child rows, and
`get_overdue_tasks` copies them from the per-task details it already
fetches. Rows without the keys (older backend payloads) stay key-less rather
than growing a fabricated empty set."""

import asyncio
import logging
import unittest

from app.core.config import get_settings
from app.core.tools.handlers.context_query import ContextQueryHandler
from app.core.tools.registry import get_context_tools

ROADMAP = '11111111-1111-4111-8111-111111111111'
EPIC = 'epic-1'
FEATURE = 'feat-1'
ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

_LOGGER = logging.getLogger('context-query-assignee-tests')


class _Nest:
    """One epic -> one feature -> the given task rows; details by task id."""

    def __init__(self, *, children, details=None):
        self.children = children
        self.details = details or {}
        self.detail_calls: list[str] = []

    async def context_summary(self, **kwargs):
        return {'epics': [{'id': EPIC, 'title': 'Epic 1'}]}

    async def context_features(self, **kwargs):
        return {
            'children': [
                {'id': FEATURE, 'type': 'feature', 'title': 'Feature 1', 'status': 'in_progress'}
            ]
        }

    async def context_children(self, **kwargs):
        return {'children': self.children}

    async def context_node_details(self, *, node_id, **kwargs):
        self.detail_calls.append(node_id)
        return dict(self.details.get(node_id, {}))


def _handler(nest: _Nest) -> ContextQueryHandler:
    return ContextQueryHandler(
        settings=get_settings(),
        logger=_LOGGER,
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


def _task_row(task_id: str, **fields):
    row = {'id': task_id, 'type': 'task', 'title': task_id.upper(), 'status': 'todo'}
    row.update(fields)
    return row


class CollectTasksForEpicTests(unittest.TestCase):
    def test_child_rows_pass_the_assignee_set_through(self) -> None:
        nest = _Nest(children=[
            _task_row('task-1', assignee_id=ANA, assignee_ids=[ANA, BEN]),
            _task_row('task-2', assignee_id=None, assignee_ids=[]),
            _task_row('task-3'),
        ])
        result = asyncio.run(
            _handler(nest)._collect_tasks_for_epic(
                roadmap_id=ROADMAP,
                epic_id=EPIC,
                status_filter='all',
                limit=50,
                session_context={},
                auth_header=None,
                trace_id=None,
            )
        )
        rows = {row['id']: row for row in result['tasks']}
        self.assertEqual(set(rows), {'task-1', 'task-2', 'task-3'})
        self.assertEqual(rows['task-1']['assignee_ids'], [ANA, BEN])
        self.assertEqual(rows['task-1']['assignee_id'], ANA)
        self.assertEqual(rows['task-2']['assignee_ids'], [])
        self.assertIsNone(rows['task-2']['assignee_id'])
        # Absent on the wire stays absent — never fabricated.
        self.assertNotIn('assignee_ids', rows['task-3'])
        self.assertNotIn('assignee_id', rows['task-3'])
        # The rest of the row shape is unchanged.
        self.assertEqual(rows['task-1']['feature_id'], FEATURE)
        self.assertEqual(rows['task-1']['epic_id'], EPIC)

    def test_get_tasks_by_epic_returns_the_set(self) -> None:
        nest = _Nest(children=[_task_row('task-1', assignee_id=ANA, assignee_ids=[ANA, BEN])])
        result = asyncio.run(
            _handler(nest).execute(
                'get_tasks_by_epic',
                {'roadmap_id': ROADMAP, 'epic_id': EPIC},
                {'trace_id': None},
            )
        )
        self.assertEqual(result['tasks'][0]['assignee_ids'], [ANA, BEN])
        self.assertEqual(result['tasks'][0]['assignee_id'], ANA)


class OverdueTasksTests(unittest.TestCase):
    def test_overdue_rows_copy_the_assignee_set_from_the_details(self) -> None:
        nest = _Nest(
            children=[
                # The list row carries a stale single-assignee view; the
                # details (already fetched for due_date) are authoritative.
                _task_row('task-1', assignee_id=ANA, assignee_ids=[ANA]),
                _task_row('task-2'),
                _task_row('task-3', assignee_id=BEN, assignee_ids=[BEN]),
            ],
            details={
                'task-1': {'id': 'task-1', 'due_date': '2026-01-10',
                           'assignee_id': ANA, 'assignee_ids': [ANA, BEN]},
                'task-2': {'id': 'task-2', 'due_date': '2026-01-20',
                           'assignee_id': None, 'assignee_ids': []},
                'task-3': {'id': 'task-3', 'due_date': '2026-03-01',
                           'assignee_id': BEN, 'assignee_ids': [BEN]},
            },
        )
        result = asyncio.run(
            _handler(nest).execute(
                'get_overdue_tasks',
                {'roadmap_id': ROADMAP, 'reference_date': '2026-02-01'},
                {'trace_id': None},
            )
        )
        rows = {row['id']: row for row in result['tasks']}
        self.assertEqual(set(rows), {'task-1', 'task-2'})  # task-3 is not overdue
        self.assertEqual(rows['task-1']['due_date'], '2026-01-10')
        self.assertEqual(rows['task-1']['days_overdue'], 22)
        self.assertEqual(rows['task-1']['assignee_ids'], [ANA, BEN])
        self.assertEqual(rows['task-1']['assignee_id'], ANA)
        self.assertEqual(rows['task-2']['assignee_ids'], [])
        self.assertIsNone(rows['task-2']['assignee_id'])

    def test_details_without_the_keys_keep_the_list_row_values(self) -> None:
        nest = _Nest(
            children=[_task_row('task-1', assignee_id=ANA, assignee_ids=[ANA])],
            details={'task-1': {'id': 'task-1', 'due_date': '2026-01-10'}},
        )
        result = asyncio.run(
            _handler(nest).execute(
                'get_overdue_tasks',
                {'roadmap_id': ROADMAP, 'reference_date': '2026-02-01'},
                {'trace_id': None},
            )
        )
        self.assertEqual(result['tasks'][0]['assignee_ids'], [ANA])
        self.assertEqual(result['tasks'][0]['assignee_id'], ANA)


class ReadToolDescriptionTests(unittest.TestCase):
    """The LLM-visible descriptions say where the set is (and is not)."""

    def _descriptions(self) -> dict[str, str]:
        return {
            tool['function']['name']: tool['function']['description']
            for tool in get_context_tools()
        }

    def test_task_list_reads_advertise_the_set(self) -> None:
        descriptions = self._descriptions()
        clause = 'Tasks carry `assignee_ids` (all assignees) and `assignee_id` (primary).'
        for name in (
            'get_node_details',
            'get_tasks_by_parent',
            'get_tasks_by_status',
            'get_overdue_tasks',
            'get_tasks_assigned_to_me',
        ):
            self.assertIn(clause, descriptions[name], name)

    def test_search_tasks_says_assignees_are_not_included(self) -> None:
        description = self._descriptions()['search_tasks']
        self.assertNotIn('Tasks carry `assignee_ids`', description)
        self.assertIn('Assignees are not included', description)
        self.assertIn('call get_node_details for the assignee set', description)


if __name__ == '__main__':
    unittest.main()
