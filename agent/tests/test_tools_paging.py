"""The paging helpers every list tool shares (tools/handlers/paging.py)."""

from __future__ import annotations

import unittest

from app.core.tools.handlers.paging import (
    MAX_OFFSET,
    PAGING_UNSUPPORTED_CODE,
    capped_list,
    clamp_offset,
    fetch_window,
    page_from_backend,
    page_from_start,
    paging_unsupported_error,
)


def _rows(count: int) -> list[dict[str, str]]:
    return [{'id': f'r{i}', 'title': f'Row {i}'} for i in range(count)]


class ClampTests(unittest.TestCase):
    def test_offset_is_a_bounded_non_negative_int(self) -> None:
        self.assertEqual(clamp_offset(None), 0)
        self.assertEqual(clamp_offset(True), 0)
        self.assertEqual(clamp_offset('7'), 0)
        self.assertEqual(clamp_offset(-3), 0)
        self.assertEqual(clamp_offset(25), 25)
        self.assertEqual(clamp_offset(10 ** 9), MAX_OFFSET)

    def test_fetch_window_is_the_page_plus_a_probe_row_within_the_cap(self) -> None:
        self.assertEqual(fetch_window(0, 10, 50), 11)
        self.assertEqual(fetch_window(45, 10, 50), 50)
        self.assertEqual(fetch_window(0, 0, 50), 1)


class PageFromStartTests(unittest.TestCase):
    def test_complete_set_reports_total_and_ends_cleanly(self) -> None:
        page = page_from_start(_rows(7), 'tasks', offset=5, limit=2, complete=True, extra={'roadmap_id': 'r'})
        self.assertEqual([row['id'] for row in page['tasks']], ['r5', 'r6'])
        self.assertEqual(page['roadmap_id'], 'r')
        self.assertEqual((page['offset'], page['returned_tasks'], page['total_tasks'], page['next_offset']), (5, 2, 7, None))
        first = page_from_start(_rows(7), 'tasks', offset=0, limit=3, complete=True)
        self.assertEqual((first['returned_tasks'], first['next_offset']), (3, 3))

    def test_incomplete_set_has_no_total_and_a_full_page_always_continues(self) -> None:
        # The source was capped at the window: 4 rows for offset 0, limit 3.
        page = page_from_start(_rows(4), 'items', offset=0, limit=3, complete=False)
        self.assertNotIn('total_items', page)
        self.assertEqual(page['next_offset'], 3)
        # A later filter ate the probe row: a full page still continues.
        filtered = page_from_start(_rows(3), 'items', offset=0, limit=3, complete=False)
        self.assertEqual(filtered['next_offset'], 3)
        # A short page from an incomplete source is the end of what it found.
        short = page_from_start(_rows(2), 'items', offset=0, limit=3, complete=False)
        self.assertIsNone(short['next_offset'])

    def test_offset_past_the_end_is_an_empty_final_page(self) -> None:
        page = page_from_start(_rows(2), 'epics', offset=9, limit=5, complete=True)
        self.assertEqual(page['epics'], [])
        self.assertEqual((page['offset'], page['returned_epics'], page['total_epics'], page['next_offset']), (9, 0, 2, None))


class PageFromBackendTests(unittest.TestCase):
    def test_backend_page_keys_are_renamed_to_the_tool_contract(self) -> None:
        page = page_from_backend(
            {'tasks': _rows(2), 'offset': 25, 'total': 30, 'next_offset': None, 'next_cursor': 'abc'},
            'tasks', offset=25,
        )
        self.assertEqual((page['offset'], page['returned_tasks'], page['total_tasks'], page['next_offset']), (25, 2, 30, None))
        for gone in ('total', 'next_cursor'):
            self.assertNotIn(gone, page)

    def test_a_backend_from_before_paging_is_a_complete_first_page(self) -> None:
        page = page_from_backend({'tasks': _rows(3)}, 'tasks', offset=0)
        self.assertEqual((page['offset'], page['returned_tasks'], page['next_offset']), (0, 3, None))
        self.assertNotIn('total_tasks', page)
        self.assertEqual(page_from_backend({'matches': 'junk'}, 'matches', offset=0)['matches'], [])


class CappedListTests(unittest.TestCase):
    def test_capped_list_keeps_an_honest_count(self) -> None:
        page = capped_list({'projects': _rows(70), 'workspace': {'id': 'w'}}, 'projects', 60)
        self.assertEqual((len(page['projects']), page['total_projects'], page['returned_projects']), (60, 70, 60))
        self.assertEqual(page['workspace'], {'id': 'w'})
        untouched = {'projects': 'nope'}
        self.assertIs(capped_list(untouched, 'projects', 60), untouched)

    def test_unsupported_error_shape(self) -> None:
        error = paging_unsupported_error()
        self.assertEqual(error['error']['code'], PAGING_UNSUPPORTED_CODE)
        self.assertIn('narrow', error['error']['message'].lower())


if __name__ == '__main__':
    unittest.main()
