from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from app.core.contracts.sessions import ResolverCandidate

NodeKind = Literal['epic', 'feature', 'task']

_SELECTION_WORDS: dict[str, int] = {
    'first': 1,
    'second': 2,
    'third': 3,
    'fourth': 4,
    'fifth': 5,
}


@dataclass
class RenameIntent:
    label: str
    new_title: str
    node_type: NodeKind | None = None


@dataclass
class MarkStatusIntent:
    label: str
    status: str
    node_type: NodeKind | None = None


@dataclass
class MoveIntent:
    label: str
    target_label: str
    node_type: NodeKind | None = None
    target_node_type: NodeKind | None = None


@dataclass
class ResolutionResult:
    status: Literal['unique', 'ambiguous', 'not_found']
    candidates: list[ResolverCandidate]
    selected: ResolverCandidate | None = None


def extract_rename_intent(message: str) -> RenameIntent | None:
    text = message.strip()
    if not text:
        return None

    typed_pattern = re.compile(
        r'rename(?:\s+my|\s+the)?\s+(.+?)\s+(epic|feature|task)\s+to\s+(.+)$',
        re.IGNORECASE,
    )
    typed_match = typed_pattern.search(text)
    if typed_match:
        label = _clean_fragment(typed_match.group(1))
        node_type = typed_match.group(2).lower()
        new_title = _clean_fragment(typed_match.group(3))
        if label and new_title:
            return RenameIntent(label=label, new_title=new_title, node_type=node_type)  # type: ignore[arg-type]

    generic_pattern = re.compile(
        r'(?:rename|retitle|change(?:\s+the)?\s+name(?:\s+of)?)\s+(.+?)\s+(?:to|as)\s+(.+)$',
        re.IGNORECASE,
    )
    generic_match = generic_pattern.search(text)
    if not generic_match:
        return None

    label_fragment = _clean_fragment(generic_match.group(1))
    new_title = _clean_fragment(generic_match.group(2))
    if not label_fragment or not new_title:
        return None
    inferred_node_type = infer_node_type(label_fragment)
    return RenameIntent(
        label=_strip_node_type_words(label_fragment),
        new_title=new_title,
        node_type=inferred_node_type,
    )


def infer_node_type(text: str) -> NodeKind | None:
    lowered = text.lower()
    if 'epic' in lowered:
        return 'epic'
    if 'feature' in lowered:
        return 'feature'
    if 'task' in lowered:
        return 'task'
    return None


def extract_mark_status_intent(message: str) -> MarkStatusIntent | None:
    text = message.strip()
    if not text:
        return None

    typed_pattern = re.compile(
        r'(?:mark|set)\s+(.+?)\s+(epic|feature|task)\s+(?:status\s+)?(?:as|to)\s+(.+)$',
        re.IGNORECASE,
    )
    typed_match = typed_pattern.search(text)
    if typed_match:
        label = _clean_fragment(typed_match.group(1))
        node_type = typed_match.group(2).lower()
        status = _normalize_status_label(typed_match.group(3))
        if label and status:
            return MarkStatusIntent(
                label=_strip_node_type_words(label),
                status=status,
                node_type=node_type,  # type: ignore[arg-type]
            )

    generic_pattern = re.compile(
        r'(?:mark|set)\s+(.+?)\s+(?:status\s+)?(?:as|to)\s+(.+)$',
        re.IGNORECASE,
    )
    generic_match = generic_pattern.search(text)
    if not generic_match:
        return None
    label_fragment = _clean_fragment(generic_match.group(1))
    status = _normalize_status_label(generic_match.group(2))
    if not label_fragment or not status:
        return None
    inferred_node_type = infer_node_type(label_fragment)
    return MarkStatusIntent(
        label=_strip_node_type_words(label_fragment),
        status=status,
        node_type=inferred_node_type,
    )


def extract_move_intent(message: str) -> MoveIntent | None:
    text = message.strip()
    if not text:
        return None

    typed_pattern = re.compile(
        r'move\s+(.+?)\s+(epic|feature|task)\s+(?:under|to)\s+(.+?)(?:\s+(epic|feature|task))?$',
        re.IGNORECASE,
    )
    typed_match = typed_pattern.search(text)
    if typed_match:
        source_label = _clean_fragment(typed_match.group(1))
        source_type = typed_match.group(2).lower()
        target_label = _clean_fragment(typed_match.group(3))
        target_type = (
            typed_match.group(4).lower().strip()
            if typed_match.group(4)
            else infer_node_type(target_label)
        )
        if source_label and target_label:
            return MoveIntent(
                label=_strip_node_type_words(source_label),
                target_label=_strip_node_type_words(target_label),
                node_type=source_type,  # type: ignore[arg-type]
                target_node_type=target_type if target_type in {'epic', 'feature', 'task'} else None,
            )

    generic_pattern = re.compile(
        r'move\s+(.+?)\s+(?:under|to)\s+(.+)$',
        re.IGNORECASE,
    )
    generic_match = generic_pattern.search(text)
    if not generic_match:
        return None
    source_label = _clean_fragment(generic_match.group(1))
    target_label = _clean_fragment(generic_match.group(2))
    if not source_label or not target_label:
        return None
    source_type = infer_node_type(source_label)
    target_type = infer_node_type(target_label)
    return MoveIntent(
        label=_strip_node_type_words(source_label),
        target_label=_strip_node_type_words(target_label),
        node_type=source_type,
        target_node_type=target_type,
    )


def resolve_candidates(
    matches: list[dict[str, Any]],
    *,
    label: str,
    node_type: str | None,
) -> ResolutionResult:
    normalized_label = normalize_text(label)
    scored: list[ResolverCandidate] = []
    for raw in matches:
        match_id = str(raw.get('id', '')).strip()
        title = str(raw.get('title', '')).strip()
        match_type = str(raw.get('type', '')).strip().lower()
        if not match_id or not title or match_type not in {'epic', 'feature', 'task'}:
            continue
        if node_type is not None and match_type != node_type:
            continue
        score = _safe_float(raw.get('score'))
        if score is None:
            score = _score_title_match(normalized_label, normalize_text(title), node_type, match_type)
        matched_fields = _safe_str_list(raw.get('matched_fields'))
        scored.append(
            ResolverCandidate(
                id=match_id,
                type=match_type,
                title=title,
                parent_id=_safe_str(raw.get('parent_id')),
                parent_title=_safe_str(raw.get('parent_title')),
                confidence=round(score, 4),
                matched_fields=matched_fields if matched_fields else None,
            )
        )

    scored.sort(key=lambda item: (item.confidence or 0, item.title.lower()), reverse=True)
    if not scored:
        return ResolutionResult(status='not_found', candidates=[])
    if len(scored) == 1:
        return ResolutionResult(status='unique', candidates=scored, selected=scored[0])

    top = scored[0].confidence or 0
    second = scored[1].confidence or 0
    if top >= 0.95 and (top - second) >= 0.15:
        return ResolutionResult(status='unique', candidates=scored, selected=scored[0])
    return ResolutionResult(status='ambiguous', candidates=scored)


def parse_selection_index(message: str) -> int | None:
    lowered = _normalize_selection_text(message)
    if not lowered:
        return None

    digit_match = re.fullmatch(r'(\d{1,2})', lowered)
    if digit_match:
        return int(digit_match.group(1))

    option_match = re.fullmatch(r'option\s+(\d{1,2})', lowered)
    if option_match:
        return int(option_match.group(1))

    optional_the = re.fullmatch(r'(?:the\s+)?(first|second|third|fourth|fifth)', lowered)
    if optional_the:
        return _SELECTION_WORDS.get(optional_the.group(1))

    for label, value in _SELECTION_WORDS.items():
        if lowered == label:
            return value
    return None


def build_ambiguity_message(label: str, candidates: list[ResolverCandidate]) -> str:
    if not candidates:
        return (
            f'I found multiple matches for "{label}", but could not rank them safely. '
            'Please restate the target with more context.'
        )
    lines = [f'I found multiple matches for "{label}". Please choose one:']
    for index, item in enumerate(candidates[:5], start=1):
        parent_hint = f' under "{item.parent_title}"' if item.parent_title else ''
        lines.append(f'{index}. {item.type} "{item.title}"{parent_hint}')
    lines.append('Reply with the option number (for example, "1").')
    return '\n'.join(lines)


def normalize_text(text: str) -> str:
    cleaned = _clean_fragment(text).lower()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


def _score_title_match(
    normalized_label: str,
    normalized_title: str,
    expected_type: str | None,
    actual_type: str,
) -> float:
    score = 0.0
    if normalized_title == normalized_label:
        score += 1.0
    elif normalized_title.startswith(normalized_label):
        score += 0.85
    elif normalized_label in normalized_title:
        score += 0.65
    elif normalized_title in normalized_label:
        score += 0.55
    if expected_type is not None and actual_type == expected_type:
        score += 0.2
    return min(score, 1.0)


def _clean_fragment(text: str) -> str:
    cleaned = text.strip().strip('"\'')
    cleaned = re.sub(r'[?.!,;:]+$', '', cleaned).strip()
    return cleaned


def _strip_node_type_words(label: str) -> str:
    return re.sub(r'\b(epic|feature|task)\b', '', label, flags=re.IGNORECASE).strip()


def _safe_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _safe_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and item.strip()]


def _normalize_selection_text(text: str) -> str:
    normalized = text.strip().lower()
    normalized = re.sub(r'[.!?,;:]+$', '', normalized).strip()
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized


def _normalize_status_label(value: str) -> str | None:
    normalized = _clean_fragment(value).lower()
    normalized = re.sub(r'\s+', '_', normalized)
    aliases = {
        'in_progress': 'in_progress',
        'progress': 'in_progress',
        'in_review': 'in_review',
        'review': 'in_review',
        'not_started': 'not_started',
        'todo': 'todo',
        'done': 'done',
        'completed': 'completed',
        'complete': 'completed',
        'blocked': 'blocked',
        'backlog': 'backlog',
        'planned': 'planned',
        'on_hold': 'on_hold',
        'active': 'active',
        'paused': 'paused',
        'archived': 'archived',
    }
    return aliases.get(normalized)
