"""Fold the web's structured sentinels into natural-language turns.

The web replays card interactions via three sentinels (same wire format the
v1 pre-dispatcher parses):
  - ``__clarifier_answer__\\n{json}``  — answer to an ask_user / clarifier card
  - ``__plan_answers__\\n{json}``       — answers to plan clarifier questions
  - ``__plan_decision__\\n{json}``      — Apply/Reject on a plan_proposal card

The v1 path routes these through dedicated state machines. The v2 single loop
instead re-enters with the answer folded into the user turn (plus the
deterministic side effect for a plan rejection), letting the model re-decide
with full context. Returns the message string the loop should treat as the
current user turn.
"""

from __future__ import annotations

import json
from typing import Any

from app.core.contracts.sessions import AgentSession
from app.core.orchestration.context.pending_plan_manager import clear_pending_plan

_PLAN_ANSWER_SENTINEL = '__plan_answers__'
_CLARIFIER_ANSWER_SENTINEL = '__clarifier_answer__'
_PLAN_DECISION_SENTINEL = '__plan_decision__'


def parse_and_fold(session: AgentSession, user_message: str) -> str:
    stripped = (user_message or '').strip()
    if stripped.startswith(_PLAN_DECISION_SENTINEL):
        return _fold_plan_decision(session, stripped)
    if stripped.startswith(_CLARIFIER_ANSWER_SENTINEL):
        return _fold_clarifier_answer(stripped)
    if stripped.startswith(_PLAN_ANSWER_SENTINEL):
        return _fold_plan_answers(session, stripped)
    return user_message


def _body(stripped: str, sentinel: str) -> Any:
    body = stripped[len(sentinel):].strip()
    if not body:
        return None
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None


def _answer_text(entry: dict[str, Any]) -> str:
    for key in ('custom_answer', 'selected_option', 'answer', 'selected', 'value'):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def _fold_clarifier_answer(stripped: str) -> str:
    parsed = _body(stripped, _CLARIFIER_ANSWER_SENTINEL)
    if not isinstance(parsed, dict):
        return stripped

    # New multi-question payload: {"answers": [{question, selected_options,
    # custom_answer}, ...]}. A single question with a single value folds to
    # the bare answer string (matching the legacy behavior the model already
    # expects); multiple answers fold to a readable Q/A replay.
    entries = parsed.get('answers')
    if isinstance(entries, list) and entries:
        answered: list[tuple[str, str]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            values = [
                v.strip()
                for v in (entry.get('selected_options') or [])
                if isinstance(v, str) and v.strip()
            ]
            custom = entry.get('custom_answer')
            if isinstance(custom, str) and custom.strip():
                values.append(custom.strip())
            if not values:
                continue
            question = str(entry.get('question') or entry.get('question_text') or '').strip()
            answered.append((question, ', '.join(values)))
        if len(answered) == 1:
            return answered[0][1]
        if answered:
            lines = [f'- {q}: {a}' if q else f'- {a}' for q, a in answered]
            return (
                'My answers to your questions:\n'
                + '\n'.join(lines)
                + '\nPlease continue with these answers.'
            )

    # Legacy single-answer payload (old web bundles).
    answer = _answer_text(parsed)
    return answer or stripped


def _fold_plan_answers(session: AgentSession, stripped: str) -> str:
    parsed = _body(stripped, _PLAN_ANSWER_SENTINEL)
    entries: list[dict[str, Any]] = []
    if isinstance(parsed, dict) and isinstance(parsed.get('answers'), list):
        entries = [e for e in parsed['answers'] if isinstance(e, dict)]
    elif isinstance(parsed, list):
        entries = [e for e in parsed if isinstance(e, dict)]
    elif isinstance(parsed, dict):
        entries = [parsed]

    answers = [text for text in (_answer_text(e) for e in entries) if text]
    pending = session.metadata.pending_plan
    original = ''
    if pending is not None and isinstance(pending.source_user_message, str):
        original = pending.source_user_message.strip()

    parts: list[str] = []
    if original:
        parts.append(f'My original request: {original}')
    if answers:
        parts.append('My answers: ' + '; '.join(answers))
    parts.append('Please produce the plan now with these answers.')
    return '\n'.join(parts) if parts else stripped


def _fold_plan_decision(session: AgentSession, stripped: str) -> str:
    parsed = _body(stripped, _PLAN_DECISION_SENTINEL)
    if not isinstance(parsed, dict):
        return stripped
    decision = parsed.get('decision')
    if decision == 'reject':
        clear_pending_plan(session)
        return 'Cancel the proposed plan — do not apply it.'
    # confirm: keep the pending plan in metadata (it rides in the compact
    # state header) and instruct the model to stage the concrete operations.
    note = parsed.get('note')
    suffix = f' Note: {note}' if isinstance(note, str) and note.strip() else ''
    return (
        'Apply the plan you proposed: stage the concrete roadmap operations '
        'to create it now.' + suffix
    )
