"""Build a compact prose overview of a roadmap for system-prompt injection.

The goal is to give the LLM "pre-knowledge" of the roadmap shape (title,
status, epic list with counts) without spending discovery tool-calls on
each turn. We intentionally fetch only what `GET /ai/context/summary`
already returns — no drill-down into feature titles — to keep the
payload size and backend cost small.
"""

from __future__ import annotations

from typing import Any

from app.core.nest_client import NestRoadmapClient


DEFAULT_MAX_EPICS = 15


async def build_roadmap_overview_summary(
    *,
    nest_client: NestRoadmapClient,
    roadmap_id: str,
    auth_header: str | None,
    trace_id: str | None = None,
    max_epics: int = DEFAULT_MAX_EPICS,
) -> str | None:
    if not roadmap_id or not auth_header:
        return None
    try:
        payload = await nest_client.context_summary(
            roadmap_id=roadmap_id,
            preview_id=None,
            auth_header=auth_header,
            trace_id=trace_id,
        )
    except Exception:
        # Degrade gracefully — a missing overview is better than a failed turn.
        return None
    if not isinstance(payload, dict) or isinstance(payload.get('error'), dict):
        return None
    return format_overview_summary(payload, max_epics=max_epics)


def format_overview_summary(
    payload: dict[str, Any],
    *,
    max_epics: int = DEFAULT_MAX_EPICS,
) -> str | None:
    title = _clean_str(payload.get('title')) or 'Untitled roadmap'
    status = _clean_str(payload.get('status'))
    epic_count = _as_int(payload.get('epic_count'))
    feature_count = _as_int(payload.get('feature_count'))
    task_count = _as_int(payload.get('task_count'))

    header = f'Roadmap: "{title}"'
    if status:
        header += f' (status: {status})'

    totals_parts: list[str] = []
    if epic_count is not None:
        totals_parts.append(f'{epic_count} {_pluralize(epic_count, "epic", "epics")}')
    if feature_count is not None:
        totals_parts.append(f'{feature_count} {_pluralize(feature_count, "feature", "features")}')
    if task_count is not None:
        totals_parts.append(f'{task_count} {_pluralize(task_count, "task", "tasks")}')
    totals_line = ' · '.join(totals_parts) if totals_parts else ''

    epics_raw = payload.get('epics')
    epics = [item for item in epics_raw if isinstance(item, dict)] if isinstance(epics_raw, list) else []

    # Bound the epic section so the summary stays compact regardless of roadmap size.
    capped_max = max(1, min(int(max_epics), 100))
    shown = epics[:capped_max]
    remaining = max(0, len(epics) - len(shown))

    epic_lines: list[str] = []
    for index, epic in enumerate(shown, start=1):
        epic_title = _clean_str(epic.get('title')) or 'Untitled epic'
        feature_count_for_epic = _as_int(epic.get('feature_count'))
        epic_status = _clean_str(epic.get('status'))
        bits: list[str] = []
        if feature_count_for_epic is not None:
            bits.append(f'{feature_count_for_epic} {_pluralize(feature_count_for_epic, "feature", "features")}')
        if epic_status:
            bits.append(f'status: {epic_status}')
        suffix = f' — {", ".join(bits)}' if bits else ''
        epic_lines.append(f'{index}. {epic_title}{suffix}')
    if remaining > 0:
        epic_lines.append(f'…and {remaining} more {_pluralize(remaining, "epic", "epics")}')

    sections: list[str] = [header]
    if totals_line:
        sections.append(totals_line)
    if epic_lines:
        sections.append('\n'.join(epic_lines))
    rendered = '\n'.join(sections).strip()
    return rendered or None


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _pluralize(count: int, singular: str, plural: str) -> str:
    return singular if count == 1 else plural
