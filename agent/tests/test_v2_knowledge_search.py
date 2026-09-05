"""search_knowledge tool: flag-gated exposure in build_tools, permanent
dispatch wiring, handler arg clamping + result shaping under the loop's
tool-result cap, project-id resolution (explicit -> loaded roadmaps' projects
-> the call's roadmap), and nest_client URL construction."""

from __future__ import annotations

import json
import logging
import unittest

from app.core.config import get_settings
from app.core.tools.handlers.context_query import ContextQueryHandler
from app.core.nest_client import NestRoadmapClient
from app.core.runtime import tools as tools_spec
from app.core.engine.tool_results import MAX_TOOL_RESULT_CHARS, tool_result_content

_P1 = '11111111-1111-1111-1111-111111111111'
_P2 = '22222222-2222-2222-2222-222222222222'


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
        self.assertEqual(params['properties']['project_ids']['maxItems'], 10)
        self.assertEqual(
            params['properties']['sources']['items']['enum'],
            ['chat_message', 'task_comment', 'activity_log', 'brief', 'file_chunk'],
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
        self.roadmap_calls: list[dict] = []

    async def ai_context_knowledge_search(self, **kwargs):
        self.calls.append(kwargs)
        return self.payload

    async def context_knowledge_search(self, **kwargs):
        self.roadmap_calls.append(kwargs)
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
            'search_knowledge', {'query': '   ', 'roadmap_id': 'rm-1'}, {}
        )
        self.assertEqual(result['error']['code'], 'MISSING_QUERY')
        self.assertEqual(nest.calls, [])
        self.assertEqual(nest.roadmap_calls, [])

    async def test_explicit_project_ids_use_the_user_scoped_search(self) -> None:
        nest = _KnowledgeNest()
        await _handler(nest).execute(
            'search_knowledge',
            {
                'query': 'q' * 900,
                'project_ids': [_P1, _P2, _P1],
                'sources': ['chat_message', 'nonsense', 'brief'],
                'limit': 99,
                'roadmap_id': 'rm-1',
            },
            {'auth_header': 'Bearer t', 'knowledge_project_ids': ['ignored']},
        )
        self.assertEqual(nest.roadmap_calls, [])
        call = nest.calls[0]
        self.assertEqual(len(call['q']), 400)
        self.assertEqual(call['project_ids'], [_P1, _P2])
        self.assertEqual(call['sources'], ['chat_message', 'brief'])
        self.assertEqual(call['limit'], 12)

    async def test_defaults_to_the_loaded_roadmaps_projects(self) -> None:
        nest = _KnowledgeNest()
        await _handler(nest).execute(
            'search_knowledge',
            {'query': 'payments', 'sources': ['memory'], 'roadmap_id': 'rm-1'},
            {'auth_header': 'Bearer t', 'knowledge_project_ids': [_P2]},
        )
        self.assertEqual(nest.roadmap_calls, [])
        self.assertEqual(nest.calls[0]['project_ids'], [_P2])
        self.assertIsNone(nest.calls[0]['sources'])
        self.assertEqual(nest.calls[0]['limit'], 8)

    async def test_falls_back_to_the_roadmap_keyed_search(self) -> None:
        nest = _KnowledgeNest()
        await _handler(nest).execute(
            'search_knowledge',
            {'query': 'payments', 'roadmap_id': 'rm-1'},
            {'auth_header': 'Bearer t'},
        )
        self.assertEqual(nest.calls, [])
        self.assertEqual(nest.roadmap_calls[0]['roadmap_id'], 'rm-1')
        self.assertEqual(nest.roadmap_calls[0]['query'], 'payments')

    async def test_no_projects_and_no_roadmap_is_missing_project_ids(self) -> None:
        nest = _KnowledgeNest()
        result = await _handler(nest).execute(
            'search_knowledge', {'query': 'payments'}, {'auth_header': 'Bearer t'}
        )
        self.assertEqual(result['error']['code'], 'MISSING_PROJECT_IDS')
        self.assertEqual(nest.calls, [])

    async def test_hallucinated_project_id_is_rejected_before_the_call(self) -> None:
        nest = _KnowledgeNest()
        result = await _handler(nest).execute(
            'search_knowledge',
            {'query': 'payments', 'project_ids': ['Apollo']},
            {'auth_header': 'Bearer t'},
        )
        self.assertEqual(result['error']['code'], 'INVALID_PROJECT_ID')
        self.assertEqual(nest.calls, [])

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
            {'query': 'payments', 'project_ids': [_P1]},
            {'auth_header': 'Bearer t'},
        )
        self.assertEqual(len(result['results']), 12)
        self.assertTrue(all(len(r['content']) <= 901 for r in result['results']))
        rendered = tool_result_content('search_knowledge', result)
        self.assertLessEqual(len(rendered), MAX_TOOL_RESULT_CHARS)
        json.loads(rendered)  # never truncated mid-structure


class NestClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_roadmap_keyed_url_shape_encodes_query_sources_and_limit(self) -> None:
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

    async def test_user_scoped_url_shape_uses_q_and_project_ids(self) -> None:
        client = NestRoadmapClient()
        seen: dict[str, str] = {}

        async def fake_get(path, auth_header, trace_id=None):
            seen['path'] = path
            return {}

        client._get = fake_get  # type: ignore[method-assign]
        await client.ai_context_knowledge_search(
            q='payments',
            project_ids=[_P1, _P2],
            sources=['brief'],
            limit=4,
            auth_header='Bearer t',
        )
        self.assertTrue(seen['path'].startswith('/ai/context/knowledge-search?'))
        self.assertIn('q=payments', seen['path'])
        self.assertIn(f'project_ids={_P1}%2C{_P2}', seen['path'])
        self.assertIn('sources=brief', seen['path'])
        self.assertIn('limit=4', seen['path'])

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
