"""The mid-loop tool dispatcher.

Routes every non-terminal tool call (roadmap reads, cross-scope reads, memory
and comment writes) to its handler, resolving the roadmap each call targets
PER CALL: the call's own ``roadmap_id`` wins, else the session's focus
roadmap. Per-call state never lives on the shared ``session_context`` dict —
``execute_many`` runs calls concurrently on one event loop, so it is written
back onto that call's ``args`` copy instead.

Authorization is the backend's: a 403/404 from NestJS is mapped to a tool
error by ``_map_upstream_context_error``; the agent never allowlists roadmaps.
"""

from __future__ import annotations

import asyncio
import logging
from time import perf_counter
from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging_utils import log_event, summarize_tool_result
from app.core.metrics import record_tool_invocation
from app.core.runtime.async_bridge import run_async_call
from app.core.tools.registry import (
    COMMENT_TOOL_NAMES,
    CONTEXT_TOOL_NAMES,
    MEMORY_TOOL_NAMES,
    EXECUTABLE_TOOL_NAMES,
    ROADMAP_ADMIN_TOOL_NAMES,
)
from app.core.uuid_utils import is_uuid_like

from .handlers.base import ToolHandlerBase
from .handlers.comment_tools import CommentToolHandler
from .handlers.context_query import ContextQueryHandler
from .handlers.memory_tools import MemoryToolHandler
from .handlers.roadmap_admin_tools import RoadmapAdminToolHandler
from .handlers.workspace_query import (
    ROADMAP_OPTIONAL_TOOL_NAMES,
    WORKSPACE_TOOL_NAMES,
    WorkspaceQueryHandler,
)

DISPATCHABLE_TOOL_NAMES = frozenset(EXECUTABLE_TOOL_NAMES) | WORKSPACE_TOOL_NAMES

# Registry context tools that cannot run without a roadmap id.
ROADMAP_REQUIRED_TOOL_NAMES = frozenset(CONTEXT_TOOL_NAMES) - ROADMAP_OPTIONAL_TOOL_NAMES


def _derive_invocation_outcome(result: Any) -> tuple[str, str | None]:
    if not isinstance(result, dict):
        # None or unexpected type — dispatcher always assigns a dict to `result`
        # before returning, so this means an exception leaked past both except
        # handlers. Report as error so `tool.invoked` doesn't silently log 'ok'.
        return 'error', 'CONTEXT_TOOL_FAILED' if result is None else None
    error = result.get('error')
    if isinstance(error, dict):
        code = error.get('code')
        return 'error', str(code) if code is not None else None
    return 'ok', None


def resolve_call_roadmap_id(
    tool_name: str,
    args: dict[str, Any],
    session_context: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | None]:
    """``(roadmap_id, error)`` for one call: the call's ``roadmap_id``
    (shape-checked — a hallucinated title is INVALID_ROADMAP_ID), else the
    session's focus/default roadmap. Roadmap-scoped context tools with no
    roadmap at all get MISSING_ROADMAP_ID; memory/comment tools leave that to
    their handlers (``MEMORY_NEEDS_ROADMAP`` / ``COMMENT_NEEDS_ROADMAP``)."""
    raw = args.get('roadmap_id')
    supplied = str(raw).strip() if isinstance(raw, str) and raw.strip() else ''
    if supplied and not is_uuid_like(supplied):
        return None, {
            'error': {
                'code': 'INVALID_ROADMAP_ID',
                'message': (
                    f'roadmap_id "{supplied}" is not a roadmap id. Use the id from '
                    'list_roadmaps or get_roadmap_overview.'
                ),
            }
        }
    roadmap_id = supplied or str(
        session_context.get('focus_roadmap_id')
        or session_context.get('default_roadmap_id')
        or ''
    ).strip()
    if not roadmap_id and tool_name in ROADMAP_REQUIRED_TOOL_NAMES:
        return None, {
            'error': {
                'code': 'MISSING_ROADMAP_ID',
                'message': (
                    'Pass roadmap_id — use list_roadmaps or get_roadmap_overview first.'
                ),
            }
        }
    return (roadmap_id or None), None


class ToolDispatcher:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        nest_client: Any,
        run_async_context_call: Callable[[Any], dict[str, Any]] | None = None,
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._nest_client = nest_client
        # `run_async_context_call` is accepted for backwards compatibility with
        # older callers that passed their own adapter. It is no longer used:
        # the dispatcher drives the async handler coroutine via its own
        # `_drive_handler_coroutine()` helper, which picks the correct
        # sync->async strategy based on whether an event loop is running in
        # the current thread.
        self._resolve_lookup_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._max_resolve_lookup_cache_entries = 256
        shared = dict(
            settings=settings,
            logger=logger,
            nest_client=nest_client,
            resolve_lookup_cache=self._resolve_lookup_cache,
            max_resolve_lookup_cache_entries=self._max_resolve_lookup_cache_entries,
        )
        self._context_handler = ContextQueryHandler(**shared)
        self._memory_handler = MemoryToolHandler(**shared)
        self._comment_handler = CommentToolHandler(**shared)
        self._roadmap_admin_handler = RoadmapAdminToolHandler(**shared)
        self._workspace_handler = WorkspaceQueryHandler(**shared)
        self._base_helper = ToolHandlerBase(**shared)

    def _drive_handler_coroutine(self, coro: Awaitable[dict[str, Any]]) -> dict[str, Any]:
        """Run the async handler coroutine from the sync dispatcher boundary.

        No event loop running in this thread -> `asyncio.run()` owns one.
        Already inside a loop (dispatcher called from async context that
        delegated through a thread adapter incorrectly, etc.) -> fall back to
        the existing bridge. Either way, at most ONE thread spawn per tool
        dispatch.
        """
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)
        return run_async_call(coro, settings=self._settings, logger=self._logger)

    def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        return self._drive_handler_coroutine(
            self._execute_async(tool_name, args, session_context)
        )

    def execute_many(
        self,
        calls: list[tuple[str, dict[str, Any]]],
        session_context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Run multiple tool calls concurrently on a single event loop.

        Callers must ensure every (name, args) is parallel-safe — typically
        restricted to the read tools. Results are returned in input order.
        Calls may target different roadmaps: each resolves its own.
        """
        if not calls:
            return []
        if len(calls) == 1:
            name, args = calls[0]
            return [self.execute(name, args, session_context)]

        async def _gather_all() -> list[dict[str, Any]]:
            return await asyncio.gather(
                *[self._execute_async(n, a, session_context) for n, a in calls]
            )

        return self._drive_handler_coroutine(_gather_all())

    async def _execute_async(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        started = perf_counter()
        trace_id = session_context.get('trace_id')
        roadmap_id: str | None = None
        result: Any = None
        args = dict(args or {})
        try:
            if tool_name not in DISPATCHABLE_TOOL_NAMES:
                result = {
                    'error': {
                        'code': 'UNKNOWN_TOOL',
                        'message': f'Tool {tool_name} is not available.',
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

            if tool_name not in WORKSPACE_TOOL_NAMES:
                roadmap_id, error = resolve_call_roadmap_id(tool_name, args, session_context)
                if error is not None:
                    result = error
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
                # Per-call state rides the call's own args copy — never the
                # shared session_context (execute_many runs calls in parallel).
                if roadmap_id:
                    args['roadmap_id'] = roadmap_id
                else:
                    args.pop('roadmap_id', None)

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
                roadmap_id=roadmap_id or '',
            )

            # Normalized derived values the handlers read. These are the same
            # for every call of the turn (pure normalization of what the
            # caller already put there), so writing them onto the shared dict
            # is idempotent. Per-call values (roadmap_id) never go here.
            session_context['trace_id'] = trace_id
            session_context['auth_header'] = auth_value
            session_context['context_change_selector'] = context_selector

            if tool_name in WORKSPACE_TOOL_NAMES:
                result = await self._workspace_handler.execute(tool_name, args, session_context)
                return result
            if tool_name in CONTEXT_TOOL_NAMES:
                result = await self._context_handler.execute(tool_name, args, session_context)
                return result
            if tool_name in MEMORY_TOOL_NAMES:
                result = await self._memory_handler.execute(tool_name, args, session_context)
                return result
            if tool_name in COMMENT_TOOL_NAMES:
                result = await self._comment_handler.execute(tool_name, args, session_context)
                return result
            if tool_name in ROADMAP_ADMIN_TOOL_NAMES:
                result = await self._roadmap_admin_handler.execute(tool_name, args, session_context)
                return result
            result = {
                'error': {
                    'code': 'UNKNOWN_TOOL',
                    'message': f'Tool {tool_name} is not available.',
                }
            }
            return result
        except HTTPException as exc:
            result = self._base_helper._map_upstream_context_error(exc)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
                tool_error_code=result.get('error', {}).get('code'),
            )
            return result
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
            result = {
                'error': {
                    'code': 'CONTEXT_TOOL_FAILED',
                    'message': 'Failed to fetch roadmap context from backend.',
                }
            }
            return result
        finally:
            elapsed_ms = (perf_counter() - started) * 1000
            self._base_helper._record_context_tool_timing(
                session_context=session_context,
                tool_name=tool_name,
                elapsed_ms=elapsed_ms,
            )
            outcome, error_code = _derive_invocation_outcome(result)
            record_tool_invocation(
                self._logger,
                self._settings,
                tool_name=tool_name,
                duration_ms=elapsed_ms,
                outcome=outcome,
                error_code=error_code,
                trace_id=trace_id,
                roadmap_id=roadmap_id or None,
                async_inner=True,
            )
