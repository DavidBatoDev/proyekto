"""Mid-loop memory tools: save_memory / forget_memory.

Unlike the context-query handlers these WRITE to the backend
(roadmap_ai_memories) — the model persists a durable preference and then
continues its answer in the same loop turn. On success the handler marks
``session_context['memory_notes_dirty']`` so the brain invalidates the cached
notes after the loop.
"""

from __future__ import annotations

from typing import Any

from app.core.logging_utils import log_event, summarize_tool_result

from .base import ToolHandlerBase


class MemoryToolHandler(ToolHandlerBase):
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

        if tool_name == 'save_memory':
            content = str(args.get('content') or '').strip()
            if len(content) < 3:
                return {
                    'error': {
                        'code': 'INVALID_MEMORY_CONTENT',
                        'message': 'content must be at least 3 characters.',
                    }
                }
            source = args.get('source')
            if source not in {'user_request', 'inferred'}:
                source = 'user_request'
            created = await self._run_context_call(
                session_context,
                self._nest_client.ai_memories_create(
                    roadmap_id=roadmap_id,
                    payload={'content': content[:500], 'source': source},
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
            session_context['memory_notes_dirty'] = True
            result = {
                'saved': True,
                'memory': {
                    'id': created.get('id'),
                    'content': created.get('content'),
                    'source': created.get('source'),
                },
            }
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'forget_memory':
            memory_id = str(args.get('memory_id') or '').strip()
            if not memory_id:
                return {
                    'error': {
                        'code': 'MISSING_MEMORY_ID',
                        'message': 'memory_id is required for forget_memory.',
                    }
                }
            await self._run_context_call(
                session_context,
                self._nest_client.ai_memories_delete(
                    roadmap_id=roadmap_id,
                    memory_id=memory_id,
                    auth_header=auth_value,
                    trace_id=trace_id,
                ),
            )
            session_context['memory_notes_dirty'] = True
            result = {'forgotten': True, 'memory_id': memory_id}
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
                'message': f'Tool {tool_name} is not a memory tool.',
            }
        }
