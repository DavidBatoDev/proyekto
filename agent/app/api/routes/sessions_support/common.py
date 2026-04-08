from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def serialized_payload_bytes(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))


def extract_upstream_error_code(detail: object) -> str | None:
    if not isinstance(detail, dict):
        return None

    code = detail.get('code')
    if isinstance(code, str) and code.strip():
        return code.strip()

    nested_detail = detail.get('detail')
    if isinstance(nested_detail, dict):
        nested_code = nested_detail.get('code')
        if isinstance(nested_code, str) and nested_code.strip():
            return nested_code.strip()

        nested_error = nested_detail.get('error')
        if isinstance(nested_error, dict):
            error_code = nested_error.get('code')
            if isinstance(error_code, str) and error_code.strip():
                return error_code.strip()

    return None


def sanitize_session_metadata(
    metadata: dict[str, Any] | None,
    *,
    actor_metadata_keys: set[str],
) -> tuple[dict[str, Any], bool]:
    if not isinstance(metadata, dict):
        return {}, False

    stripped = False

    def _walk(value: Any) -> Any:
        nonlocal stripped
        if isinstance(value, dict):
            cleaned: dict[str, Any] = {}
            for key, nested in value.items():
                key_text = str(key).strip().lower()
                if key_text in actor_metadata_keys:
                    stripped = True
                    continue
                cleaned[key] = _walk(nested)
            return cleaned
        if isinstance(value, list):
            return [_walk(item) for item in value]
        return value

    sanitized = _walk(metadata)
    if not isinstance(sanitized, dict):
        return {}, stripped
    return sanitized, stripped
