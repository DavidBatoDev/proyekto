"""Parse the web's structured sentinels into a ``RunInput``.

The web replays card interactions via three sentinels (same wire format the
pre-run agent parsed):
  - ``__clarifier_answer__\\n{json}``  — answer to an ask_user / clarifier card
  - ``__plan_answers__\\n{json}``       — answers to plan clarifier questions
  - ``__plan_decision__\\n{json}``      — Apply/Reject on a proposal card

``parse_user_input`` classifies the message and folds it into the natural-
language text the model sees (``RunInput.text``); the folding text is
unchanged from the single-loop agent. It has NO side effects — a plan
rejection is a run transition the orchestrator applies (clear the pending
plan, cancel the run without a model call), not something parsing does.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

from app.core.contracts.runs import ContextRef
from app.core.contracts.sessions import AgentSession

_PLAN_ANSWER_SENTINEL = '__plan_answers__'
_CLARIFIER_ANSWER_SENTINEL = '__clarifier_answer__'
_PLAN_DECISION_SENTINEL = '__plan_decision__'

RunInputKind = Literal['message', 'clarifier_answer', 'plan_answers', 'plan_decision']
PlanDecision = Literal['confirm', 'reject']

REJECT_FOLD_TEXT = 'Cancel the proposed plan — do not apply it.'
CONFIRM_FOLD_TEXT = (
    'Apply the plan you proposed: stage the concrete roadmap operations '
    'to create it now.'
)


@dataclass
class RunInput:
    kind: RunInputKind
    # Folded text handed to the model (sentinels resolved).
    text: str
    raw: str = ''
    # plan_decision only.
    decision: PlanDecision | None = None
    plan_id: str | None = None
    note: str | None = None
    # clarifier_answer only: the card's question_id when the web sent it.
    question_id: str | None = None
    refs: list[ContextRef] = field(default_factory=list)

    @property
    def is_reject(self) -> bool:
        return self.kind == 'plan_decision' and self.decision == 'reject'

    @property
    def is_confirm(self) -> bool:
        return self.kind == 'plan_decision' and self.decision == 'confirm'


def parse_user_input(
    session: AgentSession,
    message: str,
    refs: list[ContextRef] | None = None,
) -> RunInput:
    raw = message or ''
    stripped = raw.strip()
    refs = list(refs or [])
    if stripped.startswith(_PLAN_DECISION_SENTINEL):
        return _parse_plan_decision(stripped, raw, refs)
    if stripped.startswith(_CLARIFIER_ANSWER_SENTINEL):
        parsed = _body(stripped, _CLARIFIER_ANSWER_SENTINEL)
        question_id = None
        if isinstance(parsed, dict):
            candidate = parsed.get('question_id')
            question_id = candidate.strip() if isinstance(candidate, str) and candidate.strip() else None
        return RunInput(
            kind='clarifier_answer',
            text=_fold_clarifier_answer(stripped),
            raw=raw,
            question_id=question_id,
            refs=refs,
        )
    if stripped.startswith(_PLAN_ANSWER_SENTINEL):
        return RunInput(
            kind='plan_answers',
            text=_fold_plan_answers(session, stripped),
            raw=raw,
            refs=refs,
        )
    return RunInput(kind='message', text=raw, raw=raw, refs=refs)


def parse_and_fold(session: AgentSession, user_message: str) -> str:
    """The folded text only (no classification)."""
    return parse_user_input(session, user_message).text


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


def _parse_plan_decision(stripped: str, raw: str, refs: list[ContextRef]) -> RunInput:
    parsed = _body(stripped, _PLAN_DECISION_SENTINEL)
    if not isinstance(parsed, dict):
        # Malformed decision: treat as a plain message so the model can react.
        return RunInput(kind='message', text=stripped, raw=raw, refs=refs)
    decision_raw = str(parsed.get('decision') or '').strip().lower()
    plan_id_raw = parsed.get('plan_id')
    plan_id = plan_id_raw.strip() if isinstance(plan_id_raw, str) and plan_id_raw.strip() else None
    note_raw = parsed.get('note')
    note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
    if decision_raw == 'reject':
        return RunInput(
            kind='plan_decision',
            text=REJECT_FOLD_TEXT,
            raw=raw,
            decision='reject',
            plan_id=plan_id,
            note=note,
            refs=refs,
        )
    # confirm (or anything else): keep the pending plan in metadata (it rides
    # in the compact state header) and instruct the model to stage it.
    suffix = f' Note: {note}' if note else ''
    return RunInput(
        kind='plan_decision',
        text=CONFIRM_FOLD_TEXT + suffix,
        raw=raw,
        decision='confirm',
        plan_id=plan_id,
        note=note,
        refs=refs,
    )
