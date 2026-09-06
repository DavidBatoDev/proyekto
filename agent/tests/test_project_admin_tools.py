"""Project admin tools: create_project and update_project.

The handler validates its arguments, resolves the workspace a new project
lands in (explicit -> session -> focus project's workspace -> the backend
default only when the user chose it, else WORKSPACE_REQUIRED), posts through
the backend as the user, flags the caches the write invalidates, and maps
backend refusals (guests, non-members, non-owners) to tool errors the model
can act on. The catalog exposes both as mid-loop write tools in both scopes
and the dispatcher routes them.
"""

import asyncio
import logging
import unittest
from typing import Any

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession
from app.core.runtime import tools as tools_spec
from app.core.tools.dispatch import DISPATCHABLE_TOOL_NAMES, ToolDispatcher
from app.core.tools.handlers.project_admin_tools import (
    ProjectAdminToolHandler,
    infer_workspace_id,
)
from app.core.tools.registry import EXECUTABLE_TOOL_NAMES, PROJECT_ADMIN_TOOL_NAMES

_ROADMAP = '11111111-1111-4111-8111-111111111111'
_PROJECT = '22222222-2222-4222-8222-222222222222'
_WORKSPACE = '33333333-3333-4333-8333-333333333333'
_OTHER_WORKSPACE = '44444444-4444-4444-8444-444444444444'
_ROADMAP_SCOPE = {'kind': 'roadmap', 'roadmap_id': _ROADMAP}
_WORKSPACE_SCOPE = {'kind': 'workspace', 'workspace_id': _WORKSPACE}


class _FakeNest:
    def __init__(self, *, create_error: Exception | None = None, update_error: Exception | None = None):
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []
        self._create_error = create_error
        self._update_error = update_error

    async def project_create(self, *, payload, auth_header, trace_id=None):
        if self._create_error:
            raise self._create_error
        self.created.append(payload)
        return {
            'project': {
                'id': 'p-new',
                'title': payload['title'],
                'status': payload.get('status', 'draft'),
                'workspace_id': payload.get('workspace_id'),
            },
            'roadmap': {'id': 'r-new', 'name': payload['title']},
        }

    async def project_update(self, *, project_id, payload, auth_header, trace_id=None):
        if self._update_error:
            raise self._update_error
        self.updated.append((project_id, payload))
        return {
            'id': project_id,
            'title': payload.get('title', 'Old title'),
            'status': payload.get('status', 'draft'),
            'duration': payload.get('duration'),
            'workspace_id': _WORKSPACE,
        }


def _handler(nest: _FakeNest) -> ProjectAdminToolHandler:
    return ProjectAdminToolHandler(
        settings=get_settings(),
        logger=logging.getLogger('test'),
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


def _run(coro):
    return asyncio.run(coro)


def _nest_error(status: int, message: str, code: str | None = None) -> HTTPException:
    error: dict[str, Any] = {'message': message}
    if code:
        error['code'] = code
    return HTTPException(
        status_code=status,
        detail={'upstream': 'nestjs', 'path': '/projects', 'detail': {'error': error}},
    )


class CreateProjectTests(unittest.TestCase):
    def test_creates_in_the_session_workspace_and_flags_the_overview(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'auth_header': 'Bearer t', 'trace_id': 'tr', 'workspace_id': _WORKSPACE}
        result = _run(
            _handler(nest).execute(
                'create_project',
                {'title': '  Launch site ', 'description': 'A site', 'status': 'active', 'duration': '3 months'},
                context,
            )
        )
        self.assertTrue(result['created'])
        self.assertEqual(result['project']['id'], 'p-new')
        self.assertEqual(result['project']['workspace_id'], _WORKSPACE)
        self.assertEqual(result['roadmap'], {'id': 'r-new', 'name': 'Launch site'})
        self.assertIn('get_roadmap_overview', result['next_step'])
        self.assertIn('"Launch site"', result['next_step'])
        payload = nest.created[0]
        self.assertEqual(payload, {
            'title': 'Launch site', 'status': 'active', 'description': 'A site',
            'duration': '3 months', 'workspace_id': _WORKSPACE,
        })
        for forbidden in ('brief', 'creation_mode', 'primary_team_id', 'currency', 'roadmap_id'):
            self.assertNotIn(forbidden, payload)
        self.assertTrue(context['workspace_overview_dirty'])

    def test_explicit_workspace_wins_and_must_be_a_uuid(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'workspace_id': _WORKSPACE}
        result = _run(_handler(nest).execute('create_project', {'title': 'X', 'workspace_id': _OTHER_WORKSPACE}, context))
        self.assertTrue(result['created'])
        self.assertEqual(nest.created[0]['workspace_id'], _OTHER_WORKSPACE)
        bad = _run(_handler(nest).execute('create_project', {'title': 'X', 'workspace_id': "David's Workspace"}, context))
        self.assertEqual(bad['error']['code'], 'INVALID_WORKSPACE_ID')
        self.assertEqual(len(nest.created), 1)

    def test_roadmap_scope_uses_the_focus_projects_workspace(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {
            'workspace_id': None,
            'project_context': {'project': {'id': _PROJECT, 'title': 'Apollo', 'workspace': {'id': _WORKSPACE, 'name': 'Acme'}}},
        }
        self.assertEqual(infer_workspace_id(context), _WORKSPACE)
        result = _run(_handler(nest).execute('create_project', {'title': 'X'}, context))
        self.assertTrue(result['created'])
        self.assertEqual(nest.created[0]['workspace_id'], _WORKSPACE)

    def test_without_a_workspace_the_model_must_ask_unless_the_user_chose_the_default(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'project_context': {'project': None}}
        asked = _run(_handler(nest).execute('create_project', {'title': 'X'}, context))
        self.assertEqual(asked['error']['code'], 'WORKSPACE_REQUIRED')
        self.assertIn('use_default_workspace', asked['error']['message'])
        self.assertEqual(nest.created, [])
        self.assertNotIn('workspace_overview_dirty', context)
        result = _run(_handler(nest).execute('create_project', {'title': 'X', 'use_default_workspace': True}, context))
        self.assertTrue(result['created'])
        self.assertNotIn('workspace_id', nest.created[0])
        self.assertTrue(context['workspace_overview_dirty'])

    def test_rejects_a_blank_title_and_an_unknown_status(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'workspace_id': _WORKSPACE}
        blank = _run(_handler(nest).execute('create_project', {'title': '   '}, context))
        self.assertEqual(blank['error']['code'], 'INVALID_PROJECT_TITLE')
        bad = _run(_handler(nest).execute('create_project', {'title': 'X', 'status': 'live'}, context))
        self.assertEqual(bad['error']['code'], 'INVALID_PROJECT_STATUS')
        self.assertIn('bidding', bad['error']['message'])
        self.assertEqual(nest.created, [])

    def test_backend_refusals_become_forbidden_with_the_backend_message(self) -> None:
        for message in ('Sign in to create a project.', 'You are not a member of that workspace'):
            with self.subTest(message=message):
                nest = _FakeNest(create_error=_nest_error(403, message))
                context: dict[str, Any] = {'workspace_id': _WORKSPACE}
                result = _run(_handler(nest).execute('create_project', {'title': 'X'}, context))
                self.assertEqual(result['error']['code'], 'FORBIDDEN')
                self.assertEqual(result['error']['message'], message)
                self.assertNotIn('workspace_overview_dirty', context)


class UpdateProjectTests(unittest.TestCase):
    def test_updates_title_and_status_and_flags_both_caches(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'auth_header': 'Bearer t'}
        result = _run(
            _handler(nest).execute(
                'update_project',
                {'project_id': _PROJECT, 'title': ' New name ', 'status': 'paused', 'description': 'ignored'},
                context,
            )
        )
        self.assertTrue(result['updated'])
        self.assertEqual(result['project']['id'], _PROJECT)
        self.assertEqual(result['project']['title'], 'New name')
        self.assertEqual(result['project']['status'], 'paused')
        self.assertEqual(nest.updated, [(_PROJECT, {'title': 'New name', 'status': 'paused'})])
        self.assertTrue(context['workspace_overview_dirty'])
        self.assertEqual(context['projects_dirty'], [_PROJECT])

    def test_requires_a_uuid_project_id_and_at_least_one_persisted_field(self) -> None:
        nest = _FakeNest()
        bad_id = _run(_handler(nest).execute('update_project', {'project_id': 'Apollo', 'title': 'X'}, {}))
        self.assertEqual(bad_id['error']['code'], 'INVALID_PROJECT_ID')
        nothing = _run(_handler(nest).execute('update_project', {'project_id': _PROJECT}, {}))
        self.assertEqual(nothing['error']['code'], 'NOTHING_TO_UPDATE')
        description_only = _run(_handler(nest).execute('update_project', {'project_id': _PROJECT, 'description': 'New'}, {}))
        self.assertEqual(description_only['error']['code'], 'NOTHING_TO_UPDATE')
        self.assertIn('Descriptions cannot be changed', description_only['error']['message'])
        bad_status = _run(_handler(nest).execute('update_project', {'project_id': _PROJECT, 'status': 'done'}, {}))
        self.assertEqual(bad_status['error']['code'], 'INVALID_PROJECT_STATUS')
        self.assertEqual(nest.updated, [])

    def test_non_owner_is_forbidden_with_the_backend_message(self) -> None:
        message = "You don't have permission to update this project."
        nest = _FakeNest(update_error=_nest_error(403, message, 'missing_permission'))
        context: dict[str, Any] = {}
        result = _run(_handler(nest).execute('update_project', {'project_id': _PROJECT, 'title': 'X'}, context))
        self.assertEqual(result['error']['code'], 'FORBIDDEN')
        self.assertEqual(result['error']['message'], message)
        self.assertNotIn('projects_dirty', context)


class CatalogAndDispatchTests(unittest.TestCase):
    def test_registry_and_catalog_expose_both_tools_in_both_scopes(self) -> None:
        self.assertEqual(PROJECT_ADMIN_TOOL_NAMES, {'create_project', 'update_project'})
        self.assertTrue(PROJECT_ADMIN_TOOL_NAMES <= EXECUTABLE_TOOL_NAMES)
        self.assertTrue(PROJECT_ADMIN_TOOL_NAMES <= DISPATCHABLE_TOOL_NAMES)
        for name in PROJECT_ADMIN_TOOL_NAMES:
            self.assertTrue(tools_spec.is_dispatcher_tool(name), name)
            self.assertFalse(tools_spec.is_read_tool(name), name)
            self.assertFalse(tools_spec.is_terminal_tool(name), name)
        for scope in (_ROADMAP_SCOPE, _WORKSPACE_SCOPE):
            names = [spec['function']['name'] for spec in tools_spec.build_tools(scope=scope)]
            self.assertLess(names.index('attach_roadmap_to_project'), names.index('create_project'))
            self.assertLess(names.index('create_project'), names.index('update_project'))
            self.assertLess(names.index('update_project'), names.index('stage_edits'))
        for catalog in (
            tools_spec.materialize_tools(AgentSession(roadmap_id=_ROADMAP), _ROADMAP),
            tools_spec.repair_tools(_ROADMAP),
            tools_spec.verify_tools(),
        ):
            names = {spec['function']['name'] for spec in catalog}
            self.assertFalse(PROJECT_ADMIN_TOOL_NAMES & names)

    def test_schemas(self) -> None:
        create = tools_spec.create_project_tool()['function']
        self.assertEqual(create['parameters']['required'], ['title'])
        self.assertEqual(
            sorted(create['parameters']['properties']),
            ['description', 'duration', 'status', 'title', 'use_default_workspace', 'workspace_id'],
        )
        self.assertEqual(
            create['parameters']['properties']['status']['enum'],
            ['draft', 'bidding', 'active', 'paused', 'completed', 'archived'],
        )
        self.assertIn('never call create_roadmap', create['description'])
        update = tools_spec.update_project_tool()['function']
        self.assertEqual(update['parameters']['required'], ['project_id'])
        self.assertEqual(sorted(update['parameters']['properties']), ['duration', 'project_id', 'status', 'title'])
        self.assertIn('CANNOT be changed', update['description'])

    def test_dispatcher_routes_both_tools_and_never_sends_a_roadmap_id(self) -> None:
        nest = _FakeNest()
        dispatcher = ToolDispatcher(settings=get_settings(), logger=logging.getLogger('test'), nest_client=nest)
        context: dict[str, Any] = {'focus_roadmap_id': _ROADMAP, 'workspace_id': _WORKSPACE, 'auth_header': 'Bearer t'}
        created = dispatcher.execute('create_project', {'title': 'Fresh'}, context)
        self.assertTrue(created.get('created'), created)
        self.assertNotIn('roadmap_id', nest.created[0])
        self.assertEqual(nest.created[0]['workspace_id'], _WORKSPACE)
        updated = dispatcher.execute('update_project', {'project_id': _PROJECT, 'status': 'active'}, context)
        self.assertTrue(updated.get('updated'), updated)
        self.assertEqual(nest.updated, [(_PROJECT, {'status': 'active'})])


if __name__ == '__main__':
    unittest.main()
