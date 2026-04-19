from __future__ import annotations

import re
from typing import Any
from uuid import UUID


TEMP_REF_PATTERN = re.compile(
    r'(?i)^(?:tmp|t|temp|epic|feature|feat|task)[_-][a-z0-9][a-z0-9_-]{0,63}$'
)


def is_valid_temp_ref(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.strip()
    if not normalized:
        return False
    return TEMP_REF_PATTERN.fullmatch(normalized) is not None


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
