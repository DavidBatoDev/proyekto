"""search_knowledge tool: flag-gated exposure in build_tools, permanent
dispatch wiring, handler arg clamping + result shaping under the loop's
tool-result cap, and nest_client URL construction."""

from __future__ import annotations

import json
import logging
import unittest

from app.core.config import get_settings
from app.core.llm.context.handlers.context_query import ContextQueryHandler
from app.core.nest_client import NestRoadmapClient
from app.core.v2 import tools_spec
from app.core.v2.loop import _MAX_TOOL_RESULT_CHARS, _tool_result_content


class ExposureTests(unittest.TestCase):
    def test_flag_off_hides_tool_but_keeps_dispatch_wiring(self) -> None:
        names = {tool['function']['name'] for tool in tools_spec.build_tools()}
        self.assertNotIn('search_knowledge', names)
        # A stray call is still dispatched (never treated as terminal).
        self.assertTrue(tools_spec.is_dispatcher_tool('search_knowledge'))
        self.assertTrue(tools_spec.is_read_tool('search_knowledge'))
        self.assertFalse(tools_spec.is_terminal_tool('search_knowledge'))

    def test_flag_on_exposes_tool_with_expected_schema(self) -> None:
        tools = tools_spec.build_tools(include_knowledge_search=True)
        spec = next(
            tool for tool in tools if tool['function']['name'] == 'search_knowledge'
        )
        params = spec['function']['parameters']
        self.assertEqual(params['required'], ['query'])
        self.assertEqual(
            params['properties']['sources']['items']['enum'],
            ['chat_message', 'task_comment', 'activity_log', 'brief'],
        )
        self.assertEqual(params['properties']['limit']['maximum'], 12)


class _KnowledgeNest:
    def __init__(self, payload=None):
        self.payload = payload if payload is not None else {
            'project_id': 'project-1',
            'query': 'payments',
            'results': [],
        }
        self.calls: list[dict] = []

    async def context_knowledge_search(self, **kwargs):
        self.calls.append(kwargs)
        return self.payload


def _handler(nest) -> ContextQueryHandler:
    return ContextQueryHandler(
        settings=get_settings(),
        logger=logging.getLogger('knowledge-search-tests'),
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_query_never_calls_backend(self) -> None:
        nest = _KnowledgeNest()
        result = await _handler(nest).execute(
            'search_knowledge', {'query': '   '}, {'roadmap_id': 'rm-1'}
        )
        self.assertEqual(result['error']['code'], 'MISSING_QUERY')
        self.assertEqual(nest.calls, [])

    async def test_args_are_clamped_and_invalid_sources_dropped(self) -> None:
        nest = _KnowledgeNest()
        await _handler(nest).execute(
            'search_knowledge',
            {
                'query': 'q' * 900,
                'sources': ['chat_message', 'nonsense', 'brief'],
                'limit': 99,
            },
            {'roadmap_id': 'rm-1', 'auth_header': 'Bearer t'},
        )
        call = nest.calls[0]
        self.assertEqual(len(call['query']), 400)
        self.assertEqual(call['sources'], ['chat_message', 'brief'])
        self.assertEqual(call['limit'], 12)

    async def test_all_invalid_sources_fall_back_to_unfiltered(self) -> None:
        nest = _KnowledgeNest()
        await _handler(nest).execute(
            'search_knowledge',
            {'query': 'payments', 'sources': ['memory']},
            {'roadmap_id': 'rm-1', 'auth_header': 'Bearer t'},
        )
        self.assertIsNone(nest.calls[0]['sources'])
        self.assertEqual(nest.calls[0]['limit'], 8)

    async def test_oversized_results_stay_valid_json_under_loop_cap(self) -> None:
        results = [
            {
                'id': f'chunk-{i}',
                'source_type': 'chat_message',
                'content': 'x' * 1_500,
                'score': 0.5,
            }
            for i in range(20)
        ]
        nest = _KnowledgeNest(
            payload={'project_id': 'p-1', 'query': 'q', 'results': results}
        )
        result = await _handler(nest).execute(
            'search_knowledge',
            {'query': 'payments'},
            {'roadmap_id': 'rm-1', 'auth_header': 'Bearer t'},
        )
        self.assertEqual(len(result['results']), 12)
        self.assertTrue(all(len(r['content']) <= 901 for r in result['results']))
        rendered = _tool_result_content('search_knowledge', result)
        self.assertLessEqual(len(rendered), _MAX_TOOL_RESULT_CHARS)
        json.loads(rendered)  # never truncated mid-structure


class NestClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_url_shape_encodes_query_sources_and_limit(self) -> None:
        client = NestRoadmapClient()
        seen: dict[str, str] = {}

        async def fake_get(path, auth_header, trace_id=None):
            seen['path'] = path
            return {}

        client._get = fake_get  # type: ignore[method-assign]
        await client.context_knowledge_search(
            roadmap_id='rm-1',
            query='what about payments?',
            sources=['chat_message', 'brief'],
            limit=5,
            auth_header='Bearer t',
        )
        self.assertEqual(
            seen['path'],
            '/roadmaps/rm-1/ai/context/knowledge-search'
            '?query=what+about+payments%3F&sources=chat_message%2Cbrief&limit=5',
        )

    async def test_relevant_memories_url_shape(self) -> None:
        client = NestRoadmapClient()
        seen: dict[str, str] = {}

        async def fake_get(path, auth_header, trace_id=None):
            seen['path'] = path
            return {}

        client._get = fake_get  # type: ignore[method-assign]
        await client.ai_memories_relevant(
            roadmap_id='rm-1',
            query='naming rules',
            limit=8,
            auth_header='Bearer t',
        )
        self.assertEqual(
            seen['path'],
            '/roadmaps/rm-1/ai/memories/relevant?query=naming+rules&limit=8',
        )


if __name__ == '__main__':
    unittest.main()
