"""Mid-loop roadmap admin tools: create_roadmap, attach_roadmap_to_project.

Like the memory and comment tools these WRITE through the backend as the
current user and the model continues its answer in the same loop turn. They
are not roadmap operations (no staging, no undo log): a roadmap row is
created or re-homed, and the backend enforces the one-to-one rule between a
project and its roadmap (a project holds at most one linked roadmap; a
roadmap belongs to at most one project).

After a successful call the handler flags the caches the write invalidates
(``workspace_overview_dirty``, ``roadmap_overviews_dirty``) so the phase
drops them at the end of the loop and the next turn sees the new state.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from app.core.logging_utils import log_event, summarize_tool_result

from .base import ToolHandlerBase

CREATE_ROADMAP_TOOL_NAME = 'create_roadmap'
ATTACH_ROADMAP_TOOL_NAME = 'attach_roadmap_to_project'

_MAX_NAME_CHARS = 200
_MAX_DESCRIPTION_CHARS = 2000
_MAX_CATEGORY_CHARS = 80
_ROADMAP_STATUSES = ('draft', 'active', 'paused', 'completed', 'archived')

# Gradient palette [from, to] — kept in sync with web/src/lib/roadmapThumbnail.ts
# (and the backfill SQL palette) so an agent-created roadmap gets the same
# placeholder card as one created in the app.
_GRADIENTS: tuple[tuple[str, str], ...] = (
    ('#f97316', '#ec4899'),
    ('#6366f1', '#8b5cf6'),
    ('#0ea5e9', '#06b6d4'),
    ('#10b981', '#22c55e'),
    ('#f59e0b', '#ef4444'),
    ('#8b5cf6', '#d946ef'),
)


def _hash_string(value: str) -> int:
    """djb2 with JavaScript's 32-bit signed overflow, then abs — mirrors
    ``hashString`` in roadmapThumbnail.ts so both sides pick the same
    gradient for the same seed."""
    hashed = 5381
    for char in value:
        hashed = ((hashed << 5) + hashed + ord(char)) & 0xFFFFFFFF
    if hashed >= 0x80000000:
        hashed -= 0x100000000
    return abs(hashed)


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    initials = ''.join(part[0] for part in parts).upper()[:2]
    return initials or 'R'


def _escape_xml(value: str) -> str:
    return (
        value.replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&apos;')
    )


def generate_roadmap_thumbnail_data_uri(seed: str, name: str) -> str:
    """Deterministic gradient + initials SVG data URI (see roadmapThumbnail.ts)."""
    start, end = _GRADIENTS[_hash_string(seed or name or 'roadmap') % len(_GRADIENTS)]
    initials = _escape_xml(_initials(name or 'Roadmap'))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" '
        f'viewBox="0 0 640 360" role="img" aria-label="{initials}" '
        'data-roadmap-thumbnail="generated"><defs><linearGradient id="g" x1="0" '
        f'y1="0" x2="1" y2="1"><stop offset="0" stop-color="{start}"/>'
        f'<stop offset="1" stop-color="{end}"/></linearGradient></defs>'
        '<rect width="640" height="360" fill="url(#g)"/><text x="320" y="180" '
        'fill="#ffffff" fill-opacity="0.95" font-family="Inter, system-ui, sans-serif" '
        'font-size="140" font-weight="700" text-anchor="middle" '
        f'dominant-baseline="central">{initials}</text></svg>'
    )
    return 'data:image/svg+xml,' + quote(svg, safe="-_.!~*'()")


def _clean(value: Any, limit: int) -> str:
    return str(value or '').strip()[:limit]


def _error(code: str, message: str) -> dict[str, Any]:
    return {'error': {'code': code, 'message': message}}


class RoadmapAdminToolHandler(ToolHandlerBase):
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

        if tool_name == CREATE_ROADMAP_TOOL_NAME:
            return await self._create(args, session_context, auth_value, trace_id)
        if tool_name == ATTACH_ROADMAP_TOOL_NAME:
            return await self._attach(args, session_context, auth_value, trace_id)
        return {
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f'Tool {tool_name} is not a roadmap admin tool.',
            }
        }

    async def _create(
        self,
        args: dict[str, Any],
        session_context: dict[str, Any],
        auth_value: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        name = _clean(args.get('name'), _MAX_NAME_CHARS)
        if not name:
            return _error(
                'INVALID_ROADMAP_NAME',
                f'name must be 1-{_MAX_NAME_CHARS} characters.',
            )
        project_id = _clean(args.get('project_id'), 64)
        if project_id and not self._is_uuid(project_id):
            return _error(
                'INVALID_PROJECT_ID',
                f'project_id "{project_id}" is not a project id. Use the id from '
                'get_workspace_overview.',
            )
        status = _clean(args.get('status'), 20).lower() or 'draft'
        if status not in _ROADMAP_STATUSES:
            status = 'draft'
        payload: dict[str, Any] = {
            'name': name,
            'status': status,
            'settings': {},
            'preview_url': generate_roadmap_thumbnail_data_uri(name, name),
        }
        description = _clean(args.get('description'), _MAX_DESCRIPTION_CHARS)
        if description:
            payload['description'] = description
        category = _clean(args.get('category'), _MAX_CATEGORY_CHARS)
        if category:
            payload['category'] = category
        if project_id:
            payload['project_id'] = project_id

        try:
            created = await self._run_context_call(
                session_context,
                self._nest_client.roadmap_create(
                    payload=payload,
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
        except HTTPException as exc:
            # 409 PROJECT_ALREADY_HAS_ROADMAP / 403 / 404 become tool errors
            # the model can explain, whether or not the dispatcher wraps us.
            return self._map_upstream_context_error(exc)
        if isinstance(created, dict) and isinstance(created.get('error'), dict):
            return created
        roadmap_id = str(created.get('id') or '') if isinstance(created, dict) else ''
        session_context['workspace_overview_dirty'] = True
        result = {
            'created': True,
            'roadmap': {
                'id': roadmap_id,
                'name': created.get('name') if isinstance(created, dict) else name,
                'status': created.get('status') if isinstance(created, dict) else status,
                'project_id': created.get('project_id') if isinstance(created, dict) else (project_id or None),
            },
            'next_step': (
                'The roadmap is empty. Call get_roadmap_overview with this id before '
                'adding epics, features or tasks to it with stage_edits or propose.'
            ),
        }
        log_event(
            self._logger,
            'tool_call_result',
            settings=self._settings,
            trace_id=trace_id,
            tool_name=CREATE_ROADMAP_TOOL_NAME,
            result_summary=summarize_tool_result(result),
        )
        return result

    async def _attach(
        self,
        args: dict[str, Any],
        session_context: dict[str, Any],
        auth_value: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        # The dispatcher writes the resolved roadmap onto args (the call's own
        # roadmap_id, else the focus roadmap); a workspace session must name it.
        roadmap_id = _clean(args.get('roadmap_id'), 64)
        if not roadmap_id:
            return {
                'error': {
                    'code': 'ROADMAP_ID_REQUIRED',
                    'message': (
                        'Pass roadmap_id — the standalone roadmap to attach (use '
                        'list_roadmaps or get_workspace_overview to find it).'
                    ),
                }
            }
        project_id = _clean(args.get('project_id'), 64)
        if not project_id or not self._is_uuid(project_id):
            return _error(
                'INVALID_PROJECT_ID',
                'Pass project_id — the project to attach the roadmap to (use '
                'get_workspace_overview to find it).',
            )
        try:
            updated = await self._run_context_call(
                session_context,
                self._nest_client.roadmap_update(
                    roadmap_id=roadmap_id,
                    payload={'project_id': project_id},
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
        except HTTPException as exc:
            return self._map_upstream_context_error(exc)
        if isinstance(updated, dict) and isinstance(updated.get('error'), dict):
            return updated
        session_context['workspace_overview_dirty'] = True
        dirty = session_context.setdefault('roadmap_overviews_dirty', [])
        if isinstance(dirty, list) and roadmap_id not in dirty:
            dirty.append(roadmap_id)
        result = {
            'attached': True,
            'roadmap': {
                'id': roadmap_id,
                'name': updated.get('name') if isinstance(updated, dict) else None,
                'project_id': updated.get('project_id') if isinstance(updated, dict) else project_id,
            },
        }
        log_event(
            self._logger,
            'tool_call_result',
            settings=self._settings,
            trace_id=trace_id,
            tool_name=ATTACH_ROADMAP_TOOL_NAME,
            result_summary=summarize_tool_result(result),
        )
        return result
