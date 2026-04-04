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
    response: dict[str, Any] = field(default_factory=dict)
    assistant: dict[str, Any] = field(default_factory=dict)


_LIFECYCLE_TRACES: dict[str, _LifecycleTrace] = {}


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
    if cfg.agent_log_json:
        logger.log(level, json.dumps(payload, ensure_ascii=True, default=str))
        return
    palette = _resolve_palette(cfg, logger)
    lifecycle_block = _capture_lifecycle_block(payload)
    logger.log(level, _render_event_block(payload, palette=palette))
    if lifecycle_block:
        logger.log(level, _render_lifecycle_block(lifecycle_block, palette=palette))


def summarize_tool_result(result: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {'result_type': 'dict'}
    if 'error' in result and isinstance(result.get('error'), dict):
        error = result.get('error', {})
        summary['error_code'] = error.get('code')
        return summary

    for key in ('matches', 'children', 'epics', 'operations', 'tasks'):
        value = result.get(key)
        if isinstance(value, list):
            summary[f'{key}_count'] = len(value)
    if 'roadmap_id' in result:
        summary['roadmap_id'] = result.get('roadmap_id')
    if 'type' in result:
        summary['node_type'] = result.get('type')
    if 'id' in result:
        summary['node_id'] = result.get('id')
    if not summary:
        summary['keys'] = sorted(result.keys())
    return summary


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
    elif event.startswith('deterministic_context_'):
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
            'auto_preview': payload.get('auto_preview'),
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
                'preview_available': payload.get('preview_available'),
                'operations_count': payload.get('operations_count'),
                'artifacts_count': payload.get('artifacts_count'),
                'route_lane': payload.get('route_lane'),
                'discovery_stop_reason': payload.get('discovery_stop_reason'),
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
    lines.extend(
        [
            '',
            'RESPONSE',
            f'  provider    {trace.response.get("provider_used") or trace.response.get("provider")}',
            f'  fallback    {_yes_no(trace.response.get("fallback_used"))}',
            f'  preview     {_yes_no(trace.response.get("preview_available"))}',
            f'  ops         {trace.response.get("operations_count")}',
            f'  elapsed     {trace.response.get("elapsed_ms")} ms',
            f'  lane        {trace.response.get("route_lane")}',
            f'  stop        {trace.response.get("discovery_stop_reason")}',
            f'  clarifier   {_yes_no(trace.response.get("clarifier_returned"))}',
            f'  guard       {_yes_no(trace.response.get("edit_guard_intervened"))}',
            f'  retry_calls {trace.response.get("retry_tool_calls_used")}',
            f'  retry_dedupe {_yes_no(trace.response.get("retry_duplicate_operation_deduped"))}',
            f'  retry_auto  {_yes_no(trace.response.get("retry_autostage_applied"))}',
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
    if parse_mode.startswith('deterministic_context_'):
        label = parse_mode.removeprefix('deterministic_context_')
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
