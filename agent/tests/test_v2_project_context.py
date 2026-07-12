"""Linked-project context cache, prompt block, and v2 read-tool wiring."""

from __future__ import annotations

import json
import logging
import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession
from app.core.llm.context.handlers.context_query import ContextQueryHandler
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.agent_service import AgentService
from app.core.orchestration.context.session_context_builder import (
    build_session_context,
)
from app.core.tools.registry import CONTEXT_TOOL_NAMES, get_context_tools
from app.core.v2 import tools_spec
from app.core.v2.context import (
    _PROJECT_CONTEXT_BLOCK_MAX_CHARS,
    _project_context_block,
    compact_state,
)
from app.core.v2.loop import _MAX_TOOL_RESULT_CHARS, _tool_result_content


class _MemoryStore:
    pass


def _settings(**updates):
    return get_settings().model_copy(
        update={
            'agent_project_context_enabled': True,
            'agent_cache_ttl_seconds': 600,
            **updates,
        }
    )


def _session() -> AgentSession:
    return AgentSession(roadmap_id='22222222-2222-2222-2222-222222222222')


class _ProjectContextNest:
    def __init__(self, payload=None, error: HTTPException | None = None):
        self.payload = payload or {
            'project': {'id': 'project-1', 'title': 'Apollo'}
        }
        self.error = error
        self.calls: list[dict] = []

    async def context_project(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.payload


def _service(nest: _ProjectContextNest, **setting_updates) -> AgentService:
    service = AgentService(_MemoryStore())
    service._settings = _settings(**setting_updates)
    service._nest_client = nest
    return service


class ProjectContextCacheTests(unittest.TestCase):
    def test_fresh_cache_skips_then_expired_cache_refetches(self) -> None:
        nest = _ProjectContextNest()
        service = _service(nest)
        session = _session()

        service._ensure_project_context(
            session=session, auth_header='Bearer token', trace_id='trace-1'
        )
        service._ensure_project_context(
            session=session, auth_header='Bearer token', trace_id='trace-2'
        )
        self.assertEqual(len(nest.calls), 1)

        session.metadata.project_context_fetched_at = (
            datetime.now(timezone.utc).replace(tzinfo=None)
            - timedelta(seconds=601)
        )
        service._ensure_project_context(
            session=session, auth_header='Bearer token', trace_id='trace-3'
        )
        self.assertEqual(len(nest.calls), 2)

    def test_projectless_response_is_negative_cached(self) -> None:
        nest = _ProjectContextNest(payload={'project': None})
        service = _service(nest)
        session = _session()

        for _ in range(2):
            service._ensure_project_context(
                session=session, auth_header='Guest guest-1', trace_id=None
            )

        self.assertEqual(len(nest.calls), 1)
        self.assertEqual(session.metadata.project_context, {'project': None})
        self.assertIsNotNone(session.metadata.project_context_fetched_at)

    def test_404_is_swallowed_and_negative_cached(self) -> None:
        nest = _ProjectContextNest(
            error=HTTPException(status_code=404, detail='Roadmap not found')
        )
        service = _service(nest)
        session = _session()

        for _ in range(2):
            service._ensure_project_context(
                session=session, auth_header='Guest guest-1', trace_id=None
            )

        self.assertEqual(len(nest.calls), 1)
        self.assertIsNone(session.metadata.project_context)
        self.assertIsNotNone(session.metadata.project_context_fetched_at)

    def test_disabled_flag_clears_stale_cache_without_fetching(self) -> None:
        nest = _ProjectContextNest()
        service = _service(nest, agent_project_context_enabled=False)
        session = _session()
        session.metadata.project_context = {
            'project': {'id': 'old', 'title': 'Stale'}
        }
        session.metadata.project_context_fetched_at = datetime.now(
            timezone.utc
        ).replace(tzinfo=None)

        service._ensure_project_context(
            session=session, auth_header='Bearer token', trace_id=None
        )

        self.assertEqual(nest.calls, [])
        self.assertIsNone(session.metadata.project_context)
        self.assertIsNone(session.metadata.project_context_fetched_at)

    def test_session_context_builder_also_gates_preexisting_cache(self) -> None:
        session = _session()
        session.metadata.project_context = {
            'project': {'id': 'old', 'title': 'Stale'}
        }

        context = build_session_context(
            session=session,
            auth_header='Bearer token',
            trace_id=None,
            settings=_settings(agent_project_context_enabled=False),
            get_active_draft_if_available=lambda _session: None,
            get_recent_resolved_targets=lambda _session: [],
        )

        self.assertIsNone(context['project_context'])


def _compact_payload() -> dict:
    return {
        'project': {
            'id': 'project-1',
            'title': 'Apollo',
            'status': 'active',
            'category': 'SaaS',
            'project_state': 'codebase',
            'duration': '6 months',
            'budget_range': '$10k-$25k',
            'funding_status': 'seed',
            'start_date': '2026-07-01',
            'skills': [f'skill-{index}' for index in range(30)],
        },
        'brief_excerpt': ('brief word\n' * 400),
        'has_full_brief': True,
        'custom_field_keys': [f'field-{index}' for index in range(30)],
        'members': [
            {
                'id': f'member-{index}',
                'display_name': f'Person {index}',
                'role': 'editor',
                'persona': 'freelancer',
            }
            for index in range(1, 18)
        ],
        'teams': [f'Team {index}' for index in range(12)],
        'resource_summary': {
            'count': 42,
            'top_titles': [f'Resource {index}' for index in range(15)],
        },
        'meeting_summary': {
            'upcoming_count': 4,
            'next': {
                'title': 'Architecture review',
                'scheduled_at': '2026-07-20T09:00:00Z',
            },
        },
    }


class ProjectContextBlockTests(unittest.TestCase):
    def test_block_is_after_roadmap_and_caps_long_values_and_lists(self) -> None:
        block = _project_context_block(_compact_payload())
        state = compact_state(
            _session(),
            {
                'roadmap_overview_summary': 'Roadmap: Apollo delivery',
                'project_context': _compact_payload(),
                'conversation_summary': 'Earlier context',
            },
        )

        self.assertLess(state.index('# Current roadmap'), state.index('# Project context'))
        self.assertLess(
            state.index('# Project context'), state.index('# Earlier conversation summary')
        )
        self.assertIn('Project: Apollo', state)
        self.assertIn('Person 15', state)
        self.assertNotIn('Person 16', state)
        self.assertIn('skill-14', state)
        self.assertNotIn('skill-15', state)
        self.assertLessEqual(len(block), _PROJECT_CONTEXT_BLOCK_MAX_CHARS)
        for tool_name in (
            'get_project_brief',
            'list_project_resources',
            'list_project_meetings',
            'get_member_details',
        ):
            self.assertIn(tool_name, state)

        brief_line = next(
            line for line in state.splitlines() if line.startswith('Brief excerpt: ')
        )
        self.assertLessEqual(len(brief_line), len('Brief excerpt: ') + 1200)
        self.assertTrue(brief_line.endswith('...'))

    def test_whole_block_cap_always_preserves_detail_tool_hint(self) -> None:
        oversized = _compact_payload()
        oversized['project'].update(
            {
                key: f'{key}-' + ('x' * 500)
                for key in (
                    'title',
                    'status',
                    'category',
                    'project_state',
                    'duration',
                    'budget_range',
                    'funding_status',
                    'start_date',
                )
            }
        )
        oversized['project']['skills'] = ['s' * 300 for _ in range(20)]
        oversized['brief_excerpt'] = 'b' * 5000
        oversized['custom_field_keys'] = ['c' * 300 for _ in range(25)]
        oversized['members'] = [
            {
                'id': 'i' * 200,
                'display_name': 'n' * 300,
                'role': 'r' * 200,
                'persona': 'p' * 200,
            }
            for _ in range(20)
        ]
        oversized['teams'] = ['t' * 300 for _ in range(12)]
        oversized['resource_summary']['top_titles'] = [
            'l' * 300 for _ in range(15)
        ]
        oversized['meeting_summary']['next']['title'] = 'm' * 500

        block = _project_context_block(oversized)

        self.assertEqual(len(block), _PROJECT_CONTEXT_BLOCK_MAX_CHARS)
        for tool_name in (
            'get_project_brief',
            'list_project_resources',
            'list_project_meetings',
            'get_member_details',
        ):
            self.assertIn(tool_name, block)

    def test_projectless_context_does_not_render_a_block(self) -> None:
        state = compact_state(
            _session(),
            {
                'roadmap_overview_summary': 'Roadmap: guest',
                'project_context': {'project': None},
            },
        )
        self.assertNotIn('# Project context', state)


class ProjectToolRegistryTests(unittest.TestCase):
    def test_four_tools_are_exposed_as_non_terminal_reads(self) -> None:
        names = {
            'get_project_brief',
            'list_project_resources',
            'list_project_meetings',
            'get_member_details',
        }
        schemas = {
            item['function']['name']: item['function'] for item in get_context_tools()
        }

        self.assertTrue(names.issubset(CONTEXT_TOOL_NAMES))
        self.assertTrue(names.issubset(schemas))
        for name in names:
            self.assertTrue(tools_spec.is_read_tool(name))
            self.assertTrue(tools_spec.is_dispatcher_tool(name))
            self.assertFalse(tools_spec.is_terminal_tool(name))
        meeting_properties = schemas['list_project_meetings']['parameters'][
            'properties'
        ]
        self.assertEqual(
            meeting_properties['window']['enum'], ['upcoming', 'recent', 'all']
        )


class ProjectBriefToolResultTests(unittest.TestCase):
    def test_full_twelve_thousand_character_brief_stays_valid_json(self) -> None:
        summary = ('b' * 11_989) + '-brief-tail'
        self.assertEqual(len(summary), 12_000)

        serialized = _tool_result_content(
            {'project_id': 'p1', 'project_summary': summary, 'custom_fields': []},
            'get_project_brief',
        )
        parsed = json.loads(serialized)

        self.assertEqual(parsed['project_summary'], summary)
        self.assertTrue(parsed['project_summary'].endswith('-brief-tail'))

    def test_existing_tools_keep_the_eight_thousand_character_cap(self) -> None:
        serialized = _tool_result_content(
            {
                'content': ('x' * (_MAX_TOOL_RESULT_CHARS + 500))
                + '-default-tail'
            },
            'get_node_details',
        )

        self.assertTrue(serialized.endswith('(truncated)'))
        self.assertLessEqual(len(serialized), _MAX_TOOL_RESULT_CHARS + 20)
        self.assertNotIn('-default-tail', serialized)


class StructuredProjectToolResultTests(unittest.TestCase):
    def test_oversized_resources_return_ordered_valid_json_with_counts(self) -> None:
        folders = [
            {'id': f'folder-{index}', 'name': f'Folder {index}', 'position': index}
            for index in range(3)
        ]
        links = [
            {
                'id': f'link-{index}',
                'title': f'Link {index}',
                'description': f'description-{index}-' + ('x' * 650),
                'folder_id': f'folder-{index % 3}',
            }
            for index in range(30)
        ]
        payload = {'project_id': 'p1', 'folders': folders, 'links': links}
        self.assertGreater(len(json.dumps(payload)), _MAX_TOOL_RESULT_CHARS)

        serialized = _tool_result_content(payload, 'list_project_resources')
        parsed = json.loads(serialized)

        self.assertLessEqual(len(serialized), _MAX_TOOL_RESULT_CHARS)
        self.assertTrue(parsed['result_truncated'])
        self.assertEqual(parsed['total_folders'], len(folders))
        self.assertEqual(parsed['returned_folders'], len(parsed['folders']))
        self.assertEqual(parsed['total_links'], len(links))
        self.assertEqual(parsed['returned_links'], len(parsed['links']))
        self.assertGreater(parsed['returned_folders'], 0)
        self.assertGreater(parsed['returned_links'], 0)
        self.assertLess(parsed['returned_links'], parsed['total_links'])
        self.assertEqual(
            parsed['folders'], folders[: parsed['returned_folders']]
        )
        self.assertEqual(parsed['links'], links[: parsed['returned_links']])

    def test_oversized_meetings_preserve_meeting_and_participant_order(self) -> None:
        meetings = [
            {
                'id': f'meeting-{meeting_index}',
                'title': f'Meeting {meeting_index}',
                'description': 'agenda-' + ('a' * 300),
                'status': 'scheduled',
                'participants': [
                    {
                        'user_id': f'user-{meeting_index}-{participant_index}',
                        'display_name': 'Participant ' + ('p' * 180),
                        'role': 'attendee',
                        'response': 'accepted',
                    }
                    for participant_index in range(8)
                ],
            }
            for meeting_index in range(8)
        ]
        payload = {
            'project_id': 'p1',
            'window': 'all',
            'meetings': meetings,
        }
        self.assertGreater(len(json.dumps(payload)), _MAX_TOOL_RESULT_CHARS)

        serialized = _tool_result_content(payload, 'list_project_meetings')
        parsed = json.loads(serialized)

        self.assertLessEqual(len(serialized), _MAX_TOOL_RESULT_CHARS)
        self.assertTrue(parsed['result_truncated'])
        self.assertEqual(parsed['total_meetings'], len(meetings))
        self.assertEqual(parsed['returned_meetings'], len(parsed['meetings']))
        self.assertEqual(
            parsed['total_participants'],
            sum(len(meeting['participants']) for meeting in meetings),
        )
        self.assertEqual(
            parsed['returned_participants'],
            sum(len(meeting['participants']) for meeting in parsed['meetings']),
        )
        self.assertGreater(parsed['returned_meetings'], 0)
        self.assertGreater(parsed['returned_participants'], 0)
        self.assertLess(
            parsed['returned_participants'], parsed['total_participants']
        )
        self.assertEqual(
            [meeting['id'] for meeting in parsed['meetings']],
            [
                meeting['id']
                for meeting in meetings[: parsed['returned_meetings']]
            ],
        )
        for index, returned_meeting in enumerate(parsed['meetings']):
            returned_participants = returned_meeting['participants']
            self.assertEqual(
                returned_participants,
                meetings[index]['participants'][: len(returned_participants)],
            )
            self.assertEqual(
                returned_meeting['total_participants'],
                len(meetings[index]['participants']),
            )
            self.assertEqual(
                returned_meeting['returned_participants'],
                len(returned_participants),
            )


class _DetailNest:
    def __init__(self):
        self.calls: list[tuple] = []

    async def context_project_brief(self, **kwargs):
        self.calls.append(('brief', kwargs))
        return {'project_id': 'p1', 'project_summary': 'Brief'}

    async def context_project_resources(self, **kwargs):
        self.calls.append(('resources', kwargs))
        return {'error': {'code': 'NO_PROJECT'}}

    async def context_project_meetings(self, **kwargs):
        self.calls.append(('meetings', kwargs))
        return {'project_id': 'p1', 'window': kwargs['window'], 'meetings': []}

    async def context_project_member_details(self, **kwargs):
        self.calls.append(('member', kwargs))
        return {'member': {'id': kwargs['member_id']}}


def _handler(nest: _DetailNest) -> ContextQueryHandler:
    return ContextQueryHandler(
        settings=_settings(),
        logger=logging.getLogger('project-context-tests'),
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


class ProjectContextDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_detail_tools_dispatch_and_preserve_no_project_sentinel(self) -> None:
        nest = _DetailNest()
        handler = _handler(nest)
        member_id = '123e4567-e89b-12d3-a456-426614174000'
        context = {
            'roadmap_id': 'roadmap-1',
            'auth_header': 'Bearer token',
            'trace_id': 'trace-1',
        }

        brief = await handler.execute('get_project_brief', {}, context)
        resources = await handler.execute('list_project_resources', {}, context)
        meetings = await handler.execute(
            'list_project_meetings', {'window': 'recent', 'limit': 7}, context
        )
        member = await handler.execute(
            'get_member_details', {'member_id': member_id}, context
        )

        self.assertEqual(brief['project_summary'], 'Brief')
        self.assertEqual(resources['error']['code'], 'NO_PROJECT')
        self.assertEqual(meetings['window'], 'recent')
        self.assertEqual(member['member']['id'], member_id)
        meeting_call = next(call for call in nest.calls if call[0] == 'meetings')
        self.assertEqual(meeting_call[1]['limit'], 7)
        member_call = next(call for call in nest.calls if call[0] == 'member')
        self.assertEqual(member_call[1]['roadmap_id'], 'roadmap-1')
        self.assertEqual(member_call[1]['auth_header'], 'Bearer token')

    async def test_member_details_rejects_traversal_before_outbound_call(self) -> None:
        nest = _DetailNest()
        result = await _handler(nest).execute(
            'get_member_details',
            {'member_id': '../../brief?admin=true'},
            {
                'roadmap_id': 'roadmap-1',
                'auth_header': 'Bearer token',
                'trace_id': 'trace-1',
            },
        )

        self.assertEqual(result['error']['code'], 'INVALID_UUID')
        self.assertEqual(nest.calls, [])


class ProjectContextNestClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_five_client_methods_build_expected_paths(self) -> None:
        client = NestRoadmapClient()
        calls: list[tuple[str, str | None, str | None]] = []

        async def fake_get(path, auth_header, trace_id=None):
            calls.append((path, auth_header, trace_id))
            return {'ok': True}

        client._get = fake_get
        common = {
            'roadmap_id': 'roadmap-1',
            'auth_header': 'Guest guest-1',
            'trace_id': 'trace-1',
        }
        await client.context_project(**common)
        await client.context_project_brief(**common)
        await client.context_project_resources(**common)
        await client.context_project_meetings(
            **common, window='recent', limit=7
        )
        await client.context_project_member_details(
            **common, member_id='../member/1'
        )

        self.assertEqual(
            [item[0] for item in calls],
            [
                '/roadmaps/roadmap-1/ai/context/project',
                '/roadmaps/roadmap-1/ai/context/project/brief',
                '/roadmaps/roadmap-1/ai/context/project/resources',
                '/roadmaps/roadmap-1/ai/context/project/meetings?window=recent&limit=7',
                '/roadmaps/roadmap-1/ai/context/project/members/..%2Fmember%2F1',
            ],
        )
        self.assertTrue(
            all(item[1:] == ('Guest guest-1', 'trace-1') for item in calls)
        )


if __name__ == '__main__':
    unittest.main()
