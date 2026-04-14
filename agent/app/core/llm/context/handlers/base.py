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
from app.core.metrics import record_cache_event
from app.core.orchestration.edits.edit_resolver import resolve_candidates
from app.core.uuid_utils import is_uuid_like


TASK_STATUS_VALUES = ('todo', 'in_progress', 'in_review', 'done', 'blocked')
TASK_STATUS_SET = set(TASK_STATUS_VALUES)
FEATURE_STATUS_VALUES = ('not_started', 'in_progress', 'in_review', 'completed', 'blocked')
FEATURE_STATUS_SET = set(FEATURE_STATUS_VALUES)
EPIC_PRIORITY_VALUES = ('critical', 'nice_to_have', 'low', 'medium', 'high')
EPIC_PRIORITY_SET = set(EPIC_PRIORITY_VALUES)
RELAXED_RESOLVE_UNIQUE_MIN_CONFIDENCE = 0.8
UNASSIGN_ASSIGNEE_TOKENS = {
    'unassign',
    'unassigned',
    'none',
    'null',
    'no assignee',
    'remove assignee',
    'clear assignee',
}

class ToolHandlerBase:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        nest_client: Any,
        resolve_lookup_cache: dict[str, tuple[float, dict[str, Any]]],
        max_resolve_lookup_cache_entries: int,
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._nest_client = nest_client
        self._resolve_lookup_cache = resolve_lookup_cache
        self._max_resolve_lookup_cache_entries = max_resolve_lookup_cache_entries

    async def _run_context_call(
        self,
        session_context: dict[str, Any],
        coro: Any,
    ) -> dict[str, Any]:
        started = perf_counter()
        try:
            # Accept either a coroutine (production nest_client) or a plain
            # value (some test mocks return dicts directly). The defensive
            # branch keeps existing mock shapes working without forcing every
            # test to convert to AsyncMock.
            if asyncio.iscoroutine(coro) or asyncio.isfuture(coro):
                return await coro
            return coro
        finally:
            elapsed_ms = (perf_counter() - started) * 1000
            self._record_context_http_timing(session_context=session_context, elapsed_ms=elapsed_ms)

    async def _run_context_calls_parallel(
        self,
        session_context: dict[str, Any],
        coroutines: list[Any],
    ) -> list[dict[str, Any]]:
        if not coroutines:
            return []
        started = perf_counter()

        async def _immediate(value: Any) -> Any:
            return value

        awaitables: list[Any] = []
        for item in coroutines:
            if asyncio.iscoroutine(item) or asyncio.isfuture(item):
                awaitables.append(item)
            else:
                awaitables.append(_immediate(item))
        gathered = await asyncio.gather(*awaitables, return_exceptions=True)
        elapsed_ms = (perf_counter() - started) * 1000
        self._record_context_http_timing(session_context=session_context, elapsed_ms=elapsed_ms)
        normalized: list[dict[str, Any]] = []
        for item in gathered:
            if isinstance(item, Exception):
                normalized.append({})
            elif isinstance(item, dict):
                normalized.append(item)
            else:
                normalized.append({})
        return normalized

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
        return is_uuid_like(value)

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

    def _normalize_assignee_update_input(self, value: Any) -> tuple[bool, str | None]:
        if value is None:
            return True, None
        if not isinstance(value, str):
            return False, None
        normalized = value.strip()
        if not normalized:
            return False, None
        canonical = ' '.join(re.sub(r'[^a-z0-9]+', ' ', normalized.lower()).split())
        if canonical in UNASSIGN_ASSIGNEE_TOKENS:
            return True, None
        return True, normalized

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

    async def _resolve_epic_fuzzy_fallback_matches(
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

        summary = await self._run_context_call(
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

    async def _build_resolve_unique_subgraph(
        self,
        *,
        roadmap_id: str,
        selected: dict[str, Any] | None,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
        child_limit: int,
    ) -> dict[str, Any] | None:
        if not isinstance(selected, dict):
            return None
        node_payload = self._compact_subgraph_node_payload(
            selected,
            default_type=None,
            include_status=False,
        )
        if node_payload is None:
            return None

        node_id = str(node_payload.get('id') or '').strip()
        node_type = str(node_payload.get('type') or '').strip().lower()
        if node_type not in {'epic', 'feature', 'task'}:
            return None

        subgraph: dict[str, Any] = {'node': node_payload}
        parent_payload = await self._resolve_subgraph_parent(
            roadmap_id=roadmap_id,
            selected=selected,
            node_type=node_type,
            session_context=session_context,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        if isinstance(parent_payload, dict):
            subgraph['parent'] = parent_payload

        children_payload = await self._resolve_subgraph_children(
            roadmap_id=roadmap_id,
            node_id=node_id,
            node_type=node_type,
            child_limit=child_limit,
            session_context=session_context,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        if children_payload is not None:
            subgraph['children'] = children_payload
        return subgraph

    async def _resolve_subgraph_parent(
        self,
        *,
        roadmap_id: str,
        selected: dict[str, Any],
        node_type: str,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any] | None:
        if node_type == 'epic':
            return None

        expected_parent_type = 'epic' if node_type == 'feature' else 'feature'
        parent_id = str(selected.get('parent_id') or '').strip()
        parent_title = str(selected.get('parent_title') or '').strip()
        context_node_details = getattr(self._nest_client, 'context_node_details', None)
        has_context_node_details = callable(context_node_details)

        if not parent_id:
            if not has_context_node_details:
                return None
            detail_result = await self._run_context_call(
                session_context,
                context_node_details(
                    roadmap_id=roadmap_id,
                    node_id=str(selected.get('id') or ''),
                    auth_header=auth_header,
                    trace_id=trace_id,
                ),
            )
            if isinstance(detail_result, dict) and not isinstance(detail_result.get('error'), dict):
                parent_id = (
                    str(detail_result.get('parent_id') or '').strip()
                    or str(detail_result.get('feature_id') or '').strip()
                    or str(detail_result.get('epic_id') or '').strip()
                )
                if not parent_title:
                    parent_title = str(detail_result.get('parent_title') or '').strip()

        if not parent_id:
            return None

        parent_type = expected_parent_type
        if not parent_title:
            if not has_context_node_details:
                return {
                    'id': parent_id,
                    'type': parent_type,
                    'title': parent_title,
                }
            parent_result = await self._run_context_call(
                session_context,
                context_node_details(
                    roadmap_id=roadmap_id,
                    node_id=parent_id,
                    auth_header=auth_header,
                    trace_id=trace_id,
                ),
            )
            if isinstance(parent_result, dict) and not isinstance(parent_result.get('error'), dict):
                parent_title = str(parent_result.get('title') or '').strip()
                resolved_parent_type = str(parent_result.get('type') or '').strip().lower()
                if resolved_parent_type in {'epic', 'feature'}:
                    parent_type = resolved_parent_type

        parent_payload = {
            'id': parent_id,
            'type': parent_type,
            'title': parent_title,
        }
        return parent_payload

    async def _resolve_subgraph_children(
        self,
        *,
        roadmap_id: str,
        node_id: str,
        node_type: str,
        child_limit: int,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
    ) -> list[dict[str, Any]] | None:
        normalized_limit = max(1, min(int(child_limit), 20))
        if node_type == 'task':
            return None

        if node_type == 'epic':
            context_features = getattr(self._nest_client, 'context_features', None)
            if not callable(context_features):
                return []
            feature_result = await self._run_context_call(
                session_context,
                context_features(
                    roadmap_id=roadmap_id,
                    epic_id=node_id,
                    limit=normalized_limit,
                    auth_header=auth_header,
                    trace_id=trace_id,
                ),
            )
            if isinstance(feature_result.get('error'), dict):
                return []
            features = self._filtered_features(
                features=self._children_from_result(feature_result),
                status_filter=None,
                limit=normalized_limit,
            )
            children: list[dict[str, Any]] = []
            for feature in features:
                compact = self._compact_subgraph_node_payload(
                    feature,
                    default_type='feature',
                    include_status=True,
                )
                if compact is None:
                    continue
                children.append(compact)
            return children

        context_children = getattr(self._nest_client, 'context_children', None)
        if not callable(context_children):
            return []
        child_result = await self._run_context_call(
            session_context,
            context_children(
                roadmap_id=roadmap_id,
                node_id=node_id,
                limit=normalized_limit,
                auth_header=auth_header,
                trace_id=trace_id,
            ),
        )
        if isinstance(child_result.get('error'), dict):
            return []
        tasks = self._filtered_tasks(
            tasks=self._children_from_result(child_result),
            status_filter=None,
            limit=normalized_limit,
        )
        children = []
        for task in tasks:
            compact = self._compact_subgraph_node_payload(
                task,
                default_type='task',
                include_status=True,
            )
            if compact is None:
                continue
            children.append(compact)
        return children

    def _compact_subgraph_node_payload(
        self,
        payload: dict[str, Any],
        *,
        default_type: str | None,
        include_status: bool,
    ) -> dict[str, Any] | None:
        node_id = str(payload.get('id') or '').strip()
        if not node_id:
            return None
        node_type_raw = str(payload.get('type') or '').strip().lower()
        node_type = node_type_raw or (str(default_type or '').strip().lower())
        if node_type not in {'epic', 'feature', 'task'}:
            return None
        compact: dict[str, Any] = {
            'id': node_id,
            'type': node_type,
            'title': str(payload.get('title') or '').strip(),
        }
        if include_status:
            status = self._normalized_status_filter(payload.get('status'))
            if status:
                compact['status'] = status
        return compact

    def _build_resolve_request_cache_key(
        self,
        *,
        roadmap_id: str,
        node_type: str | None,
        label: str,
        limit: int,
        context_selector: str | None,
        auto_correct: bool,
        fuzzy: bool,
    ) -> str:
        return json.dumps(
            {
                'roadmap_id': roadmap_id,
                'node_type': node_type,
                'label': label,
                'limit': limit,
                'context_selector': context_selector,
                'auto_correct': auto_correct,
                'fuzzy': fuzzy,
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
        auto_correct: bool,
        fuzzy: bool,
    ) -> str:
        return self._build_resolve_request_cache_key(
            roadmap_id=roadmap_id,
            node_type=node_type,
            label=label,
            limit=limit,
            context_selector=context_selector,
            auto_correct=auto_correct,
            fuzzy=fuzzy,
        )

    def _read_resolve_request_cache(
        self,
        *,
        session_context: dict[str, Any],
        cache_key: str,
    ) -> dict[str, Any] | None:
        cache = session_context.setdefault('_resolve_request_cache', {})
        trace_id = session_context.get('trace_id') if isinstance(session_context, dict) else None
        if not isinstance(cache, dict):
            record_cache_event(
                self._logger, self._settings,
                cache='resolve_request', outcome='miss',
                trace_id=trace_id,
            )
            return None
        cached_value = cache.get(cache_key)
        if not isinstance(cached_value, dict):
            record_cache_event(
                self._logger, self._settings,
                cache='resolve_request', outcome='miss',
                trace_id=trace_id,
            )
            return None
        record_cache_event(
            self._logger, self._settings,
            cache='resolve_request', outcome='hit',
            trace_id=trace_id,
        )
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
            record_cache_event(
                self._logger, self._settings,
                cache='resolve_lookup', outcome='miss',
            )
            return None
        cached_at, payload = entry
        ttl_seconds = max(int(self._settings.agent_resolve_cache_ttl_seconds), 0)
        if ttl_seconds <= 0:
            self._resolve_lookup_cache.pop(cache_key, None)
            record_cache_event(
                self._logger, self._settings,
                cache='resolve_lookup', outcome='miss',
                extra={'reason': 'ttl_disabled'},
            )
            return None
        age_seconds = perf_counter() - cached_at
        if age_seconds > float(ttl_seconds):
            self._resolve_lookup_cache.pop(cache_key, None)
            record_cache_event(
                self._logger, self._settings,
                cache='resolve_lookup', outcome='miss',
                extra={'reason': 'expired'},
            )
            return None
        record_cache_event(
            self._logger, self._settings,
            cache='resolve_lookup', outcome='hit',
        )
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

    async def _collect_tasks_for_epic(
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
        feature_limit = max(10, min(100, normalized_limit))
        features_result = await self._run_context_call(
            session_context,
            self._nest_client.context_features(
                roadmap_id=roadmap_id,
                epic_id=epic_id,
                limit=feature_limit,
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

        tasks: list[dict[str, Any]] = []
        batch_size = 8
        for batch_start in range(0, len(feature_ids), batch_size):
            if len(tasks) >= normalized_limit:
                break
            batch_feature_ids = feature_ids[batch_start:batch_start + batch_size]
            remaining_capacity = max(1, normalized_limit - len(tasks))
            child_limit = max(1, min(100, remaining_capacity))
            task_coroutines = [
                self._nest_client.context_children(
                    roadmap_id=roadmap_id,
                    node_id=feature_id,
                    limit=child_limit,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )
                for feature_id in batch_feature_ids
            ]
            task_results = await self._run_context_calls_parallel(session_context, task_coroutines)
            for feature_id, task_result in zip(batch_feature_ids, task_results):
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

    async def _collect_tasks_for_roadmap(
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
        summary_result = await self._run_context_call(
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
            per_epic = await self._collect_tasks_for_epic(
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

    async def _compute_epic_progress(
        self,
        *,
        roadmap_id: str,
        epic_id: str,
        session_context: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        task_result = await self._collect_tasks_for_epic(
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
