import logging
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.config import get_settings
from app.core.llm.context.handlers.base import ToolHandlerBase


def _make_handler(nest_client) -> ToolHandlerBase:
    return ToolHandlerBase(
        settings=get_settings(),
        logger=logging.getLogger('test'),
        nest_client=nest_client,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=64,
    )


class ContextResolveCoroutinePrefersBatchTests(unittest.TestCase):
    def test_uses_context_resolve_when_available(self) -> None:
        captured: dict = {}

        def _context_resolve(**kwargs):
            captured.update(kwargs)
            return {'matches': [], 'top_match': None}

        handler = _make_handler(
            SimpleNamespace(context_resolve=_context_resolve),
        )
        coro = handler._context_resolve_coroutine(
            roadmap_id='r1',
            query='Foo',
            node_type='epic',
            limit=5,
            auth_header='Bearer x',
            trace_id='tr',
            children_limit=5,
        )
        self.assertEqual(coro, {'matches': [], 'top_match': None})
        self.assertEqual(captured['query'], 'Foo')
        self.assertEqual(captured['node_type'], 'epic')
        self.assertTrue(captured['include_parent'])
        self.assertTrue(captured['include_children'])
        self.assertEqual(captured['children_limit'], 5)

    def test_falls_back_to_context_search_when_batch_unavailable(self) -> None:
        captured: dict = {}

        def _context_search(**kwargs):
            captured.update(kwargs)
            return {'matches': []}

        handler = _make_handler(
            SimpleNamespace(context_search=_context_search),
        )
        coro = handler._context_resolve_coroutine(
            roadmap_id='r1',
            query='Foo',
            node_type=None,
            limit=5,
            auth_header='Bearer x',
            trace_id='tr',
            children_limit=5,
        )
        self.assertEqual(coro, {'matches': []})
        # Fallback must not leak batch-specific kwargs into context_search.
        self.assertNotIn('include_parent', captured)
        self.assertNotIn('include_children', captured)
        self.assertNotIn('children_limit', captured)
        self.assertEqual(captured['query'], 'Foo')


class SubgraphFromBatchTopMatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.handler = _make_handler(MagicMock())

    def test_uses_top_match_when_ids_align(self) -> None:
        top_match = {
            'node': {'id': 'n1', 'type': 'epic', 'title': 'Foo'},
            'parent': {'id': 'p1', 'type': 'roadmap', 'title': 'Root'},
            'children': [
                {'id': 'c1', 'type': 'feature', 'title': 'Child', 'status': 'in_progress'},
            ],
        }
        selected = {'id': 'n1', 'type': 'epic', 'title': 'Foo'}
        subgraph = self.handler._subgraph_from_batch_top_match(
            top_match=top_match,
            selected_payload=selected,
        )
        self.assertIsNotNone(subgraph)
        self.assertEqual(subgraph['parent']['id'], 'p1')
        self.assertEqual(subgraph['parent']['type'], 'roadmap')
        self.assertEqual(len(subgraph['children']), 1)
        self.assertEqual(subgraph['children'][0]['status'], 'in_progress')

    def test_returns_none_when_ids_mismatch(self) -> None:
        top_match = {'node': {'id': 'other', 'type': 'epic', 'title': 'X'}}
        selected = {'id': 'n1', 'type': 'epic', 'title': 'Foo'}
        self.assertIsNone(
            self.handler._subgraph_from_batch_top_match(
                top_match=top_match, selected_payload=selected
            )
        )

    def test_returns_none_when_top_match_missing(self) -> None:
        self.assertIsNone(
            self.handler._subgraph_from_batch_top_match(
                top_match=None,
                selected_payload={'id': 'n1', 'type': 'epic', 'title': 'Foo'},
            )
        )

    def test_skips_invalid_parent_type(self) -> None:
        top_match = {
            'node': {'id': 'n1', 'type': 'feature', 'title': 'Feat'},
            'parent': {'id': 'p1', 'type': 'unexpected', 'title': '?'},
            'children': [],
        }
        selected = {'id': 'n1', 'type': 'feature', 'title': 'Feat'}
        subgraph = self.handler._subgraph_from_batch_top_match(
            top_match=top_match,
            selected_payload=selected,
        )
        self.assertIsNotNone(subgraph)
        self.assertNotIn('parent', subgraph)
        self.assertEqual(subgraph['children'], [])


if __name__ == '__main__':
    unittest.main()
