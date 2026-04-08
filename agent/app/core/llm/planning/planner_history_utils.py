from __future__ import annotations

import hashlib
import json
from typing import Any


def build_history_messages(
    planner: Any,
    *,
    session_context: dict[str, Any],
    max_messages: int | None,
    ai_message_cls: Any,
    human_message_cls: Any,
) -> list[Any]:
    if ai_message_cls is None or human_message_cls is None:
        return []

    history = session_context.get('recent_messages', [])
    if max_messages is None:
        history_limit = planner._settings.max_chat_history_messages
    else:
        try:
            history_limit = max(int(max_messages), 0)
        except (TypeError, ValueError):
            history_limit = planner._settings.max_chat_history_messages
    if history_limit <= 0:
        return []

    history_slice = history[-history_limit:]
    cache = getattr(planner, '_history_messages_cache', None)
    if not isinstance(cache, dict):
        cache = {}
        setattr(planner, '_history_messages_cache', cache)
    cache_max_entries = getattr(planner, '_history_messages_cache_max_entries', 128)
    if not isinstance(cache_max_entries, int) or cache_max_entries <= 0:
        cache_max_entries = 128
        setattr(planner, '_history_messages_cache_max_entries', cache_max_entries)

    cache_key = history_messages_cache_key(
        history_slice=history_slice,
        history_limit=history_limit,
    )
    cached_messages = cache.get(cache_key)
    if cached_messages is not None:
        return list(cached_messages)

    messages: list[Any] = []
    for item in history_slice:
        if not isinstance(item, dict):
            continue
        role = str(item.get('role', '')).strip().lower()
        content = str(item.get('content', '')).strip()
        if not content:
            continue
        if role == 'assistant':
            messages.append(ai_message_cls(content=content))
        elif role == 'user':
            messages.append(human_message_cls(content=content))

    cache[cache_key] = list(messages)
    while len(cache) > cache_max_entries:
        oldest_key = next(iter(cache), None)
        if oldest_key is None:
            break
        cache.pop(oldest_key, None)
    return messages


def history_messages_cache_key(
    *,
    history_slice: list[Any],
    history_limit: int,
) -> str:
    normalized_items: list[dict[str, str]] = []
    for item in history_slice:
        if not isinstance(item, dict):
            continue
        role = str(item.get('role', '')).strip().lower()
        content = str(item.get('content', '')).strip()
        if not content:
            continue
        normalized_items.append({'role': role, 'content': content})
    serialized = json.dumps(normalized_items, ensure_ascii=True, separators=(',', ':'))
    digest = hashlib.sha1(serialized.encode('utf-8')).hexdigest()[:20]
    return f'{history_limit}:{digest}:{len(normalized_items)}'
