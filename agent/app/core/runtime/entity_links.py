"""Ground reply entity links before persistence and the HTTP response.

Three passes run on every final message, in this order:

1. Handle expansion: outline handles (`E1`, `R2.E1`, `R2`) become uuids.
2. Grounding: every `(kind, id)` must be an entity this run observed and the
   link text must be that entity's title. A failing link is repaired when the
   evidence still identifies exactly one entity (a mistyped or borrowed id
   under the right kind, or the right id and title under the wrong kind);
   otherwise it collapses to its text. Both outcomes are logged.
3. Auto-linking: whole, delimiter-bounded mentions of long, unambiguous
   observed titles become links, so a list the model wrote in plain text still
   renders as chips. Existing links, code and bracket tags are never touched.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.core.contracts.runs import EntitySeen
from app.core.logging_utils import log_event
from app.core.runtime.entity_registry import build_lookup, normalize_title, titles_match
from app.core.runtime.handles import merged_handle_map
from app.core.uuid_utils import is_uuid_like, normalize_uuid

_logger = logging.getLogger(__name__)

ENTITY_LINK_PATTERN = re.compile(r'\]\(proyekto://(project|roadmap|epic|feature|task|milestone|team|workspace)/([^)\s]+)\)')
# Link labels can contain escaped punctuation and nested bracket text.
_LABEL_PATTERN = r'\[((?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*)'
_FULL_LINK_PATTERN = re.compile(_LABEL_PATTERN + ENTITY_LINK_PATTERN.pattern)
_ESCAPE_PATTERN = re.compile(r'\\([\\`*_[\]])')

# A mistyped uuid is repaired only when it is this close to a registered id
# (used to pick between entities that share a title; a unique title needs no id).
MAX_ID_EDIT_DISTANCE = 3
# Normalised titles shorter than this are never auto-linked: too many false hits.
MIN_AUTOLINK_TITLE_CHARS = 12
# What may sit next to a plain-text title for it to count as a whole mention:
# list bullets, dashes, colons, quotes, emphasis, headings, punctuation.
_AUTOLINK_DELIMITERS = frozenset('-—–:;,.()"“”\'‘’*_/|>#!?•')
# Spans auto-linking must not rewrite: code, any Markdown link (its label
# included), bracket tags the web renders as pills, bare URLs.
_PROTECTED_SPAN_PATTERN = re.compile(
    r'```.*?```'
    r'|`[^`\n]*`'
    r'|!?' + _LABEL_PATTERN + r'\]\([^)]*\)'
    r'|\[(?:\\.|[^\[\]\\])*\]'
    r'|https?://\S+',
    re.DOTALL,
)


def entity_link(label: str, kind: str, entity_id: str) -> str:
    """Quote a canonical title as Markdown link text, without changing prose."""
    escaped = re.sub(r'([\\`*_[\]])', r'\\\1', label)
    return f'[{escaped}](proyekto://{kind}/{entity_id})'


def _unescape(label: str) -> str:
    return _ESCAPE_PATTERN.sub(r'\1', label)


def strip_entity_links(text: str) -> str:
    """Keep entity titles in persisted tool text; leave other Markdown alone."""
    return _FULL_LINK_PATTERN.sub(lambda match: _unescape(match.group(1)), text)


@dataclass
class GroundingResult:
    text: str
    expanded: int = 0
    kept: int = 0
    # Links the model wrote wrongly but which still identified one entity.
    repaired: int = 0
    # Plain-text mentions of observed titles that were turned into links.
    auto: int = 0
    rejected: list[dict[str, Any]] = field(default_factory=list)


def _edit_distance(left: str, right: str, limit: int) -> int:
    """Levenshtein distance, capped at limit + 1 so mismatches exit early."""
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        current = [i]
        best = i
        for j, b in enumerate(right, 1):
            cost = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a != b))
            current.append(cost)
            best = min(best, cost)
        if best > limit:
            return limit + 1
        previous = current
    return previous[-1]


def _repair(
    kind: str,
    entity_id: str | None,
    raw_id: str,
    link_text: str,
    reason: str,
    lookup: dict[tuple[str, str], EntitySeen],
) -> EntitySeen | None:
    """Return the one entity a failing link evidently meant, else None.

    Within a kind the exact title is decisive (a mistyped or borrowed id);
    across kinds only an id AND title that agree on one entity are trusted, so
    a workspace name on a team id still collapses instead of re-pointing.
    """
    if reason == 'KIND_MISMATCH':
        agreeing = [
            entry for (other_kind, other_id), entry in lookup.items()
            if other_id == entity_id and other_kind != kind and titles_match(link_text, entry.title)
        ]
        return agreeing[0] if len(agreeing) == 1 else None
    wanted = normalize_title(link_text)
    if not wanted:
        return None
    candidates = [
        entry for (other_kind, _), entry in lookup.items()
        if other_kind == kind and normalize_title(entry.title) == wanted
    ]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        ranked = sorted(
            ((_edit_distance(raw_id.strip().lower(), entry.id, MAX_ID_EDIT_DISTANCE), entry) for entry in candidates),
            key=lambda pair: pair[0],
        )
        nearest, runner_up = ranked[0], ranked[1]
        if nearest[0] <= MAX_ID_EDIT_DISTANCE and runner_up[0] > nearest[0]:
            return nearest[1]
    return None


def ground_entity_links(text: str, session: Any, run: Any) -> GroundingResult:
    """Expand handles, validate or repair every link, then auto-link plain titles.

    Rejections preserve unescaped prose and are observable, but neither the
    session nor the run is mutated. All terminal paths share this validator.
    """
    result = GroundingResult(text=text)
    if not text:
        return result
    lookup = build_lookup(session, run)
    if ENTITY_LINK_PATTERN.search(text):
        handles = merged_handle_map(session, run)
        known_ids = {entity_id for _, entity_id in lookup}
        prefixes = {
            context.handle_prefix: roadmap_id
            for roadmap_id, context in session.metadata.roadmaps.items()
            if context.handle_prefix
        }

        def expand(match: re.Match[str]) -> str:
            label, kind, raw_id = match.groups()
            link_text = _unescape(label)
            resolved_id = normalize_uuid(raw_id)
            if not resolved_id:
                entry = handles.get(raw_id)
                if entry is not None:
                    resolved_id = normalize_uuid(entry.get('id'))
                elif re.fullmatch(r'R\d+', raw_id) and raw_id in prefixes:
                    resolved_id = normalize_uuid(prefixes[raw_id])
                if resolved_id:
                    result.expanded += 1
            registered = lookup.get((kind, resolved_id)) if resolved_id else None
            reason = None
            if registered is None:
                reason = 'KIND_MISMATCH' if resolved_id in known_ids else 'UNKNOWN_ID'
            elif not titles_match(link_text, registered.title):
                reason = 'TITLE_MISMATCH'
            if reason is None:
                result.kept += 1
                if is_uuid_like(raw_id):
                    return match.group(0)
                return f'[{label}](proyekto://{kind}/{resolved_id})'
            repaired = _repair(kind, resolved_id, raw_id, link_text, reason, lookup)
            if repaired is not None:
                result.repaired += 1
                log_event(
                    _logger,
                    'entity_link_repaired',
                    run_id=run.run_id,
                    kind=kind,
                    entity_id=resolved_id or raw_id,
                    reason=reason,
                    repaired_kind=repaired.kind,
                    repaired_id=repaired.id,
                    link_text=link_text,
                    registered_title=repaired.title,
                )
                return f'[{label}](proyekto://{repaired.kind}/{repaired.id})'
            rejection = {
                'run_id': run.run_id,
                'kind': kind,
                'entity_id': resolved_id or raw_id,
                'reason': reason,
                'link_text': link_text,
                'registered_title': registered.title if registered else None,
            }
            result.rejected.append(rejection)
            log_event(_logger, 'entity_link_rejected', **rejection)
            return link_text

        result.text = _FULL_LINK_PATTERN.sub(expand, text)
    result.text, result.auto = autolink_entities(result.text, lookup)
    return result


def _autolink_candidates(lookup: dict[tuple[str, str], EntitySeen]) -> list[tuple[EntitySeen, re.Pattern[str]]]:
    """Long titles that name exactly one observed entity, longest first.

    A project and its default roadmap share a name, as can a workspace and a
    team, so any title shared by two entities is left alone: ambiguity must
    not become a wrong chip.
    """
    groups: dict[str, list[EntitySeen]] = {}
    for entry in lookup.values():
        groups.setdefault(normalize_title(entry.title), []).append(entry)
    candidates: list[tuple[EntitySeen, re.Pattern[str]]] = []
    for normalized, entries in groups.items():
        if len(entries) != 1 or len(normalized) < MIN_AUTOLINK_TITLE_CHARS:
            continue
        entry = entries[0]
        forms = {entry.title.strip()}
        stripped = re.sub(r'^\s*\([^)]*\)\s*', '', entry.title, count=1).strip()
        if stripped and len(normalize_title(stripped)) >= MIN_AUTOLINK_TITLE_CHARS:
            forms.add(stripped)
        for form in forms:
            words = form.split()
            if not words:
                continue
            pattern = re.compile(
                r'(?<!\w)' + r'\s+'.join(re.escape(word) for word in words) + r'(?!\w)',
                re.IGNORECASE,
            )
            candidates.append((entry, pattern))
    candidates.sort(key=lambda pair: len(pair[1].pattern), reverse=True)
    return candidates


def _whole_mention(text: str, start: int, end: int) -> bool:
    before = text[:start].rstrip(' \t')
    after = text[end:].lstrip(' \t')
    return (
        (not before or before[-1] in _AUTOLINK_DELIMITERS or before[-1] in '\r\n')
        and (not after or after[0] in _AUTOLINK_DELIMITERS or after[0] in '\r\n')
    )


def autolink_entities(text: str, lookup: dict[tuple[str, str], EntitySeen]) -> tuple[str, int]:
    """Link whole plain-text mentions of unambiguous observed titles.

    Returns the rewritten text and how many links were added. The label keeps
    the model's own spelling; the chip swaps in the canonical title when the
    two agree.
    """
    if not text:
        return text, 0
    candidates = _autolink_candidates(lookup)
    if not candidates:
        return text, 0
    protected = [match.span() for match in _PROTECTED_SPAN_PATTERN.finditer(text)]
    replacements: list[tuple[int, int, str]] = []
    for entry, pattern in candidates:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(s < end and start < e for s, e in protected):
                continue
            if not _whole_mention(text, start, end):
                continue
            replacements.append((start, end, entity_link(match.group(0), entry.kind, entry.id)))
            protected.append((start, end))
    if not replacements:
        return text, 0
    replacements.sort()
    pieces: list[str] = []
    cursor = 0
    for start, end, replacement in replacements:
        pieces.append(text[cursor:start])
        pieces.append(replacement)
        cursor = end
    pieces.append(text[cursor:])
    return ''.join(pieces), len(replacements)


def expand_entity_links(text: str, session: Any, run: Any) -> str:
    """Compatibility wrapper; new callers use the grounding counters too."""
    return ground_entity_links(text, session, run).text
