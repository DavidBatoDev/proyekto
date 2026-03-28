from __future__ import annotations

import json
import logging
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
    logger.log(level, _render_pretty_payload(payload))


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


def _render_pretty_payload(payload: dict[str, Any]) -> str:
    event = payload.get('event', 'event')
    lines = [f'event: {event}']
    for key in _ordered_keys(payload):
        if key == 'event':
            continue
        _append_pretty_value(lines, key, payload[key], indent=5)
    return '\n'.join(lines)


def _ordered_keys(payload: dict[str, Any]) -> list[str]:
    priorities = {key: index for index, key in enumerate(_KEY_PRIORITY)}
    return sorted(
        payload.keys(),
        key=lambda key: (priorities.get(key, len(_KEY_PRIORITY)), key),
    )


def _append_pretty_value(lines: list[str], key: str, value: Any, *, indent: int) -> None:
    prefix = ' ' * indent
    if isinstance(value, dict):
        lines.append(f'{prefix}- {key}:')
        for child_key in _ordered_mapping_keys(value):
            _append_pretty_value(lines, child_key, value[child_key], indent=indent + 2)
        return

    if isinstance(value, list):
        if not value:
            lines.append(f'{prefix}- {key}: []')
            return
        lines.append(f'{prefix}- {key}:')
        for item in value:
            _append_pretty_list_item(lines, item, indent=indent + 2)
        return

    lines.append(f'{prefix}- {key}: {value}')


def _append_pretty_list_item(lines: list[str], value: Any, *, indent: int) -> None:
    prefix = ' ' * indent
    if isinstance(value, dict):
        lines.append(f'{prefix}-')
        for key in _ordered_mapping_keys(value):
            _append_pretty_value(lines, key, value[key], indent=indent + 2)
        return

    if isinstance(value, list):
        if not value:
            lines.append(f'{prefix}- []')
            return
        lines.append(f'{prefix}-')
        for item in value:
            _append_pretty_list_item(lines, item, indent=indent + 2)
        return

    lines.append(f'{prefix}- {value}')


def _ordered_mapping_keys(value: dict[str, Any]) -> list[str]:
    return sorted(value.keys())
