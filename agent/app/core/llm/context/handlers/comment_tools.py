"""Mid-loop comment tool: add_task_comments.

Like the memory tools this WRITES via the backend (task_comments) — the model
posts the same comment to one or more tasks and then continues its answer in
the same loop turn. The backend responds with per-task results
(``posted``/``failed``/``results``) which are passed through verbatim so the
model can report exactly which tasks got the comment. Comments are immediate
and are NOT part of the staged-operations/undo pipeline.
"""

from __future__ import annotations

from typing import Any

from app.core.logging_utils import log_event, summarize_tool_result

from .base import ToolHandlerBase

_MAX_TASK_IDS = 25
_MAX_CONTENT_CHARS = 2000


class CommentToolHandler(ToolHandlerBase):
    async def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        trace_id = session_context.get('trace_id')
        roadmap_id = str(session_context.get('roadmap_id') or '').strip()
        auth_value = session_context.get('auth_header')
        if not (isinstance(auth_value, str) and auth_value):
            auth_value = None

        if tool_name == 'add_task_comments':
            raw_ids = args.get('task_ids')
            task_ids: list[str] = []
            if isinstance(raw_ids, list):
                for raw in raw_ids:
                    candidate = str(raw or '').strip()
                    if candidate and candidate not in task_ids:
                        task_ids.append(candidate)
            if not task_ids:
                return {
                    'error': {
                        'code': 'INVALID_TASK_IDS',
                        'message': (
                            'task_ids must be a non-empty list of task ids '
                            'from read tools.'
                        ),
                    }
                }
            if len(task_ids) > _MAX_TASK_IDS:
                return {
                    'error': {
                        'code': 'INVALID_TASK_IDS',
                        'message': (
                            f'At most {_MAX_TASK_IDS} task_ids per call — '
                            'split into batches.'
                        ),
                    }
                }
            content = str(args.get('content') or '').strip()
            if not content or len(content) > _MAX_CONTENT_CHARS:
                return {
                    'error': {
                        'code': 'INVALID_COMMENT_CONTENT',
                        'message': (
                            'content must be 1-'
                            f'{_MAX_CONTENT_CHARS} characters of plain text.'
                        ),
                    }
                }
            result = await self._run_context_call(
                session_context,
                self._nest_client.ai_task_comments_add(
                    roadmap_id=roadmap_id,
                    payload={'task_ids': task_ids, 'content': content},
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        return {
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f'Tool {tool_name} is not a comment tool.',
            }
        }
