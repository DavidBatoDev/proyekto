"""Expand reply entity handles before persistence and the HTTP response."""

from __future__ import annotations

import re
from typing import Any

from app.core.runtime.handles import merged_handle_map
from app.core.uuid_utils import is_uuid_like

ENTITY_LINK_PATTERN = re.compile(r'\]\(proyekto://(project|roadmap|epic|feature|task|milestone|team)/([^)\s]+)\)')
# Link labels can contain escaped punctuation and nested bracket text.
_LABEL_PATTERN = r'\[((?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*)'
_FULL_LINK_PATTERN = re.compile(_LABEL_PATTERN + ENTITY_LINK_PATTERN.pattern)


def entity_link(label: str, kind: str, entity_id: str) -> str:
    """Quote a canonical title as Markdown link text, without changing prose."""
    escaped = re.sub(r'([\\`*_[\]])', r'\\\1', label)
    return f'[{escaped}](proyekto://{kind}/{entity_id})'


def strip_entity_links(text: str) -> str:
    """Keep entity titles in persisted tool text; leave other Markdown alone."""
    return _FULL_LINK_PATTERN.sub(
        lambda match: re.sub(r'\\([\\`*_[\]])', r'\1', match.group(1)),
        text,
    )


def expand_entity_links(text: str, session: Any, run: Any) -> str:
    """Resolve only known handles of the requested kind; keep unknown titles."""
    if not ENTITY_LINK_PATTERN.search(text):
        return text
    handles = merged_handle_map(session, run)

    def expand(match: re.Match[str]) -> str:
        label, kind, entity_id = match.groups()
        if not label.strip():
            return label
        if is_uuid_like(entity_id):
            return match.group(0)
        entry = handles.get(entity_id)
        resolved_id = entry.get('id') if entry and entry.get('type') == kind else None
        if kind == 'roadmap' and re.fullmatch(r'R\d+', entity_id):
            resolved_id = next(
                (
                    roadmap_id for roadmap_id, context in session.metadata.roadmaps.items()
                    if context.handle_prefix == entity_id
                ),
                None,
            )
        if not is_uuid_like(resolved_id):
            return label
        return f'[{label}](proyekto://{kind}/{resolved_id})'

    return _FULL_LINK_PATTERN.sub(expand, text)
