from __future__ import annotations

import hashlib
import json
from typing import Any


def _extract_history_item(item: Any) -> dict[str, Any] | None:
    """Normalize a session_context['recent_messages'] entry into a dict
    with role/content/tool_calls/tool_call_id keys — or None if the
    entry is malformed.

    An entry is usable if it has either a non-empty `content` OR
    non-empty `tool_calls`. An assistant message that only carries
    tool_calls (empty content) is valid and must pass through.
    """

    if not isinstance(item, dict):
        return None
    role = str(item.get('role', '')).strip().lower()
    if not role:
        return None
    content = str(item.get('content', '') or '').strip()
    tool_calls = item.get('tool_calls')
    if not isinstance(tool_calls, list) or not tool_calls:
        tool_calls = None
    tool_call_id = item.get('tool_call_id')
    if not isinstance(tool_call_id, str) or not tool_call_id.strip():
        tool_call_id = None
    if not content and not tool_calls and role != 'tool':
        return None
    return {
        'role': role,
        'content': content,
        'tool_calls': tool_calls,
        'tool_call_id': tool_call_id,
    }


def _prune_respecting_tool_pairs(
    items: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Cap the history at `limit` most-recent entries, but never orphan a
    `role='tool'` message from its preceding `role='assistant'` message
    that carried the matching `tool_call_id` in `tool_calls[*].id`. If
    the cap would cut between a pair, drop the assistant side too.

    OpenAI / LangChain validate that every tool_call_id in the message
    list has a matching id in a prior assistant's tool_calls — violating
    this fails the entire request. Coherent pruning prevents that.
    """

    if limit <= 0 or not items:
        return []
    if len(items) <= limit:
        return list(items)

    window = items[-limit:]
    # If the first item in the window is a tool-result whose
    # tool_call_id appears in an assistant-tool_calls message that was
    # CUT from the window, drop leading tool-results until we're inside
    # a self-contained pair.
    assistant_ids_in_window: set[str] = set()
    for item in window:
        if item.get('role') == 'assistant' and isinstance(item.get('tool_calls'), list):
            for call in item['tool_calls']:
                if isinstance(call, dict):
                    cid = call.get('id')
                    if isinstance(cid, str):
                        assistant_ids_in_window.add(cid)
    trimmed_start = 0
    while trimmed_start < len(window):
        entry = window[trimmed_start]
        if entry.get('role') == 'tool':
            tcid = entry.get('tool_call_id')
            if isinstance(tcid, str) and tcid not in assistant_ids_in_window:
                trimmed_start += 1
                continue
        break
    return window[trimmed_start:]


def build_history_messages(
    planner: Any,
    *,
    session_context: dict[str, Any],
    max_messages: int | None,
    ai_message_cls: Any,
    human_message_cls: Any,
    tool_message_cls: Any = None,
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

    normalized_items: list[dict[str, Any]] = []
    for item in history:
        extracted = _extract_history_item(item)
        if extracted is not None:
            normalized_items.append(extracted)

    history_slice = _prune_respecting_tool_pairs(normalized_items, history_limit)

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
    for entry in history_slice:
        role = entry['role']
        content = entry['content']
        tool_calls = entry.get('tool_calls')
        tool_call_id = entry.get('tool_call_id')
        if role == 'assistant' and tool_calls:
            # LangChain's AIMessage accepts tool_calls positionally/kw;
            # pass both content (may be empty) and tool_calls.
            messages.append(ai_message_cls(content=content, tool_calls=tool_calls))
        elif role == 'assistant':
            messages.append(ai_message_cls(content=content))
        elif role == 'user':
            messages.append(human_message_cls(content=content))
        elif role == 'tool' and tool_message_cls is not None and tool_call_id:
            messages.append(tool_message_cls(content=content, tool_call_id=tool_call_id))
        # Unknown roles (and tool roles when tool_message_cls is None)
        # are silently dropped — legacy providers stay unaffected.

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
    normalized_items: list[dict[str, Any]] = []
    for item in history_slice:
        if not isinstance(item, dict):
            continue
        role = str(item.get('role', '')).strip().lower()
        content = str(item.get('content', '') or '').strip()
        tool_calls = item.get('tool_calls')
        tool_call_id = item.get('tool_call_id')
        if not isinstance(tool_calls, list) or not tool_calls:
            tool_calls = None
        if not isinstance(tool_call_id, str) or not tool_call_id.strip():
            tool_call_id = None
        if not content and not tool_calls and role != 'tool':
            continue
        normalized_items.append({
            'role': role,
            'content': content,
            'tool_calls': tool_calls,
            'tool_call_id': tool_call_id,
        })
    serialized = json.dumps(normalized_items, ensure_ascii=True, separators=(',', ':'), default=str)
    digest = hashlib.sha1(serialized.encode('utf-8')).hexdigest()[:20]
    return f'{history_limit}:{digest}:{len(normalized_items)}'
