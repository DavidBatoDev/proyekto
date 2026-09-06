"""Ground reply entity links before persistence and the HTTP response."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.core.logging_utils import log_event
from app.core.runtime.entity_registry import build_lookup, titles_match
from app.core.runtime.handles import merged_handle_map
from app.core.uuid_utils import is_uuid_like, normalize_uuid

_logger = logging.getLogger(__name__)

ENTITY_LINK_PATTERN = re.compile(r'\]\(proyekto://(project|roadmap|epic|feature|task|milestone|team|workspace)/([^)\s]+)\)')
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


@dataclass
class GroundingResult:
    text: str
    expanded: int = 0
    kept: int = 0
    rejected: list[dict[str, Any]] = field(default_factory=list)


def ground_entity_links(text: str, session: Any, run: Any) -> GroundingResult:
    """Expand handles, then accept only an observed typed id and matching title.

    Rejections preserve unescaped prose and are observable, but neither the
    session nor the run is mutated. All terminal paths share this validator.
    """
    result = GroundingResult(text=text)
    if not ENTITY_LINK_PATTERN.search(text):
        return result
    handles = merged_handle_map(session, run)
    lookup = build_lookup(session, run)
    known_ids = {entity_id for _, entity_id in lookup}

    def expand(match: re.Match[str]) -> str:
        label, kind, entity_id = match.groups()
        link_text = re.sub(r'\\([\\`*_[\]])', r'\1', label)
        resolved_id = normalize_uuid(entity_id)
        reason = None
        if not resolved_id:
            entry = handles.get(entity_id)
            if entry is not None:
                if entry.get('type') == kind:
                    resolved_id = normalize_uuid(entry.get('id'))
                else:
                    reason = 'KIND_MISMATCH'
            if re.fullmatch(r'R\d+', entity_id):
                roadmap_id = next(
                    (
                        roadmap_id for roadmap_id, context in session.metadata.roadmaps.items()
                        if context.handle_prefix == entity_id
                    ),
                    None,
                )
                if roadmap_id:
                    if kind == 'roadmap':
                        resolved_id = normalize_uuid(roadmap_id)
                    else:
                        reason = 'KIND_MISMATCH'
            if resolved_id:
                result.expanded += 1
        registered = lookup.get((kind, resolved_id)) if resolved_id else None
        if not reason:
            if registered is None:
                reason = 'KIND_MISMATCH' if resolved_id in known_ids else 'UNKNOWN_ID'
            elif not titles_match(link_text, registered.title):
                reason = 'TITLE_MISMATCH'
        if reason:
            rejection = {
                'run_id': run.run_id,
                'kind': kind,
                'entity_id': resolved_id or entity_id,
                'reason': reason,
                'link_text': link_text,
                'registered_title': registered.title if registered else None,
            }
            result.rejected.append(rejection)
            log_event(_logger, 'entity_link_rejected', **rejection)
            return link_text
        result.kept += 1
        if is_uuid_like(entity_id):
            return match.group(0)
        return f'[{label}](proyekto://{kind}/{resolved_id})'

    result.text = _FULL_LINK_PATTERN.sub(expand, text)
    return result


def expand_entity_links(text: str, session: Any, run: Any) -> str:
    """Compatibility wrapper; new callers use the grounding counters too."""
    return ground_entity_links(text, session, run).text
