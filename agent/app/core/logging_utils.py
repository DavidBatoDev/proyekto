from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import Settings, get_settings

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
    logger.log(level, f'{event} | {payload}')


def summarize_tool_result(result: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {'result_type': 'dict'}
    if 'error' in result and isinstance(result.get('error'), dict):
        error = result.get('error', {})
        summary['error_code'] = error.get('code')
        return summary

    for key in ('matches', 'children', 'epics', 'operations'):
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
