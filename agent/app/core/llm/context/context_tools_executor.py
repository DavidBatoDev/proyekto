from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
import json
import logging
import re
from time import perf_counter
from typing import Any, Callable

from fastapi import HTTPException

from app.core.config import Settings
from app.core.logging_utils import log_event, summarize_tool_result
from app.core.orchestration.edits.edit_resolver import resolve_candidates
from app.core.tools.registry import EXECUTABLE_TOOL_NAMES


TASK_STATUS_VALUES = ('todo', 'in_progress', 'in_review', 'done', 'blocked')
TASK_STATUS_SET = set(TASK_STATUS_VALUES)
FEATURE_STATUS_VALUES = ('not_started', 'in_progress', 'in_review', 'completed', 'blocked')
FEATURE_STATUS_SET = set(FEATURE_STATUS_VALUES)
EPIC_PRIORITY_VALUES = ('critical', 'nice_to_have', 'low', 'medium', 'high')
EPIC_PRIORITY_SET = set(EPIC_PRIORITY_VALUES)


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
        self._resolve_lookup_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._max_resolve_lookup_cache_entries = 256

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

            if tool_name == 'get_roadmap_overview':
                summary = self._run_context_call(
                    session_context,
                    self._nest_client.context_summary(
                        roadmap_id=roadmap_id,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                if isinstance(summary.get('error'), dict):
                    result = summary
                else:
                    include_epics = bool(args.get('include_epics', True))
                    max_epics_raw = args.get('max_epics')
                    max_epics = int(max_epics_raw) if isinstance(max_epics_raw, int) else 20
                    max_epics = max(1, min(max_epics, 100))
                    epics_raw = summary.get('epics')
                    epics = [item for item in epics_raw if isinstance(item, dict)] if isinstance(epics_raw, list) else []
                    overview_epics: list[dict[str, Any]] = []
                    if include_epics:
                        for epic in epics[:max_epics]:
                            epic_id = str(epic.get('id') or '').strip()
                            if not epic_id:
                                continue
                            progress = self._compute_epic_progress(
                                roadmap_id=roadmap_id,
                                epic_id=epic_id,
                                session_context=session_context,
                                auth_header=auth_value,
                                trace_id=trace_id,
                            )
                            if isinstance(progress.get('error'), dict):
                                overview_epics.append(
                                    {
                                        'id': epic_id,
                                        'title': epic.get('title'),
                                        'status': epic.get('status'),
                                        'feature_count': epic.get('feature_count'),
                                        'progress': None,
                                    }
                                )
                                continue
                            overview_epics.append(
                                {
                                    'id': epic_id,
                                    'title': epic.get('title'),
                                    'status': epic.get('status'),
                                    'feature_count': epic.get('feature_count'),
                                    'progress': progress,
                                }
                            )
                    result = {
                        'roadmap_id': summary.get('roadmap_id'),
                        'title': summary.get('title'),
                        'description': summary.get('description'),
                        'status': summary.get('status'),
                        'epic_count': summary.get('epic_count'),
                        'feature_count': summary.get('feature_count'),
                        'task_count': summary.get('task_count'),
                        'epics': overview_epics,
                        'truncated_epics': max(0, len(epics) - len(overview_epics)) if include_epics else None,
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

            if tool_name == 'get_epics_by_roadmap':
                summary = self._run_context_call(
                    session_context,
                    self._nest_client.context_summary(
                        roadmap_id=roadmap_id,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                if isinstance(summary.get('error'), dict):
                    result = summary
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                status_filter = self._normalize_feature_status_filter(args.get('status'))
                if status_filter is None and args.get('status') is not None:
                    result = self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._feature_status_filter_validation_message(),
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
                        arg_value_preview=str(args.get('status'))[:40] if args.get('status') is not None else None,
                    )
                    return result
                priority_filter = self._normalize_epic_priority_filter(args.get('priority'))
                if priority_filter is None and args.get('priority') is not None:
                    result = self._invalid_argument_result(
                        arg_name='priority',
                        arg_value=args.get('priority'),
                        message=self._epic_priority_filter_validation_message(),
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
                        invalid_arg_name='priority',
                        arg_value_preview=str(args.get('priority'))[:40] if args.get('priority') is not None else None,
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 200))
                epics_raw = summary.get('epics') if isinstance(summary, dict) else None
                epics = [item for item in epics_raw if isinstance(item, dict)] if isinstance(epics_raw, list) else []
                filtered: list[dict[str, Any]] = []
                for epic in epics:
                    status = self._normalize_feature_status_filter(epic.get('status')) or 'unknown'
                    if status_filter and status_filter not in {'all', '*'} and status != status_filter:
                        continue
                    priority = self._normalize_epic_priority_filter(epic.get('priority')) or 'unknown'
                    if priority_filter and priority_filter != 'all' and priority != priority_filter:
                        continue
                    filtered.append(
                        {
                            'id': epic.get('id'),
                            'type': 'epic',
                            'title': epic.get('title'),
                            'status': status,
                            'priority': priority,
                            'feature_count': epic.get('feature_count'),
                        }
                    )
                    if len(filtered) >= limit:
                        break
                result = {
                    'roadmap_id': roadmap_id,
                    'epics': filtered,
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

            if tool_name == 'search_tasks':
                query = str(args.get('query', '')).strip()
                if not query:
                    result = {
                        'error': {
                            'code': 'MISSING_QUERY',
                            'message': 'query is required for search_tasks.',
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
                normalized_query = self._normalize_query_text(query)
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_search(
                        roadmap_id=roadmap_id,
                        query=normalized_query,
                        node_type='task',
                        limit=limit,
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
                normalized_label = self._normalize_query_text(label)
                node_type_raw = str(args.get('node_type', '')).strip().lower()
                node_type = node_type_raw if node_type_raw in {'epic', 'feature', 'task'} else None
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 20
                request_cache_key = self._build_resolve_request_cache_key(
                    roadmap_id=roadmap_id,
                    node_type=node_type,
                    label=normalized_label,
                    limit=limit,
                    context_selector=context_selector,
                )
                request_cached_result = self._read_resolve_request_cache(
                    session_context=session_context,
                    cache_key=request_cache_key,
                )
                if request_cached_result is not None:
                    self._increment_phase_counter(
                        session_context,
                        'resolve_dedup_hits',
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(request_cached_result),
                        resolution_id=request_cached_result.get('resolution_id'),
                        resolve_dedup_hit=True,
                        resolve_cache_hit=False,
                    )
                    return request_cached_result

                resolve_cache_key = self._build_resolve_cache_key(
                    roadmap_id=roadmap_id,
                    node_type=node_type,
                    label=normalized_label,
                    limit=limit,
                    context_selector=context_selector,
                )
                resolve_cached_result = self._read_resolve_lookup_cache(resolve_cache_key)
                if resolve_cached_result is not None:
                    self._increment_phase_counter(
                        session_context,
                        'resolve_cache_hits',
                    )
                    self._write_resolve_request_cache(
                        session_context=session_context,
                        cache_key=request_cache_key,
                        value=resolve_cached_result,
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(resolve_cached_result),
                        resolution_id=resolve_cached_result.get('resolution_id'),
                        resolve_dedup_hit=False,
                        resolve_cache_hit=True,
                    )
                    return resolve_cached_result

                self._increment_phase_counter(
                    session_context,
                    'resolve_cache_misses',
                )
                raw_matches: list[Any] = []
                resolution_id: str | None = None
                seen_ids: set[str] = set()
                query_variants = self._query_variants(label)
                search_results_by_variant: list[tuple[str, dict[str, Any]]] = []
                if (
                    self._settings.agent_resolve_parallel_variants_enabled
                    and len(query_variants) > 1
                ):
                    coroutines = [
                        self._nest_client.context_search(
                            roadmap_id=roadmap_id,
                            query=query,
                            node_type=node_type,
                            limit=limit,
                            auth_header=auth_value,
                            trace_id=trace_id,
                        )
                        for query in query_variants
                    ]
                    parallel_results = self._run_context_calls_parallel(
                        session_context,
                        coroutines,
                    )
                    search_results_by_variant = [
                        (query, result if isinstance(result, dict) else {})
                        for query, result in zip(query_variants, parallel_results)
                    ]
                else:
                    for query in query_variants:
                        search_result = self._run_context_call(
                            session_context,
                            self._nest_client.context_search(
                                roadmap_id=roadmap_id,
                                query=query,
                                node_type=node_type,
                                limit=limit,
                                auth_header=auth_value,
                                trace_id=trace_id,
                            ),
                        )
                        search_results_by_variant.append((query, search_result))
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

                if (
                    self._settings.agent_resolve_parallel_variants_enabled
                    and len(query_variants) > 1
                ):
                    for _query, search_result in search_results_by_variant:
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

                # If backend search misses for epic labels, try typo-tolerant local matching
                # against summary epics before falling back to a clarifier turn.
                if not raw_matches and node_type == 'epic':
                    fuzzy_epic_matches = self._resolve_epic_fuzzy_fallback_matches(
                        roadmap_id=roadmap_id,
                        label=label,
                        limit=limit,
                        session_context=session_context,
                        auth_header=auth_value,
                        trace_id=trace_id,
                        preview_id=context_selector,
                    )
                    for item in fuzzy_epic_matches:
                        if not isinstance(item, dict):
                            continue
                        item_id = str(item.get('id') or '').strip()
                        dedupe_key = item_id or json.dumps(item, sort_keys=True, default=str)
                        if dedupe_key in seen_ids:
                            continue
                        seen_ids.add(dedupe_key)
                        raw_matches.append(item)
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
                self._write_resolve_lookup_cache(resolve_cache_key, result)
                self._write_resolve_request_cache(
                    session_context=session_context,
                    cache_key=request_cache_key,
                    value=result,
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                    resolution_id=resolution_id,
                    resolve_dedup_hit=False,
                    resolve_cache_hit=False,
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

            if tool_name in {'get_features', 'get_features_by_epic'}:
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
                status_filter = self._normalize_feature_status_filter(args.get('status'))
                if status_filter is None and args.get('status') is not None:
                    result = self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._feature_status_filter_validation_message(),
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
                        arg_value_preview=str(args.get('status'))[:40] if args.get('status') is not None else None,
                    )
                    return result
                upstream_result = self._run_context_call(
                    session_context,
                    self._nest_client.context_features(
                        roadmap_id=roadmap_id,
                        epic_id=epic_id,
                        limit=limit,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
                )
                feature_limit = int(limit) if isinstance(limit, int) else 100
                feature_limit = max(1, min(feature_limit, 100))
                result = {
                    'children': self._filtered_features(
                        features=self._children_from_result(upstream_result),
                        status_filter=status_filter,
                        limit=feature_limit,
                    )
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

            if tool_name == 'get_epic_progress':
                epic_id = str(args.get('epic_id', '')).strip()
                if not epic_id:
                    result = {
                        'error': {
                            'code': 'MISSING_EPIC_ID',
                            'message': 'epic_id is required for get_epic_progress.',
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
                result = self._compute_epic_progress(
                    roadmap_id=roadmap_id,
                    epic_id=epic_id,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
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

            if tool_name == 'get_feature_details':
                feature_id = str(args.get('feature_id', '')).strip()
                if not feature_id:
                    result = {
                        'error': {
                            'code': 'MISSING_FEATURE_ID',
                            'message': 'feature_id is required for get_feature_details.',
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
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_node_details(
                        roadmap_id=roadmap_id,
                        node_id=feature_id,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                node_type = self._normalized_status_filter(result.get('type'))
                if node_type and node_type != 'feature':
                    result = {
                        'error': {
                            'code': 'TYPE_MISMATCH',
                            'message': 'feature_id did not resolve to a feature node.',
                        }
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

            if tool_name == 'get_tasks_by_feature':
                feature_id = str(args.get('feature_id', '')).strip()
                if not feature_id:
                    result = {
                        'error': {
                            'code': 'MISSING_FEATURE_ID',
                            'message': 'feature_id is required for get_tasks_by_feature.',
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
                status_filter = self._normalize_task_status_filter(args.get('status'))
                if status_filter is None and args.get('status') is not None:
                    result = self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._task_status_filter_validation_message(),
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
                        arg_value_preview=str(args.get('status'))[:40] if args.get('status') is not None else None,
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 500))
                children_result = self._run_context_call(
                    session_context,
                    self._nest_client.context_children(
                        roadmap_id=roadmap_id,
                        node_id=feature_id,
                        limit=min(limit, 100),
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                children = self._children_from_result(children_result)
                tasks = self._filtered_tasks(
                    tasks=children,
                    status_filter=status_filter,
                    limit=limit,
                )
                result = {'feature_id': feature_id, 'tasks': tasks}
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'get_tasks_by_epic':
                epic_id = str(args.get('epic_id', '')).strip()
                if not epic_id:
                    result = {
                        'error': {
                            'code': 'MISSING_EPIC_ID',
                            'message': 'epic_id is required for get_tasks_by_epic.',
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
                status_filter = self._normalize_task_status_filter(args.get('status'))
                if status_filter is None and args.get('status') is not None:
                    result = self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._task_status_filter_validation_message(),
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
                        arg_value_preview=str(args.get('status'))[:40] if args.get('status') is not None else None,
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 500))
                result = self._collect_tasks_for_epic(
                    roadmap_id=roadmap_id,
                    epic_id=epic_id,
                    status_filter=status_filter,
                    limit=limit,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
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

            if tool_name == 'get_tasks_by_status':
                status_filter = self._normalize_task_status_filter(args.get('status'))
                if status_filter is None:
                    result = self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._task_status_filter_validation_message(),
                    )
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
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 500))
                result = self._collect_tasks_for_roadmap(
                    roadmap_id=roadmap_id,
                    status_filter=status_filter,
                    limit=limit,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                    context_selector=context_selector,
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

            if tool_name == 'get_overdue_tasks':
                include_completed = bool(args.get('include_completed', False))
                reference_date = self._parse_reference_date(args.get('reference_date'))
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 500))
                task_result = self._collect_tasks_for_roadmap(
                    roadmap_id=roadmap_id,
                    status_filter='all',
                    limit=max(limit, 200),
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                    context_selector=context_selector,
                )
                tasks_raw = task_result.get('tasks')
                tasks = [item for item in tasks_raw if isinstance(item, dict)] if isinstance(tasks_raw, list) else []
                candidate_ids: list[str] = []
                for item in tasks:
                    status = self._normalized_status_filter(item.get('status'))
                    if not include_completed and self._is_done_status(status):
                        continue
                    task_id = str(item.get('id') or '').strip()
                    if task_id:
                        candidate_ids.append(task_id)
                detail_coroutines = [
                    self._nest_client.context_node_details(
                        roadmap_id=roadmap_id,
                        node_id=task_id,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
                    for task_id in candidate_ids
                ]
                detail_results = self._run_context_calls_parallel(
                    session_context,
                    detail_coroutines,
                )
                detail_by_id: dict[str, dict[str, Any]] = {}
                for task_id, detail in zip(candidate_ids, detail_results):
                    if isinstance(detail, dict):
                        detail_by_id[task_id] = detail
                overdue: list[dict[str, Any]] = []
                for item in tasks:
                    task_id = str(item.get('id') or '').strip()
                    if not task_id:
                        continue
                    detail = detail_by_id.get(task_id, {})
                    due_date_value = detail.get('due_date')
                    due_date = self._parse_date(due_date_value)
                    if due_date is None or due_date >= reference_date:
                        continue
                    status = self._normalized_status_filter(item.get('status'))
                    if not include_completed and self._is_done_status(status):
                        continue
                    payload = dict(item)
                    payload['due_date'] = due_date_value
                    payload['days_overdue'] = (reference_date - due_date).days
                    overdue.append(payload)
                    if len(overdue) >= limit:
                        break
                result = {
                    'roadmap_id': roadmap_id,
                    'reference_date': reference_date.isoformat(),
                    'tasks': overdue,
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

            if tool_name == 'get_blocked_items':
                include_epics = bool(args.get('include_epics', True))
                include_features = bool(args.get('include_features', True))
                include_tasks = bool(args.get('include_tasks', True))
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 200
                limit = max(1, min(limit, 500))
                blocked: list[dict[str, Any]] = []

                summary = self._run_context_call(
                    session_context,
                    self._nest_client.context_summary(
                        roadmap_id=roadmap_id,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                epics_raw = summary.get('epics') if isinstance(summary, dict) else None
                epics = [item for item in epics_raw if isinstance(item, dict)] if isinstance(epics_raw, list) else []

                for epic in epics:
                    if len(blocked) >= limit:
                        break
                    epic_id = str(epic.get('id') or '').strip()
                    epic_title = str(epic.get('title') or 'Untitled epic')
                    epic_status = self._normalized_status_filter(epic.get('status'))
                    if include_epics and epic_status == 'blocked':
                        blocked.append(
                            {
                                'id': epic_id,
                                'type': 'epic',
                                'title': epic_title,
                                'status': epic_status,
                            }
                        )
                    if not epic_id:
                        continue
                    feature_result = self._run_context_call(
                        session_context,
                        self._nest_client.context_features(
                            roadmap_id=roadmap_id,
                            epic_id=epic_id,
                            limit=100,
                            auth_header=auth_value,
                            trace_id=trace_id,
                        ),
                    )
                    features = self._children_from_result(feature_result)
                    for feature in features:
                        if len(blocked) >= limit:
                            break
                        feature_id = str(feature.get('id') or '').strip()
                        feature_title = str(feature.get('title') or 'Untitled feature')
                        feature_status = self._normalized_status_filter(feature.get('status'))
                        if include_features and feature_status == 'blocked':
                            blocked.append(
                                {
                                    'id': feature_id,
                                    'type': 'feature',
                                    'title': feature_title,
                                    'status': feature_status,
                                    'epic_id': epic_id,
                                    'epic_title': epic_title,
                                }
                            )
                        if not include_tasks or not feature_id:
                            continue
                        task_result = self._run_context_call(
                            session_context,
                            self._nest_client.context_children(
                                roadmap_id=roadmap_id,
                                node_id=feature_id,
                                limit=100,
                                auth_header=auth_value,
                                trace_id=trace_id,
                            ),
                        )
                        tasks = self._children_from_result(task_result)
                        for task in tasks:
                            if len(blocked) >= limit:
                                break
                            task_status = self._normalized_status_filter(task.get('status'))
                            if task_status != 'blocked':
                                continue
                            blocked.append(
                                {
                                    'id': task.get('id'),
                                    'type': 'task',
                                    'title': task.get('title'),
                                    'status': task_status,
                                    'feature_id': feature_id,
                                    'feature_title': feature_title,
                                    'epic_id': epic_id,
                                    'epic_title': epic_title,
                                }
                            )

                result = {
                    'roadmap_id': roadmap_id,
                    'items': blocked,
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

            if tool_name == 'get_tasks_assigned_to_me':
                status_raw = args.get('status')
                status_filter: str | None = None
                if isinstance(status_raw, str) and status_raw.strip():
                    normalized_status = self._normalize_task_status_filter(status_raw)
                    if normalized_status is None:
                        result = self._invalid_argument_result(
                            arg_name='status',
                            arg_value=status_raw,
                            message=self._task_status_filter_validation_message(),
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
                upstream_status = 'all' if status_filter and status_filter not in {'all', 'open'} else status_filter
                result = self._run_context_call(
                    session_context,
                    self._nest_client.context_tasks_assigned_to_me(
                        roadmap_id=roadmap_id,
                        status=upstream_status,
                        limit=limit,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    )
                )
                if isinstance(result, dict) and not isinstance(result.get('error'), dict):
                    tasks_raw = result.get('tasks')
                    if isinstance(tasks_raw, list):
                        task_limit = int(limit) if isinstance(limit, int) else 200
                        task_limit = max(1, min(task_limit, 200))
                        filtered_tasks = self._filtered_tasks(
                            tasks=[item for item in tasks_raw if isinstance(item, dict)],
                            status_filter=status_filter,
                            limit=task_limit,
                        )
                        result = dict(result)
                        result['tasks'] = filtered_tasks
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'create_epic':
                title = str(args.get('title') or '').strip()
                if not title:
                    return self._invalid_argument_result(
                        arg_name='title',
                        arg_value=args.get('title'),
                        message='title is required for create_epic.',
                    )
                data: dict[str, Any] = {'title': title}
                for key in ('description', 'status'):
                    value = args.get(key)
                    if isinstance(value, str) and value.strip():
                        data[key] = value.strip()
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[{'op': 'add_epic', 'node_type': 'epic', 'data': data}],
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

            if tool_name == 'create_feature':
                epic_id = str(args.get('epic_id') or '').strip()
                title = str(args.get('title') or '').strip()
                if not epic_id:
                    return self._invalid_argument_result(
                        arg_name='epic_id',
                        arg_value=args.get('epic_id'),
                        message='epic_id is required for create_feature.',
                    )
                if not title:
                    return self._invalid_argument_result(
                        arg_name='title',
                        arg_value=args.get('title'),
                        message='title is required for create_feature.',
                    )
                data = {'title': title}
                for key in ('description', 'status'):
                    value = args.get(key)
                    if isinstance(value, str) and value.strip():
                        data[key] = value.strip()
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'add_feature',
                            'node_type': 'feature',
                            'parent_id': epic_id,
                            'data': data,
                        }
                    ],
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

            if tool_name == 'create_task':
                feature_id = str(args.get('feature_id') or '').strip()
                title = str(args.get('title') or '').strip()
                if not feature_id:
                    return self._invalid_argument_result(
                        arg_name='feature_id',
                        arg_value=args.get('feature_id'),
                        message='feature_id is required for create_task.',
                    )
                if not title:
                    return self._invalid_argument_result(
                        arg_name='title',
                        arg_value=args.get('title'),
                        message='title is required for create_task.',
                    )
                data = {'title': title}
                for key in (
                    'description',
                    'status',
                    'priority',
                    'assignee_id',
                    'due_date',
                ):
                    value = args.get(key)
                    if isinstance(value, str) and value.strip():
                        data[key] = value.strip()
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'add_task',
                            'node_type': 'task',
                            'parent_id': feature_id,
                            'data': data,
                        }
                    ],
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

            if tool_name == 'update_task_status':
                task_id = str(args.get('task_id') or '').strip()
                if not task_id:
                    return self._invalid_argument_result(
                        arg_name='task_id',
                        arg_value=args.get('task_id'),
                        message='task_id is required for update_task_status.',
                    )
                status = self._normalize_task_status_input(args.get('status'))
                if status is None:
                    return self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._task_status_validation_message(),
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'mark_status',
                            'node_type': 'task',
                            'node_id': task_id,
                            'status': status,
                        }
                    ],
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

            if tool_name == 'update_task_priority':
                task_id = str(args.get('task_id') or '').strip()
                priority = str(args.get('priority') or '').strip()
                if not task_id or not priority:
                    return self._invalid_argument_result(
                        arg_name='task_id/priority',
                        arg_value=args,
                        message='task_id and priority are required for update_task_priority.',
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'update_node',
                            'node_type': 'task',
                            'node_id': task_id,
                            'patch': {'priority': priority},
                        }
                    ],
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

            if tool_name == 'update_task_assignee':
                task_id = str(args.get('task_id') or '').strip()
                assignee_id = str(args.get('assignee_id') or '').strip()
                if not task_id or not assignee_id:
                    return self._invalid_argument_result(
                        arg_name='task_id/assignee_id',
                        arg_value=args,
                        message='task_id and assignee_id are required for update_task_assignee.',
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'update_node',
                            'node_type': 'task',
                            'node_id': task_id,
                            'patch': {'assignee_id': assignee_id},
                        }
                    ],
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

            if tool_name in {'update_feature_status', 'update_epic_status'}:
                id_key = 'feature_id' if tool_name == 'update_feature_status' else 'epic_id'
                node_type = 'feature' if tool_name == 'update_feature_status' else 'epic'
                node_id = str(args.get(id_key) or '').strip()
                status = str(args.get('status') or '').strip()
                if not node_id or not status:
                    return self._invalid_argument_result(
                        arg_name=f'{id_key}/status',
                        arg_value=args,
                        message=f'{id_key} and status are required for {tool_name}.',
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'mark_status',
                            'node_type': node_type,
                            'node_id': node_id,
                            'status': status,
                        }
                    ],
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

            if tool_name == 'update_titles':
                node_type = str(args.get('node_type') or '').strip().lower()
                node_id = str(args.get('node_id') or '').strip()
                title = str(args.get('title') or '').strip()
                if node_type not in {'epic', 'feature', 'task'} or not node_id or not title:
                    return self._invalid_argument_result(
                        arg_name='node_type/node_id/title',
                        arg_value=args,
                        message='node_type, node_id, and title are required for update_titles.',
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'update_node',
                            'node_type': node_type,
                            'node_id': node_id,
                            'patch': {'title': title},
                        }
                    ],
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

            if tool_name in {'delete_task', 'delete_feature', 'delete_epic'}:
                key_by_tool = {
                    'delete_task': ('task_id', 'task'),
                    'delete_feature': ('feature_id', 'feature'),
                    'delete_epic': ('epic_id', 'epic'),
                }
                id_key, node_type = key_by_tool[tool_name]
                node_id = str(args.get(id_key) or '').strip()
                if not node_id:
                    return self._invalid_argument_result(
                        arg_name=id_key,
                        arg_value=args.get(id_key),
                        message=f'{id_key} is required for {tool_name}.',
                    )
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[
                        {
                            'op': 'delete_node',
                            'node_type': node_type,
                            'node_id': node_id,
                        }
                    ],
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

            if tool_name in {'move_task_to_feature', 'move_feature_to_epic'}:
                if tool_name == 'move_task_to_feature':
                    node_id = str(args.get('task_id') or '').strip()
                    new_parent_id = str(args.get('feature_id') or '').strip()
                    node_type = 'task'
                    arg_label = 'task_id/feature_id'
                else:
                    node_id = str(args.get('feature_id') or '').strip()
                    new_parent_id = str(args.get('epic_id') or '').strip()
                    node_type = 'feature'
                    arg_label = 'feature_id/epic_id'
                if not node_id or not new_parent_id:
                    return self._invalid_argument_result(
                        arg_name=arg_label,
                        arg_value=args,
                        message=f'{arg_label} are required for {tool_name}.',
                    )
                operation: dict[str, Any] = {
                    'op': 'move_node',
                    'node_type': node_type,
                    'node_id': node_id,
                    'new_parent_id': new_parent_id,
                }
                position = args.get('position')
                if isinstance(position, int) and position >= 0:
                    operation['position'] = position
                result = self._build_operation_result(
                    tool_name=tool_name,
                    operations=[operation],
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

            if tool_name in {'reorder_tasks', 'reorder_features', 'reorder_epics'}:
                if tool_name == 'reorder_tasks':
                    ids = self._string_list(args.get('task_ids'))
                    parent_id = str(args.get('feature_id') or '').strip()
                    node_type = 'task'
                    id_label = 'task_ids'
                    parent_label = 'feature_id'
                elif tool_name == 'reorder_features':
                    ids = self._string_list(args.get('feature_ids'))
                    parent_id = str(args.get('epic_id') or '').strip()
                    node_type = 'feature'
                    id_label = 'feature_ids'
                    parent_label = 'epic_id'
                else:
                    ids = self._string_list(args.get('epic_ids'))
                    parent_id = ''
                    node_type = 'epic'
                    id_label = 'epic_ids'
                    parent_label = ''
                if not ids:
                    return self._invalid_argument_result(
                        arg_name=id_label,
                        arg_value=args.get(id_label),
                        message=f'{id_label} is required for {tool_name}.',
                    )
                if parent_label and not parent_id:
                    return self._invalid_argument_result(
                        arg_name=parent_label,
                        arg_value=args.get(parent_label),
                        message=f'{parent_label} is required for {tool_name}.',
                    )
                operations: list[dict[str, Any]] = []
                for index, node_id in enumerate(ids):
                    op: dict[str, Any] = {
                        'op': 'move_node',
                        'node_type': node_type,
                        'node_id': node_id,
                        'position': index,
                    }
                    if parent_id:
                        op['new_parent_id'] = parent_id
                    operations.append(op)
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'bulk_update_task_status':
                task_ids = self._string_list(args.get('task_ids'))
                if not task_ids:
                    return self._invalid_argument_result(
                        arg_name='task_ids',
                        arg_value=args.get('task_ids'),
                        message='task_ids is required for bulk_update_task_status.',
                    )
                status = self._normalize_task_status_input(args.get('status'))
                if status is None:
                    return self._invalid_argument_result(
                        arg_name='status',
                        arg_value=args.get('status'),
                        message=self._task_status_validation_message(),
                    )
                operations = [
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'node_id': task_id,
                        'status': status,
                    }
                    for task_id in task_ids
                ]
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'bulk_assign_tasks':
                task_ids = self._string_list(args.get('task_ids'))
                assignee_id = str(args.get('assignee_id') or '').strip()
                if not task_ids or not assignee_id:
                    return self._invalid_argument_result(
                        arg_name='task_ids/assignee_id',
                        arg_value=args,
                        message='task_ids and assignee_id are required for bulk_assign_tasks.',
                    )
                operations = [
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'node_id': task_id,
                        'patch': {'assignee_id': assignee_id},
                    }
                    for task_id in task_ids
                ]
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'bulk_delete_tasks':
                task_ids = self._string_list(args.get('task_ids'))
                if not task_ids:
                    return self._invalid_argument_result(
                        arg_name='task_ids',
                        arg_value=args.get('task_ids'),
                        message='task_ids is required for bulk_delete_tasks.',
                    )
                operations = [
                    {'op': 'delete_node', 'node_type': 'task', 'node_id': task_id}
                    for task_id in task_ids
                ]
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'bulk_move_tasks_to_feature':
                task_ids = self._string_list(args.get('task_ids'))
                feature_id = str(args.get('feature_id') or '').strip()
                if not task_ids or not feature_id:
                    return self._invalid_argument_result(
                        arg_name='task_ids/feature_id',
                        arg_value=args,
                        message='task_ids and feature_id are required for bulk_move_tasks_to_feature.',
                    )
                start_position_raw = args.get('start_position')
                start_position = (
                    start_position_raw if isinstance(start_position_raw, int) and start_position_raw >= 0 else 0
                )
                operations = [
                    {
                        'op': 'move_node',
                        'node_type': 'task',
                        'node_id': task_id,
                        'new_parent_id': feature_id,
                        'position': start_position + index,
                    }
                    for index, task_id in enumerate(task_ids)
                ]
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name in {'bulk_update_feature_status', 'bulk_update_epic_status'}:
                if tool_name == 'bulk_update_feature_status':
                    ids = self._string_list(args.get('feature_ids'))
                    node_type = 'feature'
                    id_label = 'feature_ids'
                else:
                    ids = self._string_list(args.get('epic_ids'))
                    node_type = 'epic'
                    id_label = 'epic_ids'
                status = str(args.get('status') or '').strip()
                if not ids or not status:
                    return self._invalid_argument_result(
                        arg_name=f'{id_label}/status',
                        arg_value=args,
                        message=f'{id_label} and status are required for {tool_name}.',
                    )
                operations = [
                    {
                        'op': 'mark_status',
                        'node_type': node_type,
                        'node_id': node_id,
                        'status': status,
                    }
                    for node_id in ids
                ]
                result = self._build_operation_result(tool_name=tool_name, operations=operations)
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

    def _run_context_calls_parallel(
        self,
        session_context: dict[str, Any],
        coroutines: list[Any],
    ) -> list[dict[str, Any]]:
        if not coroutines:
            return []
        started = perf_counter()

        async def _gather_calls() -> list[dict[str, Any]]:
            awaitables: list[Any] = []
            for item in coroutines:
                if asyncio.iscoroutine(item) or asyncio.isfuture(item):
                    awaitables.append(item)
                else:
                    async def _immediate(value: Any) -> Any:
                        return value

                    awaitables.append(_immediate(item))
            gathered = await asyncio.gather(*awaitables, return_exceptions=True)
            normalized: list[dict[str, Any]] = []
            for item in gathered:
                if isinstance(item, Exception):
                    normalized.append({})
                elif isinstance(item, dict):
                    normalized.append(item)
                else:
                    normalized.append({})
            return normalized

        gather_coro = _gather_calls()
        result = self._run_async_context_call(gather_coro)
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
        elif not isinstance(result, list):
            gather_coro.close()
        elapsed_ms = (perf_counter() - started) * 1000
        self._record_context_http_timing(session_context=session_context, elapsed_ms=elapsed_ms)
        if isinstance(result, list):
            return [item if isinstance(item, dict) else {} for item in result]
        return []

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

    def _resolve_epic_fuzzy_fallback_matches(
        self,
        *,
        roadmap_id: str,
        label: str,
        limit: int,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
        preview_id: str | None,
    ) -> list[dict[str, Any]]:
        context_summary = getattr(self._nest_client, 'context_summary', None)
        if not callable(context_summary):
            return []

        normalized_label = self._normalize_resolve_text(label)
        if len(normalized_label) < 4:
            return []

        summary = self._run_context_call(
            session_context,
            context_summary(
                roadmap_id=roadmap_id,
                preview_id=preview_id,
                auth_header=auth_header,
                trace_id=trace_id,
            ),
        )
        if not isinstance(summary, dict) or isinstance(summary.get('error'), dict):
            return []

        epics_raw = summary.get('epics')
        if not isinstance(epics_raw, list):
            return []

        scored: list[dict[str, Any]] = []
        for epic in epics_raw:
            if not isinstance(epic, dict):
                continue
            epic_id = str(epic.get('id') or '').strip()
            title = str(epic.get('title') or '').strip()
            if not epic_id or not title:
                continue
            normalized_title = self._normalize_resolve_text(title)
            if not normalized_title:
                continue

            score = SequenceMatcher(None, normalized_label, normalized_title).ratio()
            if normalized_label in normalized_title or normalized_title in normalized_label:
                score = min(1.0, score + 0.08)

            if score < 0.72:
                continue
            scored.append(
                {
                    'id': epic_id,
                    'type': 'epic',
                    'title': title,
                    'score': round(score, 4),
                    'matched_fields': ['title_fuzzy'],
                }
            )

        scored.sort(key=lambda item: float(item.get('score') or 0.0), reverse=True)
        return scored[: max(1, min(limit, 10))]

    def _fallback_term(self, value: str) -> str | None:
        tokens = [token for token in value.split(' ') if token]
        if len(tokens) <= 1:
            return None
        generic_terms = {
            'all',
            'app',
            'application',
            'epic',
            'feature',
            'item',
            'items',
            'module',
            'platform',
            'project',
            'roadmap',
            'system',
            'task',
            'tasks',
            'work',
        }
        for token in reversed(tokens):
            normalized = re.sub(r'[^a-z0-9]+', '', token.lower())
            if len(normalized) < 4:
                continue
            if normalized in generic_terms:
                continue
            return token
        return None

    def _normalize_resolve_text(self, value: str) -> str:
        lowered = value.strip().lower()
        lowered = re.sub(r'[^a-z0-9\s]+', ' ', lowered)
        return ' '.join(lowered.split())

    def _build_resolve_request_cache_key(
        self,
        *,
        roadmap_id: str,
        node_type: str | None,
        label: str,
        limit: int,
        context_selector: str | None,
    ) -> str:
        return json.dumps(
            {
                'roadmap_id': roadmap_id,
                'node_type': node_type,
                'label': label,
                'limit': limit,
                'context_selector': context_selector,
            },
            sort_keys=True,
            separators=(',', ':'),
        )

    def _build_resolve_cache_key(
        self,
        *,
        roadmap_id: str,
        node_type: str | None,
        label: str,
        limit: int,
        context_selector: str | None,
    ) -> str:
        return self._build_resolve_request_cache_key(
            roadmap_id=roadmap_id,
            node_type=node_type,
            label=label,
            limit=limit,
            context_selector=context_selector,
        )

    def _read_resolve_request_cache(
        self,
        *,
        session_context: dict[str, Any],
        cache_key: str,
    ) -> dict[str, Any] | None:
        cache = session_context.setdefault('_resolve_request_cache', {})
        if not isinstance(cache, dict):
            return None
        cached_value = cache.get(cache_key)
        if not isinstance(cached_value, dict):
            return None
        return deepcopy(cached_value)

    def _write_resolve_request_cache(
        self,
        *,
        session_context: dict[str, Any],
        cache_key: str,
        value: dict[str, Any],
    ) -> None:
        cache = session_context.setdefault('_resolve_request_cache', {})
        if not isinstance(cache, dict):
            return
        cache[cache_key] = deepcopy(value)

    def _read_resolve_lookup_cache(self, cache_key: str) -> dict[str, Any] | None:
        entry = self._resolve_lookup_cache.get(cache_key)
        if entry is None:
            return None
        cached_at, payload = entry
        ttl_seconds = max(int(self._settings.agent_resolve_cache_ttl_seconds), 0)
        if ttl_seconds <= 0:
            self._resolve_lookup_cache.pop(cache_key, None)
            return None
        age_seconds = perf_counter() - cached_at
        if age_seconds > float(ttl_seconds):
            self._resolve_lookup_cache.pop(cache_key, None)
            return None
        return deepcopy(payload)

    def _write_resolve_lookup_cache(
        self,
        cache_key: str,
        value: dict[str, Any],
    ) -> None:
        if int(self._settings.agent_resolve_cache_ttl_seconds) <= 0:
            return
        self._resolve_lookup_cache[cache_key] = (perf_counter(), deepcopy(value))
        while len(self._resolve_lookup_cache) > self._max_resolve_lookup_cache_entries:
            oldest_key = next(iter(self._resolve_lookup_cache), None)
            if oldest_key is None:
                break
            self._resolve_lookup_cache.pop(oldest_key, None)

    def _increment_phase_counter(
        self,
        session_context: dict[str, Any],
        metric_name: str,
    ) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        current = int(metrics.get(metric_name) or 0)
        metrics[metric_name] = current + 1

    def _build_operation_result(
        self,
        *,
        tool_name: str,
        operations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            'assistant_message': f'Prepared {len(operations)} operation(s) from {tool_name}.',
            'operations': operations,
        }

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        output: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                continue
            normalized = item.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            output.append(normalized)
        return output

    def _normalized_status_filter(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip().lower()
        return normalized or None

    def _normalize_task_status_filter(self, value: Any) -> str | None:
        if value is None:
            return None
        normalized = self._normalized_status_filter(value)
        if normalized is None:
            return None
        if normalized == 'open':
            return 'open'
        aliases = {
            'todo': 'todo',
            'in_progress': 'in_progress',
            'in progress': 'in_progress',
            'in_review': 'in_review',
            'in review': 'in_review',
            'done': 'done',
            'blocked': 'blocked',
            'all': 'all',
        }
        canonical = aliases.get(normalized)
        if canonical is not None:
            return canonical
        collapsed = re.sub(r'[^a-z0-9]+', '', normalized)
        return {
            'todo': 'todo',
            'inprogress': 'in_progress',
            'inreview': 'in_review',
            'done': 'done',
            'blocked': 'blocked',
            'all': 'all',
            'open': 'open',
        }.get(collapsed)

    def _task_status_filter_validation_message(self) -> str:
        return 'status must be one of: todo, in_progress, in_review, done, blocked, all.'

    def _normalize_feature_status_filter(self, value: Any) -> str | None:
        if value is None:
            return None
        normalized = self._normalized_status_filter(value)
        if normalized is None:
            return None
        aliases = {
            'not_started': 'not_started',
            'not started': 'not_started',
            'in_progress': 'in_progress',
            'in progress': 'in_progress',
            'in_review': 'in_review',
            'in review': 'in_review',
            'completed': 'completed',
            'complete': 'completed',
            'done': 'completed',
            'blocked': 'blocked',
            'all': 'all',
        }
        canonical = aliases.get(normalized)
        if canonical is not None:
            return canonical
        collapsed = re.sub(r'[^a-z0-9]+', '', normalized)
        return {
            'notstarted': 'not_started',
            'inprogress': 'in_progress',
            'inreview': 'in_review',
            'completed': 'completed',
            'done': 'completed',
            'blocked': 'blocked',
            'all': 'all',
        }.get(collapsed)

    def _feature_status_filter_validation_message(self) -> str:
        return 'status must be one of: not_started, in_progress, in_review, completed, blocked, all.'

    def _normalize_epic_priority_filter(self, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return None
        normalized = re.sub(r'[^a-z0-9]+', '_', value.strip().lower()).strip('_')
        if not normalized:
            return None
        if normalized in EPIC_PRIORITY_SET:
            return normalized
        aliases = {
            'critical': 'critical',
            'crititcal': 'critical',
            'nice_to_have': 'nice_to_have',
            'nicetohave': 'nice_to_have',
            'low': 'low',
            'medium': 'medium',
            'high': 'high',
            'all': 'all',
        }
        return aliases.get(normalized)

    def _epic_priority_filter_validation_message(self) -> str:
        return 'priority must be one of: critical, nice_to_have, low, medium, high, all.'

    def _normalize_task_status_input(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = re.sub(r'[^a-z0-9]+', '_', value.strip().lower()).strip('_')
        if not normalized:
            return None
        if normalized in TASK_STATUS_SET:
            return normalized

        collapsed = normalized.replace('_', '')
        collapsed_aliases = {
            'todo': 'todo',
            'inprogress': 'in_progress',
            'inreview': 'in_review',
            'review': 'in_review',
            'done': 'done',
            'complete': 'done',
            'completed': 'done',
            'blocked': 'blocked',
        }
        return collapsed_aliases.get(collapsed)

    def _task_status_validation_message(self) -> str:
        return f"status must be one of: {', '.join(TASK_STATUS_VALUES)}."

    def _matches_status_filter(self, status: str | None, status_filter: str | None) -> bool:
        normalized_status = self._normalized_status_filter(status) or 'unknown'
        normalized_filter = self._normalized_status_filter(status_filter)
        if normalized_filter in {None, 'all', '*'}:
            return True
        if normalized_filter == 'open':
            return not self._is_done_status(normalized_status)
        if normalized_filter in {'done', 'completed'}:
            return self._is_done_status(normalized_status)
        return normalized_status == normalized_filter

    def _children_from_result(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        children = result.get('children')
        if not isinstance(children, list):
            return []
        return [item for item in children if isinstance(item, dict)]

    def _filtered_features(
        self,
        *,
        features: list[dict[str, Any]],
        status_filter: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for item in features:
            node_type = str(item.get('type') or '').strip().lower()
            if node_type and node_type != 'feature':
                continue
            status = self._normalize_feature_status_filter(item.get('status'))
            if status_filter and status_filter not in {'all', '*'} and status != status_filter:
                continue
            payload = dict(item)
            if status is not None:
                payload['status'] = status
            output.append(payload)
            if len(output) >= limit:
                break
        return output

    def _filtered_tasks(
        self,
        *,
        tasks: list[dict[str, Any]],
        status_filter: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for item in tasks:
            node_type = str(item.get('type') or '').strip().lower()
            if node_type and node_type != 'task':
                continue
            status = self._normalized_status_filter(item.get('status'))
            if not self._matches_status_filter(status, status_filter):
                continue
            payload = dict(item)
            if status is not None:
                payload['status'] = status
            output.append(payload)
            if len(output) >= limit:
                break
        return output

    def _is_done_status(self, status: str | None) -> bool:
        normalized = self._normalized_status_filter(status)
        return normalized in {'done', 'completed', 'archived'}

    def _parse_date(self, value: Any) -> date | None:
        if not isinstance(value, str):
            return None
        raw = value.strip()
        if not raw:
            return None
        try:
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
                return date.fromisoformat(raw)
            return datetime.fromisoformat(raw.replace('Z', '+00:00')).date()
        except ValueError:
            return None

    def _parse_reference_date(self, value: Any) -> date:
        parsed = self._parse_date(value)
        if parsed is not None:
            return parsed
        return datetime.now(timezone.utc).date()

    def _collect_tasks_for_epic(
        self,
        *,
        roadmap_id: str,
        epic_id: str,
        status_filter: str | None,
        limit: int,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        normalized_limit = max(1, min(int(limit), 2000))
        features_result = self._run_context_call(
            session_context,
            self._nest_client.context_features(
                roadmap_id=roadmap_id,
                epic_id=epic_id,
                limit=100,
                auth_header=auth_header,
                trace_id=trace_id,
            ),
        )
        if isinstance(features_result.get('error'), dict):
            return features_result
        features = self._children_from_result(features_result)
        feature_meta_by_id: dict[str, dict[str, Any]] = {}
        feature_ids: list[str] = []
        for feature in features:
            feature_id = str(feature.get('id') or '').strip()
            if not feature_id:
                continue
            feature_ids.append(feature_id)
            feature_meta_by_id[feature_id] = {
                'title': str(feature.get('title') or 'Untitled feature'),
                'status': self._normalized_status_filter(feature.get('status')) or 'unknown',
            }

        task_coroutines = [
            self._nest_client.context_children(
                roadmap_id=roadmap_id,
                node_id=feature_id,
                limit=100,
                auth_header=auth_header,
                trace_id=trace_id,
            )
            for feature_id in feature_ids
        ]
        task_results = self._run_context_calls_parallel(session_context, task_coroutines)

        tasks: list[dict[str, Any]] = []
        for feature_id, task_result in zip(feature_ids, task_results):
            children = self._children_from_result(task_result)
            feature_meta = feature_meta_by_id.get(feature_id, {})
            for task in children:
                node_type = str(task.get('type') or '').strip().lower()
                if node_type and node_type != 'task':
                    continue
                status = self._normalized_status_filter(task.get('status'))
                if not self._matches_status_filter(status, status_filter):
                    continue
                payload = {
                    'id': task.get('id'),
                    'type': 'task',
                    'title': task.get('title'),
                    'status': status or 'unknown',
                    'feature_id': feature_id,
                    'feature_title': feature_meta.get('title'),
                    'feature_status': feature_meta.get('status'),
                    'epic_id': epic_id,
                }
                tasks.append(payload)
                if len(tasks) >= normalized_limit:
                    break
            if len(tasks) >= normalized_limit:
                break

        return {
            'roadmap_id': roadmap_id,
            'epic_id': epic_id,
            'tasks': tasks,
        }

    def _collect_tasks_for_roadmap(
        self,
        *,
        roadmap_id: str,
        status_filter: str | None,
        limit: int,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
        context_selector: str | None,
    ) -> dict[str, Any]:
        normalized_limit = max(1, min(int(limit), 2000))
        summary_result = self._run_context_call(
            session_context,
            self._nest_client.context_summary(
                roadmap_id=roadmap_id,
                preview_id=context_selector,
                auth_header=auth_header,
                trace_id=trace_id,
            ),
        )
        if isinstance(summary_result.get('error'), dict):
            return summary_result

        epics_raw = summary_result.get('epics')
        epics = [item for item in epics_raw if isinstance(item, dict)] if isinstance(epics_raw, list) else []
        tasks: list[dict[str, Any]] = []
        for epic in epics:
            if len(tasks) >= normalized_limit:
                break
            epic_id = str(epic.get('id') or '').strip()
            if not epic_id:
                continue
            epic_title = str(epic.get('title') or 'Untitled epic')
            per_epic = self._collect_tasks_for_epic(
                roadmap_id=roadmap_id,
                epic_id=epic_id,
                status_filter=status_filter,
                limit=max(1, normalized_limit - len(tasks)),
                session_context=session_context,
                auth_header=auth_header,
                trace_id=trace_id,
            )
            task_rows = per_epic.get('tasks') if isinstance(per_epic, dict) else None
            if not isinstance(task_rows, list):
                continue
            for row in task_rows:
                if not isinstance(row, dict):
                    continue
                payload = dict(row)
                payload['epic_title'] = epic_title
                tasks.append(payload)
                if len(tasks) >= normalized_limit:
                    break

        return {'roadmap_id': roadmap_id, 'tasks': tasks}

    def _compute_epic_progress(
        self,
        *,
        roadmap_id: str,
        epic_id: str,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        task_result = self._collect_tasks_for_epic(
            roadmap_id=roadmap_id,
            epic_id=epic_id,
            status_filter='all',
            limit=2000,
            session_context=session_context,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        if isinstance(task_result.get('error'), dict):
            return task_result
        tasks_raw = task_result.get('tasks')
        tasks = [item for item in tasks_raw if isinstance(item, dict)] if isinstance(tasks_raw, list) else []

        feature_ids: set[str] = set()
        feature_status_counts: dict[str, int] = {}
        task_status_counts: dict[str, int] = {}
        done_count = 0
        for task in tasks:
            feature_id = str(task.get('feature_id') or '').strip()
            if feature_id:
                feature_ids.add(feature_id)
            feature_status = self._normalized_status_filter(task.get('feature_status')) or 'unknown'
            feature_status_counts[feature_status] = feature_status_counts.get(feature_status, 0) + 1
            status = self._normalized_status_filter(task.get('status')) or 'unknown'
            task_status_counts[status] = task_status_counts.get(status, 0) + 1
            if self._is_done_status(status):
                done_count += 1

        task_count = len(tasks)
        progress_percent = round((done_count / task_count) * 100, 2) if task_count > 0 else 0.0
        return {
            'roadmap_id': roadmap_id,
            'epic_id': epic_id,
            'feature_count': len(feature_ids),
            'task_count': task_count,
            'done_task_count': done_count,
            'open_task_count': max(task_count - done_count, 0),
            'progress_percent': progress_percent,
            'feature_status_counts': feature_status_counts,
            'task_status_counts': task_status_counts,
        }
