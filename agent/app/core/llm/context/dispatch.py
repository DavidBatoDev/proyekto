from __future__ import annotations

import logging
from time import perf_counter
from typing import Any, Callable

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging_utils import log_event, summarize_tool_result
from app.core.tools.registry import (
    CONTEXT_TOOL_NAMES,
    EDIT_HELPER_TOOL_NAMES,
    EXECUTABLE_TOOL_NAMES,
)

from .handlers.base import ToolHandlerBase
from .handlers.context_query import ContextQueryHandler
from .handlers.edit_helpers import EditHelperHandler


class ToolDispatcher:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        nest_client: Any,
        run_async_context_call: Callable[[Any], dict[str, Any]],
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._nest_client = nest_client
        self._run_async_context_call = run_async_context_call
        self._resolve_lookup_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._max_resolve_lookup_cache_entries = 256
        shared = dict(
            settings=settings,
            logger=logger,
            nest_client=nest_client,
            run_async_context_call=run_async_context_call,
            resolve_lookup_cache=self._resolve_lookup_cache,
            max_resolve_lookup_cache_entries=self._max_resolve_lookup_cache_entries,
        )
        self._context_handler = ContextQueryHandler(**shared)
        self._edit_handler = EditHelperHandler(**shared)
        self._base_helper = ToolHandlerBase(**shared)

    def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        started = perf_counter()
        trace_id = session_context.get('trace_id')
        roadmap_id = ''
        try:
            if tool_name not in EXECUTABLE_TOOL_NAMES:
                result = {
                    'error': {
                        'code': 'UNKNOWN_TOOL',
                        'message': f'Tool {tool_name} is not available in edit mode.',
                    }
                }
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            roadmap_id = str(
                args.get('roadmap_id') or session_context.get('roadmap_id') or ''
            ).strip()
            session_roadmap_id = str(session_context.get('roadmap_id') or '').strip()
            if not roadmap_id:
                result = {
                    'error': {
                        'code': 'MISSING_ROADMAP_ID',
                        'message': 'roadmap_id is required for context tools.',
                    }
                }
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result
            if session_roadmap_id and roadmap_id != session_roadmap_id:
                result = {
                    'error': {
                        'code': 'ROADMAP_SCOPE_MISMATCH',
                        'message': 'Context tools must use the active session roadmap_id.',
                    }
                }
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            auth_header = session_context.get('auth_header')
            auth_value = auth_header if isinstance(auth_header, str) and auth_header else None
            context_selector_raw = session_context.get('context_change_selector')
            context_selector = (
                str(context_selector_raw).strip()
                if isinstance(context_selector_raw, str) and context_selector_raw.strip()
                else None
            )
            log_event(
                self._logger,
                'tool_call_requested',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                tool_args=args,
                arg_keys=sorted(args.keys()),
                roadmap_id=roadmap_id,
            )

            # Write normalized derived values onto the caller's dict. The original
            # monolithic executor passed session_context by reference to its tool
            # branches, so helpers like _increment_phase_counter and
            # _read/_write_resolve_request_cache mutate state that the caller reads
            # back after tool execution (see
            # orchestration/planning/planning_phase_metrics.py). A copy here would
            # silently drop phase metrics and within-turn resolve dedup.
            session_context['trace_id'] = trace_id
            session_context['roadmap_id'] = roadmap_id
            session_context['auth_header'] = auth_value
            session_context['context_change_selector'] = context_selector

            if tool_name in CONTEXT_TOOL_NAMES:
                return self._context_handler.execute(tool_name, args, session_context)
            if tool_name in EDIT_HELPER_TOOL_NAMES:
                return self._edit_handler.execute(tool_name, args, session_context)
            return {
                'error': {
                    'code': 'UNKNOWN_TOOL',
                    'message': f'Tool {tool_name} is not available in edit mode.',
                }
            }
        except HTTPException as exc:
            error_payload = self._base_helper._map_upstream_context_error(exc)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(error_payload),
                tool_error_code=error_payload.get('error', {}).get('code'),
            )
            return error_payload
        except Exception as exc:  # pragma: no cover
            self._logger.warning(
                'Context tool execution failed. tool=%s roadmap_id=%s error=%s',
                tool_name,
                roadmap_id,
                exc,
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary={'result_type': 'error', 'error_code': 'CONTEXT_TOOL_FAILED'},
            )
            return {
                'error': {
                    'code': 'CONTEXT_TOOL_FAILED',
                    'message': 'Failed to fetch roadmap context from backend.',
                }
            }
        finally:
            self._base_helper._record_context_tool_timing(
                session_context=session_context,
                tool_name=tool_name,
                elapsed_ms=(perf_counter() - started) * 1000,
            )
