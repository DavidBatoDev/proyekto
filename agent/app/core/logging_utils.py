from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.core.config import Settings, get_settings

_KEY_PRIORITY = (
    'ts',
    'trace_id',
    'session_id',
    'roadmap_id',
    'intent_type',
    'response_mode',
    'provider',
    'provider_used',
    'phase',
    'fallback_used',
    'provider_error_code',
    'error_code',
    'elapsed_ms',
    'stop_reason',
    'react_terminal_action',
)

_SENSITIVE_KEYS = {
    'authorization',
    'auth_header',
    'api_key',
    'openai_api_key',
    'token',
    'password',
    'secret',
}

_CONTENT_KEYS = {
    'message',
    'user_message',
    'assistant_message',
    'content',
    'system_prompt',
    'planner_prompt',
}

_LIFECYCLE_TRACE_TTL_SECONDS = 15 * 60
_MAX_TOOL_CALLS_PER_TRACE = 20
_TRACE_LOCK = threading.Lock()
_PROGRESS_EVENT_TRACE_TTL_SECONDS = 15 * 60
_MAX_PROGRESS_EVENTS_PER_TRACE = 250
_MAX_PROGRESS_DETAIL_DEPTH = 4
_MAX_PROGRESS_LIST_ITEMS = 50
_MAX_PROGRESS_TEXT_LENGTH = 500
_MAX_PROGRESS_TITLE_ITEMS = 50


@dataclass
class _LifecycleTrace:
    trace_id: str
    created_monotonic: float
    last_seen_monotonic: float
    session_id: str | None = None
    roadmap_id: str | None = None
    request: dict[str, Any] = field(default_factory=dict)
    actor: dict[str, Any] = field(default_factory=dict)
    routing: dict[str, Any] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)
    llm_operations: list[dict[str, Any]] = field(default_factory=list)
    response: dict[str, Any] = field(default_factory=dict)
    assistant: dict[str, Any] = field(default_factory=dict)


_LIFECYCLE_TRACES: dict[str, _LifecycleTrace] = {}
_PROGRESS_EVENT_LOCK = threading.Lock()

_PROGRESS_EVENT_ALLOWLIST = {
    'message_received',
    'actor_context_loaded',
    'intent_classified',
    'route_selected',
    'provider_attempt',
    'provider_success',
    'provider_failure',
    'tool_call_requested',
    'tool_call_result',
    'plan_generated',
    'session_staged_state',
    'message_completed',
    'auto_commit_async_completed',
    'auto_commit_async_failed',
}


@dataclass
class _ProgressTraceEvent:
    seq: int
    ts: str
    event: str
    title: str
    status: str
    summary: str
    details: dict[str, Any] | None = None


@dataclass
class _ProgressTrace:
    trace_id: str
    created_monotonic: float
    last_seen_monotonic: float
    next_seq: int = 1
    session_id: str | None = None
    roadmap_id: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    done: bool = False
    events: list[_ProgressTraceEvent] = field(default_factory=list)


_PROGRESS_TRACES: dict[str, _ProgressTrace] = {}


@dataclass(frozen=True)
class _AnsiPalette:
    enabled: bool

    def separator(self, text: str) -> str:
        return self._style(text, '36')

    def event_header(self, text: str) -> str:
        return self._style(text, '1;96')

    def lifecycle_header(self, text: str) -> str:
        return self._style(text, '1;95')

    def _style(self, text: str, code: str) -> str:
        if not self.enabled:
            return text
        return f'\x1b[{code}m{text}\x1b[0m'


def configure_logging(settings: Settings | None = None) -> None:
    cfg = settings or get_settings()
    level_name = (cfg.agent_log_level or 'INFO').upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format='%(message)s' if cfg.agent_log_json else '%(asctime)s %(levelname)s %(name)s %(message)s',
        force=True,
    )
    # Keep agent logs structured and useful by suppressing transport-level noise.
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('watchfiles').setLevel(logging.WARNING)
    logging.getLogger('uvicorn.access').setLevel(logging.WARNING)


def log_event(
    logger: logging.Logger,
    event: str,
    *,
    level: int = logging.INFO,
    settings: Settings | None = None,
    **data: Any,
) -> None:
    cfg = settings or get_settings()
    payload = {
        'ts': datetime.now(timezone.utc).isoformat(),
        'event': event,
        **_sanitize(data, include_content=cfg.agent_log_include_content),
    }
    _capture_progress_event(payload, settings=cfg)
    if cfg.agent_log_json:
        logger.log(level, json.dumps(payload, ensure_ascii=True, default=str))
        return
    palette = _resolve_palette(cfg, logger)
    lifecycle_block = _capture_lifecycle_block(payload)
    logger.log(level, _render_event_block(payload, palette=palette))
    if lifecycle_block:
        logger.log(level, _render_lifecycle_block(lifecycle_block, palette=palette))


def get_progress_trace_events(
    *,
    session_id: str,
    trace_id: str,
    after_seq: int = 0,
    limit: int = 50,
    detail: str = 'verbose',
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    cfg = settings or get_settings()
    if not cfg.agent_progress_events_enabled:
        return None

    normalized_after_seq = max(0, int(after_seq))
    normalized_limit = max(1, min(int(limit), 200))
    normalized_detail = _normalize_progress_detail_mode(detail)
    verbose_allowed = bool(cfg.agent_progress_events_allow_verbose)
    include_verbose_details = normalized_detail == 'verbose' and verbose_allowed

    now = time.monotonic()
    with _PROGRESS_EVENT_LOCK:
        _evict_expired_progress_traces(now)
        trace = _PROGRESS_TRACES.get(trace_id)
        if trace is None:
            return None
        if trace.session_id is not None and trace.session_id != session_id:
            return None

        filtered_events = [
            event for event in trace.events if event.seq > normalized_after_seq
        ][:normalized_limit]
        events_payload = [
            _serialize_progress_trace_event(
                event,
                include_verbose_details=include_verbose_details,
            )
            for event in filtered_events
        ]
        next_seq = (
            filtered_events[-1].seq
            if filtered_events
            else normalized_after_seq
        )
        response: dict[str, Any] = {
            'trace_id': trace.trace_id,
            'session_id': trace.session_id,
            'roadmap_id': trace.roadmap_id,
            'events': events_payload,
            'next_seq': next_seq,
            'done': trace.done,
            'started_at': trace.started_at,
            'completed_at': trace.completed_at,
        }
        elapsed_ms = _compute_progress_elapsed_ms(trace)
        if elapsed_ms is not None:
            response['elapsed_ms'] = elapsed_ms
        return response


def _sanitize_result_title(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = ' '.join(value.split())
    if not normalized:
        return None
    return normalized[:180]


def _extract_result_titles(result: dict[str, Any]) -> dict[str, Any] | None:
    title_source_keys = ('tasks', 'matches', 'children', 'epics', 'items')
    for key in title_source_keys:
        raw_items = result.get(key)
        if not isinstance(raw_items, list):
            continue
        titles: list[str] = []
        seen: set[str] = set()
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            title = _sanitize_result_title(item.get('title'))
            if title is None or title in seen:
                continue
            seen.add(title)
            titles.append(title)
        if not titles:
            continue

        shown = titles[:_MAX_PROGRESS_TITLE_ITEMS]
        total_count = len(titles)
        shown_count = len(shown)
        return {
            'item_titles': shown,
            'item_titles_source': key,
            'item_titles_shown_count': shown_count,
            'item_titles_total_count': total_count,
            'item_titles_has_more': total_count > shown_count,
        }
    return None


def summarize_tool_result(result: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {'result_type': 'dict'}
    if 'error' in result and isinstance(result.get('error'), dict):
        error = result.get('error', {})
        summary['error_code'] = error.get('code')
        return summary

    for key in ('matches', 'children', 'epics', 'operations', 'tasks', 'items'):
        value = result.get(key)
        if isinstance(value, list):
            summary[f'{key}_count'] = len(value)
    if 'type' in result:
        summary['node_type'] = result.get('type')
    titles_payload = _extract_result_titles(result)
    if isinstance(titles_payload, dict):
        summary.update(titles_payload)
    if not summary:
        summary['keys'] = sorted(result.keys())
    return summary


def _capture_progress_event(payload: dict[str, Any], *, settings: Settings) -> None:
    if not settings.agent_progress_events_enabled:
        return

    trace_id = _text_or_none(payload.get('trace_id'))
    if trace_id is None:
        return

    event = str(payload.get('event') or '').strip().lower()
    if event not in _PROGRESS_EVENT_ALLOWLIST:
        return

    details = _build_progress_event_details(payload)
    now = time.monotonic()
    with _PROGRESS_EVENT_LOCK:
        _evict_expired_progress_traces(now)
        trace = _PROGRESS_TRACES.get(trace_id)
        if trace is None:
            trace = _ProgressTrace(
                trace_id=trace_id,
                created_monotonic=now,
                last_seen_monotonic=now,
            )
            _PROGRESS_TRACES[trace_id] = trace
        trace.last_seen_monotonic = now
        _apply_progress_trace_metadata(trace, payload)

        progress_event = _ProgressTraceEvent(
            seq=trace.next_seq,
            ts=str(payload.get('ts') or datetime.now(timezone.utc).isoformat()),
            event=event,
            title=_progress_event_title(event),
            status=_progress_event_status(event, payload),
            summary=_progress_event_summary(event, payload),
            details=details,
        )
        trace.next_seq += 1
        trace.events.append(progress_event)
        if len(trace.events) > _MAX_PROGRESS_EVENTS_PER_TRACE:
            trace.events = trace.events[-_MAX_PROGRESS_EVENTS_PER_TRACE:]
        _update_progress_trace_completion(trace, event, payload)


def _evict_expired_progress_traces(now: float) -> None:
    expired: list[str] = []
    for trace_id, trace in _PROGRESS_TRACES.items():
        if now - trace.last_seen_monotonic > _PROGRESS_EVENT_TRACE_TTL_SECONDS:
            expired.append(trace_id)
    for trace_id in expired:
        _PROGRESS_TRACES.pop(trace_id, None)


def _apply_progress_trace_metadata(trace: _ProgressTrace, payload: dict[str, Any]) -> None:
    trace.session_id = _text_or_none(payload.get('session_id')) or trace.session_id
    trace.roadmap_id = _text_or_none(payload.get('roadmap_id')) or trace.roadmap_id
    payload_ts = _text_or_none(payload.get('ts'))
    if trace.started_at is None and payload_ts is not None:
        trace.started_at = payload_ts
    if str(payload.get('event') or '').strip().lower() == 'message_received' and payload_ts is not None:
        trace.started_at = payload_ts


def _update_progress_trace_completion(
    trace: _ProgressTrace,
    event: str,
    payload: dict[str, Any],
) -> None:
    payload_ts = _text_or_none(payload.get('ts'))
    if event == 'message_completed':
        if payload_ts is not None:
            trace.completed_at = payload_ts
        auto_commit_async_enqueued = payload.get('auto_commit_async_enqueued')
        trace.done = not bool(auto_commit_async_enqueued)
        return
    if event in {'auto_commit_async_completed', 'auto_commit_async_failed'}:
        if payload_ts is not None:
            trace.completed_at = payload_ts
        trace.done = True


def _serialize_progress_trace_event(
    event: _ProgressTraceEvent,
    *,
    include_verbose_details: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'seq': event.seq,
        'ts': event.ts,
        'event': event.event,
        'title': event.title,
        'status': event.status,
        'summary': event.summary,
    }
    if event.details:
        details = (
            event.details
            if include_verbose_details
            else _to_structured_progress_details(event.event, event.details)
        )
        if details:
            payload['details'] = details
    return payload


def _to_structured_progress_details(event: str, details: dict[str, Any]) -> dict[str, Any] | None:
    if event == 'tool_call_requested':
        return _pick_progress_detail_fields(details, ('tool_name', 'arg_keys', 'tool_args'))
    if event == 'tool_call_result':
        return _pick_progress_detail_fields(
            details,
            ('tool_name', 'result_summary', 'tool_error_code'),
        )
    if event in {'provider_attempt', 'provider_success', 'provider_failure'}:
        return _pick_progress_detail_fields(
            details,
            ('provider', 'phase', 'error_code', 'tokens_input', 'tokens_output', 'tokens_total'),
        )
    if event == 'session_staged_state':
        return _pick_progress_detail_fields(
            details,
            (
                'response_mode',
                'staged_operations_count',
                'staged_operations_version',
                'stop_reason',
                'react_terminal_action',
            ),
        )
    if event == 'message_completed':
        return _pick_progress_detail_fields(
            details,
            (
                'response_mode',
                'parse_mode',
                'operations_count',
                'elapsed_ms',
                'provider_used',
                'provider_error_code',
                'error_code',
            ),
        )
    if event in {'auto_commit_async_completed', 'auto_commit_async_failed'}:
        return _pick_progress_detail_fields(
            details,
            (
                'auto_commit_ms',
                'elapsed_ms',
                'staged_operations_count',
                'auto_commit_error_code',
                'auto_commit_error_message',
                'auto_commit_error_upstream_status',
                'auto_commit_invalid_operation',
            ),
        )
    if event == 'intent_classified':
        return _pick_progress_detail_fields(details, ('intent_type', 'parse_mode', 'is_roadmap_question'))
    if event == 'route_selected':
        return _pick_progress_detail_fields(details, ('response_mode', 'tool_mode', 'intent_type'))
    if event == 'message_received':
        return _pick_progress_detail_fields(details, ('message', 'roadmap_role', 'actor_present'))
    if event == 'plan_generated':
        return _pick_progress_detail_fields(details, ('operations_count', 'operation_types', 'provider_used'))
    return _pick_progress_detail_fields(details, ('summary',))


def _pick_progress_detail_fields(
    details: dict[str, Any],
    keys: tuple[str, ...],
) -> dict[str, Any] | None:
    picked: dict[str, Any] = {}
    for key in keys:
        if key in details and details[key] is not None:
            picked[key] = details[key]
    return picked or None


def _build_progress_event_details(payload: dict[str, Any]) -> dict[str, Any] | None:
    details = {
        key: value
        for key, value in payload.items()
        if key not in {'event', 'trace_id'}
    }
    if not details:
        return None
    trimmed = _trim_progress_details(details, depth=0)
    if isinstance(trimmed, dict):
        return trimmed
    return None


def _trim_progress_details(value: Any, *, depth: int) -> Any:
    if depth >= _MAX_PROGRESS_DETAIL_DEPTH:
        return '[TRUNCATED]'

    if isinstance(value, dict):
        trimmed: dict[str, Any] = {}
        for key in _ordered_mapping_keys(value):
            trimmed[key] = _trim_progress_details(value[key], depth=depth + 1)
        return trimmed

    if isinstance(value, list):
        items = value[:_MAX_PROGRESS_LIST_ITEMS]
        trimmed_list = [_trim_progress_details(item, depth=depth + 1) for item in items]
        if len(value) > _MAX_PROGRESS_LIST_ITEMS:
            trimmed_list.append(
                f'...({len(value) - _MAX_PROGRESS_LIST_ITEMS} more items)'
            )
        return trimmed_list

    if isinstance(value, str) and len(value) > _MAX_PROGRESS_TEXT_LENGTH:
        return f'{value[:_MAX_PROGRESS_TEXT_LENGTH]}...'
    return value


def _normalize_progress_detail_mode(detail: str) -> str:
    normalized = str(detail or 'verbose').strip().lower()
    if normalized not in {'verbose', 'structured'}:
        return 'verbose'
    return normalized


def _progress_event_title(event: str) -> str:
    titles = {
        'message_received': 'Message received',
        'actor_context_loaded': 'Actor context loaded',
        'intent_classified': 'Intent classified',
        'route_selected': 'Route selected',
        'provider_attempt': 'Provider attempt',
        'provider_success': 'Provider completed',
        'provider_failure': 'Provider failed',
        'tool_call_requested': 'Tool call requested',
        'tool_call_result': 'Tool call result',
        'plan_generated': 'Plan generated',
        'session_staged_state': 'Session staged',
        'message_completed': 'Message completed',
        'auto_commit_async_completed': 'Auto-commit completed',
        'auto_commit_async_failed': 'Auto-commit failed',
    }
    return titles.get(event, event.replace('_', ' '))


def _progress_event_status(event: str, payload: dict[str, Any]) -> str:
    if event in {'provider_failure', 'auto_commit_async_failed'}:
        return 'error'
    if event == 'tool_call_result' and payload.get('tool_error_code'):
        return 'error'
    if event == 'message_completed':
        if payload.get('error_code') or payload.get('provider_error_code'):
            return 'error'
        return 'success'
    if event in {
        'provider_success',
        'tool_call_result',
        'plan_generated',
        'session_staged_state',
        'auto_commit_async_completed',
    }:
        return 'success'
    return 'running'


def _progress_event_summary(event: str, payload: dict[str, Any]) -> str:
    if event == 'message_received':
        return f'Received user message: {_progress_message_preview(payload.get("message"))}'
    if event == 'actor_context_loaded':
        role = payload.get('roadmap_role')
        source = payload.get('actor_context_source')
        if role and source:
            return f'Loaded actor context ({role}) from {source}.'
        return 'Loaded actor context.'
    if event == 'intent_classified':
        intent = payload.get('intent_type')
        return f'Classified intent as {intent}.' if intent else 'Classified user intent.'
    if event == 'route_selected':
        mode = payload.get('response_mode')
        tool_mode = payload.get('tool_mode')
        if mode and tool_mode:
            return f'Routed request to {mode} using {tool_mode}.'
        if mode:
            return f'Routed request to {mode}.'
        return 'Selected execution route.'
    if event == 'provider_attempt':
        provider = payload.get('provider')
        phase = payload.get('phase')
        if provider and phase:
            return f'Started provider call to {provider} ({phase}).'
        return 'Started provider call.'
    if event == 'provider_success':
        provider = payload.get('provider')
        return (
            f'Provider {provider} completed successfully.'
            if provider
            else 'Provider call completed successfully.'
        )
    if event == 'provider_failure':
        provider = payload.get('provider')
        error_code = payload.get('error_code')
        if provider and error_code:
            return f'Provider {provider} failed with {error_code}.'
        if provider:
            return f'Provider {provider} failed.'
        return 'Provider call failed.'
    if event == 'tool_call_requested':
        tool_name = payload.get('tool_name')
        return f'Calling tool {tool_name}.' if tool_name else 'Calling tool.'
    if event == 'tool_call_result':
        tool_name = payload.get('tool_name')
        tool_error = payload.get('tool_error_code')
        result_summary = payload.get('result_summary')
        if tool_error:
            return (
                f'Tool {tool_name} failed with {tool_error}.'
                if tool_name
                else f'Tool failed with {tool_error}.'
            )
        suffix = ''
        if isinstance(result_summary, dict):
            compact = ', '.join(
                f'{key}={value}'
                for key, value in result_summary.items()
                if value is not None
            )
            if compact:
                suffix = f' ({compact})'
        return (
            f'Tool {tool_name} completed{suffix}.'
            if tool_name
            else f'Tool call completed{suffix}.'
        )
    if event == 'plan_generated':
        operations_count = payload.get('operations_count')
        if operations_count is not None:
            return f'Generated plan with {operations_count} operations.'
        return 'Generated operation plan.'
    if event == 'session_staged_state':
        staged_count = payload.get('staged_operations_count')
        stop_reason = payload.get('stop_reason')
        if staged_count is not None and stop_reason:
            return f'Staged {staged_count} operations ({stop_reason}).'
        if staged_count is not None:
            return f'Staged {staged_count} operations.'
        return 'Updated staged session state.'
    if event == 'message_completed':
        elapsed_ms = payload.get('elapsed_ms')
        response_mode = payload.get('response_mode')
        if elapsed_ms is not None and response_mode:
            return f'Completed {response_mode} response in {elapsed_ms} ms.'
        if elapsed_ms is not None:
            return f'Completed response in {elapsed_ms} ms.'
        return 'Completed assistant response.'
    if event == 'auto_commit_async_completed':
        auto_commit_ms = payload.get('auto_commit_ms')
        if auto_commit_ms is not None:
            return f'Auto-commit completed in {auto_commit_ms} ms.'
        return 'Auto-commit completed.'
    if event == 'auto_commit_async_failed':
        error_code = payload.get('auto_commit_error_code')
        if error_code:
            return f'Auto-commit failed with {error_code}.'
        return 'Auto-commit failed.'
    return event.replace('_', ' ')


def _progress_message_preview(value: Any) -> str:
    if isinstance(value, dict):
        preview = value.get('preview')
        if isinstance(preview, str) and preview.strip():
            return f'"{preview}"'
        length = value.get('len')
        if isinstance(length, int):
            return f'(len={length})'
    if isinstance(value, str):
        compact = ' '.join(value.split())
        return f'"{compact[:120]}"'
    return 'message'


def _compute_progress_elapsed_ms(trace: _ProgressTrace) -> int | None:
    if trace.started_at is None:
        return None
    end_ts = trace.completed_at
    if end_ts is None:
        if trace.done:
            end_ts = trace.started_at
        else:
            return None
    try:
        start_dt = datetime.fromisoformat(trace.started_at.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_ts.replace('Z', '+00:00'))
    except ValueError:
        return None
    return max(0, int((end_dt - start_dt).total_seconds() * 1000))


def _sanitize(value: Any, *, include_content: bool) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            lowered = key.lower()
            if lowered in _SENSITIVE_KEYS:
                out[key] = '[REDACTED]'
                continue
            if lowered in _CONTENT_KEYS and not include_content and isinstance(item, str):
                out[key] = _truncate(item)
                continue
            out[key] = _sanitize(item, include_content=include_content)
        return out
    if isinstance(value, list):
        return [_sanitize(item, include_content=include_content) for item in value]
    if isinstance(value, str) and not include_content and len(value) > 400:
        return _truncate(value)
    return value


def _truncate(text: str) -> dict[str, Any]:
    cleaned = ' '.join(text.split())
    return {
        'len': len(text),
        'preview': cleaned[:120],
    }


def _render_event_block(payload: dict[str, Any], *, palette: _AnsiPalette) -> str:
    event = str(payload.get('event', 'event')).upper()
    divider = '-' * 62
    lines = [
        palette.separator(divider),
        palette.event_header(f'EVENT: {event}'),
        palette.separator(divider),
        '',
    ]
    for key in _ordered_keys(payload):
        if key == 'event':
            continue
        _append_event_field(lines, key, payload[key], indent=2)
    lines.extend(['', palette.separator(divider)])
    return '\n'.join(lines)


def _capture_lifecycle_block(payload: dict[str, Any]) -> str | None:
    trace_id = payload.get('trace_id')
    if not isinstance(trace_id, str) or not trace_id.strip():
        return None
    event = str(payload.get('event') or '')
    now = time.monotonic()
    with _TRACE_LOCK:
        _evict_expired_traces(now)
        trace = _LIFECYCLE_TRACES.get(trace_id)
        if event == 'message_received' or trace is None:
            trace = _LifecycleTrace(
                trace_id=trace_id,
                created_monotonic=now,
                last_seen_monotonic=now,
            )
            _LIFECYCLE_TRACES[trace_id] = trace
        trace.last_seen_monotonic = now
        _apply_lifecycle_payload(trace, payload)
        if event != 'message_completed':
            return None
        block = _build_lifecycle_block(trace)
        _LIFECYCLE_TRACES.pop(trace_id, None)
        return block


def _evict_expired_traces(now: float) -> None:
    expired: list[str] = []
    for trace_id, trace in _LIFECYCLE_TRACES.items():
        if now - trace.last_seen_monotonic > _LIFECYCLE_TRACE_TTL_SECONDS:
            expired.append(trace_id)
    for trace_id in expired:
        _LIFECYCLE_TRACES.pop(trace_id, None)


def _apply_lifecycle_payload(trace: _LifecycleTrace, payload: dict[str, Any]) -> None:
    event = str(payload.get('event') or '')
    if payload.get('parse_mode') is not None:
        trace.routing['parse_mode'] = payload.get('parse_mode')
    elif event.startswith('context_'):
        trace.routing['parse_mode'] = event
    trace.session_id = _text_or_none(payload.get('session_id')) or trace.session_id
    trace.roadmap_id = _text_or_none(payload.get('roadmap_id')) or trace.roadmap_id
    trace.actor = {
        **trace.actor,
        **{
            'source': payload.get('actor_context_source'),
            'present': payload.get('actor_present'),
            'role': payload.get('roadmap_role'),
        },
    }
    if event == 'message_received':
        trace.request = {
            'message': payload.get('message'),
            'replace_operations': payload.get('replace_operations'),
            'ts': payload.get('ts'),
        }
        return
    if event == 'intent_classified':
        trace.routing['classified'] = payload.get('intent_type')
        trace.routing['is_roadmap_question'] = payload.get('is_roadmap_question')
        trace.routing['parse_mode'] = payload.get('parse_mode')
        return
    if event == 'route_selected':
        trace.routing['mode'] = payload.get('response_mode')
        trace.routing['tool_mode'] = payload.get('tool_mode')
        trace.routing['intent_type'] = payload.get('intent_type')
        return
    if event == 'tool_call_requested':
        tool_entry = {
            'tool_name': payload.get('tool_name'),
            'tool_args': payload.get('tool_args'),
            'arg_keys': payload.get('arg_keys'),
            'requested_ts': payload.get('ts'),
            'result_summary': None,
            'tool_error_code': None,
        }
        trace.tools.append(tool_entry)
        if len(trace.tools) > _MAX_TOOL_CALLS_PER_TRACE:
            trace.tools = trace.tools[-_MAX_TOOL_CALLS_PER_TRACE:]
        return
    if event == 'tool_call_result':
        tool_name = payload.get('tool_name')
        target = _find_latest_tool_entry(trace.tools, tool_name)
        if target is None:
            target = {
                'tool_name': tool_name,
                'tool_args': None,
                'arg_keys': None,
                'requested_ts': None,
                'result_summary': None,
                'tool_error_code': None,
            }
            trace.tools.append(target)
        target['result_summary'] = payload.get('result_summary')
        target['tool_error_code'] = payload.get('tool_error_code')
        if payload.get('resolution_id') is not None:
            target['resolution_id'] = payload.get('resolution_id')
        return
    if event == 'llm_planned_operation':
        trace.llm_operations.append(
            {
                'operation_index': payload.get('operation_index'),
                'operation': payload.get('operation'),
                'provider_used': payload.get('provider_used'),
            }
        )
        return
    if event == 'operation_contract_validation_failed':
        trace.response['operation_validation_error'] = payload.get('validation_error')
        return
    if event in {'provider_attempt', 'provider_success', 'provider_failure'}:
        trace.response['provider_event'] = event
        trace.response['provider'] = payload.get('provider')
        trace.response['phase'] = payload.get('phase')
        trace.response['provider_error_code'] = payload.get('error_code') or payload.get(
            'provider_error_code'
        )
        trace.response['tokens_input'] = payload.get('tokens_input')
        trace.response['tokens_output'] = payload.get('tokens_output')
        trace.response['tokens_total'] = payload.get('tokens_total')
        trace.response['fallback_used'] = payload.get('fallback_used')
        return
    if event == 'message_completed':
        trace.response = {
            **trace.response,
            **{
                'provider_used': payload.get('provider_used'),
                'fallback_used': payload.get('fallback_used'),
                'provider_error_code': payload.get('provider_error_code'),
                'elapsed_ms': payload.get('elapsed_ms'),
                'staged_changes_present': (
                    payload.get('staged_changes_present')
                    if payload.get('staged_changes_present') is not None
                    else payload.get('preview_available')
                ),
                'operations_count': payload.get('operations_count'),
                'artifacts_count': payload.get('artifacts_count'),
                'route_lane': payload.get('route_lane'),
                'discovery_stop_reason': payload.get('discovery_stop_reason'),
                'stop_reason': payload.get('stop_reason'),
                'react_terminal_action': payload.get('react_terminal_action'),
                'react_loop_turns': payload.get('react_loop_turns'),
                'react_loop_budget': payload.get('react_loop_budget'),
                'react_loop_termination_reason': payload.get('react_loop_termination_reason'),
                'clarifier_returned': payload.get('clarifier_returned'),
                'edit_guard_intervened': payload.get('edit_guard_intervened'),
                'retry_tool_calls_used': payload.get('retry_tool_calls_used'),
                'retry_duplicate_operation_deduped': payload.get(
                    'retry_duplicate_operation_deduped'
                ),
                'retry_autostage_applied': payload.get('retry_autostage_applied'),
                'tokens_input': payload.get('tokens_input'),
                'tokens_output': payload.get('tokens_output'),
                'tokens_total': payload.get('tokens_total'),
            },
        }
        trace.routing['intent_type'] = payload.get('intent_type') or trace.routing.get('intent_type')
        trace.routing['mode'] = payload.get('response_mode') or trace.routing.get('mode')
        trace.routing['parse_mode'] = payload.get('parse_mode') or trace.routing.get('parse_mode')
        trace.assistant = {'assistant_message': payload.get('assistant_message')}


def _find_latest_tool_entry(
    tools: list[dict[str, Any]],
    tool_name: Any,
) -> dict[str, Any] | None:
    for tool in reversed(tools):
        if tool.get('tool_name') == tool_name and tool.get('result_summary') is None:
            return tool
    return None


def _build_lifecycle_block(trace: _LifecycleTrace) -> str:
    sep = '-' * 78
    title = _lifecycle_title(trace)
    lines = [
        sep,
        f'AI REQUEST: {title}',
        sep,
        f'trace_id     {trace.trace_id}',
        f'session_id   {trace.session_id or "-"}',
        f'roadmap_id   {trace.roadmap_id or "-"}',
        '',
        'USER',
        f'  {_format_message_summary(trace.request.get("message"))}',
        '',
        'ACTOR',
        f'  source      {trace.actor.get("source")}',
        f'  present     {_yes_no(trace.actor.get("present"))}',
        f'  role        {trace.actor.get("role")}',
        '',
        'ROUTING',
        f'  classified  {trace.routing.get("classified")}',
        f'  mode        {trace.routing.get("mode")}',
        f'  tool_mode   {trace.routing.get("tool_mode")}',
        f'  recovery    parse_mode: {trace.routing.get("parse_mode")}',
        '',
        'TOOL CALL',
    ]
    lines.extend(_render_tool_calls(trace.tools))
    lines.extend(['', 'LLM OPERATIONS'])
    lines.extend(_render_llm_operations(trace.llm_operations))
    lines.extend(
        [
            '',
            'RESPONSE',
            f'  provider    {trace.response.get("provider_used") or trace.response.get("provider")}',
            f'  fallback    {_yes_no(trace.response.get("fallback_used"))}',
            f'  staged      {_yes_no(trace.response.get("staged_changes_present"))}',
            f'  ops         {trace.response.get("operations_count")}',
            f'  elapsed     {trace.response.get("elapsed_ms")} ms',
            f'  lane        {trace.response.get("route_lane")}',
            f'  stop        {trace.response.get("stop_reason") or trace.response.get("discovery_stop_reason")}',
            f'  action      {trace.response.get("react_terminal_action")}',
            f'  react_loop  turns={trace.response.get("react_loop_turns")} budget={trace.response.get("react_loop_budget")} end={trace.response.get("react_loop_termination_reason")}',
            f'  clarifier   {_yes_no(trace.response.get("clarifier_returned"))}',
            f'  guard       {_yes_no(trace.response.get("edit_guard_intervened"))}',
            f'  retry_calls {trace.response.get("retry_tool_calls_used")}',
            f'  retry_dedupe {_yes_no(trace.response.get("retry_duplicate_operation_deduped"))}',
            f'  retry_auto  {_yes_no(trace.response.get("retry_autostage_applied"))}',
            f'  validation  {trace.response.get("operation_validation_error")}',
            f'  tokens      in={trace.response.get("tokens_input")} out={trace.response.get("tokens_output")} total={trace.response.get("tokens_total")}',
            '',
            'ASSISTANT',
            f'  {_format_message_summary(trace.assistant.get("assistant_message"))}',
            sep,
        ]
    )
    return '\n'.join(lines)


def _render_lifecycle_block(block: str, *, palette: _AnsiPalette) -> str:
    if not block:
        return block
    lines = block.split('\n')
    rendered: list[str] = []
    for line in lines:
        if line.startswith('EVENT: '):
            rendered.append(palette.event_header(line))
            continue
        if line.startswith('AI REQUEST: '):
            rendered.append(palette.lifecycle_header(line))
            continue
        if line and all(char == '-' for char in line):
            rendered.append(palette.separator(line))
            continue
        rendered.append(line)
    return '\n'.join(rendered)


def _render_tool_calls(tools: list[dict[str, Any]]) -> list[str]:
    if not tools:
        return ['  none']
    rendered: list[str] = []
    for index, tool in enumerate(tools, start=1):
        rendered.append(f'  {index}. {tool.get("tool_name")}')
        args = tool.get('tool_args')
        if isinstance(args, dict) and args:
            for key in sorted(args.keys()):
                rendered.append(f'     - {key}: {args.get(key)}')
        result_summary = tool.get('result_summary')
        if isinstance(result_summary, dict) and result_summary:
            rendered.append('     - result:')
            for key in sorted(result_summary.keys()):
                rendered.append(f'       - {key}: {result_summary.get(key)}')
        if tool.get('tool_error_code'):
            rendered.append(f'     - tool_error_code: {tool.get("tool_error_code")}')
    return rendered


def _render_llm_operations(operations: list[dict[str, Any]]) -> list[str]:
    if not operations:
        return ['  none']
    rendered: list[str] = []
    for item in operations:
        operation_index = item.get('operation_index')
        operation_payload = item.get('operation')
        rendered.append(f'  {operation_index}:')
        if isinstance(operation_payload, dict):
            for key in sorted(operation_payload.keys()):
                rendered.append(f'     - {key}: {operation_payload.get(key)}')
        else:
            rendered.append(f'     - payload: {operation_payload}')
    return rendered


def _lifecycle_title(trace: _LifecycleTrace) -> str:
    parse_mode = str(trace.routing.get('parse_mode') or '').strip().lower()
    intent_type = str(trace.routing.get('intent_type') or '').strip()
    title_from_mode = _title_from_parse_mode(parse_mode)
    if title_from_mode is not None:
        return title_from_mode
    if intent_type:
        return intent_type.replace('_', ' ').upper()
    return 'REQUEST'


def _title_from_parse_mode(parse_mode: str) -> str | None:
    if not parse_mode:
        return None
    if 'my_tasks' in parse_mode:
        return 'MY TASKS'
    if 'overview' in parse_mode:
        return 'ROADMAP OVERVIEW'
    if parse_mode.endswith('_context_tools'):
        return 'CONTEXT TOOLS'
    if parse_mode.startswith('context_'):
        label = parse_mode.removeprefix('context_')
        return label.replace('_', ' ').upper()
    return None


def _format_message_summary(value: Any) -> str:
    if isinstance(value, dict):
        preview = value.get('preview')
        length = value.get('len')
        if preview is not None and length is not None:
            return f'"{preview}" (len={length})'
        return json.dumps(value, ensure_ascii=True, default=str)
    if value is None:
        return '-'
    return f'"{value}"'


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _yes_no(value: Any) -> str:
    if value is True:
        return 'yes'
    if value is False:
        return 'no'
    return str(value)


def _ordered_keys(payload: dict[str, Any]) -> list[str]:
    priorities = {key: index for index, key in enumerate(_KEY_PRIORITY)}
    return sorted(
        payload.keys(),
        key=lambda key: (priorities.get(key, len(_KEY_PRIORITY)), key),
    )


def _append_event_field(lines: list[str], key: str, value: Any, *, indent: int) -> None:
    prefix = ' ' * indent
    if isinstance(value, dict):
        lines.append(f'{prefix}{key}:')
        for child_key in _ordered_mapping_keys(value):
            _append_event_field(lines, child_key, value[child_key], indent=indent + 2)
        return

    if isinstance(value, list):
        if not value:
            lines.append(f'{prefix}{key}: []')
            return
        lines.append(f'{prefix}{key}:')
        for item in value:
            _append_event_list_item(lines, item, indent=indent + 2)
        return

    lines.append(f'{prefix}{key}: {value}')


def _append_event_list_item(lines: list[str], value: Any, *, indent: int) -> None:
    prefix = ' ' * indent
    if isinstance(value, dict):
        lines.append(f'{prefix}-')
        for key in _ordered_mapping_keys(value):
            _append_event_field(lines, key, value[key], indent=indent + 2)
        return

    if isinstance(value, list):
        if not value:
            lines.append(f'{prefix}- []')
            return
        lines.append(f'{prefix}-')
        for item in value:
            _append_event_list_item(lines, item, indent=indent + 2)
        return

    lines.append(f'{prefix}- {value}')


def _ordered_mapping_keys(value: dict[str, Any]) -> list[str]:
    return sorted(value.keys())


def _resolve_palette(cfg: Settings, logger: logging.Logger) -> _AnsiPalette:
    mode = _normalize_log_color_mode(getattr(cfg, 'agent_log_color', 'auto'))
    if mode == 'off':
        return _AnsiPalette(enabled=False)
    if mode == 'on':
        return _AnsiPalette(enabled=True)
    return _AnsiPalette(enabled=_is_logger_tty(logger))


def _normalize_log_color_mode(value: Any) -> str:
    normalized = str(value or 'auto').strip().lower()
    if normalized not in {'auto', 'on', 'off'}:
        return 'auto'
    return normalized


def _is_logger_tty(logger: logging.Logger) -> bool:
    for handler in logger.handlers:
        stream = getattr(handler, 'stream', None)
        if stream is None:
            continue
        isatty = getattr(stream, 'isatty', None)
        if callable(isatty):
            try:
                if isatty():
                    return True
            except Exception:
                continue
    return False
