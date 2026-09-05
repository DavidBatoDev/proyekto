"""Roadmap admin tools: create_roadmap and attach_roadmap_to_project.

The handler validates its arguments, posts through the backend as the user,
flags the caches the write invalidates, and maps backend refusals (a
project that already has a roadmap, a project the user cannot edit) to tool
errors the model can act on. The catalog exposes both as mid-loop write
tools and the dispatcher routes them.
"""

import asyncio
import logging
import unittest
from typing import Any
from urllib.parse import unquote

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.runtime import tools as tools_spec
from app.core.tools.dispatch import DISPATCHABLE_TOOL_NAMES, ToolDispatcher
from app.core.tools.handlers.roadmap_admin_tools import (
    RoadmapAdminToolHandler,
    generate_roadmap_thumbnail_data_uri,
)
from app.core.tools.registry import EXECUTABLE_TOOL_NAMES, ROADMAP_ADMIN_TOOL_NAMES

_ROADMAP = '11111111-1111-4111-8111-111111111111'
_PROJECT = '22222222-2222-4222-8222-222222222222'
_ROADMAP_SCOPE = {'kind': 'roadmap', 'roadmap_id': _ROADMAP}
_WORKSPACE_SCOPE = {'kind': 'workspace', 'workspace_id': 'ws-1'}


class _FakeNest:
    def __init__(self, *, create_error: Exception | None = None, update_error: Exception | None = None):
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []
        self._create_error = create_error
        self._update_error = update_error

    async def roadmap_create(self, *, payload, auth_header, trace_id=None):
        if self._create_error:
            raise self._create_error
        self.created.append(payload)
        return {
            'id': 'r-new',
            'name': payload['name'],
            'status': payload['status'],
            'project_id': payload.get('project_id'),
        }

    async def roadmap_update(self, *, roadmap_id, payload, auth_header, trace_id=None):
        if self._update_error:
            raise self._update_error
        self.updated.append((roadmap_id, payload))
        return {'id': roadmap_id, 'name': 'Solo', 'project_id': payload.get('project_id')}


def _handler(nest: _FakeNest) -> RoadmapAdminToolHandler:
    return RoadmapAdminToolHandler(
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
        detail={'upstream': 'nestjs', 'path': '/roadmaps', 'detail': {'error': error}},
    )


class ThumbnailTests(unittest.TestCase):
    def test_thumbnail_is_an_svg_data_uri_with_initials(self) -> None:
        uri = generate_roadmap_thumbnail_data_uri('How to become a full stack developer', 'How to become a full stack developer')
        self.assertTrue(uri.startswith('data:image/svg+xml,'))
        svg = unquote(uri.split(',', 1)[1])
        self.assertIn('>HT</text>', svg)
        self.assertIn('data-roadmap-thumbnail="generated"', svg)
        # Deterministic: the same seed picks the same gradient.
        self.assertEqual(uri, generate_roadmap_thumbnail_data_uri('How to become a full stack developer', 'How to become a full stack developer'))

    def test_thumbnail_escapes_markup_in_names(self) -> None:
        svg = unquote(generate_roadmap_thumbnail_data_uri('x', '<b> & "q"').split(',', 1)[1])
        self.assertNotIn('<b>', svg)
        self.assertIn('aria-label="&lt;&amp;"', svg)


class CreateRoadmapTests(unittest.TestCase):
    def test_creates_a_standalone_roadmap_and_flags_the_overview(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'auth_header': 'Bearer t', 'trace_id': 'tr'}
        result = _run(
            _handler(nest).execute(
                'create_roadmap',
                {'name': '  How to become a full stack developer ', 'description': 'A path'},
                context,
            )
        )
        self.assertTrue(result['created'])
        self.assertEqual(result['roadmap']['id'], 'r-new')
        self.assertIsNone(result['roadmap']['project_id'])
        self.assertIn('get_roadmap_overview', result['next_step'])
        payload = nest.created[0]
        self.assertEqual(payload['name'], 'How to become a full stack developer')
        self.assertEqual(payload['status'], 'draft')
        self.assertEqual(payload['description'], 'A path')
        self.assertTrue(payload['preview_url'].startswith('data:image/svg+xml,'))
        self.assertNotIn('project_id', payload)
        self.assertTrue(context['workspace_overview_dirty'])

    def test_creates_a_roadmap_linked_to_a_project(self) -> None:
        nest = _FakeNest()
        result = _run(
            _handler(nest).execute(
                'create_roadmap',
                {'name': 'Launch', 'project_id': _PROJECT, 'status': 'active'},
                {'auth_header': 'Bearer t'},
            )
        )
        self.assertEqual(result['roadmap']['project_id'], _PROJECT)
        self.assertEqual(nest.created[0]['project_id'], _PROJECT)
        self.assertEqual(nest.created[0]['status'], 'active')

    def test_rejects_a_blank_name_and_a_non_uuid_project(self) -> None:
        nest = _FakeNest()
        blank = _run(_handler(nest).execute('create_roadmap', {'name': '   '}, {}))
        self.assertEqual(blank['error']['code'], 'INVALID_ROADMAP_NAME')
        bad = _run(_handler(nest).execute('create_roadmap', {'name': 'X', 'project_id': 'Test Project'}, {}))
        self.assertEqual(bad['error']['code'], 'INVALID_PROJECT_ID')
        self.assertEqual(nest.created, [])

    def test_backend_conflict_becomes_a_tool_error(self) -> None:
        nest = _FakeNest(create_error=_nest_error(409, 'This project already has a roadmap.', 'PROJECT_ALREADY_HAS_ROADMAP'))
        context: dict[str, Any] = {}
        result = _run(_handler(nest).execute('create_roadmap', {'name': 'X', 'project_id': _PROJECT}, context))
        self.assertEqual(result['error']['code'], 'PROJECT_ALREADY_HAS_ROADMAP')
        self.assertIn('already has a roadmap', result['error']['message'])
        self.assertNotIn('workspace_overview_dirty', context)


class AttachRoadmapTests(unittest.TestCase):
    def test_attaches_the_named_roadmap_and_flags_both_caches(self) -> None:
        nest = _FakeNest()
        context: dict[str, Any] = {'auth_header': 'Bearer t'}
        result = _run(
            _handler(nest).execute(
                'attach_roadmap_to_project',
                {'roadmap_id': _ROADMAP, 'project_id': _PROJECT},
                context,
            )
        )
        self.assertTrue(result['attached'])
        self.assertEqual(result['roadmap']['project_id'], _PROJECT)
        self.assertEqual(nest.updated, [(_ROADMAP, {'project_id': _PROJECT})])
        self.assertTrue(context['workspace_overview_dirty'])
        self.assertEqual(context['roadmap_overviews_dirty'], [_ROADMAP])

    def test_requires_both_ids(self) -> None:
        nest = _FakeNest()
        no_roadmap = _run(_handler(nest).execute('attach_roadmap_to_project', {'project_id': _PROJECT}, {}))
        self.assertEqual(no_roadmap['error']['code'], 'ROADMAP_ID_REQUIRED')
        no_project = _run(_handler(nest).execute('attach_roadmap_to_project', {'roadmap_id': _ROADMAP}, {}))
        self.assertEqual(no_project['error']['code'], 'INVALID_PROJECT_ID')
        self.assertEqual(nest.updated, [])

    def test_forbidden_project_is_reported(self) -> None:
        nest = _FakeNest(update_error=_nest_error(403, 'You cannot edit this project.'))
        result = _run(
            _handler(nest).execute(
                'attach_roadmap_to_project',
                {'roadmap_id': _ROADMAP, 'project_id': _PROJECT},
                {},
            )
        )
        self.assertEqual(result['error']['code'], 'FORBIDDEN')


class CatalogAndDispatchTests(unittest.TestCase):
    def test_registry_and_catalog_expose_both_tools(self) -> None:
        self.assertEqual(ROADMAP_ADMIN_TOOL_NAMES, {'create_roadmap', 'attach_roadmap_to_project'})
        self.assertTrue(ROADMAP_ADMIN_TOOL_NAMES <= EXECUTABLE_TOOL_NAMES)
        self.assertTrue(ROADMAP_ADMIN_TOOL_NAMES <= DISPATCHABLE_TOOL_NAMES)
        for name in ROADMAP_ADMIN_TOOL_NAMES:
            self.assertTrue(tools_spec.is_dispatcher_tool(name), name)
            self.assertFalse(tools_spec.is_read_tool(name), name)
            self.assertFalse(tools_spec.is_terminal_tool(name), name)
        for scope in (_ROADMAP_SCOPE, _WORKSPACE_SCOPE):
            names = [spec['function']['name'] for spec in tools_spec.build_tools(scope=scope)]
            self.assertIn('create_roadmap', names)
            self.assertIn('attach_roadmap_to_project', names)
            self.assertLess(names.index('attach_roadmap_to_project'), names.index('stage_edits'))

    def test_create_roadmap_schema(self) -> None:
        spec = tools_spec.create_roadmap_tool()['function']
        self.assertEqual(spec['parameters']['required'], ['name'])
        self.assertEqual(sorted(spec['parameters']['properties']), ['category', 'description', 'name', 'project_id', 'status'])
        self.assertIn('one roadmap', spec['description'])

    def test_attach_roadmap_requires_roadmap_id_only_in_workspace_scope(self) -> None:
        roadmap_required = tools_spec.attach_roadmap_to_project_tool(_ROADMAP_SCOPE)['function']['parameters']['required']
        workspace_required = tools_spec.attach_roadmap_to_project_tool(_WORKSPACE_SCOPE)['function']['parameters']['required']
        self.assertEqual(roadmap_required, ['project_id'])
        self.assertEqual(workspace_required, ['project_id', 'roadmap_id'])

    def test_dispatcher_routes_and_defaults_the_focus_roadmap_for_attach(self) -> None:
        nest = _FakeNest()
        dispatcher = ToolDispatcher(settings=get_settings(), logger=logging.getLogger('test'), nest_client=nest)
        context: dict[str, Any] = {'focus_roadmap_id': _ROADMAP, 'auth_header': 'Bearer t'}
        attached = dispatcher.execute('attach_roadmap_to_project', {'project_id': _PROJECT}, context)
        self.assertTrue(attached.get('attached'), attached)
        self.assertEqual(nest.updated, [(_ROADMAP, {'project_id': _PROJECT})])
        created = dispatcher.execute('create_roadmap', {'name': 'Fresh'}, context)
        self.assertTrue(created.get('created'), created)
        self.assertNotIn('roadmap_id', nest.created[0])


if __name__ == '__main__':
    unittest.main()
