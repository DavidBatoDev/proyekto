"""Build a compact prose overview of a roadmap for system-prompt injection.

The goal is to give the LLM "pre-knowledge" of the roadmap shape (title,
status, epic list with counts) without spending discovery tool-calls on
each turn. We intentionally fetch only what `GET /ai/context/summary`
already returns — no drill-down into feature titles — to keep the
payload size and backend cost small.

Each rendered node is tagged with a short, stable handle (``E1``, ``E1.F2``,
``M1``) so the planner can reference it directly instead of round-tripping
through ``resolve_node_reference``. The focus roadmap uses bare handles; every
other loaded roadmap gets a ``handle_prefix`` (``R2``) so its handles render as
``R2.E1`` / ``R2.E1.F2`` / ``R2.M1`` and never collide. The formatter also
returns a ``handle_map`` mapping each (already prefixed) handle to the node's
real UUID, type, title and — when the caller names it — ``roadmap_id``; the
op-emission path expands handles back to UUIDs before dispatch, so full IDs
never enter the prompt.
"""

from __future__ import annotations

from typing import Any

from app.core.nest_client import NestRoadmapClient


DEFAULT_MAX_EPICS = 25
DEFAULT_MAX_FEATURES_PER_EPIC = 8
# Non-focus roadmaps get a tighter outline so several can share one prompt.
NON_FOCUS_MAX_EPICS = 15
NON_FOCUS_MAX_FEATURES_PER_EPIC = 5

HandleMap = dict[str, dict[str, str]]


async def build_roadmap_overview_summary(
    *,
    nest_client: NestRoadmapClient,
    roadmap_id: str,
    auth_header: str | None,
    trace_id: str | None = None,
    max_epics: int = DEFAULT_MAX_EPICS,
    max_features_per_epic: int = DEFAULT_MAX_FEATURES_PER_EPIC,
    handle_prefix: str | None = None,
) -> tuple[str | None, str | None, HandleMap]:
    """Fetch the roadmap's compact overview summary.

    Returns ``(summary, revision_token, handle_map)``. The revision_token
    is the backend's current authoritative value for this roadmap; callers
    should refresh the cached token from it so subsequent commits see a
    fresh token even if another client mutated the roadmap between turns.
    ``handle_map`` maps each handle in ``summary`` to the corresponding node
    (id, type, title, roadmap_id) and is empty when there is no summary.
    """
    if not roadmap_id or not auth_header:
        return None, None, {}
    try:
        payload = await nest_client.context_summary(
            roadmap_id=roadmap_id,
            preview_id=None,
            auth_header=auth_header,
            trace_id=trace_id,
        )
    except Exception:
        # Degrade gracefully — a missing overview is better than a failed turn.
        return None, None, {}
    if not isinstance(payload, dict) or isinstance(payload.get('error'), dict):
        return None, None, {}
    summary, handle_map = format_overview_summary(
        payload,
        max_epics=max_epics,
        max_features_per_epic=max_features_per_epic,
        handle_prefix=handle_prefix,
        roadmap_id=roadmap_id,
    )
    return summary, extract_revision_token(payload), handle_map


def extract_revision_token(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw = payload.get('revision_token')
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def format_overview_summary(
    payload: dict[str, Any],
    *,
    max_epics: int = DEFAULT_MAX_EPICS,
    max_features_per_epic: int = DEFAULT_MAX_FEATURES_PER_EPIC,
    handle_prefix: str | None = None,
    roadmap_id: str | None = None,
) -> tuple[str | None, HandleMap]:
    """Render the summary payload as an outline and build its handle map.

    ``handle_prefix`` (``'R2'``) prefixes every handle — ``R2.E1``,
    ``R2.E1.F2``, ``R2.M1`` — for a non-focus roadmap; ``None`` keeps the bare
    focus-roadmap handles. ``roadmap_id`` is stamped onto every handle-map
    entry so a merged multi-roadmap map can tell which roadmap a node
    belongs to.
    """
    handle_map: HandleMap = {}
    prefix = f'{handle_prefix.strip()}.' if isinstance(handle_prefix, str) and handle_prefix.strip() else ''
    title = _clean_str(payload.get('title')) or 'Untitled roadmap'
    status = _clean_str(payload.get('status'))
    epic_count = _as_int(payload.get('epic_count'))
    feature_count = _as_int(payload.get('feature_count'))
    task_count = _as_int(payload.get('task_count'))

    def _entry(node_id: str, node_type: str, node_title: str) -> dict[str, str]:
        entry = {'id': node_id, 'type': node_type, 'title': node_title}
        if roadmap_id:
            entry['roadmap_id'] = roadmap_id
        return entry

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
    capped_features = max(0, min(int(max_features_per_epic), 50))

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
        epic_handle = f'{prefix}E{index}'
        epic_id = _clean_str(epic.get('id'))
        if epic_id:
            handle_map[epic_handle] = _entry(epic_id, 'epic', epic_title)
        epic_lines.append(f'{epic_handle}. {epic_title}{suffix}')

        # Render feature titles as a bulleted sublist so the LLM can reference
        # them by name without needing a drill-down tool call.
        features_raw = epic.get('features')
        features = [item for item in features_raw if isinstance(item, dict)] if isinstance(features_raw, list) else []
        if features and capped_features > 0:
            shown_features = features[:capped_features]
            remaining_features = max(0, len(features) - len(shown_features))
            for feature_index, feature in enumerate(shown_features, start=1):
                feature_title = _clean_str(feature.get('title')) or 'Untitled feature'
                feature_status = _clean_str(feature.get('status'))
                feature_handle = f'{epic_handle}.F{feature_index}'
                feature_id = _clean_str(feature.get('id'))
                if feature_id:
                    handle_map[feature_handle] = _entry(feature_id, 'feature', feature_title)
                if feature_status:
                    epic_lines.append(f'   {feature_handle} · {feature_title} (status: {feature_status})')
                else:
                    epic_lines.append(f'   {feature_handle} · {feature_title}')
            if remaining_features > 0:
                epic_lines.append(
                    f'   · …and {remaining_features} more '
                    f'{_pluralize(remaining_features, "feature", "features")}'
                )
    if remaining > 0:
        epic_lines.append(f'…and {remaining} more {_pluralize(remaining, "epic", "epics")}')

    # Milestones are flat roadmap children. Render them with M<n> handles so
    # the planner can update/delete/shift them without a resolve round-trip.
    milestones_raw = payload.get('milestones')
    milestones = (
        [item for item in milestones_raw if isinstance(item, dict)]
        if isinstance(milestones_raw, list)
        else []
    )
    milestone_lines: list[str] = []
    for index, milestone in enumerate(milestones[:50], start=1):
        milestone_title = _clean_str(milestone.get('title')) or 'Untitled milestone'
        milestone_handle = f'{prefix}M{index}'
        milestone_id = _clean_str(milestone.get('id'))
        if milestone_id:
            handle_map[milestone_handle] = _entry(milestone_id, 'milestone', milestone_title)
        bits = []
        target_date = _clean_str(milestone.get('target_date'))
        if target_date:
            bits.append(f'due {target_date[:10]}')
        milestone_status = _clean_str(milestone.get('status'))
        if milestone_status:
            bits.append(f'status: {milestone_status}')
        suffix = f' -- {", ".join(bits)}' if bits else ''
        milestone_lines.append(f'{milestone_handle}. {milestone_title}{suffix}')

    sections: list[str] = [header]
    if totals_line:
        sections.append(totals_line)
    if epic_lines:
        sections.append('\n'.join(epic_lines))
    if milestone_lines:
        sections.append('Milestones:\n' + '\n'.join(milestone_lines))
    rendered = '\n'.join(sections).strip()
    return (rendered or None), handle_map


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
