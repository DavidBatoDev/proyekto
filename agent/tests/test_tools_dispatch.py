"""The mid-loop dispatcher resolves the roadmap PER CALL (the call's own
`roadmap_id`, else the session's focus/default roadmap), writes it back onto
that call's args — never onto the shared session_context — and never pins
calls to one roadmap (the backend authorizes every call as the user)."""

from __future__ import annotations

import logging
import unittest

from app.core.config import get_settings
from app.core.tools.dispatch import ToolDispatcher, resolve_call_roadmap_id

FOCUS = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'
PROJECT = '33333333-3333-3333-3333-333333333333'


class _Nest:
    def __init__(self):
        self.member_calls: list[str] = []
        self.overview_calls: list[str | None] = []
        self.memory_calls: list[str] = []
        self.brief_calls: list[tuple[str, str]] = []

    async def context_members(self, *, roadmap_id, auth_header, trace_id=None):
        self.member_calls.append(roadmap_id)
        return {'roadmap_id': roadmap_id, 'members': []}

    async def ai_context_overview(self, workspace_id, auth_header, trace_id=None):
        self.overview_calls.append(workspace_id)
        return {'workspace': {'id': workspace_id}, 'projects': [], 'roadmaps': [], 'teams': []}

    async def ai_memories_create(self, *, roadmap_id, payload, auth_header, trace_id=None):
        self.memory_calls.append(roadmap_id)
        return {'id': 'm-1', **payload}

    # The /ai/context list family, answering with the backend's wire shapes
    # (AiContextRoadmapsResponseDto / AiContextSearchResponseDto /
    # AiContextTasksResponseDto) and recording the query params sent.
    async def ai_context_roadmaps(self, params, auth_header, trace_id=None):
        self.roadmaps_params = dict(params or {})
        return {
            'items': [
                {'id': FOCUS, 'name': 'Alpha', 'project': {'id': PROJECT, 'title': 'Alpha app', 'workspace_id': None}},
                {'id': OTHER, 'name': 'Beta', 'project': None},
            ],
            'next_cursor': None,
        }

    async def ai_context_search(self, params, auth_header, trace_id=None):
        self.search_params = dict(params or {})
        return {'matches': [{'id': 'epic-1', 'kind': 'epic', 'title': 'Growth', 'roadmap_id': FOCUS}]}

    async def ai_context_tasks(self, params, auth_header, trace_id=None):
        self.tasks_params = dict(params or {})
        return {'tasks': []}

    async def ai_context_project_brief(self, project_id, auth_header, trace_id=None):
        self.brief_calls.append(('project', project_id))
        return {'project_id': project_id}

    async def context_project_brief(self, *, roadmap_id, auth_header, trace_id=None):
        self.brief_calls.append(('roadmap', roadmap_id))
        return {'roadmap_id': roadmap_id}

    async def context_summary(self, *, roadmap_id, preview_id, auth_header, trace_id=None):
        return {
            'roadmap_id': roadmap_id,
            'title': 'Beta',
            'revision_token': 'tok',
            'epic_count': 1,
            'epics': [{'id': 'epic-b', 'title': 'Billing', 'feature_count': 0}],
        }


def _dispatcher(nest):
    return ToolDispatcher(
        settings=get_settings(),
        logger=logging.getLogger('dispatch-tests'),
        nest_client=nest,
    )


class ResolveCallRoadmapIdTests(unittest.TestCase):
    def test_explicit_uuid_wins_over_focus(self) -> None:
        roadmap_id, error = resolve_call_roadmap_id('list_members', {'roadmap_id': OTHER}, {'focus_roadmap_id': FOCUS})
        self.assertEqual((roadmap_id, error), (OTHER, None))

    def test_focus_then_default_fallback(self) -> None:
        self.assertEqual(resolve_call_roadmap_id('list_members', {}, {'focus_roadmap_id': FOCUS})[0], FOCUS)
        self.assertEqual(resolve_call_roadmap_id('list_members', {}, {'default_roadmap_id': OTHER})[0], OTHER)

    def test_missing_and_invalid_ids(self) -> None:
        _rid, error = resolve_call_roadmap_id('list_members', {}, {})
        assert error is not None
        self.assertEqual(error['error']['code'], 'MISSING_ROADMAP_ID')
        _rid, error = resolve_call_roadmap_id('list_members', {'roadmap_id': 'Alpha'}, {'focus_roadmap_id': FOCUS})
        assert error is not None
        self.assertEqual(error['error']['code'], 'INVALID_ROADMAP_ID')

    def test_roadmap_optional_tools_do_not_error_without_a_roadmap(self) -> None:
        for name in ('get_project_brief', 'search_knowledge', 'save_memory'):
            self.assertEqual(resolve_call_roadmap_id(name, {}, {}), (None, None), name)


class DispatcherTests(unittest.TestCase):
    def test_per_call_resolution_never_touches_the_shared_context(self) -> None:
        nest = _Nest()
        context = {'focus_roadmap_id': FOCUS, 'auth_header': 'Bearer t'}
        results = _dispatcher(nest).execute_many(
            [('list_members', {'roadmap_id': OTHER}), ('list_members', {}), ('list_members', {'roadmap_id': FOCUS})],
            context,
        )
        self.assertEqual([r['roadmap_id'] for r in results], [OTHER, FOCUS, FOCUS])
        self.assertNotIn('roadmap_id', context)
        self.assertEqual(sorted(nest.member_calls), sorted([OTHER, FOCUS, FOCUS]))

    def test_single_call_errors(self) -> None:
        nest = _Nest()
        missing = _dispatcher(nest).execute('list_members', {}, {'auth_header': 'Bearer t'})
        self.assertEqual(missing['error']['code'], 'MISSING_ROADMAP_ID')
        invalid = _dispatcher(nest).execute('list_members', {'roadmap_id': 'Alpha'}, {'focus_roadmap_id': FOCUS})
        self.assertEqual(invalid['error']['code'], 'INVALID_ROADMAP_ID')
        self.assertEqual(nest.member_calls, [])
        unknown = _dispatcher(nest).execute('not_a_tool', {}, {})
        self.assertEqual(unknown['error']['code'], 'UNKNOWN_TOOL')

    def test_another_roadmap_is_not_a_scope_mismatch(self) -> None:
        nest = _Nest()
        result = _dispatcher(nest).execute('list_members', {'roadmap_id': OTHER}, {'focus_roadmap_id': FOCUS})
        self.assertNotIn('error', result)
        self.assertEqual(result['roadmap_id'], OTHER)

    def test_workspace_tools_skip_roadmap_resolution(self) -> None:
        nest = _Nest()
        result = _dispatcher(nest).execute('get_workspace_overview', {}, {'workspace_id': 'ws-1', 'auth_header': 'Bearer t'})
        self.assertEqual(result['workspace']['id'], 'ws-1')
        self.assertEqual(nest.overview_calls, ['ws-1'])

    def test_list_roadmaps_reads_the_backend_items_shape(self) -> None:
        nest = _Nest()
        result = _dispatcher(nest).execute(
            'list_roadmaps', {'query': 'beta', 'limit': 5}, {'auth_header': 'Bearer t'}
        )
        # Filtered client-side by name on the `items` list the backend returns.
        self.assertEqual([item['id'] for item in result['items']], [OTHER])
        self.assertIsNone(result['next_cursor'])
        self.assertNotIn('items_truncated', result)
        # The over-fetch for a name filter never exceeds the DTO's @Max(100).
        self.assertEqual(nest.roadmaps_params['limit'], 15)
        self.assertNotIn('query', nest.roadmaps_params)

    def test_search_and_tasks_send_only_what_the_dtos_accept(self) -> None:
        nest = _Nest()
        long_query = 'x' * 300
        result = _dispatcher(nest).execute(
            'search_everything',
            {'query': long_query, 'kinds': ['epic', 'bogus'], 'roadmap_ids': [FOCUS, 'E1', 'Alpha'], 'limit': 99},
            {'auth_header': 'Bearer t'},
        )
        self.assertEqual(result['matches'][0]['id'], 'epic-1')
        # q is @MaxLength(160); kinds are @IsIn; roadmap_ids are @IsUUID each.
        self.assertEqual(len(nest.search_params['q']), 160)
        self.assertEqual(nest.search_params['kinds'], ['epic'])
        self.assertEqual(nest.search_params['roadmap_ids'], [FOCUS])
        self.assertEqual(nest.search_params['limit'], 20)

        _dispatcher(nest).execute(
            'list_my_tasks',
            {'status': 'weird', 'due': 'overdue', 'roadmap_ids': ['E1']},
            {'auth_header': 'Bearer t'},
        )
        self.assertEqual(nest.tasks_params['status'], 'open')
        self.assertIsNone(nest.tasks_params['roadmap_ids'])
        self.assertTrue(nest.tasks_params['overdue'])
        self.assertTrue(nest.tasks_params['assigned_to_me'])

    def test_memory_tool_without_roadmap_in_workspace_scope(self) -> None:
        nest = _Nest()
        result = _dispatcher(nest).execute('save_memory', {'content': 'Name epics by quarter'}, {'auth_header': 'Bearer t'})
        self.assertEqual(result['error']['code'], 'MEMORY_NEEDS_ROADMAP')
        ok = _dispatcher(nest).execute('save_memory', {'content': 'Name epics by quarter', 'roadmap_id': OTHER}, {'auth_header': 'Bearer t'})
        self.assertTrue(ok['saved'])
        self.assertEqual(nest.memory_calls, [OTHER])

    def test_project_keyed_tool_resolution(self) -> None:
        nest = _Nest()
        dispatcher = _dispatcher(nest)
        by_focus = dispatcher.execute('get_project_brief', {}, {'focus_roadmap_id': FOCUS, 'focus_project_id': PROJECT, 'auth_header': 'Bearer t'})
        self.assertEqual(by_focus['project_id'], PROJECT)
        by_roadmap = dispatcher.execute('get_project_brief', {'roadmap_id': OTHER}, {'focus_roadmap_id': FOCUS, 'focus_project_id': PROJECT, 'auth_header': 'Bearer t'})
        self.assertEqual(by_roadmap['roadmap_id'], OTHER)
        missing = dispatcher.execute('get_project_brief', {}, {'auth_header': 'Bearer t'})
        self.assertEqual(missing['error']['code'], 'MISSING_PROJECT_ID')
        self.assertEqual(nest.brief_calls, [('project', PROJECT), ('roadmap', OTHER)])


class RoadmapLoadedCallbackTests(unittest.TestCase):
    """A roadmap the model reads mid-loop joins the session's context cache
    through `session_context['on_roadmap_loaded']`; the tool result carries
    the same prefixed outline the next prompt will show."""

    def test_summary_and_overview_register_the_roadmap(self) -> None:
        from app.core.contracts.runs import RunState
        from app.core.contracts.sessions import AgentSession
        from app.core.runtime.context_cache import make_on_roadmap_loaded

        session = AgentSession(roadmap_id=FOCUS)
        run = RunState(trace_id='t', scope=session.scope, focus_roadmap_ids=[FOCUS])
        context = {
            'focus_roadmap_id': FOCUS,
            'auth_header': 'Bearer t',
            'on_roadmap_loaded': make_on_roadmap_loaded(session=session, run=run),
        }
        dispatcher = _dispatcher(_Nest())
        summary = dispatcher.execute('get_roadmap_summary', {'roadmap_id': OTHER}, context)
        self.assertEqual(summary['handle_prefix'], 'R1')
        self.assertIn('R1.E1. Billing', summary['outline'])
        self.assertEqual(session.metadata.roadmaps[OTHER].handle_prefix, 'R1')
        self.assertEqual(run.focus_roadmap_ids, [FOCUS, OTHER])
        overview = dispatcher.execute('get_roadmap_overview', {'roadmap_id': OTHER, 'include_epics': False}, context)
        self.assertEqual(overview['handle_prefix'], 'R1')
        self.assertIn('R1.E1. Billing', overview['outline'])
        # The focus roadmap keeps bare handles when read through a tool.
        focus = dispatcher.execute('get_roadmap_summary', {}, context)
        self.assertIsNone(focus['handle_prefix'])
        self.assertIn('E1. Billing', focus['outline'])

    def test_without_a_callback_results_are_unchanged(self) -> None:
        dispatcher = _dispatcher(_Nest())
        summary = dispatcher.execute('get_roadmap_summary', {'roadmap_id': OTHER}, {'auth_header': 'Bearer t'})
        self.assertNotIn('handle_prefix', summary)
        self.assertEqual(summary['title'], 'Beta')


if __name__ == '__main__':
    unittest.main()
