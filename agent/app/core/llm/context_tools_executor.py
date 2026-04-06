from __future__ import annotations

import json
import logging
import re
from time import perf_counter
from typing import Any, Callable

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging_utils import log_event, summarize_tool_result
from app.core.orchestration.edit_resolver import resolve_candidates
from app.core.tools.registry import CONTEXT_TOOL_NAMES


class ContextToolsExecutor:
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
            if tool_name not in CONTEXT_TOOL_NAMES:
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

            result: dict[str, Any]
            if tool_name == 'get_roadmap_summary':
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_summary(
                        roadmap_id=roadmap_id,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
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

            if tool_name == 'search_nodes':
                query = str(args.get('query', '')).strip()
                if not query:
                    result = {
                        'error': {
                            'code': 'MISSING_QUERY',
                            'message': 'query is required for search_nodes.',
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
                query = self._normalize_query_text(query)
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_search(
                        roadmap_id=roadmap_id,
                        query=query,
                        node_type=None,
                        limit=limit,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
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

            if tool_name == 'resolve_node_reference':
                label = str(args.get('label', '')).strip()
                if not label:
                    result = {
                        'error': {
                            'code': 'MISSING_LABEL',
                            'message': 'label is required for resolve_node_reference.',
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
                node_type_raw = str(args.get('node_type', '')).strip().lower()
                node_type = node_type_raw if node_type_raw in {'epic', 'feature', 'task'} else None
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 20
                raw_matches: list[Any] = []
                resolution_id: str | None = None
                seen_ids: set[str] = set()
                for query in self._query_variants(label):
                    search_result = self._run_context_call(
                        session_context,
                        self._nest_client.context_search(
                            roadmap_id=roadmap_id,
                            query=query,
                            node_type=node_type,
                            limit=limit,
                            auth_header=auth_value,
                            trace_id=trace_id,
                        )
                    )
                    if resolution_id is None:
                        maybe_resolution = search_result.get('resolution_id')
                        if isinstance(maybe_resolution, str) and maybe_resolution.strip():
                            resolution_id = maybe_resolution
                    variant_matches = search_result.get('matches', [])
                    if not isinstance(variant_matches, list):
                        continue
                    for item in variant_matches:
                        if not isinstance(item, dict):
                            continue
                        item_id = str(item.get('id') or '').strip()
                        dedupe_key = item_id or json.dumps(item, sort_keys=True, default=str)
                        if dedupe_key in seen_ids:
                            continue
                        seen_ids.add(dedupe_key)
                        raw_matches.append(item)
                    if raw_matches:
                        break
                backend_choice_by_id: dict[str, int] = {}
                for idx, raw_item in enumerate(raw_matches, start=1):
                    if isinstance(raw_item, dict):
                        raw_id = str(raw_item.get('id') or '').strip()
                        if raw_id and raw_id not in backend_choice_by_id:
                            backend_choice_by_id[raw_id] = idx
                resolved = resolve_candidates(
                    raw_matches,
                    label=label,
                    node_type=node_type,
                )
                selected_payload = (
                    resolved.selected.model_dump(exclude_none=True)
                    if resolved.selected is not None
                    else None
                )
                if isinstance(selected_payload, dict):
                    selected_id = str(selected_payload.get('id') or '').strip()
                    if selected_id in backend_choice_by_id:
                        selected_payload['backend_choice'] = backend_choice_by_id[selected_id]
                result = {
                    'status': resolved.status,
                    'resolution_id': resolution_id,
                    'selected': selected_payload,
                    'matches': [],
                }
                for item in resolved.candidates[:5]:
                    payload = item.model_dump(exclude_none=True)
                    item_id = str(payload.get('id') or '').strip()
                    if item_id in backend_choice_by_id:
                        payload['backend_choice'] = backend_choice_by_id[item_id]
                    result['matches'].append(payload)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                    resolution_id=resolution_id,
                )
                return result

            if tool_name == 'get_children_from_resolution':
                resolution_id = str(args.get('resolution_id', '')).strip()
                if not resolution_id:
                    result = {
                        'error': {
                            'code': 'MISSING_RESOLUTION_ID',
                            'message': 'resolution_id is required for get_children_from_resolution.',
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
                        tool_error_code='MISSING_RESOLUTION_ID',
                    )
                    return result
                choice = args.get('choice')
                if not isinstance(choice, int) or choice < 1:
                    result = self._invalid_argument_result(
                        arg_name='choice',
                        arg_value=choice,
                        message='choice must be an integer greater than or equal to 1.',
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                        tool_error_code='INVALID_ARGUMENT',
                        invalid_arg_name='choice',
                        arg_value_preview=str(choice)[:40] if choice is not None else None,
                        resolution_id=resolution_id,
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_children_from_resolution(
                        roadmap_id=roadmap_id,
                        resolution_id=resolution_id,
                        choice=choice,
                        limit=limit,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                    resolution_id=resolution_id,
                )
                return result

            if tool_name == 'get_features':
                epic_id = str(args.get('epic_id', '')).strip()
                if not epic_id:
                    result = {
                        'error': {
                            'code': 'MISSING_EPIC_ID',
                            'message': 'epic_id is required for get_features.',
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
                        tool_error_code='MISSING_EPIC_ID',
                    )
                    return result
                if not self._is_uuid(epic_id):
                    result = self._invalid_argument_result(
                        arg_name='epic_id',
                        arg_value=epic_id,
                        message='epic_id must be a valid UUID.',
                        error_code='INVALID_UUID',
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                        tool_error_code='INVALID_UUID',
                        invalid_arg_name='epic_id',
                        arg_value_preview=epic_id[:40],
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_features(
                        roadmap_id=roadmap_id,
                        epic_id=epic_id,
                        limit=limit,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
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

            if tool_name == 'get_tasks_assigned_to_me':
                status_raw = args.get('status')
                status_filter: str | None = None
                if isinstance(status_raw, str) and status_raw.strip():
                    normalized_status = status_raw.strip().lower()
                    if normalized_status not in {'open', 'all'}:
                        result = self._invalid_argument_result(
                            arg_name='status',
                            arg_value=status_raw,
                            message='status must be one of: open, all.',
                        )
                        log_event(
                            self._logger,
                            'tool_call_result',
                            settings=self._settings,
                            level=logging.WARNING,
                            trace_id=trace_id,
                            tool_name=tool_name,
                            result_summary=summarize_tool_result(result),
                            tool_error_code='INVALID_ARGUMENT',
                            invalid_arg_name='status',
                            arg_value_preview=status_raw[:40],
                        )
                        return result
                    status_filter = normalized_status
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_tasks_assigned_to_me(
                        roadmap_id=roadmap_id,
                        status=status_filter,
                        limit=limit,
                        preview_id=preview_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
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

            if tool_name == 'get_node_details':
                node_id = str(args.get('node_id', '')).strip()
                if not node_id:
                    result = {
                        'error': {
                            'code': 'MISSING_NODE_ID',
                            'message': 'node_id is required for get_node_details.',
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
                if not self._is_uuid(node_id):
                    result = self._invalid_argument_result(
                        arg_name='node_id',
                        arg_value=node_id,
                        message='node_id must be a valid UUID.',
                        error_code='INVALID_UUID',
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                        tool_error_code='INVALID_UUID',
                        invalid_arg_name='node_id',
                        arg_value_preview=node_id[:40],
                    )
                    return result
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_node_details(
                        roadmap_id=roadmap_id,
                        node_id=node_id,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
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

            parent_id = str(args.get('parent_id', '')).strip()
            if not parent_id:
                result = {
                    'error': {
                        'code': 'MISSING_PARENT_ID',
                        'message': 'parent_id is required for get_children.',
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
            if not self._is_uuid(parent_id):
                result = self._invalid_argument_result(
                    arg_name='parent_id',
                    arg_value=parent_id,
                    message='parent_id must be a valid UUID.',
                    error_code='INVALID_UUID',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                    tool_error_code='INVALID_UUID',
                    invalid_arg_name='parent_id',
                    arg_value_preview=parent_id[:40],
                )
                return result
            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else None
            result = self._run_context_call(
                session_context,
                self._nest_client.context_children(
                    roadmap_id=roadmap_id,
                    node_id=parent_id,
                    limit=limit,
                    auth_header=auth_value,
                    trace_id=trace_id,
                )
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
        except HTTPException as exc:
            error_payload = self._map_upstream_context_error(exc)
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
            self._record_context_tool_timing(
                session_context=session_context,
                tool_name=tool_name,
                elapsed_ms=(perf_counter() - started) * 1000,
            )

    def _run_context_call(
        self,
        session_context: dict[str, Any],
        coro: Any,
    ) -> dict[str, Any]:
        started = perf_counter()
        result = self._run_async_context_call(coro)
        elapsed_ms = (perf_counter() - started) * 1000
        self._record_context_http_timing(session_context=session_context, elapsed_ms=elapsed_ms)
        return result

    def _record_context_tool_timing(
        self,
        *,
        session_context: dict[str, Any],
        tool_name: str,
        elapsed_ms: float,
    ) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        current_total = float(metrics.get('context_tools_ms') or 0.0)
        metrics['context_tools_ms'] = current_total + float(elapsed_ms)
        by_name = metrics.get('context_tools_by_name')
        if not isinstance(by_name, dict):
            by_name = {}
            metrics['context_tools_by_name'] = by_name
        by_name[tool_name] = float(by_name.get(tool_name) or 0.0) + float(elapsed_ms)

    def _record_context_http_timing(
        self,
        *,
        session_context: dict[str, Any],
        elapsed_ms: float,
    ) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        current_http_total = float(metrics.get('context_tools_http_call_ms') or 0.0)
        metrics['context_tools_http_call_ms'] = current_http_total + float(elapsed_ms)

    def _is_uuid(self, value: str) -> bool:
        return bool(
            re.fullmatch(
                r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                value,
            )
        )

    def _invalid_argument_result(
        self,
        *,
        arg_name: str,
        arg_value: Any,
        message: str,
        error_code: str = 'INVALID_ARGUMENT',
    ) -> dict[str, Any]:
        return {
            'error': {
                'code': error_code,
                'message': message,
                'arg_name': arg_name,
                'arg_value_preview': str(arg_value)[:60] if arg_value is not None else None,
            }
        }

    def _map_upstream_context_error(self, exc: HTTPException) -> dict[str, Any]:
        default_code = 'CONTEXT_TOOL_FAILED'
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        upstream_detail = detail.get('detail') if isinstance(detail, dict) else None
        error_blob = upstream_detail.get('error') if isinstance(upstream_detail, dict) else None
        message = 'Failed to fetch roadmap context from backend.'
        mapped_code: str | None = None
        if isinstance(error_blob, dict):
            inner_message = error_blob.get('message')
            if isinstance(inner_message, dict):
                if isinstance(inner_message.get('message'), str):
                    message = inner_message['message']
                if isinstance(inner_message.get('code'), str):
                    mapped_code = inner_message['code']
            elif isinstance(inner_message, str):
                message = inner_message
            if isinstance(error_blob.get('code'), str):
                mapped_code = error_blob['code']
        if mapped_code is None and isinstance(upstream_detail, dict):
            maybe_code = upstream_detail.get('code')
            if isinstance(maybe_code, str):
                mapped_code = maybe_code
        if mapped_code is None and exc.status_code == 403:
            mapped_code = 'FORBIDDEN'
        if mapped_code is None and exc.status_code == 404:
            mapped_code = 'NODE_NOT_FOUND'
        if mapped_code is None and exc.status_code == 400:
            mapped_code = 'INVALID_ARGUMENT'
        return {
            'error': {
                'code': mapped_code or default_code,
                'message': message,
            }
        }

    def _normalize_query_text(self, value: str) -> str:
        normalized = value.strip()
        normalized = re.sub(r'[\"\'`]+', ' ', normalized)
        normalized = re.sub(r'\s+', ' ', normalized).strip()
        return normalized

    def _query_variants(self, label: str) -> list[str]:
        base = self._normalize_query_text(label)
        variants: list[str] = []
        if base:
            variants.append(base)
        compact = re.sub(r'[^a-zA-Z0-9\s-]', ' ', base)
        compact = re.sub(r'\s+', ' ', compact).strip()
        if compact and compact not in variants:
            variants.append(compact)
        fallback = self._fallback_term(compact or base)
        if fallback and fallback not in variants:
            variants.append(fallback)
        return variants[:3]

    def _fallback_term(self, value: str) -> str | None:
        tokens = [token for token in value.split(' ') if token]
        if len(tokens) <= 1:
            return None
        for token in reversed(tokens):
            if len(token) >= 4:
                return token
        return None
