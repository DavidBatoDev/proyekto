"""Project admin tools: create_project and update_project.

Mid-loop writes through the backend as the current user (plain REST, not
roadmap operations: nothing is staged, nothing lands in the undo log). The
backend provisions a project's default roadmap in the same create call, so
``create_project`` returns both ids and the model never follows up with
``create_roadmap``. ``update_project`` is owner-only upstream and can change
only the fields the backend persists (title, status, duration); it never
offers the description, which ``PATCH /projects/:id`` silently ignores.

Workspace placement for a new project: an explicit ``workspace_id`` wins,
then the session's workspace (workspace scope), then the focus roadmap's
project workspace (roadmap scope), then the backend's default only when the
model passes ``use_default_workspace`` after the user chose it. With none of
those the tool answers ``WORKSPACE_REQUIRED`` so the model asks.

Both tools flag the caches the write invalidates (``workspace_overview_dirty``,
``projects_dirty``) so the investigate phase drops them at the end of the loop.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.core.logging_utils import log_event, summarize_tool_result
from app.core.uuid_utils import is_uuid_like

from .base import ToolHandlerBase

CREATE_PROJECT_TOOL_NAME = 'create_project'
UPDATE_PROJECT_TOOL_NAME = 'update_project'

PROJECT_STATUSES = ('draft', 'bidding', 'active', 'paused', 'completed', 'archived')
_MAX_TITLE_CHARS = 200
_MAX_DESCRIPTION_CHARS = 2000
_MAX_DURATION_CHARS = 120

WORKSPACE_REQUIRED_MESSAGE = (
    'No workspace is in scope for this session. Ask the user (via ask_user) which '
    'workspace the project belongs in, listing the workspaces you know from '
    "get_workspace_overview; if they answer 'my default/personal workspace', call "
    'create_project again with use_default_workspace: true and no workspace_id.'
)


def _clean(value: Any, limit: int) -> str:
    return str(value or '').strip()[:limit]


def _error(code: str, message: str) -> dict[str, Any]:
    return {'error': {'code': code, 'message': message}}


def _status_error(status: str) -> dict[str, Any]:
    return _error(
        'INVALID_PROJECT_STATUS',
        f'status "{status}" is not a project status. Use one of: {", ".join(PROJECT_STATUSES)}.',
    )


def infer_workspace_id(session_context: dict[str, Any]) -> str | None:
    """The workspace a new project lands in when the model names none:
    the session's workspace (workspace scope), else the focus roadmap's
    project workspace read from the cached project pack (roadmap scope)."""
    candidate = session_context.get('workspace_id')
    if isinstance(candidate, str) and is_uuid_like(candidate):
        return candidate
    pack = session_context.get('project_context')
    project = pack.get('project') if isinstance(pack, dict) else None
    workspace = project.get('workspace') if isinstance(project, dict) else None
    workspace_id = workspace.get('id') if isinstance(workspace, dict) else None
    if isinstance(workspace_id, str) and is_uuid_like(workspace_id):
        return workspace_id
    return None


def _project_view(project: Any, *, fallback: dict[str, Any]) -> dict[str, Any]:
    source = project if isinstance(project, dict) else {}
    return {
        'id': str(source.get('id') or fallback.get('id') or ''),
        'title': source.get('title') or fallback.get('title'),
        'status': source.get('status') or fallback.get('status'),
        'duration': source.get('duration') if 'duration' in source else fallback.get('duration'),
        'workspace_id': source.get('workspace_id') if 'workspace_id' in source else fallback.get('workspace_id'),
    }


class ProjectAdminToolHandler(ToolHandlerBase):
    async def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        trace_id = session_context.get('trace_id')
        auth_value = session_context.get('auth_header')
        if not (isinstance(auth_value, str) and auth_value):
            auth_value = None

        if tool_name == CREATE_PROJECT_TOOL_NAME:
            return await self._create(args, session_context, auth_value, trace_id)
        if tool_name == UPDATE_PROJECT_TOOL_NAME:
            return await self._update(args, session_context, auth_value, trace_id)
        return _error('UNKNOWN_TOOL', f'Tool {tool_name} is not a project admin tool.')

    async def _create(
        self,
        args: dict[str, Any],
        session_context: dict[str, Any],
        auth_value: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        title = _clean(args.get('title'), _MAX_TITLE_CHARS)
        if not title:
            return _error('INVALID_PROJECT_TITLE', f'title must be 1-{_MAX_TITLE_CHARS} characters.')
        payload: dict[str, Any] = {'title': title}

        status = _clean(args.get('status'), 20).lower()
        if status:
            if status not in PROJECT_STATUSES:
                return _status_error(status)
            payload['status'] = status
        description = _clean(args.get('description'), _MAX_DESCRIPTION_CHARS)
        if description:
            payload['description'] = description
        duration = _clean(args.get('duration'), _MAX_DURATION_CHARS)
        if duration:
            payload['duration'] = duration

        explicit_workspace = _clean(args.get('workspace_id'), 64)
        if explicit_workspace:
            if not is_uuid_like(explicit_workspace):
                return _error(
                    'INVALID_WORKSPACE_ID',
                    f'workspace_id "{explicit_workspace}" is not a workspace id. Use the id from '
                    'get_workspace_overview, or omit it to use the workspace in scope.',
                )
            payload['workspace_id'] = explicit_workspace
        else:
            inferred = infer_workspace_id(session_context)
            if inferred:
                payload['workspace_id'] = inferred
            elif not bool(args.get('use_default_workspace')):
                return _error('WORKSPACE_REQUIRED', WORKSPACE_REQUIRED_MESSAGE)

        try:
            created = await self._run_context_call(
                session_context,
                self._nest_client.project_create(
                    payload=payload,
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
        except HTTPException as exc:
            # 403 (guest, not a workspace member) / 400 become tool errors the
            # model can explain, whether or not the dispatcher wraps us.
            return self._map_upstream_context_error(exc)
        if isinstance(created, dict) and isinstance(created.get('error'), dict):
            return created

        created_project = created.get('project') if isinstance(created, dict) else None
        created_roadmap = created.get('roadmap') if isinstance(created, dict) else None
        project_view = _project_view(
            created_project,
            fallback={'title': title, 'status': status or 'draft', 'workspace_id': payload.get('workspace_id')},
        )
        project_view.pop('duration', None)
        roadmap_source = created_roadmap if isinstance(created_roadmap, dict) else {}
        roadmap_view = {
            'id': str(roadmap_source.get('id') or ''),
            'name': roadmap_source.get('name') or title,
        }
        session_context['workspace_overview_dirty'] = True
        result = {
            'created': True,
            'project': project_view,
            'roadmap': roadmap_view,
            'next_step': (
                f'The project has an empty roadmap "{roadmap_view["name"]}" (id {roadmap_view["id"]}). '
                'Call get_roadmap_overview with that roadmap id before adding epics, features or tasks.'
            ),
        }
        log_event(
            self._logger,
            'tool_call_result',
            settings=self._settings,
            trace_id=trace_id,
            tool_name=CREATE_PROJECT_TOOL_NAME,
            result_summary=summarize_tool_result(result),
        )
        return result

    async def _update(
        self,
        args: dict[str, Any],
        session_context: dict[str, Any],
        auth_value: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        project_id = _clean(args.get('project_id'), 64)
        if not project_id or not is_uuid_like(project_id):
            return _error(
                'INVALID_PROJECT_ID',
                'Pass project_id — the project to update (use get_workspace_overview to find it).',
            )
        payload: dict[str, Any] = {}
        title = _clean(args.get('title'), _MAX_TITLE_CHARS)
        if title:
            payload['title'] = title
        status = _clean(args.get('status'), 20).lower()
        if status:
            if status not in PROJECT_STATUSES:
                return _status_error(status)
            payload['status'] = status
        duration = _clean(args.get('duration'), _MAX_DURATION_CHARS)
        if duration:
            payload['duration'] = duration
        if not payload:
            return _error(
                'NOTHING_TO_UPDATE',
                'Pass at least one of title, status, duration. Descriptions cannot be '
                'changed with update_project.',
            )

        try:
            updated = await self._run_context_call(
                session_context,
                self._nest_client.project_update(
                    project_id=project_id,
                    payload=payload,
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
        except HTTPException as exc:
            mapped = self._map_upstream_context_error(exc)
            if exc.status_code == 403 and isinstance(mapped.get('error'), dict):
                # The backend answers missing_permission for non-owners; keep its
                # message but give the model the code the prompt names.
                mapped['error']['code'] = 'FORBIDDEN'
            return mapped
        if isinstance(updated, dict) and isinstance(updated.get('error'), dict):
            return updated

        session_context['workspace_overview_dirty'] = True
        dirty = session_context.setdefault('projects_dirty', [])
        if isinstance(dirty, list) and project_id not in dirty:
            dirty.append(project_id)
        result = {
            'updated': True,
            'project': _project_view(updated, fallback={'id': project_id, **payload}),
        }
        log_event(
            self._logger,
            'tool_call_result',
            settings=self._settings,
            trace_id=trace_id,
            tool_name=UPDATE_PROJECT_TOOL_NAME,
            result_summary=summarize_tool_result(result),
        )
        return result
