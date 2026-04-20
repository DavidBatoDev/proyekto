from __future__ import annotations

import re
from typing import Any

from app.core.contracts.sessions import IntentType


_HEURISTIC_ACTION_VERB_PATTERN = (
    r'(?:add|create|move|delete|remove|update|updated|mark|shift|link|unlink|'
    r'rename|retitle|change|changed|assign|assigned|reassign|reassigned|unassign|'
    r'unassigned)'
)

_QUESTION_STYLE_ACTION_VERB_PATTERN = (
    r'(?:add|create|move|delete|remove|update|updated|mark|shift|link|unlink|'
    r'rename|retitle|change|changed|assign|assigned|reassign|reassigned|unassign|'
    r'unassigned|set|make|complete|close)'
)


def heuristic_intent(user_message: str) -> IntentType:
    text = user_message.strip().lower()
    if not text:
        return 'unclear'
    if re.fullmatch(r'(h+i+|h+e+y+|h+e+l+o+|y+o+)', text) or text in {
        'good morning',
        'good afternoon',
        'good evening',
    }:
        return 'smalltalk'
    if looks_like_confirm_action(text):
        return 'confirm_action'
    if looks_like_roadmap_plan_request(text):
        return 'roadmap_plan'
    if re.search(
        rf'\b{_HEURISTIC_ACTION_VERB_PATTERN}\b',
        text,
    ):
        return 'roadmap_edit'
    if text.endswith('?') or re.search(r'^(what|why|how|when|where|can you|could you|do we)\b', text):
        return 'general_question'
    if re.search(r'\b(list|show|tell(?:\s+me)?)\b.*\b(roadmap|epic|feature|task|milestone)\b', text):
        return 'general_question'
    return 'unclear'


def looks_like_confirm_action(normalized_text: str) -> bool:
    return bool(
        re.fullmatch(
            r"(?:"
            r"(?:ok|okay|yes|yep)(?:\s+(?:please|kindly))?(?:\s+(?:confirm|proceed|go ahead|do it|apply))?"
            r"|(?:confirm|proceed|go ahead|do it|let'?s do it|apply(?: those)? changes?)"
            r")"
            r"(?:\s+(?:please|kindly|now))?"
            r"(?:\s+(?:with\s+)?(?:this|it|that))?"
            r"(?:\s+(?:please|kindly|now))?",
            normalized_text,
        )
    )


def looks_like_roadmap_plan_request(normalized_text: str) -> bool:
    return bool(
        re.search(
            r'\b(?:'
            r'(?:create|build|draft|design)\s+(?:a\s+)?roadmap'
            r'|roadmap\s+for'
            r'|plan\s+(?:a\s+)?roadmap'
            r'|break\s+(?:this|that|it)\s+into'
            r'|suggest\s+(?:tasks?|features?|epics?)'
            r'|propose\s+(?:tasks?|features?|epics?)'
            r'|structure\s+(?:this|that|it)'
            r')\b',
            normalized_text,
        )
    )


# Verbs that unambiguously target a plan's structure rather than the live
# roadmap — either they're structural (add/remove/rename/reorder/merge/split)
# or they explicitly reference the plan itself. Kept in sync with
# `_HEURISTIC_ACTION_VERB_PATTERN` where they overlap.
_PLAN_REVISION_VERB_PATTERN = (
    r'(?:add|create|insert|append|include|remove|drop|delete|'
    r'rename|retitle|change|update|edit|revise|modify|tweak|adjust|swap|'
    r'replace|merge|split|break(?:\s+down)?|combine|consolidate|reorder|'
    r'move|shift|reorganize|reorganise|simplify|shorten|expand|extend|'
    r'shrink|tighten)'
)

_PLAN_REFERENCE_PATTERN = (
    r'\b(?:the\s+)?(?:plan|proposal|proposed|draft|outline|roadmap)\b'
)


def is_plan_revision_message(normalized_text: str) -> bool:
    """Return True when the message reads like a request to modify an
    existing plan (as opposed to confirming it or creating a brand-new one).

    This is a syntactic signal only — the caller must also verify a pending
    plan exists in the session before promoting the intent. Confirmation
    phrases are excluded upstream by `looks_like_confirm_action`.
    """

    text = normalized_text.strip().lower()
    if not text:
        return False
    if not re.search(rf'\b{_PLAN_REVISION_VERB_PATTERN}\b', text):
        return False
    # Short edit messages without explicit plan references still count — when
    # a pending plan exists the caller uses that as the disambiguator. We
    # keep this helper permissive on purpose.
    return True


def is_roadmap_question(
    *,
    intent_type: IntentType,
    user_message: str,
    session_context: dict[str, Any],
) -> bool:
    if not session_context.get('roadmap_id'):
        return False
    if intent_type in {'roadmap_edit', 'roadmap_plan', 'confirm_action'}:
        return False
    if intent_type == 'roadmap_query':
        return True
    if is_question_style_edit_request(user_message):
        return False
    lowered = user_message.strip().lower()
    roadmap_keywords = (
        'roadmap',
        'epic',
        'feature',
        'task',
        'overdue',
        'assigned',
        'assignee',
        'status',
        'timeline',
        'dependency',
        'milestone',
    )
    if any(keyword in lowered for keyword in roadmap_keywords):
        return True
    return intent_type in {'general_question', 'question', 'unclear'}


def is_question_style_edit_request(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').strip().lower().split())
    if not normalized:
        return False
    if not normalized.endswith('?'):
        return False
    if not re.search(rf'\b{_QUESTION_STYLE_ACTION_VERB_PATTERN}\b', normalized):
        return False
    return bool(
        re.search(
            rf'^(?:can|could|would|will)\s+you\b.*\b{_QUESTION_STYLE_ACTION_VERB_PATTERN}\b',
            normalized,
        )
    )


def is_informational_operation_question(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').strip().lower().split())
    if not normalized:
        return False
    if not normalized.endswith('?'):
        return False
    if not re.search(rf'\b{_QUESTION_STYLE_ACTION_VERB_PATTERN}\b', normalized):
        return False
    return bool(
        re.search(
            r'^(?:how\s+(?:do|can)\s+(?:i|we|you)'
            r'|what\s+(?:is|are|does|do)'
            r'|why\b'
            r'|when\b'
            r'|where\b'
            r'|should\s+we\b'
            r'|can\s+we\b)',
            normalized,
        )
    )
