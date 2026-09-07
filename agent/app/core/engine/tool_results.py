"""Tool-result serialization and truncation for the loop engine.

Every tool result is fed back to the model as a ``function_call_output`` string.
Large payloads are capped so one verbose read cannot blow the context window.
A result whose bulk is a list of items (tasks, matches, roadmaps, epics...) is
cut as an ordered prefix of whole items with ``returned_<key>`` /
``total_<key>`` markers, so the model sees well-formed JSON, every id it sees is
complete, and it knows how much it did not see. Only a result with no such list
falls back to a hard character cut.
"""

from __future__ import annotations

import json
from typing import Any

MAX_TOOL_RESULT_CHARS = 8000
MAX_PROJECT_BRIEF_TOOL_RESULT_CHARS = 64_000
# A list result may run past the default cap as long as it stays whole items:
# 30 assigned tasks with attribution are ~20k chars, and a cut mid-item costs
# the model the ids it needs to link them (production run 0a014ee4).
MAX_LIST_TOOL_RESULT_CHARS = 16_000


def _serialized_tool_result(result: Any) -> str:
    return json.dumps(result, default=str, ensure_ascii=False)


def _fits_default_tool_result_cap(result: Any) -> bool:
    return len(_serialized_tool_result(result)) <= MAX_TOOL_RESULT_CHARS


def _structured_project_resources_result(result: Any) -> str:
    source = result if isinstance(result, dict) else {}
    folders_raw = source.get('folders')
    links_raw = source.get('links')
    folders = (
        [item for item in folders_raw if isinstance(item, dict)]
        if isinstance(folders_raw, list)
        else []
    )
    links = (
        [item for item in links_raw if isinstance(item, dict)]
        if isinstance(links_raw, list)
        else []
    )
    truncated: dict[str, Any] = {
        'project_id': source.get('project_id'),
        'folders': [],
        'links': [],
        'total_folders': len(folders),
        'returned_folders': 0,
        'total_links': len(links),
        'returned_links': 0,
        'result_truncated': True,
    }

    for folder in folders:
        truncated['folders'].append(folder)
        truncated['returned_folders'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['folders'].pop()
            truncated['returned_folders'] -= 1
            break

    for link in links:
        truncated['links'].append(link)
        truncated['returned_links'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['links'].pop()
            truncated['returned_links'] -= 1
            break

    return _serialized_tool_result(truncated)


def _structured_project_meetings_result(result: Any) -> str:
    source = result if isinstance(result, dict) else {}
    meetings_raw = source.get('meetings')
    meetings = (
        [item for item in meetings_raw if isinstance(item, dict)]
        if isinstance(meetings_raw, list)
        else []
    )
    participants_by_meeting: list[list[dict[str, Any]]] = []
    total_participants = 0
    for meeting in meetings:
        participants_raw = meeting.get('participants')
        participants = (
            [item for item in participants_raw if isinstance(item, dict)]
            if isinstance(participants_raw, list)
            else []
        )
        participants_by_meeting.append(participants)
        total_participants += len(participants)

    truncated: dict[str, Any] = {
        'project_id': source.get('project_id'),
        'window': source.get('window'),
        'meetings': [],
        'total_meetings': len(meetings),
        'returned_meetings': 0,
        'total_participants': total_participants,
        'returned_participants': 0,
        'result_truncated': True,
    }
    returned_participant_sources: list[list[dict[str, Any]]] = []

    # Reserve room for as many ordered meetings as possible first. Participant
    # payloads are then filled as ordered prefixes without splitting an item.
    for meeting, participants in zip(meetings, participants_by_meeting):
        meeting_copy = {
            key: value for key, value in meeting.items() if key != 'participants'
        }
        meeting_copy['participants'] = []
        meeting_copy['total_participants'] = len(participants)
        meeting_copy['returned_participants'] = 0
        truncated['meetings'].append(meeting_copy)
        truncated['returned_meetings'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['meetings'].pop()
            truncated['returned_meetings'] -= 1
            break
        returned_participant_sources.append(participants)

    for meeting_copy, participants in zip(
        truncated['meetings'], returned_participant_sources
    ):
        for participant in participants:
            meeting_copy['participants'].append(participant)
            meeting_copy['returned_participants'] += 1
            truncated['returned_participants'] += 1
            if not _fits_default_tool_result_cap(truncated):
                meeting_copy['participants'].pop()
                meeting_copy['returned_participants'] -= 1
                truncated['returned_participants'] -= 1
                break

    return _serialized_tool_result(truncated)


def _list_container_key(result: Any) -> str | None:
    """The root key holding the result's bulk as a list of dict items."""
    if not isinstance(result, dict):
        return None
    best: str | None = None
    best_size = 0
    for key, value in result.items():
        if not isinstance(value, list) or not value:
            continue
        if not all(isinstance(item, dict) for item in value):
            continue
        size = len(_serialized_tool_result(value))
        if size > best_size:
            best, best_size = key, size
    return best


def _truncation_hint(key: str, returned: int, total: int) -> str:
    return (
        f'Only the first {returned} of {total} {key} fit in one result. Tell the '
        'user how many you are showing; to see the rest, narrow the query '
        '(status, due window, roadmap_ids, a smaller limit) instead of repeating '
        'the same call with a larger limit.'
    )


def _structured_list_result(result: dict[str, Any], key: str, max_chars: int) -> str | None:
    """Keep an ordered prefix of whole items under ``key``; None when nothing fits."""
    items = [item for item in result[key] if isinstance(item, dict)]
    truncated: dict[str, Any] = {k: v for k, v in result.items() if k != key}
    truncated[key] = []
    truncated[f'total_{key}'] = len(items)
    truncated[f'returned_{key}'] = 0
    truncated['result_truncated'] = True
    # The widest hint the loop can end with, so the final one always fits.
    truncated['truncation_hint'] = _truncation_hint(key, len(items), len(items))

    def fits() -> bool:
        return len(_serialized_tool_result(truncated)) <= max_chars

    if not fits():
        return None
    for item in items:
        truncated[key].append(item)
        truncated[f'returned_{key}'] += 1
        if not fits():
            truncated[key].pop()
            truncated[f'returned_{key}'] -= 1
            break
    if not truncated[key]:
        return None
    truncated['truncation_hint'] = _truncation_hint(key, truncated[f'returned_{key}'], len(items))
    return _serialized_tool_result(truncated)


def tool_result_content(result: Any, tool_name: str) -> str:
    """Serialize a tool result for the model, truncating past the per-tool cap."""
    try:
        text = json.dumps(result, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(result)
    max_chars = (
        MAX_PROJECT_BRIEF_TOOL_RESULT_CHARS
        if tool_name == 'get_project_brief'
        else MAX_TOOL_RESULT_CHARS
    )
    if len(text) <= max_chars:
        return text
    if tool_name == 'list_project_resources':
        return _structured_project_resources_result(result)
    if tool_name == 'list_project_meetings':
        return _structured_project_meetings_result(result)
    list_key = _list_container_key(result) if max_chars == MAX_TOOL_RESULT_CHARS else None
    if list_key is not None:
        if len(text) <= MAX_LIST_TOOL_RESULT_CHARS:
            return text
        structured = _structured_list_result(result, list_key, MAX_LIST_TOOL_RESULT_CHARS)
        if structured is not None:
            return structured
    return text[:max_chars] + '…(truncated)'
