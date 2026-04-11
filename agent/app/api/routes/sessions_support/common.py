from __future__ import annotations

import json
from datetime import datetime, timezone
import re
from typing import Any


def utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def serialized_payload_bytes(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))


def _iter_error_payload_candidates(detail: object) -> list[dict[str, Any]]:
    if not isinstance(detail, dict):
        return []

    candidates: list[dict[str, Any]] = []
    queue: list[dict[str, Any]] = [detail]
    seen_ids: set[int] = set()
    while queue:
        candidate = queue.pop(0)
        candidate_id = id(candidate)
        if candidate_id in seen_ids:
            continue
        seen_ids.add(candidate_id)
        candidates.append(candidate)

        nested_detail = candidate.get('detail')
        if isinstance(nested_detail, dict):
            queue.append(nested_detail)

        nested_error = candidate.get('error')
        if isinstance(nested_error, dict):
            queue.append(nested_error)

    return candidates


def _coerce_status_code(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.isdigit():
            return int(normalized)
    return None


def _coerce_message(value: Any) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, list):
        message_parts = [
            str(item).strip()
            for item in value
            if isinstance(item, (str, int, float)) and str(item).strip()
        ]
        if message_parts:
            return '; '.join(message_parts[:3])
    if isinstance(value, dict):
        nested_message = value.get('message')
        return _coerce_message(nested_message)
    return None


def _normalize_error_label_to_code(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    sanitized = re.sub(r'[^a-z0-9]+', '_', normalized).strip('_')
    if not sanitized:
        return None
    return sanitized.upper()


def extract_upstream_error_details(detail: object) -> dict[str, Any]:
    code: str | None = None
    status_code: int | None = None
    error_label: str | None = None
    message: str | None = None
    invalid_operation: dict[str, Any] | None = None

    for candidate in _iter_error_payload_candidates(detail):
        if code is None:
            candidate_code = candidate.get('code')
            if isinstance(candidate_code, str) and candidate_code.strip():
                code = candidate_code.strip()

        if status_code is None:
            candidate_status = candidate.get('statusCode')
            if candidate_status is None:
                candidate_status = candidate.get('status_code')
            status_code = _coerce_status_code(candidate_status)

        if error_label is None:
            candidate_error = candidate.get('error')
            if isinstance(candidate_error, str) and candidate_error.strip():
                error_label = candidate_error.strip()

        if message is None:
            message = _coerce_message(candidate.get('message'))

        if invalid_operation is None:
            invalid_candidate = candidate.get('_auto_commit_invalid_operation')
            if not isinstance(invalid_candidate, dict):
                invalid_candidate = candidate.get('invalid_operation')
            if isinstance(invalid_candidate, dict):
                invalid_operation = invalid_candidate

    normalized_code = code
    if normalized_code is None:
        normalized_code = _normalize_error_label_to_code(error_label)
    if normalized_code is None and status_code is not None:
        normalized_code = f'HTTP_{status_code}'

    return {
        'code': normalized_code,
        'status_code': status_code,
        'error': error_label,
        'message': message,
        'invalid_operation': invalid_operation,
    }


def extract_upstream_error_code(detail: object) -> str | None:
    details = extract_upstream_error_details(detail)
    code = details.get('code')
    return code if isinstance(code, str) and code.strip() else None


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
