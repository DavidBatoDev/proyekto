from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.core import realtime_push
from app.core.trace import store as trace_store
from app.core.trace.store import PROGRESS_EVENT_ALLOWLIST, TraceEvent
from app.core.trace_context import get_trace_fields

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

# Progress-trace storage lives in app/core/trace/store.py (Redis-backed with a
# per-process active buffer). The allowlist and event shape are re-exported
# here because the presentation helpers below (title/status/summary/detail
# picking) are what the store renders with.
_PROGRESS_EVENT_ALLOWLIST = PROGRESS_EVENT_ALLOWLIST
_ProgressTraceEvent = TraceEvent


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
    fmt = '%(message)s' if cfg.agent_log_json else '%(asctime)s %(levelname)s %(name)s %(message)s'
    formatter = logging.Formatter(fmt)

    handlers: list[logging.Handler] = []
    log_file_raw = (cfg.agent_log_file or '').strip() if cfg.agent_log_file else ''
    if log_file_raw:
        file_path = Path(log_file_raw).expanduser()
        if not file_path.is_absolute():
            file_path = Path(os.getcwd()) / file_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(file_path, mode='a', encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)

    if cfg.agent_log_to_console or not handlers:
        stream_handler = logging.StreamHandler()
        stream_handler.setLevel(level)
        stream_handler.setFormatter(formatter)
        handlers.append(stream_handler)

    logging.basicConfig(
        level=level,
        handlers=handlers,
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
    # Auto-populate trace correlation fields from contextvars when the caller
    # did not pass them explicitly. An explicit None is treated as "omit"
    # (matches pre-contextvars behavior where missing fields were not logged).
    for field_name, field_value in get_trace_fields().items():
        if field_value is None:
            continue
        if field_name not in data or data[field_name] is None:
            data[field_name] = field_value
    payload = {
        'ts': datetime.now(timezone.utc).isoformat(),
        'event': event,
        **_sanitize(data, include_content=cfg.agent_log_include_content),
    }
    # Enqueue-only on the calling thread; the trace store flushes to Redis
    # from worker threads (never inline on the event loop).
    trace_store.capture(payload, cfg)
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
    """Compatibility wrapper over ``trace.store.read`` (same semantics).

    Synchronous; may read Redis when this process does not hold the trace —
    route handlers call it through ``run_store_call``.
    """
    return trace_store.read(
        session_id=session_id,
        trace_id=trace_id,
        after_seq=after_seq,
        limit=limit,
        detail=detail,
        settings=settings or get_settings(),
    )


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


def _serialize_progress_trace_event(
    event: TraceEvent,
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
    if event == 'assistant_delta':
        return _pick_progress_detail_fields(details, ('text', 'turn', 'delta_seq'))
    if event == 'assistant_thought':
        return _pick_progress_detail_fields(details, ('text', 'turn', 'thought_seq'))
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
            (
                'provider',
                'phase',
                'error_code',
                'tokens_input',
                'tokens_output',
                'tokens_total',
                'tokens_cached',
            ),
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
    if event == 'run_started':
        return _pick_progress_detail_fields(
            details,
            ('run_id', 'phase', 'step', 'scope_kind', 'refs_count'),
        )
    if event == 'phase_entered':
        return _pick_progress_detail_fields(
            details,
            ('phase', 'step', 'commits_done', 'commits_total'),
        )
    if event == 'phase_completed':
        return _pick_progress_detail_fields(details, ('phase', 'step', 'outcome'))
    if event == 'run_step_completed':
        return _pick_progress_detail_fields(
            details,
            (
                'run_id',
                'phase',
                'step',
                'run_next',
                'run_status',
                'checkpoint',
                'elapsed_ms',
            ),
        )
    if event == 'run_checkpoint':
        return _pick_progress_detail_fields(
            details,
            ('run_id', 'phase', 'checkpoint', 'plan_id'),
        )
    if event == 'refs_resolved':
        return _pick_progress_detail_fields(
            details,
            (
                'refs_total',
                'refs_accessible',
                'refs_inaccessible',
                'loaded_roadmap_ids',
            ),
        )
    if event == 'commit_started':
        return _pick_progress_detail_fields(
            details,
            ('roadmap_id', 'roadmap_title', 'batch_id', 'operations_count', 'attempt'),
        )
    if event == 'commit_completed':
        return _pick_progress_detail_fields(
            details,
            (
                'roadmap_id',
                'roadmap_title',
                'batch_id',
                'change_id',
                'operations_count',
                'commit_ms',
                'impacted_item_count',
                'impacted_summary',
                'impacted_items',
                'history_recorded',
            ),
        )
    if event == 'commit_failed':
        return _pick_progress_detail_fields(
            details,
            (
                'roadmap_id',
                'roadmap_title',
                'batch_id',
                'error_code',
                'error_message',
                'upstream_status',
                'invalid_operation',
                'attempt',
                'impacted_items',
            ),
        )
    if event == 'verify_completed':
        return _pick_progress_detail_fields(
            details,
            (
                'status',
                'summary_text',
                'checks',
                'follow_up_plan_id',
                'commits_total',
                'commits_committed',
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
    if event == 'planner_summary':
        return _pick_progress_detail_fields(
            details,
            (
                'summary_text',
                'summary_source',
                'response_mode',
                'operations_count',
                'operation_types',
            ),
        )
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
    # owner_key is trace metadata (the session owner's forwarded identity),
    # consumed by the trace store — never rendered as event detail.
    details = {
        key: value
        for key, value in payload.items()
        if key not in {'event', 'trace_id', 'owner_key'}
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
        'planner_summary': 'Planner summary',
        'plan_generated': 'Plan generated',
        'session_staged_state': 'Session staged',
        'message_completed': 'Message completed',
        'assistant_delta': 'Assistant writing',
        'assistant_thought': 'Thinking',
        # Run lifecycle (hidden in the web timeline).
        'run_started': 'Run started',
        'phase_entered': 'Phase started',
        'phase_completed': 'Phase completed',
        'run_step_completed': 'Step completed',
        'run_checkpoint': 'Waiting for input',
        'refs_resolved': 'References resolved',
        # Curated rows.
        'commit_started': 'Committing changes',
        'commit_completed': 'Changes committed',
        'commit_failed': 'Commit failed',
        'verify_completed': 'Verification completed',
    }
    return titles.get(event, event.replace('_', ' '))


def _progress_event_status(event: str, payload: dict[str, Any]) -> str:
    if event in {'provider_failure', 'commit_failed'}:
        return 'error'
    if event == 'tool_call_result' and payload.get('tool_error_code'):
        return 'error'
    if event == 'message_completed':
        if payload.get('error_code') or payload.get('provider_error_code'):
            return 'error'
        return 'success'
    if event == 'verify_completed':
        return 'error' if str(payload.get('status') or '').lower() == 'failed' else 'success'
    if event in {
        'provider_success',
        'tool_call_result',
        'planner_summary',
        'plan_generated',
        'session_staged_state',
        'assistant_thought',
        'phase_completed',
        'run_step_completed',
        'run_checkpoint',
        'refs_resolved',
        'commit_completed',
    }:
        return 'success'
    return 'running'


def _progress_event_summary(event: str, payload: dict[str, Any]) -> str:
    if event == 'assistant_delta':
        return 'Assistant is writing…'
    if event == 'assistant_thought':
        text = payload.get('text')
        if isinstance(text, str) and text.strip():
            return text.strip()
        return 'Thinking through the next step.'
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
    if event == 'planner_summary':
        summary_text = payload.get('summary_text')
        if isinstance(summary_text, str):
            normalized = ' '.join(summary_text.split())
            if normalized:
                return normalized
        operations_count = payload.get('operations_count')
        if operations_count is not None:
            return f'Prepared a concise planning summary for {operations_count} operations.'
        return 'Prepared a concise planning summary.'
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
    if event == 'run_started':
        phase = payload.get('phase')
        return f'Started run ({phase}).' if phase else 'Started run.'
    if event == 'phase_entered':
        phase = payload.get('phase') or 'next'
        commits_done = payload.get('commits_done')
        commits_total = payload.get('commits_total')
        if commits_total is not None and commits_done is not None:
            return f'Entered {phase} phase ({commits_done}/{commits_total} commits).'
        return f'Entered {phase} phase.'
    if event == 'phase_completed':
        phase = payload.get('phase') or 'current'
        outcome = payload.get('outcome')
        if outcome:
            return f'Completed {phase} phase ({outcome}).'
        return f'Completed {phase} phase.'
    if event == 'run_step_completed':
        step = payload.get('step')
        run_next = payload.get('run_next')
        if step is not None and run_next:
            return f'Step {step} completed ({run_next}).'
        if run_next:
            return f'Step completed ({run_next}).'
        return 'Step completed.'
    if event == 'run_checkpoint':
        checkpoint = payload.get('checkpoint')
        if checkpoint:
            return f'Waiting for the user ({checkpoint}).'
        return 'Waiting for the user.'
    if event == 'refs_resolved':
        total = payload.get('refs_total')
        accessible = payload.get('refs_accessible')
        if total is not None and accessible is not None:
            return f'Resolved {accessible}/{total} referenced items.'
        if total is not None:
            return f'Resolved {total} referenced items.'
        return 'Resolved referenced items.'
    if event == 'commit_started':
        title = _progress_roadmap_label(payload)
        operations_count = payload.get('operations_count')
        if operations_count is not None:
            return f'Committing {operations_count} operations to {title}.'
        return f'Committing changes to {title}.'
    if event == 'commit_completed':
        title = _progress_roadmap_label(payload)
        operations_count = payload.get('operations_count')
        impacted_summary = payload.get('impacted_summary')
        suffix = ''
        if isinstance(impacted_summary, dict):
            compact = ', '.join(
                f'{key}={value}'
                for key, value in sorted(impacted_summary.items())
                if value is not None
            )
            if compact:
                suffix = f' ({compact})'
        if operations_count is not None:
            return f'Committed {operations_count} operations to {title}{suffix}.'
        return f'Committed changes to {title}{suffix}.'
    if event == 'commit_failed':
        title = _progress_roadmap_label(payload)
        error_code = payload.get('error_code')
        if error_code:
            return f'Commit to {title} failed with {error_code}.'
        return f'Commit to {title} failed.'
    if event == 'verify_completed':
        summary_text = payload.get('summary_text')
        if isinstance(summary_text, str):
            normalized = ' '.join(summary_text.split())
            if normalized:
                return normalized
        status = payload.get('status')
        if status:
            return f'Verification {str(status).replace("_", " ")}.'
        return 'Verification completed.'
    return event.replace('_', ' ')


def _progress_roadmap_label(payload: dict[str, Any]) -> str:
    title = payload.get('roadmap_title')
    if isinstance(title, str) and title.strip():
        return f'"{" ".join(title.split())[:120]}"'
    roadmap_id = payload.get('roadmap_id')
    if isinstance(roadmap_id, str) and roadmap_id.strip():
        return f'roadmap {roadmap_id.strip()}'
    return 'the roadmap'


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
        trace.response['tokens_cached'] = payload.get('tokens_cached')
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
                'tokens_cached': payload.get('tokens_cached'),
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
            f'  cache       {_format_cache_hit(trace.response.get("tokens_input"), trace.response.get("tokens_cached"))}',
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


def _format_cache_hit(tokens_input: Any, tokens_cached: Any) -> str:
    """Render prompt-cache effectiveness as `cached/input (NN%)`.

    Cached input tokens bill at ~10%, and the prompt is ordered so the static
    prefix stays byte-stable (see v2/context.py compact_state). A hit rate that
    collapses to 0% across a multi-turn conversation means something per-turn
    crept above the "# Actor" block and broke the cacheable prefix.
    """
    if not isinstance(tokens_input, int) or tokens_input <= 0:
        return 'n/a'
    if not isinstance(tokens_cached, int) or tokens_cached < 0:
        return f'0/{tokens_input} (0%)'
    percent = round(tokens_cached * 100 / tokens_input)
    return f'{tokens_cached}/{tokens_input} ({percent}%)'


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
    # A FileHandler is attached whenever AGENT_LOG_FILE is set. ANSI escape
    # codes are undesirable in on-disk log files regardless of 'on'/'auto'.
    if _has_file_handler(logger):
        return _AnsiPalette(enabled=False)
    if mode == 'on':
        return _AnsiPalette(enabled=True)
    return _AnsiPalette(enabled=_is_logger_tty(logger))


def _has_file_handler(logger: logging.Logger) -> bool:
    # Walk only the handlers this logger's records actually reach (the
    # propagate chain ends at root). A FileHandler elsewhere — e.g. root's
    # AGENT_LOG_FILE handler when this logger has propagate=False — can't
    # receive these records, so it must not veto ANSI on the local stream.
    visited: set[int] = set()
    current: logging.Logger | None = logger
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        for handler in current.handlers:
            if isinstance(handler, logging.FileHandler):
                return True
        current = current.parent if current.propagate else None
    return False


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
