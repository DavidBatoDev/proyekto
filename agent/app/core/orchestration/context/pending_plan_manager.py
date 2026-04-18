"""Persist, render, and clear a strategic plan awaiting user confirmation.

The plan lane emits a structured JSON envelope (see plan_mode/v1.md) instead of
staging operations. This module parses that envelope into a `PendingPlan`
model, stores it on `session.metadata.pending_plan`, and renders a compact
prose section that the planner injects into the next system prompt so a
follow-up `confirm_action` turn sees the plan verbatim.

Mirrors `applied_changes_log.py` in style: pure functions that read/write the
session, no I/O side effects beyond emitting log events.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from app.core.contracts.sessions import (
    AgentSession,
    PendingPlan,
    PendingPlanAnswer,
    PendingPlanQuestion,
)
from app.core.logging_utils import log_event


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _compute_overview_hash(overview_summary: str | None) -> str | None:
    if not isinstance(overview_summary, str) or not overview_summary.strip():
        return None
    digest = hashlib.sha1(overview_summary.strip().encode('utf-8'))
    return digest.hexdigest()[:16]


def record_pending_plan_from_planner_output(
    session: AgentSession,
    *,
    payload: dict[str, Any] | None,
    user_message: str,
    trace_id: str | None,
    logger: logging.Logger,
    settings: Any,
    planning_turn_id: str | None = None,
) -> PendingPlan | None:
    """Dispatch on the planner envelope's `status` key:
      - `needs_answer` → store the clarifier question, status='awaiting_answers'
      - `plan_ready` (or legacy envelopes without status) → store the plan

    Returns the persisted `PendingPlan` on success, `None` when the payload is
    missing or fails validation.
    """

    if not isinstance(payload, dict):
        log_event(
            logger,
            'pending_plan_record_skipped',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            reason='payload_missing',
        )
        return None

    status = (payload.get('status') or '').strip().lower()
    if status == 'needs_answer':
        return _record_pending_plan_question(
            session,
            payload=payload,
            user_message=user_message,
            trace_id=trace_id,
            logger=logger,
            settings=settings,
            planning_turn_id=planning_turn_id,
        )
    # Default: treat as plan_ready (terminal envelope). Empty envelopes are
    # still rejected further down via the non-empty hierarchy check.
    return _record_pending_plan_final(
        session,
        payload=payload,
        user_message=user_message,
        trace_id=trace_id,
        logger=logger,
        settings=settings,
        planning_turn_id=planning_turn_id,
    )


def _record_pending_plan_question(
    session: AgentSession,
    *,
    payload: dict[str, Any],
    user_message: str,
    trace_id: str | None,
    logger: logging.Logger,
    settings: Any,
    planning_turn_id: str | None,
) -> PendingPlan | None:
    question_raw = payload.get('question')
    if not isinstance(question_raw, dict):
        log_event(
            logger,
            'pending_plan_question_missing',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
        )
        return None

    try:
        question = PendingPlanQuestion(**{
            key: value
            for key, value in question_raw.items()
            if key in PendingPlanQuestion.model_fields
        })
    except ValidationError as exc:
        log_event(
            logger,
            'pending_plan_question_schema_invalid',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            error_count=len(exc.errors()),
            first_error=exc.errors()[0] if exc.errors() else None,
        )
        return None

    # Preserve accumulated answers and the original source_user_message from
    # the first turn of the planning session. This is the multi-turn bit: each
    # needs_answer envelope narrows the plan by adding one more Q/A pair.
    existing = session.metadata.pending_plan
    previous_answers: list[PendingPlanAnswer] = (
        list(existing.answers) if existing is not None else []
    )
    source_user_message = (
        existing.source_user_message
        if existing is not None and existing.source_user_message
        else user_message
    )
    plan_kwargs: dict[str, Any] = {
        'planning_turn_id': planning_turn_id,
        'summary': '',
        'goal': '',
        'source_user_message': source_user_message,
        'status': 'awaiting_answers',
        'current_question': question,
        'answers': previous_answers,
        'base_revision': session.base_revision,
        'revision_token': session.revision_token,
        'roadmap_overview_hash': _compute_overview_hash(
            session.metadata.roadmap_overview_summary
        ),
    }
    if existing is not None:
        plan_kwargs['plan_id'] = existing.plan_id
    plan = PendingPlan(**plan_kwargs)
    plan.updated_at = _utcnow()
    session.metadata.pending_plan = plan

    log_event(
        logger,
        'pending_plan_question_recorded',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        plan_id=plan.plan_id,
        question_id=question.id,
        option_count=len(question.options),
        allow_custom=question.allow_custom,
        answers_so_far=len(previous_answers),
    )
    return plan


def _record_pending_plan_final(
    session: AgentSession,
    *,
    payload: dict[str, Any],
    user_message: str,
    trace_id: str | None,
    logger: logging.Logger,
    settings: Any,
    planning_turn_id: str | None,
) -> PendingPlan | None:
    payload_for_model = dict(payload)
    payload_for_model.pop('status', None)
    payload_for_model.setdefault('source_user_message', user_message)
    payload_for_model.setdefault('summary', payload_for_model.get('summary') or '')
    payload_for_model.setdefault('goal', payload_for_model.get('goal') or user_message)
    if planning_turn_id is not None:
        payload_for_model.setdefault('planning_turn_id', planning_turn_id)
    allowed_keys = set(PendingPlan.model_fields.keys())
    payload_for_model = {
        key: value for key, value in payload_for_model.items() if key in allowed_keys
    }
    # Preserve accumulated answers so the UI can keep showing the Q&A trail.
    existing = session.metadata.pending_plan
    if existing is not None and existing.answers and not payload_for_model.get('answers'):
        payload_for_model['answers'] = [
            answer.model_dump(mode='json', exclude_none=True)
            for answer in existing.answers
        ]

    try:
        plan = PendingPlan(**payload_for_model)
    except ValidationError as exc:
        log_event(
            logger,
            'pending_plan_schema_invalid',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            error_count=len(exc.errors()),
            first_error=exc.errors()[0] if exc.errors() else None,
        )
        return None

    # Reject empty terminal envelopes — the prompt requires a non-empty draft.
    if plan.status == 'proposed' and not plan.proposed_hierarchy:
        log_event(
            logger,
            'pending_plan_rejected_empty_hierarchy',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
        )
        return None

    plan.base_revision = session.base_revision
    plan.revision_token = session.revision_token
    plan.roadmap_overview_hash = _compute_overview_hash(
        session.metadata.roadmap_overview_summary
    )
    plan.current_question = None  # terminal envelope → no pending question
    plan.status = 'proposed'
    plan.updated_at = _utcnow()

    if existing is not None and existing.status in {'proposed', 'awaiting_answers'}:
        log_event(
            logger,
            'pending_plan_superseded',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            previous_plan_id=existing.plan_id,
            previous_status=existing.status,
            new_plan_id=plan.plan_id,
        )

    session.metadata.pending_plan = plan
    log_event(
        logger,
        'pending_plan_recorded',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        plan_id=plan.plan_id,
        epic_count=len(plan.proposed_hierarchy),
        feature_count=sum(len(epic.features) for epic in plan.proposed_hierarchy),
        task_count=sum(
            len(feature.tasks)
            for epic in plan.proposed_hierarchy
            for feature in epic.features
        ),
        answers_incorporated=len(plan.answers),
        base_revision=plan.base_revision,
    )
    return plan


def append_plan_answer(
    session: AgentSession,
    *,
    answer: PendingPlanAnswer,
    logger: logging.Logger,
    settings: Any,
    trace_id: str | None = None,
) -> bool:
    """Append a user answer to the pending plan. Returns True on success,
    False if there is no plan awaiting answers.
    """

    plan = session.metadata.pending_plan
    if plan is None or plan.status != 'awaiting_answers':
        return False
    plan.answers.append(answer)
    # Clearing current_question signals to the next plan turn that this
    # question has been resolved; the model decides whether to ask another.
    plan.current_question = None
    plan.updated_at = _utcnow()
    log_event(
        logger,
        'pending_plan_answer_appended',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        plan_id=plan.plan_id,
        question_id=answer.question_id,
        answers_so_far=len(plan.answers),
    )
    return True


def clear_pending_plan(
    session: AgentSession,
    *,
    reason: str,
    logger: logging.Logger,
    settings: Any,
    trace_id: str | None = None,
    final_status: str = 'discarded',
) -> bool:
    """Remove the pending plan and log the reason. Returns True if there was
    one to clear.
    """

    existing = session.metadata.pending_plan
    if existing is None:
        return False
    log_event(
        logger,
        'pending_plan_cleared',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        plan_id=existing.plan_id,
        reason=reason,
        final_status=final_status,
    )
    session.metadata.pending_plan = None
    return True


def is_plan_stale(
    session: AgentSession,
    plan: PendingPlan,
) -> bool:
    """A plan is stale if base_revision has moved or the overview summary has
    drifted since the plan was recorded.
    """

    if plan.base_revision is not None and session.base_revision is not None:
        if plan.base_revision != session.base_revision:
            return True
    current_hash = _compute_overview_hash(session.metadata.roadmap_overview_summary)
    if plan.roadmap_overview_hash and current_hash and plan.roadmap_overview_hash != current_hash:
        return True
    return False


def format_pending_plan_section(plan: PendingPlan | None) -> str | None:
    """Render the pending plan as a compact prose section for prompt injection.

    Renders for both `proposed` (terminal envelope awaiting user confirmation)
    and `awaiting_answers` (mid-clarifier). Callers should filter to these two
    statuses; other statuses (confirmed/discarded/superseded) get None.
    """

    if plan is None or plan.status not in {'proposed', 'awaiting_answers'}:
        return None
    if plan.status == 'awaiting_answers':
        lines: list[str] = [
            'Plan clarifier in progress — the user has answered '
            f'{len(plan.answers)} question(s) so far.',
        ]
        if plan.answers:
            lines.append('Previous answers:')
            for idx, answer in enumerate(plan.answers, start=1):
                value = answer.custom_answer or answer.selected_option or '(unknown)'
                qtext = answer.question_text or answer.question_id
                lines.append(f'{idx}. Q: {qtext} / A: {value}')
        if plan.current_question is not None:
            lines.append(
                f'Currently asked: "{plan.current_question.question}" '
                f'(options: {", ".join(plan.current_question.options) or "(none)"})'
            )
        return '\n'.join(lines)
    lines = []
    lines.append(f'Plan summary: {plan.summary}')
    if plan.goal:
        lines.append(f'Goal: {plan.goal}')
    if plan.rationale:
        lines.append(f'Rationale: {plan.rationale}')
    if plan.proposed_hierarchy:
        lines.append('Proposed structure:')
        for epic in plan.proposed_hierarchy:
            lines.append(f'- Epic "{epic.title}"')
            for feature in epic.features:
                anchor = (
                    f' (under existing epic "{feature.target_epic_title}")'
                    if feature.target_epic_title else ''
                )
                lines.append(f'  - Feature "{feature.title}"{anchor}')
                for task in feature.tasks:
                    task_anchor = (
                        f' (under existing feature "{task.target_feature_title}")'
                        if task.target_feature_title else ''
                    )
                    lines.append(f'    - Task "{task.title}"{task_anchor}')
    if plan.risks:
        lines.append('Risks: ' + '; '.join(plan.risks))
    if plan.next_steps:
        lines.append('Next steps: ' + '; '.join(plan.next_steps))
    if plan.open_questions:
        lines.append('Open questions: ' + '; '.join(plan.open_questions))
    return '\n'.join(lines)
