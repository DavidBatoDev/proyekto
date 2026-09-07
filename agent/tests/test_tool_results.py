"""List tool results reach the model as whole items with an honest count."""

from __future__ import annotations

import json
import unittest

from app.core.engine.tool_results import (
    MAX_LIST_TOOL_RESULT_CHARS,
    MAX_TOOL_RESULT_CHARS,
    tool_result_content,
)


def _task(index: int) -> dict[str, object]:
    return {
        'id': f'a852a3e8-f1bd-42e7-b426-ddb43e908{index:03d}',
        'title': f'Task {index}: build the media storage and upload pipeline with large-video support',
        'status': 'in_progress',
        'priority': None,
        'due_date': '2026-09-30',
        'assignee_ids': ['8ea29e1d-f188-4c0e-9bd9-5f00de331991'],
        'feature_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        'feature_title': 'Build CMS create/edit/publish for articles, blogs and resources',
        'epic_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'epic_title': 'CMS and content pipeline',
        'roadmap_id': '64867cc7-f528-4bce-b5ee-7f9bf109523c',
        'roadmap_name': 'PRD - Yachatdac Website',
        'project_id': 'cafc1c7a-d70b-4a22-98a2-94a04dc628b5',
        'project_title': 'PRD - Yachatdac Website',
    }


class ListTruncationTests(unittest.TestCase):
    def test_thirty_assigned_tasks_keep_whole_items_and_report_the_total(self) -> None:
        # Production run 0a014ee4: 30 tasks were cut mid-item at 8000 chars.
        payload = {'tasks': [_task(index) for index in range(30)]}
        raw = json.dumps(payload, ensure_ascii=False)
        self.assertGreater(len(raw), MAX_LIST_TOOL_RESULT_CHARS)

        rendered = tool_result_content(payload, 'list_my_tasks')
        parsed = json.loads(rendered)  # never cut mid-structure

        self.assertLessEqual(len(rendered), MAX_LIST_TOOL_RESULT_CHARS)
        self.assertGreater(len(rendered), MAX_TOOL_RESULT_CHARS)
        self.assertTrue(parsed['result_truncated'])
        self.assertEqual(parsed['total_tasks'], 30)
        self.assertEqual(parsed['returned_tasks'], len(parsed['tasks']))
        self.assertGreater(parsed['returned_tasks'], 15)
        self.assertEqual(parsed['tasks'], payload['tasks'][: parsed['returned_tasks']])
        # The cut page resumes right after its last item.
        self.assertEqual(parsed['next_offset'], parsed['returned_tasks'])
        self.assertIn(f'first {parsed["returned_tasks"]} of the 30 tasks', parsed['truncation_hint'])
        self.assertIn(f'offset={parsed["next_offset"]}', parsed['truncation_hint'])
        self.assertNotIn('larger limit', parsed['truncation_hint'])

    def test_a_cut_page_keeps_the_handler_total_and_resumes_from_its_offset(self) -> None:
        # A handler page at offset 10 of a 90-task set, itself too big to fit.
        payload = {'tasks': [_task(index) for index in range(30)], 'offset': 10, 'total_tasks': 90, 'next_offset': 40}
        parsed = json.loads(tool_result_content(payload, 'list_my_tasks'))
        self.assertTrue(parsed['result_truncated'])
        self.assertEqual(parsed['total_tasks'], 90)
        self.assertEqual(parsed['offset'], 10)
        self.assertEqual(parsed['next_offset'], 10 + parsed['returned_tasks'])
        self.assertLess(parsed['next_offset'], 40)

    def test_a_list_under_the_list_cap_is_returned_whole(self) -> None:
        payload = {'tasks': [_task(index) for index in range(18)]}
        raw = json.dumps(payload, ensure_ascii=False)
        self.assertGreater(len(raw), MAX_TOOL_RESULT_CHARS)
        self.assertLessEqual(len(raw), MAX_LIST_TOOL_RESULT_CHARS)
        self.assertEqual(tool_result_content(payload, 'list_my_tasks'), raw)

    def test_the_largest_list_is_the_one_trimmed_and_scalars_survive(self) -> None:
        payload = {
            'roadmap_id': '64867cc7-f528-4bce-b5ee-7f9bf109523c',
            'title': 'PRD - Yachatdac Website',
            'counts': {'tasks': 30},
            'epics': [{'id': f'e{i}', 'title': 'x' * 900} for i in range(40)],
            'milestones': [{'id': 'm1', 'title': 'Launch'}],
        }
        parsed = json.loads(tool_result_content(payload, 'get_roadmap_overview'))
        self.assertEqual(parsed['title'], 'PRD - Yachatdac Website')
        self.assertEqual(parsed['counts'], {'tasks': 30})
        self.assertEqual(parsed['milestones'], [{'id': 'm1', 'title': 'Launch'}])
        self.assertEqual(parsed['total_epics'], 40)
        self.assertLess(parsed['returned_epics'], 40)
        self.assertNotIn('total_milestones', parsed)

    def test_results_without_a_list_keep_the_hard_cut(self) -> None:
        rendered = tool_result_content({'content': 'x' * (MAX_TOOL_RESULT_CHARS + 500)}, 'get_node_details')
        self.assertTrue(rendered.endswith('(truncated)'))
        self.assertLessEqual(len(rendered), MAX_TOOL_RESULT_CHARS + len('…(truncated)'))

    def test_a_single_item_too_large_to_fit_falls_back_to_the_hard_cut(self) -> None:
        payload = {'matches': [{'id': 'm1', 'content': 'x' * (MAX_LIST_TOOL_RESULT_CHARS + 10)}]}
        rendered = tool_result_content(payload, 'search_nodes')
        self.assertTrue(rendered.endswith('(truncated)'))

    def test_small_results_are_untouched(self) -> None:
        payload = {'tasks': [_task(0)]}
        self.assertEqual(tool_result_content(payload, 'list_my_tasks'), json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
