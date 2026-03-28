from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class DeterministicContextIntent:
    name: str
    pending_kind: Literal[
        'roadmap_overview',
        'my_tasks',
        'features_of_epic',
        'tasks_of_feature',
        'epics_in_roadmap',
    ]
    resolver_node_type: Literal['epic', 'feature'] | None
    entity_plural: str
    item_plural: str
    item_singular: str
    parse_mode: str
    question_pattern: re.Pattern[str] | None
    requires_label: bool = True


DETERMINISTIC_CONTEXT_INTENTS: tuple[DeterministicContextIntent, ...] = (
    DeterministicContextIntent(
        name='roadmap_overview',
        pending_kind='roadmap_overview',
        resolver_node_type=None,
        entity_plural='roadmap',
        item_plural='items',
        item_singular='item',
        parse_mode='deterministic_context_overview',
        question_pattern=None,
        requires_label=False,
    ),
    DeterministicContextIntent(
        name='my_tasks',
        pending_kind='my_tasks',
        resolver_node_type=None,
        entity_plural='tasks',
        item_plural='tasks',
        item_singular='task',
        parse_mode='deterministic_context_my_tasks',
        question_pattern=re.compile(
            r'\b(?:my\s+tasks?|tasks?\s+(?:assigned\s+to|for)\s+me|assigned\s+to\s+me)\b',
            re.IGNORECASE,
        ),
        requires_label=False,
    ),
    DeterministicContextIntent(
        name='features',
        pending_kind='features_of_epic',
        resolver_node_type='epic',
        entity_plural='epics',
        item_plural='features',
        item_singular='feature',
        parse_mode='deterministic_context_features',
        question_pattern=re.compile(
            r'features?\s+(?:of|for|under|in)\s+(.+?)(?:\?|$)',
            re.IGNORECASE,
        ),
    ),
    DeterministicContextIntent(
        name='tasks',
        pending_kind='tasks_of_feature',
        resolver_node_type='feature',
        entity_plural='features',
        item_plural='tasks',
        item_singular='task',
        parse_mode='deterministic_context_tasks',
        question_pattern=re.compile(
            r'tasks?\s+(?:of|for|under|in)\s+(.+?)(?:\?|$)',
            re.IGNORECASE,
        ),
    ),
    DeterministicContextIntent(
        name='epics',
        pending_kind='epics_in_roadmap',
        resolver_node_type=None,
        entity_plural='roadmap',
        item_plural='epics',
        item_singular='epic',
        parse_mode='deterministic_context_epics',
        question_pattern=re.compile(
            r'\b(?:list|show|tell(?:\s+me)?|what\s+are)\b.*\bepics?\b|\ball\s+epics?\b(?:.*\broadmap\b)?',
            re.IGNORECASE,
        ),
        requires_label=False,
    ),
)


def normalize_context_label(label: str) -> str:
    cleaned = label.strip().strip('"\'')
    cleaned = re.sub(
        r'^\s*(?:the\s+)?(?:epic|feature|task)\s+',
        '',
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r'[?.!,;:]+$', '', cleaned).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned


def should_include_ids(user_message: str) -> bool:
    lowered = user_message.lower()
    return bool(
        re.search(r'\bwith\s+ids?\b', lowered)
        or re.search(r'\binclude\s+ids?\b', lowered)
        or re.search(r'\bshow\s+.*\bids?\b', lowered)
        or re.search(r'\bepic\s+ids?\b', lowered)
    )


def is_global_overview_query(user_message: str) -> bool:
    lowered = user_message.lower()
    if not lowered.strip():
        return False
    if 'overall roadmap' in lowered:
        return True

    has_scope = bool(
        re.search(r'\b(this\s+roadmap|overall\s+roadmap|roadmap|all\s+items)\b', lowered)
    )
    has_list = bool(
        re.search(r'\b(list|show|tell(?:\s+me)?|what\s+are|overview|all)\b', lowered)
    )
    has_entities = bool(re.search(r'\b(epics?|features?|tasks?|items?)\b', lowered))
    return has_scope and has_list and has_entities


def is_generic_roadmap_label(label: str) -> bool:
    normalized = label.strip().lower()
    normalized = re.sub(r'^\s*the\s+', '', normalized).strip()
    return normalized in {
        'roadmap',
        'this roadmap',
        'overall roadmap',
        'the roadmap',
        'this overall roadmap',
        'all roadmap',
        'all items',
    }


def get_deterministic_context_intent(
    pending_kind: str,
) -> DeterministicContextIntent | None:
    for intent in DETERMINISTIC_CONTEXT_INTENTS:
        if intent.pending_kind == pending_kind:
            return intent
    return None


def match_global_overview_intent(
    user_message: str,
) -> tuple[DeterministicContextIntent, str] | None:
    intent = get_deterministic_context_intent('roadmap_overview')
    if intent is None:
        return None
    if is_global_overview_query(user_message):
        return intent, ''
    return None


def match_deterministic_context_intent(
    user_message: str,
) -> tuple[DeterministicContextIntent, str] | None:
    for intent in DETERMINISTIC_CONTEXT_INTENTS:
        if intent.pending_kind == 'roadmap_overview':
            continue
        if intent.question_pattern is None:
            continue
        match = intent.question_pattern.search(user_message)
        if not match:
            continue
        if not intent.requires_label:
            return intent, ''
        label = normalize_context_label(match.group(1))
        if label:
            return intent, label
    return None
