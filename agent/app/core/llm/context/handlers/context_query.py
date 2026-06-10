from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException

from app.core.logging_utils import log_event, summarize_tool_result
from app.core.orchestration.edits.edit_resolver import resolve_candidates

from .base import RELAXED_RESOLVE_UNIQUE_MIN_CONFIDENCE, ToolHandlerBase


class ContextQueryHandler(ToolHandlerBase):
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
        context_selector = session_context.get('context_change_selector')
        if not (isinstance(context_selector, str) and context_selector.strip()):
            context_selector = None

        if tool_name == 'get_roadmap_summary':
            result = await self._run_context_call(
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
            summary = await self._run_context_call(
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
                        progress = await self._compute_epic_progress(
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
            summary = await self._run_context_call(
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
            result = await self._run_context_call(
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
            result = await self._run_context_call(
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
            auto_correct_enabled = bool(args.get('auto_correct', True))
            fuzzy_enabled = bool(args.get('fuzzy', True))
            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else 20

            # Phase 2 observability: the planner is expected to use overview
            # handles (E1, E1.F2) for any node already rendered in "Current
            # roadmap". A resolve call for such a node is redundant — log it
            # so we can tell whether the prompt guidance is being followed.
            # The resolve still runs; future work can decide whether to
            # short-circuit once we see how often this fires.
            handle_map_raw = session_context.get('roadmap_handle_map')
            handle_map: dict[str, dict[str, str]] = (
                handle_map_raw if isinstance(handle_map_raw, dict) else {}
            )
            handle_by_id: dict[str, str] = {}
            redundant_handle: str | None = None
            redundant_match_count = 0
            if handle_map:
                normalized_label_lower = normalized_label.lower()
                for handle_key, entry in handle_map.items():
                    if not isinstance(entry, dict):
                        continue
                    entry_id = entry.get('id')
                    if isinstance(entry_id, str) and entry_id:
                        handle_by_id[entry_id] = handle_key
                    entry_title = entry.get('title')
                    entry_type = entry.get('type')
                    if not isinstance(entry_title, str):
                        continue
                    if node_type is not None and entry_type != node_type:
                        continue
                    if self._normalize_query_text(entry_title).lower() == normalized_label_lower:
                        redundant_handle = handle_key
                        redundant_match_count += 1
                        # Keep scanning so handle_by_id is fully populated.
                if redundant_handle is not None:
                    log_event(
                        self._logger,
                        'resolve_redundant_with_overview',
                        settings=self._settings,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        overview_handle=redundant_handle,
                        node_type=node_type,
                        label_chars=len(label),
                    )
            # The overview handle map IS the roadmap state the model is looking
            # at — when the label matches exactly one node there, answer from it
            # directly. The backend roundtrip is redundant for this case and has
            # been observed returning an empty match for a node the overview
            # plainly listed, which derailed the turn into a needless clarifier.
            if redundant_handle is not None and redundant_match_count == 1:
                entry = handle_map.get(redundant_handle) or {}
                matched_id = str(entry.get('id') or '').strip()
                matched_type = str(entry.get('type') or '').strip().lower()
                matched_title = str(entry.get('title') or '').strip()
                if matched_id and matched_type in {'epic', 'feature', 'task'}:
                    selected = {
                        'id': matched_id,
                        'type': matched_type,
                        'title': matched_title,
                    }
                    result = {
                        'status': 'resolved',
                        'resolution_id': None,
                        'type_relaxed': False,
                        'selected': selected,
                        'matches': [dict(selected)],
                        'node_id': matched_id,
                        'node_type': matched_type,
                        'title': matched_title,
                        'overview_handle': redundant_handle,
                        'source': 'overview_handle_map',
                    }
                    self._write_resolve_request_cache(
                        session_context=session_context,
                        cache_key=self._build_resolve_request_cache_key(
                            roadmap_id=roadmap_id,
                            node_type=node_type,
                            label=normalized_label,
                            limit=limit,
                            context_selector=context_selector,
                            auto_correct=auto_correct_enabled,
                            fuzzy=fuzzy_enabled,
                        ),
                        value=result,
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                        resolution_id=None,
                        resolve_dedup_hit=False,
                        resolve_cache_hit=False,
                        resolve_overview_short_circuit=True,
                    )
                    return result
            request_cache_key = self._build_resolve_request_cache_key(
                roadmap_id=roadmap_id,
                node_type=node_type,
                label=normalized_label,
                limit=limit,
                context_selector=context_selector,
                auto_correct=auto_correct_enabled,
                fuzzy=fuzzy_enabled,
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
                auto_correct=auto_correct_enabled,
                fuzzy=fuzzy_enabled,
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
            type_relaxed = False
            # W7 — the batch `/ai/context/resolve` endpoint returns the same
            # `matches[]` shape as the legacy `/context/search` endpoint plus a
            # `top_match` block containing parent + children for the first
            # candidate. Stashing each variant's top_match here lets us skip
            # the follow-up parent+children HTTPs in `_build_resolve_unique_subgraph`
            # when the planner's winning candidate matches a variant's top hit.
            top_matches_by_id: dict[str, dict[str, Any]] = {}
            subgraph_children_limit = max(1, min(int(limit), 20))

            def _harvest_variant_payload(result: dict[str, Any]) -> None:
                top_match = result.get('top_match') if isinstance(result, dict) else None
                if not isinstance(top_match, dict):
                    return
                node_payload = top_match.get('node')
                if not isinstance(node_payload, dict):
                    return
                top_id = str(node_payload.get('id') or '').strip()
                if not top_id or top_id in top_matches_by_id:
                    return
                top_matches_by_id[top_id] = top_match

            if auto_correct_enabled:
                query_variants = self._query_variants(label)
            else:
                query_variants = [normalized_label] if normalized_label else [label]
            search_results_by_variant: list[tuple[str, dict[str, Any]]] = []
            if (
                self._settings.agent_resolve_parallel_variants_enabled
                and len(query_variants) > 1
            ):
                coroutines = [
                    self._context_resolve_coroutine(
                        roadmap_id=roadmap_id,
                        query=query,
                        node_type=node_type,
                        limit=limit,
                        auth_header=auth_value,
                        trace_id=trace_id,
                        children_limit=subgraph_children_limit,
                    )
                    for query in query_variants
                ]
                parallel_results = await self._run_context_calls_parallel(
                    session_context,
                    coroutines,
                )
                search_results_by_variant = [
                    (query, result if isinstance(result, dict) else {})
                    for query, result in zip(query_variants, parallel_results)
                ]
                for _query, result in search_results_by_variant:
                    _harvest_variant_payload(result)
            else:
                for query in query_variants:
                    search_result = await self._run_context_call(
                        session_context,
                        self._context_resolve_coroutine(
                            roadmap_id=roadmap_id,
                            query=query,
                            node_type=node_type,
                            limit=limit,
                            auth_header=auth_value,
                            trace_id=trace_id,
                            children_limit=subgraph_children_limit,
                        ),
                    )
                    search_results_by_variant.append((query, search_result))
                    _harvest_variant_payload(search_result)
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

            if not raw_matches and node_type in {'epic', 'feature', 'task'}:
                relaxed_search_results_by_variant: list[tuple[str, dict[str, Any]]] = []
                relaxed_resolution_id: str | None = None
                if (
                    self._settings.agent_resolve_parallel_variants_enabled
                    and len(query_variants) > 1
                ):
                    coroutines = [
                        self._context_resolve_coroutine(
                            roadmap_id=roadmap_id,
                            query=query,
                            node_type=None,
                            limit=limit,
                            auth_header=auth_value,
                            trace_id=trace_id,
                            children_limit=subgraph_children_limit,
                        )
                        for query in query_variants
                    ]
                    parallel_results = await self._run_context_calls_parallel(
                        session_context,
                        coroutines,
                    )
                    relaxed_search_results_by_variant = [
                        (query, result if isinstance(result, dict) else {})
                        for query, result in zip(query_variants, parallel_results)
                    ]
                    for _query, result in relaxed_search_results_by_variant:
                        _harvest_variant_payload(result)
                else:
                    for query in query_variants:
                        search_result = await self._run_context_call(
                            session_context,
                            self._context_resolve_coroutine(
                                roadmap_id=roadmap_id,
                                query=query,
                                node_type=None,
                                limit=limit,
                                auth_header=auth_value,
                                trace_id=trace_id,
                                children_limit=subgraph_children_limit,
                            ),
                        )
                        relaxed_search_results_by_variant.append((query, search_result))
                        _harvest_variant_payload(search_result)
                        if relaxed_resolution_id is None:
                            maybe_resolution = search_result.get('resolution_id')
                            if isinstance(maybe_resolution, str) and maybe_resolution.strip():
                                relaxed_resolution_id = maybe_resolution
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
                    for _query, search_result in relaxed_search_results_by_variant:
                        if relaxed_resolution_id is None:
                            maybe_resolution = search_result.get('resolution_id')
                            if isinstance(maybe_resolution, str) and maybe_resolution.strip():
                                relaxed_resolution_id = maybe_resolution
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

                if raw_matches:
                    type_relaxed = True
                    if resolution_id is None:
                        resolution_id = relaxed_resolution_id

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
            if (
                fuzzy_enabled
                and not raw_matches
                and node_type in {None, 'epic'}
            ):
                fuzzy_epic_matches = await self._resolve_epic_fuzzy_fallback_matches(
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
                node_type=None if type_relaxed else node_type,
            )
            if type_relaxed and resolved.status == 'unique':
                selected_confidence = float(
                    (resolved.selected.confidence if resolved.selected is not None else 0.0)
                    or 0.0
                )
                if selected_confidence < RELAXED_RESOLVE_UNIQUE_MIN_CONFIDENCE:
                    if len(resolved.candidates) > 1:
                        resolved = type(resolved)(
                            status='ambiguous',
                            candidates=resolved.candidates,
                        )
                    else:
                        resolved = type(resolved)(
                            status='not_found',
                            candidates=resolved.candidates,
                        )
            selected_payload = (
                resolved.selected.model_dump(exclude_none=True)
                if resolved.selected is not None
                else None
            )
            selected_id = ''
            selected_type = ''
            selected_title = ''
            if isinstance(selected_payload, dict):
                selected_id = str(selected_payload.get('id') or '').strip()
                selected_type = str(selected_payload.get('type') or '').strip().lower()
                selected_title = str(selected_payload.get('title') or '').strip()
                if selected_id in backend_choice_by_id:
                    selected_payload['backend_choice'] = backend_choice_by_id[selected_id]

            resolved_subgraph = self._subgraph_from_batch_top_match(
                top_match=top_matches_by_id.get(selected_id) if selected_id else None,
                selected_payload=selected_payload,
            )
            if resolved_subgraph is None:
                resolved_subgraph = await self._build_resolve_unique_subgraph(
                    roadmap_id=roadmap_id,
                    selected=selected_payload,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                    child_limit=subgraph_children_limit,
                )
            result = {
                'status': resolved.status,
                'resolution_id': resolution_id,
                'type_relaxed': type_relaxed,
                'selected': selected_payload,
                'matches': [],
            }
            for item in resolved.candidates[:5]:
                payload = item.model_dump(exclude_none=True)
                item_id = str(payload.get('id') or '').strip()
                if item_id in backend_choice_by_id:
                    payload['backend_choice'] = backend_choice_by_id[item_id]
                result['matches'].append(payload)
            if selected_id:
                result['node_id'] = selected_id
                # Phase 2: if the resolved node is already in the roadmap
                # overview, include its handle so the planner can reference it
                # directly in future turns (and ideally skip resolve next time).
                overview_handle = handle_by_id.get(selected_id)
                if overview_handle is not None:
                    result['overview_handle'] = overview_handle
            if selected_type:
                result['node_type'] = selected_type
            if selected_title:
                result['title'] = selected_title
            if isinstance(resolved_subgraph, dict):
                result['resolved_subgraph'] = resolved_subgraph
                node_payload = resolved_subgraph.get('node')
                if isinstance(node_payload, dict):
                    result['node'] = node_payload
                parent_payload = resolved_subgraph.get('parent')
                if isinstance(parent_payload, dict):
                    result['parent'] = parent_payload
                children_payload = resolved_subgraph.get('children')
                if isinstance(children_payload, list):
                    result['children'] = children_payload
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
                resolve_auto_correct=auto_correct_enabled,
                resolve_fuzzy=fuzzy_enabled,
                resolve_type_relaxed=type_relaxed,
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
            result = await self._run_context_call(
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

        if tool_name == 'get_features_by_epic':
            epic_id = str(args.get('epic_id', '')).strip()
            if not epic_id:
                result = {
                    'error': {
                        'code': 'MISSING_EPIC_ID',
                        'message': 'epic_id is required for get_features_by_epic.',
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
            upstream_result = await self._run_context_call(
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
            result = await self._compute_epic_progress(
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
            result = await self._run_context_call(
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

        if tool_name == 'get_tasks_by_parent':
            parent_id = str(args.get('parent_id', '')).strip()
            if not parent_id:
                result = {
                    'error': {
                        'code': 'MISSING_PARENT_ID',
                        'message': 'parent_id is required for get_tasks_by_parent.',
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
            parent_type_raw = str(args.get('parent_type', '')).strip().lower()
            if parent_type_raw and parent_type_raw not in {'epic', 'feature'}:
                result = self._invalid_argument_result(
                    arg_name='parent_type',
                    arg_value=args.get('parent_type'),
                    message='parent_type must be one of: epic, feature.',
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
                )
                return result
            include_completed = bool(args.get('include_completed', False))
            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else 200
            limit = max(1, min(limit, 500))

            parent_type = parent_type_raw
            if not parent_type:
                parent_details = await self._run_context_call(
                    session_context,
                    self._nest_client.context_node_details(
                        roadmap_id=roadmap_id,
                        node_id=parent_id,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                parent_type_detected = str(parent_details.get('type') or '').strip().lower()
                if parent_type_detected in {'epic', 'feature'}:
                    parent_type = parent_type_detected
                else:
                    result = {
                        'error': {
                            'code': 'TYPE_MISMATCH',
                            'message': 'parent_id must resolve to an epic or feature node.',
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

            tasks: list[dict[str, Any]] = []
            if parent_type == 'feature':
                children_result = await self._run_context_call(
                    session_context,
                    self._nest_client.context_children(
                        roadmap_id=roadmap_id,
                        node_id=parent_id,
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
            else:
                tasks_result = await self._collect_tasks_for_epic(
                    roadmap_id=roadmap_id,
                    epic_id=parent_id,
                    status_filter=status_filter,
                    limit=limit,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                )
                if isinstance(tasks_result.get('error'), dict):
                    result = tasks_result
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
                tasks_raw = tasks_result.get('tasks')
                tasks = [item for item in tasks_raw if isinstance(item, dict)] if isinstance(tasks_raw, list) else []

            if not include_completed and status_filter in {None, 'all', 'open'}:
                tasks = [
                    item for item in tasks
                    if not self._is_done_status(self._normalized_status_filter(item.get('status')))
                ]

            result = {
                'parent_id': parent_id,
                'parent_type': parent_type,
                'include_completed': include_completed,
                'tasks': tasks[:limit],
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
            children_result = await self._run_context_call(
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
            result = await self._collect_tasks_for_epic(
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
            result = await self._collect_tasks_for_roadmap(
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
            task_result = await self._collect_tasks_for_roadmap(
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
            detail_results = await self._run_context_calls_parallel(
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

            summary = await self._run_context_call(
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
                feature_result = await self._run_context_call(
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
                    task_result = await self._run_context_call(
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
            result = await self._run_context_call(
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
            result = await self._run_context_call(
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

        if tool_name == 'get_children':
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
            result = await self._run_context_call(
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

        return {
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f'Tool {tool_name} is not available in edit mode.',
            }
        }
