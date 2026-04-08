from __future__ import annotations

import hashlib
import re
from typing import Iterable


def build_clarifier_contract(
    *,
    reason: str | None,
    question: str,
    options: Iterable[str] | None,
    max_items: int = 5,
) -> tuple[str, list[str]]:
    normalized_question = _extract_question_text(question)
    option_entries = _build_option_entries(reason=reason, options=options, max_items=max_items)
    rendered_options = [f'[{option_id}] {label}' for option_id, label in option_entries]
    if not rendered_options:
        return normalized_question, []

    numbered_lines = [
        f'{index}. {label}'
        for index, (_, label) in enumerate(option_entries, start=1)
    ]
    message = f'{normalized_question}\n\nOptions:\n' + '\n'.join(numbered_lines)
    return message, rendered_options


def _build_option_entries(
    *,
    reason: str | None,
    options: Iterable[str] | None,
    max_items: int,
) -> list[tuple[str, str]]:
    seen_ids: set[str] = set()
    entries: list[tuple[str, str]] = []
    for raw_option in list(options or []):
        label = _normalize_option_label(raw_option)
        if not label:
            continue
        option_id = _build_option_id(reason=reason, label=label)
        if option_id in seen_ids:
            continue
        seen_ids.add(option_id)
        entries.append((option_id, label))
        if len(entries) >= max_items:
            break
    return entries


def _normalize_option_label(value: str) -> str:
    normalized = str(value or '').strip()
    if not normalized:
        return ''
    normalized = re.sub(r'^\d+\.\s*', '', normalized)
    normalized = re.sub(r'^\[[^\]]+\]\s*', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return normalized


def _extract_question_text(value: str) -> str:
    normalized = str(value or '').strip()
    if not normalized:
        return 'I need one clarification before I can safely continue.'

    marker = '\n\nOptions:'
    marker_index = normalized.find(marker)
    if marker_index >= 0:
        normalized = normalized[:marker_index].strip()

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    if not lines:
        return 'I need one clarification before I can safely continue.'
    if len(lines) == 1:
        return lines[0]

    has_numbered_list = any(re.match(r'^\d+\.\s+', line) for line in lines[1:])
    if has_numbered_list:
        return lines[0]
    return '\n'.join(lines)


def _build_option_id(*, reason: str | None, label: str) -> str:
    reason_slug = _slugify(reason or 'clarifier')[:24] or 'clarifier'
    label_slug = _slugify(label)[:24] or 'option'
    digest = hashlib.sha1(f'{reason_slug}:{label}'.encode('utf-8')).hexdigest()[:8]
    return f'{reason_slug}_{label_slug}_{digest}'


def _slugify(value: str) -> str:
    normalized = str(value or '').strip().lower()
    normalized = re.sub(r'[^a-z0-9]+', '_', normalized)
    normalized = re.sub(r'_+', '_', normalized)
    return normalized.strip('_')
