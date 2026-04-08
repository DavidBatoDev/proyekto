from __future__ import annotations

from datetime import datetime
from typing import Any


def parse_change_timeline(
    timeline: Any,
) -> tuple[dict[str, str], dict[str, datetime | None]]:
    timeline_status: dict[str, str] = {}
    timeline_discarded_at: dict[str, datetime | None] = {}
    if not isinstance(timeline, list):
        return timeline_status, timeline_discarded_at

    for item in timeline:
        if not isinstance(item, dict):
            continue
        timeline_change_id = item.get('change_id')
        timeline_entry_status = item.get('status')
        if not isinstance(timeline_change_id, str) or not timeline_change_id.strip():
            continue
        if timeline_entry_status not in {'applied', 'discarded'}:
            continue
        timeline_status[timeline_change_id] = timeline_entry_status

        timeline_entry_discarded_at = item.get('discarded_at')
        if isinstance(timeline_entry_discarded_at, str):
            try:
                timeline_discarded_at[timeline_change_id] = datetime.fromisoformat(
                    timeline_entry_discarded_at.replace('Z', '+00:00')
                ).replace(tzinfo=None)
            except ValueError:
                timeline_discarded_at[timeline_change_id] = None
        else:
            timeline_discarded_at[timeline_change_id] = None

    return timeline_status, timeline_discarded_at
