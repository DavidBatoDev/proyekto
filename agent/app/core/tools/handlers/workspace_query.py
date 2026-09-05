"""Cross-scope read tools over the user-scoped ``/api/ai/context`` family.

These are not keyed by a roadmap: they answer "what can I reach" questions
(``get_workspace_overview``), find roadmaps and items anywhere the user has
access (``list_roadmaps``, ``search_everything``), list the user's own tasks
across roadmaps (``list_my_tasks``), and read a project's members by project
id (``list_project_members``). Authorization stays on the backend per call;
the handler only shapes arguments and caps result sizes so a result never
blows the loop's tool-result cap.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.core.contracts.statuses import TASK_STATUS_VALUES
from app.core.logging_utils import log_event, summarize_tool_result

from .base import ToolHandlerBase

WORKSPACE_TOOL_NAMES: frozenset[str] = frozenset(
    {
        'get_workspace_overview',
        'list_roadmaps',
        'search_everything',
        'list_my_tasks',
        'list_project_members',
    }
)

# Context tools keyed by project id (project_id optional in roadmap scope,
# where the focus roadmap's project is the default).
PROJECT_KEYED_TOOL_NAMES: frozenset[str] = frozenset(
    {
        'get_project_brief',
        'list_project_resources',
        'list_project_meetings',
        'get_member_details',
        'list_project_members',
    }
)

# Registry context tools that do NOT need a roadmap id per call.
ROADMAP_OPTIONAL_TOOL_NAMES: frozenset[str] = PROJECT_KEYED_TOOL_NAMES | {'search_knowledge'}

# The backend's AI_CONTEXT_SEARCH_KINDS (@IsIn each): anything else is a 400.
_SEARCH_KINDS = ('project', 'roadmap', 'epic', 'feature', 'task')
_DUE_WINDOWS = ('overdue', 'today', 'week', 'all')
_MAX_LIST_ITEMS = 60
_MAX_ID_LIST = 20


def _clamp_int(value: Any, *, default: int, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return max(low, min(value, high))


def _string_list(value: Any, *, cap: int = _MAX_ID_LIST) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or '').strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= cap:
            break
    return out


def _cap_list(payload: dict[str, Any], key: str, cap: int = _MAX_LIST_ITEMS) -> dict[str, Any]:
    items = payload.get(key)
    if not isinstance(items, list) or len(items) <= cap:
        return payload
    return {**payload, key: items[:cap], f'{key}_truncated': len(items) - cap}


class WorkspaceQueryHandler(ToolHandlerBase):
    def _uuid_list(self, value: Any, *, cap: int = _MAX_ID_LIST) -> list[str]:
        """`_string_list` narrowed to uuid-shaped ids: the /ai/context list
        DTOs validate `roadmap_ids` with @IsUUID each, so a handle or a title
        the model slipped in must be dropped here rather than 400 the call."""
        return [item for item in _string_list(value, cap=cap) if self._is_uuid(item)]

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

        if tool_name == 'get_workspace_overview':
            workspace_id = str(args.get('workspace_id') or session_context.get('workspace_id') or '').strip() or None
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_context_overview(
                    workspace_id,
                    auth_value,
                    trace_id=trace_id,
                ),
            )
            if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                for key in ('projects', 'roadmaps', 'teams'):
                    result = _cap_list(result, key)
            return self._log_result(tool_name, result, trace_id)

        if tool_name == 'list_roadmaps':
            limit = _clamp_int(args.get('limit'), default=20, low=1, high=50)
            query = str(args.get('query') or '').strip().lower()[:200]
            params: dict[str, Any] = {
                'workspace_id': str(args.get('workspace_id') or '').strip() or None,
                'project_id': str(args.get('project_id') or '').strip() or None,
                # Fetch more than the limit when filtering client-side by name.
                'limit': min(100, limit * 3) if query else limit,
            }
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_context_roadmaps(
                    params,
                    auth_value,
                    trace_id=trace_id,
                ),
            )
            if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                # The backend answers {items, next_cursor} (AiContextRoadmapsResponseDto);
                # `roadmaps` is tolerated for older fakes/payloads.
                list_key = 'items' if isinstance(result.get('items'), list) else 'roadmaps'
                roadmaps = result.get(list_key)
                if isinstance(roadmaps, list):
                    entries = [item for item in roadmaps if isinstance(item, dict)]
                    if query:
                        entries = [
                            item
                            for item in entries
                            if query in str(item.get('name') or item.get('title') or '').lower()
                        ]
                    result = {**result, list_key: entries[:limit]}
                    if len(entries) > limit:
                        result[f'{list_key}_truncated'] = len(entries) - limit
            return self._log_result(tool_name, result, trace_id)

        if tool_name == 'search_everything':
            query = str(args.get('query') or '').strip()
            if len(query) < 2:
                return self._log_result(
                    tool_name,
                    {
                        'error': {
                            'code': 'MISSING_QUERY',
                            'message': 'query (at least 2 characters) is required for search_everything.',
                        }
                    },
                    trace_id,
                    warning=True,
                )
            raw_kinds = args.get('kinds')
            kinds = [
                kind for kind in (raw_kinds if isinstance(raw_kinds, list) else []) if kind in _SEARCH_KINDS
            ] or None
            params = {
                # AiContextSearchQueryDto: q is @MaxLength(160); roadmap_ids is
                # @IsUUID each (one bad id fails the whole request with a 400).
                'q': query[:160],
                'kinds': kinds,
                'roadmap_ids': self._uuid_list(args.get('roadmap_ids')) or None,
                'limit': _clamp_int(args.get('limit'), default=10, low=1, high=20),
            }
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_context_search(
                    params,
                    auth_value,
                    trace_id=trace_id,
                ),
            )
            if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                result = _cap_list(result, 'results', 20)
                result = _cap_list(result, 'matches', 20)
            return self._log_result(tool_name, result, trace_id)

        if tool_name == 'list_my_tasks':
            status = str(args.get('status') or 'open').strip().lower()
            if status not in {'open', 'all', *TASK_STATUS_VALUES}:
                status = 'open'
            due = str(args.get('due') or 'all').strip().lower()
            if due not in _DUE_WINDOWS:
                due = 'all'
            today = date.today()
            params = {
                'assigned_to_me': True,
                'status': status,
                'roadmap_ids': self._uuid_list(args.get('roadmap_ids')) or None,
                'limit': _clamp_int(args.get('limit'), default=25, low=1, high=50),
            }
            if due == 'overdue':
                params['overdue'] = True
            elif due == 'today':
                params['due_after'] = today.isoformat()
                params['due_before'] = today.isoformat()
            elif due == 'week':
                params['due_after'] = today.isoformat()
                params['due_before'] = (today + timedelta(days=7)).isoformat()
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_context_tasks(
                    params,
                    auth_value,
                    trace_id=trace_id,
                ),
            )
            if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                result = _cap_list(result, 'tasks', 50)
            return self._log_result(tool_name, result, trace_id)

        if tool_name == 'list_project_members':
            project_id = str(args.get('project_id') or session_context.get('focus_project_id') or '').strip()
            if not project_id:
                return self._log_result(
                    tool_name,
                    {
                        'error': {
                            'code': 'MISSING_PROJECT_ID',
                            'message': (
                                'Pass project_id — use list_roadmaps or '
                                'get_workspace_overview to find it.'
                            ),
                        }
                    },
                    trace_id,
                    warning=True,
                )
            if not self._is_uuid(project_id):
                return self._log_result(
                    tool_name,
                    {
                        'error': {
                            'code': 'INVALID_PROJECT_ID',
                            'message': f'project_id "{project_id}" is not a project id.',
                        }
                    },
                    trace_id,
                    warning=True,
                )
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_context_project_members(
                    project_id,
                    auth_value,
                    trace_id=trace_id,
                ),
            )
            if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                result = _cap_list(result, 'members', 50)
            return self._log_result(tool_name, result, trace_id)

        return {
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f'Tool {tool_name} is not a workspace tool.',
            }
        }

    def _log_result(
        self,
        tool_name: str,
        result: dict[str, Any],
        trace_id: str | None,
        *,
        warning: bool = False,
    ) -> dict[str, Any]:
        import logging

        log_event(
            self._logger,
            'tool_call_result',
            settings=self._settings,
            level=logging.WARNING if warning else logging.INFO,
            trace_id=trace_id,
            tool_name=tool_name,
            result_summary=summarize_tool_result(result),
        )
        return result
