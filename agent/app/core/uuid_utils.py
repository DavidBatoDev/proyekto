from __future__ import annotations

from typing import Any
from uuid import UUID


def normalize_uuid(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None

    lowered = candidate.lower()
    if lowered.startswith('urn:uuid:'):
        candidate = candidate[9:]

    if candidate.startswith('{') and candidate.endswith('}'):
        candidate = candidate[1:-1]

    try:
        return str(UUID(candidate))
    except (ValueError, AttributeError, TypeError):
        return None


def is_uuid_like(value: Any) -> bool:
    return normalize_uuid(value) is not None
