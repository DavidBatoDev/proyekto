from __future__ import annotations

import re
import string

from app.core.contracts.sessions import IntentType

_CANONICAL_INTENT_FAMILIES = {
    'rename_node',
    'create_epic',
    'create_feature',
    'create_task',
    'move_node',
    'update_node',
    'delete_node',
    'mark_status',
    'shift_dates',
    'roadmap_edit_clarifier',
}

_INTENT_FAMILY_ALIASES = {
    'rename': 'rename_node',
    'rename_item': 'rename_node',
    'rename_task': 'rename_node',
    'rename_feature': 'rename_node',
    'rename_epic': 'rename_node',
    'move': 'move_node',
    'move_item': 'move_node',
    'update': 'update_node',
    'delete': 'delete_node',
    'mark': 'mark_status',
    'shift': 'shift_dates',
}

_MIXED_QUERY_CUE_PATTERN = re.compile(
    r'\b(?:how many|what|which|who|where|when|summarize|summary|overview|tell me|show me|list|count)\b',
    re.IGNORECASE,
)

_MIXED_EDIT_VERB_PATTERN = re.compile(
    r'\b(?:add|create|remove|delete|mark|rename|move|update|set|assign|unassign|reassign|change)\b',
    re.IGNORECASE,
)


def detect_edit_continuation_trigger(user_message: str) -> str | None:
    normalized = user_message.strip().lower()
    normalized = re.sub(r'[.!?,;:]+', ' ', normalized).strip()
    normalized = re.sub(r'\s+', ' ', normalized)
    if re.fullmatch(
        r'(?:a|option a|no need|no extra details|no additional details|nothing else)',
        normalized,
    ):
        return 'confirm'
    if re.fullmatch(
        r'(?:(?:ok|okay|yes|yep)\s+)?'
        r'(?:cancel|stop|never mind|nevermind|abort)'
        r'(?:\s+(?:please|kindly|now|this|it|that|for now))?',
        normalized,
    ):
        return 'cancel'
    if re.fullmatch(
        r"(?:"
        r"(?:ok|okay|yes|yep)(?:\s+(?:please|kindly))?(?:\s+(?:confirm|proceed|go ahead|do it))?"
        r"|(?:confirm|proceed|go ahead|do it|let'?s do it)"
        r")"
        r"(?:\s+(?:please|kindly|now))?"
        r"(?:\s+(?:with\s+)?(?:this|it|that))?"
        r"(?:\s+(?:please|kindly|now))?",
        normalized,
    ):
        return 'confirm'
    if re.fullmatch(
        r"(?:can you\s+)?(?:try again|retry|again|re-?run|re-?attempt)"
        r"(?:\s+(?:please|kindly|now))?",
        normalized,
    ):
        return 'retry'
    if re.search(
        r'\b(i meant|instead|inside|under|in that|it should|changed my mind|change my mind)\b',
        normalized,
    ):
        return 'correction'
    return None


def extract_mixed_query_followup_message(
    *,
    user_message: str,
    preview_intent: IntentType,
    mixed_query_cue_pattern: re.Pattern[str] = _MIXED_QUERY_CUE_PATTERN,
    mixed_edit_verb_pattern: re.Pattern[str] = _MIXED_EDIT_VERB_PATTERN,
) -> str | None:
    if preview_intent != 'roadmap_edit':
        return None
    message = ' '.join(user_message.strip().split())
    if not message:
        return None

    for query_match in mixed_query_cue_pattern.finditer(message):
        start = query_match.start()
        if start <= 0:
            continue
        prefix = message[:start]
        if not mixed_edit_verb_pattern.search(prefix):
            continue
        bridge_window = message[max(0, start - 32) : start]
        if not re.search(r'(?:\band\b|\bthen\b|[;,.])', bridge_window, re.IGNORECASE):
            continue
        query_tail = message[start:]
        query_tail = re.sub(
            r'^(?:and|then|also|plus)\s+',
            '',
            query_tail,
            flags=re.IGNORECASE,
        ).strip()
        query_tail = query_tail.rstrip(' .!?')
        if len(query_tail.split()) < 3:
            continue
        return query_tail
    return None


def extract_mixed_edit_primary_message(
    *,
    user_message: str,
    query_message: str | None,
) -> str | None:
    if not query_message:
        return None
    message = ' '.join(user_message.strip().split())
    query_tail = ' '.join(query_message.strip().split())
    if not message or not query_tail:
        return None
    lowered_message = message.lower()
    lowered_query = query_tail.lower()
    query_index = lowered_message.find(lowered_query)
    if query_index <= 0:
        return None

    primary = message[:query_index].rstrip(' ,;:.!?')
    primary = re.sub(
        r'(?:\b(?:and|then|also|plus)\b\s*)+$',
        '',
        primary,
        flags=re.IGNORECASE,
    ).strip()
    if len(primary.split()) < 2:
        return None
    return primary


def strip_quotes_and_punctuation(value: str) -> str:
    cleaned = value.strip()
    cleaned = cleaned.strip('"\'`')
    cleaned = re.sub(r'[.?!,;:]+$', '', cleaned)
    return ' '.join(cleaned.split())


def normalize_label_for_matching(value: str) -> str:
    lowered = value.lower().strip()
    normalized = re.sub(r'[^a-z0-9]+', ' ', lowered)
    return ' '.join(normalized.split())


def extract_rename_labels(user_message: str) -> tuple[str, str] | None:
    text = ' '.join(user_message.strip().split())
    if not text:
        return None

    patterns = [
        r'(?i)\b(?:rename|retitle)\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
        r'(?i)\bchange(?:\s+the)?\s+name(?:\s+of)?\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match is None:
            continue
        from_label = strip_quotes_and_punctuation(match.group(1))
        to_title = strip_quotes_and_punctuation(match.group(2))
        if from_label and to_title:
            return from_label, to_title
    return None


def is_rename_message(user_message: str) -> bool:
    normalized = user_message.strip().lower()
    if not normalized:
        return False
    return normalized.startswith('rename ') or ' rename ' in normalized


def normalize_label(value: str) -> str:
    lowered = value.strip().lower()
    if not lowered:
        return ''
    lowered = lowered.translate(str.maketrans('', '', string.punctuation.replace('-', '')))
    lowered = lowered.replace('-', ' ')
    lowered = re.sub(r'\s+', ' ', lowered).strip()
    return lowered


def fallback_label(value: str) -> str | None:
    tokens = [token for token in value.split(' ') if token]
    if len(tokens) <= 1:
        return None
    if len(tokens[-1]) >= 4:
        return tokens[-1]
    if len(tokens) >= 2 and len(tokens[-2]) >= 4:
        return tokens[-2]
    return None


def normalize_intent_family(
    value: str | None,
    *,
    aliases: dict[str, str] | None = None,
    canonical_families: set[str] | None = None,
) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return 'roadmap_edit_clarifier'
    alias_map = aliases if aliases is not None else _INTENT_FAMILY_ALIASES
    canonical = (
        canonical_families
        if canonical_families is not None
        else _CANONICAL_INTENT_FAMILIES
    )
    normalized = alias_map.get(normalized, normalized)
    if normalized not in canonical:
        return 'roadmap_edit_clarifier'
    return normalized


def extract_rename_intent(user_message: str) -> tuple[str, str] | None:
    rename_match = re.search(
        r'rename\s+(?:my\s+)?["\']?(.+?)["\']?\s+to\s+["\']?(.+?)["\']?$',
        user_message.strip(),
        re.IGNORECASE,
    )
    if rename_match is None:
        return None
    from_label = rename_match.group(1).strip()
    to_title = rename_match.group(2).strip()
    if not from_label or not to_title:
        return None
    return from_label, to_title
