from __future__ import annotations

from difflib import SequenceMatcher
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

_MIN_UNIQUE_CONFIDENCE = 0.6


@dataclass
class CreateIntent:
    node_type: NodeKind
    title: str
    parent_label: str | None = None
    parent_node_type: NodeKind | None = None
    allow_duplicate: bool = False


@dataclass
class ResolutionResult:
    status: Literal['unique', 'ambiguous', 'not_found']
    candidates: list[ResolverCandidate]
    selected: ResolverCandidate | None = None


def infer_node_type(text: str) -> NodeKind | None:
    lowered = text.lower()
    if 'epic' in lowered:
        return 'epic'
    if 'feature' in lowered:
        return 'feature'
    if 'task' in lowered:
        return 'task'
    return None


def extract_create_intent(message: str) -> CreateIntent | None:
    text = _normalize_create_prompt_text(message)
    if not text:
        return None

    allow_duplicate = bool(re.search(r'\bduplicate\s+epic\b', text, re.IGNORECASE))
    epic_anchor_pattern = re.compile(
        r'(?:create|add)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:duplicate\s+)?epic\b.*?\b(?:called|named|titled)\b\s+(?:"([^"]+)"|\'([^\']+)\'|(.+))$',
        re.IGNORECASE,
    )
    epic_anchor_match = epic_anchor_pattern.search(text)
    if epic_anchor_match:
        captured_title = (
            epic_anchor_match.group(1)
            or epic_anchor_match.group(2)
            or epic_anchor_match.group(3)
            or ''
        )
        title = _normalize_create_title(captured_title)
        if title:
            return CreateIntent(
                node_type='epic',
                title=title,
                allow_duplicate=allow_duplicate,
            )

    epic_pattern = re.compile(
        r'(?:create|add)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:duplicate\s+)?epic\b(?:\s+(.+))?$',
        re.IGNORECASE,
    )
    epic_match = epic_pattern.search(text)
    if epic_match:
        title = _normalize_create_title(epic_match.group(1) or '')
        if title:
            return CreateIntent(
                node_type='epic',
                title=title,
                allow_duplicate=allow_duplicate,
            )

    child_pattern = re.compile(
        r'(?:create|add)\s+(?:a|an|new)?\s*(feature|task)\s+(?:called|named|titled)?\s*(.+?)\s+(?:under|in)\s+(.+?)(?:\s+(epic|feature))?$',
        re.IGNORECASE,
    )
    child_match = child_pattern.search(text)
    if child_match:
        node_type = child_match.group(1).lower()
        title = _clean_fragment(child_match.group(2))
        parent_label = _clean_fragment(child_match.group(3))
        explicit_parent_type = (
            child_match.group(4).lower().strip() if child_match.group(4) else None
        )
        inferred_parent_type: NodeKind | None
        if explicit_parent_type in {'epic', 'feature'}:
            inferred_parent_type = explicit_parent_type  # type: ignore[assignment]
        else:
            inferred_parent_type = infer_node_type(parent_label)
        if title and parent_label and node_type in {'feature', 'task'}:
            expected_parent_type = 'epic' if node_type == 'feature' else 'feature'
            parent_type = (
                inferred_parent_type
                if inferred_parent_type in {'epic', 'feature'}
                else expected_parent_type
            )
            return CreateIntent(
                node_type=node_type,  # type: ignore[arg-type]
                title=title,
                parent_label=_strip_node_type_words(parent_label),
                parent_node_type=parent_type,
                allow_duplicate=False,
            )

    return None


def _normalize_create_prompt_text(message: str) -> str:
    text = message.strip()
    if not text:
        return ''
    normalized = re.sub(
        r'^\s*(?:can you|could you|would you|please)\b[\s,:-]*',
        '',
        text,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r'\bfor\s+me\b', ' ', normalized, flags=re.IGNORECASE)
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return normalized


def _normalize_create_title(value: str) -> str | None:
    cleaned = _clean_fragment(value)
    if not cleaned:
        return None
    cleaned = re.sub(
        r'^(?:for\s+me\s+)?(?:called|named|titled)\b(?:\s+|$)',
        '',
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    cleaned = _clean_fragment(cleaned)
    if not cleaned:
        return None
    if re.fullmatch(
        r'(?:epic|feature|task|new|duplicate|called|named|titled)',
        cleaned,
        re.IGNORECASE,
    ):
        return None
    title_tokens = [token for token in re.split(r'\s+', cleaned.lower()) if token]
    stop_tokens = {'a', 'an', 'new', 'duplicate', 'epic', 'feature', 'task', 'called', 'named', 'titled'}
    if title_tokens and all(token in stop_tokens for token in title_tokens):
        return None
    return cleaned


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
        only = scored[0]
        confidence = only.confidence or 0
        if confidence < _MIN_UNIQUE_CONFIDENCE:
            return ResolutionResult(status='not_found', candidates=scored)
        return ResolutionResult(status='unique', candidates=scored, selected=only)

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

    similarity = SequenceMatcher(None, normalized_label, normalized_title).ratio()
    if similarity >= 0.92:
        score = max(score, 0.9)
    elif similarity >= 0.84:
        score = max(score, 0.72)
    elif similarity >= 0.75:
        score = max(score, 0.5)

    if expected_type is not None and actual_type == expected_type:
        score += 0.2
    return min(score, 1.0)


def _clean_fragment(text: str) -> str:
    cleaned = text.strip().strip('"\'')
    cleaned = re.sub(r'[?.!,;:]+$', '', cleaned).strip()
    return cleaned


def _strip_node_type_words(label: str) -> str:
    stripped = re.sub(r'\b(epic|feature|task)\b', '', label, flags=re.IGNORECASE).strip()
    stripped = re.sub(r'^(my|the|this|that|our)\s+', '', stripped, flags=re.IGNORECASE).strip()
    return stripped


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
