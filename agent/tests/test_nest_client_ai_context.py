"""NestRoadmapClient additions for the user-scoped `/api/ai/context/*` family,
workspace routes, and the run-attributed commit payload: paths, query
params, headers — in the transport-mock style of
test_nest_client_transport_errors.py."""

from __future__ import annotations

import json
import logging
import unittest
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import httpx

from app.core.nest_client import NestRoadmapClient, _encode_query

_BASE = 'http://backend.test/api'


def _ok_response(data: Any) -> httpx.Response:
    return httpx.Response(200, json={'data': data}, request=httpx.Request('GET', _BASE))


class _Transport:
    def __init__(self, data: Any = None) -> None:
        payload = {'ok': True} if data is None else data
        self.get = AsyncMock(return_value=_ok_response(payload))
        self.post = AsyncMock(return_value=_ok_response(payload))
        self.request = AsyncMock(return_value=_ok_response(payload))


def _client(transport: _Transport) -> NestRoadmapClient:
    client = NestRoadmapClient.__new__(NestRoadmapClient)
    client._settings = SimpleNamespace(nest_api_base_url=_BASE)
    client._logger = logging.getLogger('nest-client-ai-context-tests')
    client._clients_by_loop_id = {}
    client._get_client = AsyncMock(return_value=transport)  # type: ignore[method-assign]
    return client


def _split(url: str) -> tuple[str, dict[str, list[str]]]:
    parts = urlsplit(url)
    return parts.path, parse_qs(parts.query, keep_blank_values=True)


class AiContextGetRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._patch = patch('app.core.nest_client.log_event')
        self._patch.start()

    async def asyncTearDown(self) -> None:
        self._patch.stop()

    async def test_actor(self) -> None:
        transport = _Transport({'actor_id': 'u-1', 'display_name': 'Ada'})
        client = _client(transport)
        result = await client.ai_context_actor('Bearer tok', trace_id='trace-1')
        self.assertEqual(result['actor_id'], 'u-1')
        url = transport.get.call_args.args[0]
        headers = transport.get.call_args.kwargs['headers']
        self.assertEqual(url, f'{_BASE}/ai/context/actor')
        self.assertEqual(headers['Authorization'], 'Bearer tok')
        self.assertEqual(headers['X-Trace-Id'], 'trace-1')
        self.assertNotIn('X-Guest-User-Id', headers)

    async def test_guest_auth_header_translates(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_actor('Guest g-1')
        headers = transport.get.call_args.kwargs['headers']
        self.assertEqual(headers['X-Guest-User-Id'], 'g-1')
        self.assertNotIn('Authorization', headers)
        self.assertNotIn('X-Trace-Id', headers)

    async def test_overview_with_and_without_workspace(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_overview('ws-1', 'Bearer tok')
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/overview')
        self.assertEqual(query, {'workspace_id': ['ws-1']})

        await client.ai_context_overview(None, 'Bearer tok')
        self.assertEqual(transport.get.call_args.args[0], f'{_BASE}/ai/context/overview')

    async def test_roadmaps_params_are_allowlisted(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_roadmaps(
            {'workspace_id': 'ws-1', 'project_id': None, 'cursor': 'abc=', 'limit': 25, 'evil': 'x'},
            'Bearer tok',
        )
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/roadmaps')
        self.assertEqual(query, {'workspace_id': ['ws-1'], 'cursor': ['abc='], 'limit': ['25']})

    async def test_roadmaps_without_params(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_roadmaps(None, 'Bearer tok')
        self.assertEqual(transport.get.call_args.args[0], f'{_BASE}/ai/context/roadmaps')

    async def test_search_encodes_csv_lists_and_q(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_search(
            {
                'q': 'login flow & sso',
                'kinds': ['epic', 'feature'],
                'roadmap_ids': ('r-1', 'r-2'),
                'project_id': 'p-1',
                'limit': 10,
                'node_type': 'epic',
            },
            'Bearer tok',
            trace_id='trace-search',
        )
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/search')
        self.assertEqual(
            query,
            {
                'q': ['login flow & sso'],
                'kinds': ['epic,feature'],
                'roadmap_ids': ['r-1,r-2'],
                'project_id': ['p-1'],
                'limit': ['10'],
            },
        )
        self.assertNotIn('query=', transport.get.call_args.args[0])
        self.assertEqual(transport.get.call_args.kwargs['headers']['X-Trace-Id'], 'trace-search')

    async def test_tasks_encodes_booleans(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_tasks(
            {
                'assigned_to_me': True,
                'overdue': False,
                'status': 'open',
                'due_before': '2026-09-30',
                'due_after': None,
                'roadmap_ids': [],
                'limit': 50,
            },
            'Bearer tok',
        )
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/tasks')
        self.assertEqual(
            query,
            {
                'assigned_to_me': ['true'],
                'overdue': ['false'],
                'status': ['open'],
                'due_before': ['2026-09-30'],
                'limit': ['50'],
            },
        )

    async def test_knowledge_search_uses_q_and_project_ids(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_knowledge_search(
            'launch checklist',
            ['p-1', 'p-2'],
            ['chat', 'brief'],
            8,
            'Bearer tok',
            workspace_id='ws-1',
        )
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/knowledge-search')
        self.assertEqual(
            query,
            {
                'q': ['launch checklist'],
                'project_ids': ['p-1,p-2'],
                'workspace_id': ['ws-1'],
                'sources': ['chat,brief'],
                'limit': ['8'],
            },
        )

    async def test_knowledge_search_omits_empty_optionals(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_knowledge_search('q', None, None, None, 'Bearer tok')
        _, query = _split(transport.get.call_args.args[0])
        self.assertEqual(query, {'q': ['q']})

    async def test_project_keyed_routes(self) -> None:
        transport = _Transport()
        client = _client(transport)
        project_id = 'p/1 x'
        encoded = 'p%2F1%20x'
        expectations = [
            (client.ai_context_project_context(project_id, 'Bearer tok'), ''),
            (client.ai_context_project_brief(project_id, 'Bearer tok'), '/brief'),
            (client.ai_context_project_resources(project_id, 'Bearer tok'), '/resources'),
            (client.ai_context_project_members(project_id, 'Bearer tok'), '/members'),
            (
                client.ai_context_project_member_details(project_id, 'm/1', 'Bearer tok'),
                '/members/m%2F1',
            ),
        ]
        for coroutine, suffix in expectations:
            await coroutine
            self.assertEqual(
                transport.get.call_args.args[0],
                f'{_BASE}/ai/context/projects/{encoded}{suffix}',
            )

    async def test_project_meetings_query(self) -> None:
        transport = _Transport()
        client = _client(transport)
        await client.ai_context_project_meetings('p-1', 'upcoming', 5, 'Bearer tok')
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/projects/p-1/meetings')
        self.assertEqual(query, {'window': ['upcoming'], 'limit': ['5']})
        await client.ai_context_project_meetings('p-1', None, None, 'Bearer tok')
        self.assertEqual(transport.get.call_args.args[0], f'{_BASE}/ai/context/projects/p-1/meetings')

    async def test_changes_by_run_or_session(self) -> None:
        transport = _Transport({'changes': []})
        client = _client(transport)
        await client.ai_context_changes('Bearer tok', run_id='run-1', limit=20)
        path, query = _split(transport.get.call_args.args[0])
        self.assertEqual(path, '/api/ai/context/changes')
        self.assertEqual(query, {'run_id': ['run-1'], 'limit': ['20']})

        await client.ai_context_changes('Bearer tok', session_id='sess-1')
        _, query = _split(transport.get.call_args.args[0])
        self.assertEqual(query, {'session_id': ['sess-1']})

        with self.assertRaises(ValueError):
            await client.ai_context_changes('Bearer tok')

    async def test_workspace_get(self) -> None:
        transport = _Transport({'id': 'ws-1', 'slug': 'acme'})
        client = _client(transport)
        result = await client.workspace_get('ws-1', 'Bearer tok', trace_id='t')
        self.assertEqual(result['slug'], 'acme')
        self.assertEqual(transport.get.call_args.args[0], f'{_BASE}/workspaces/ws-1')


class AiContextWriteRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._patch = patch('app.core.nest_client.log_event')
        self._patch.start()

    async def asyncTearDown(self) -> None:
        self._patch.stop()

    async def test_resolve_refs_posts_the_batch(self) -> None:
        resolved = {'refs': [{'kind': 'roadmap', 'id': 'r-1', 'accessible': True, 'title': 'Alpha'}]}
        transport = _Transport(resolved)
        client = _client(transport)
        refs = [{'kind': 'roadmap', 'id': 'r-1', 'label': 'Alpha'}]
        result = await client.resolve_refs(refs, 'Bearer tok', trace_id='trace-refs')
        self.assertEqual(result, resolved)
        self.assertEqual(transport.post.call_args.args[0], f'{_BASE}/ai/context/resolve-refs')
        self.assertEqual(transport.post.call_args.kwargs['json'], {'refs': refs})
        headers = transport.post.call_args.kwargs['headers']
        self.assertEqual(headers['Authorization'], 'Bearer tok')
        self.assertEqual(headers['X-Trace-Id'], 'trace-refs')
        self.assertEqual(headers['Content-Type'], 'application/json')

    async def test_put_workspace_session_agent_state(self) -> None:
        transport = _Transport({})
        client = _client(transport)
        await client.put_workspace_session_agent_state(
            'ws-1', 'sess-1', {'agent_state': {'snapshot_version': 2}}, 'Bearer tok', trace_id='t'
        )
        method, url = transport.request.call_args.args[:2]
        self.assertEqual(method, 'PUT')
        self.assertEqual(url, f'{_BASE}/workspaces/ws-1/ai-sessions/sess-1/agent-state')
        self.assertEqual(
            transport.request.call_args.kwargs['json'],
            {'agent_state': {'snapshot_version': 2}},
        )

    async def test_commit_adds_session_and_run_ids_without_mutating_payload(self) -> None:
        transport = _Transport({'change_id': 'c-1'})
        client = _client(transport)
        payload = {
            'operations': [{'op': 'add_epic', 'title': 'X'}],
            'base_revision': 1,
            'revision_token': 'tok',
            'include_roadmap': False,
            'include_timeline': False,
            'idempotency_key': 'idem-1',
        }
        snapshot = json.loads(json.dumps(payload))
        session_id = '5d2c1b0a-0000-4000-8000-000000000001'
        run_id = '5D2C1B0A-0000-4000-8000-000000000002'
        await client.commit('r-1', payload, 'Bearer tok', trace_id='t', session_id=session_id, run_id=run_id)
        self.assertEqual(transport.post.call_args.args[0], f'{_BASE}/roadmaps/r-1/ai/commit')
        sent = transport.post.call_args.kwargs['json']
        self.assertEqual(sent['session_id'], session_id)
        # Canonical (lower-case) form: the backend DTO validates with @IsUUID.
        self.assertEqual(sent['run_id'], run_id.lower())
        self.assertEqual(sent['idempotency_key'], 'idem-1')
        self.assertEqual(payload, snapshot)
        self.assertIsNot(sent, payload)

    async def test_commit_drops_ids_that_are_not_uuids(self) -> None:
        # The commit DTO rejects a non-uuid session_id/run_id with a 400, which
        # would fail every commit of a session with a legacy id: drop them.
        transport = _Transport({'change_id': 'c-1'})
        client = _client(transport)
        payload = {'operations': [], 'idempotency_key': 'idem-3'}
        await client.commit('r-1', payload, 'Bearer tok', session_id='sess-alpha', run_id='run-1')
        sent = transport.post.call_args.kwargs['json']
        self.assertIs(sent, payload)
        self.assertNotIn('session_id', sent)
        self.assertNotIn('run_id', sent)
        run_id = '5d2c1b0a-0000-4000-8000-000000000009'
        await client.commit('r-1', payload, 'Bearer tok', session_id='sess-alpha', run_id=run_id)
        sent = transport.post.call_args.kwargs['json']
        self.assertEqual(sent.get('run_id'), run_id)
        self.assertNotIn('session_id', sent)

    async def test_commit_without_run_ids_sends_payload_unchanged(self) -> None:
        transport = _Transport({'change_id': 'c-1'})
        client = _client(transport)
        payload = {'operations': [], 'idempotency_key': 'idem-2'}
        await client.commit('r-1', payload, 'Bearer tok')
        sent = transport.post.call_args.kwargs['json']
        self.assertIs(sent, payload)
        self.assertNotIn('session_id', sent)
        self.assertNotIn('run_id', sent)


class EncodeQueryTests(unittest.TestCase):
    def test_skips_empty_and_encodes_types(self) -> None:
        self.assertEqual(_encode_query([]), '')
        self.assertEqual(_encode_query([('a', None), ('b', ''), ('c', [])]), '')
        query = _encode_query(
            [
                ('flag', True),
                ('off', False),
                ('ids', ['x', ' ', None, 'y']),
                ('n', 0),
                ('text', ' a b '),
            ]
        )
        self.assertEqual(query, '?flag=true&off=false&ids=x%2Cy&n=0&text=a+b')


if __name__ == '__main__':
    unittest.main()
