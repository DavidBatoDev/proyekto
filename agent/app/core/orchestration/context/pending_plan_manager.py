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
from app.core.orchestration.context.pending_plan_revision_applier import (
    apply_revision_operations,
    extract_metadata_updates,
)


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
    intent_type: str | None = None,
) -> PendingPlan | None:
    """Dispatch on the planner envelope's `status` key:
      - `needs_answer` → store the clarifier question, status='awaiting_answers'
      - `plan_ready` (or legacy envelopes without status) → store the plan

    When `intent_type == 'plan_revision'` and a prior proposed plan exists,
    the new plan inherits its `plan_id`, bumps `revision_count`, and emits a
    `pending_plan_revised` telemetry event — distinguishing a user-requested
    revision from the natural `awaiting_answers → proposed` transition that
    happens when a multi-turn clarifier finally produces a final plan.

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
        intent_type=intent_type,
    )


_MAX_CLARIFIER_QUESTIONS_PER_SESSION = 10
_MAX_QUESTIONS_PER_TURN = 4


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
    # Accept either `questions: [...]` (new, plural) or `question: {...}`
    # (legacy singular — treated as a list of one).
    raw_questions: list[dict[str, Any]] = []
    if isinstance(payload.get('questions'), list):
        raw_questions = [q for q in payload['questions'] if isinstance(q, dict)]
    elif isinstance(payload.get('question'), dict):
        raw_questions = [payload['question']]
    if not raw_questions:
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

    # Cap per-turn batch so the web doesn't render a wall of questions.
    if len(raw_questions) > _MAX_QUESTIONS_PER_TURN:
        log_event(
            logger,
            'pending_plan_question_batch_truncated',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            emitted=len(raw_questions),
            kept=_MAX_QUESTIONS_PER_TURN,
        )
        raw_questions = raw_questions[:_MAX_QUESTIONS_PER_TURN]

    parsed_questions: list[PendingPlanQuestion] = []
    for raw in raw_questions:
        try:
            parsed_questions.append(
                PendingPlanQuestion(**{
                    key: value
                    for key, value in raw.items()
                    if key in PendingPlanQuestion.model_fields
                })
            )
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
            # Skip this bad entry; keep the rest of the batch.
            continue
    if not parsed_questions:
        return None

    # Preserve accumulated answers and the original source_user_message from
    # the first turn of the planning session. Each needs_answer envelope
    # narrows the plan by adding more Q/A pairs.
    existing = session.metadata.pending_plan
    previous_answers: list[PendingPlanAnswer] = (
        list(existing.answers) if existing is not None else []
    )
    source_user_message = (
        existing.source_user_message
        if existing is not None and existing.source_user_message
        else user_message
    )

    # Enforce the session-wide cap: answered + new pending questions.
    total_q_budget = (
        len(previous_answers) + len(parsed_questions)
    )
    cap_reached = total_q_budget > _MAX_CLARIFIER_QUESTIONS_PER_SESSION
    if cap_reached:
        allowed = max(0, _MAX_CLARIFIER_QUESTIONS_PER_SESSION - len(previous_answers))
        if allowed == 0:
            log_event(
                logger,
                'pending_plan_question_cap_exhausted',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                answered_so_far=len(previous_answers),
                dropped=len(parsed_questions),
            )
            return None
        parsed_questions = parsed_questions[:allowed]

    plan_kwargs: dict[str, Any] = {
        'planning_turn_id': planning_turn_id,
        'summary': '',
        'goal': '',
        'source_user_message': source_user_message,
        'status': 'awaiting_answers',
        'current_questions': parsed_questions,
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
        question_count=len(parsed_questions),
        answers_so_far=len(previous_answers),
        total_budget=total_q_budget,
        cap_triggered=cap_reached,
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
    intent_type: str | None = None,
) -> PendingPlan | None:
    payload_for_model = dict(payload)
    payload_for_model.pop('status', None)
    payload_for_model.setdefault('source_user_message', user_message)
    payload_for_model.setdefault('summary', payload_for_model.get('summary') or '')
    payload_for_model.setdefault('goal', payload_for_model.get('goal') or user_message)
    if planning_turn_id is not None:
        payload_for_model.setdefault('planning_turn_id', planning_turn_id)

    existing = session.metadata.pending_plan
    # Compact-revision path: when the planner emits `revision_operations`
    # against a prior proposed plan, merge them into that plan's hierarchy
    # server-side instead of relying on the LLM to regurgitate the full
    # proposed_hierarchy. This is the structural optimization for the
    # plan_revision lane (see agent/logs.txt turn 3 for the baseline —
    # 3340 output tokens to rename one epic). The ops path is an
    # optimization, not a replacement: if ops fail to resolve the payload
    # MUST still carry a full proposed_hierarchy as ground truth.
    revision_ops_raw = payload_for_model.pop('revision_operations', None)
    revision_ops_applied = False
    revision_ops_metadata: dict[str, Any] = {}
    if (
        isinstance(revision_ops_raw, list)
        and revision_ops_raw
        and existing is not None
        and existing.status == 'proposed'
        and intent_type == 'plan_revision'
    ):
        new_hierarchy, unresolved = apply_revision_operations(
            prior_hierarchy=existing.proposed_hierarchy,
            operations=revision_ops_raw,
        )
        total_ops = len(revision_ops_raw)
        unresolved_count = len(unresolved)
        if new_hierarchy and unresolved_count < total_ops:
            payload_for_model['proposed_hierarchy'] = [
                epic.model_dump(mode='json', exclude_none=True)
                for epic in new_hierarchy
            ]
            revision_ops_metadata = extract_metadata_updates(revision_ops_raw)
            for field in ('summary', 'goal', 'rationale', 'risks', 'next_steps'):
                if field in revision_ops_metadata:
                    payload_for_model[field] = revision_ops_metadata[field]
            revision_ops_applied = True
            log_event(
                logger,
                'pending_plan_revision_ops_applied',
                settings=settings,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                plan_id=existing.plan_id,
                ops_count=total_ops,
                unresolved_count=unresolved_count,
                prior_epic_count=len(existing.proposed_hierarchy),
            )
        else:
            log_event(
                logger,
                'pending_plan_revision_ops_fell_back',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                plan_id=existing.plan_id,
                ops_count=total_ops,
                unresolved_count=unresolved_count,
                reason='all_ops_unresolved',
            )
    elif (
        isinstance(revision_ops_raw, list)
        and revision_ops_raw
        and intent_type == 'plan_revision'
    ):
        log_event(
            logger,
            'pending_plan_revision_ops_fell_back',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            plan_id=existing.plan_id if existing is not None else None,
            ops_count=len(revision_ops_raw),
            unresolved_count=len(revision_ops_raw),
            reason='no_prior_proposed_plan',
        )

    allowed_keys = set(PendingPlan.model_fields.keys())
    payload_for_model = {
        key: value for key, value in payload_for_model.items() if key in allowed_keys
    }
    # Preserve accumulated answers so the UI can keep showing the Q&A trail.
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
    plan.current_questions = []  # terminal envelope → no pending questions
    plan.status = 'proposed'
    plan.updated_at = _utcnow()

    # Plan continuity across turns splits into two cases, both of which
    # preserve `plan_id` so the web re-renders the same card:
    #   1. awaiting_answers → proposed: the clarifier finished and produced
    #      the final plan. Not a revision — revision_count stays at 0.
    #   2. proposed → proposed with intent_type == 'plan_revision': the user
    #      asked to change the finalized plan. Bump revision_count and fire
    #      the `pending_plan_revised` telemetry event so downstream metrics
    #      can distinguish "rev 3 of plan X" from "three unrelated plans".
    if existing is not None and existing.status in {'proposed', 'awaiting_answers'}:
        plan.plan_id = existing.plan_id
        is_user_requested_revision = (
            existing.status == 'proposed'
            and intent_type == 'plan_revision'
        )
        if is_user_requested_revision:
            plan.revision_count = (existing.revision_count or 0) + 1
            log_event(
                logger,
                'pending_plan_revised',
                settings=settings,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                plan_id=plan.plan_id,
                previous_status=existing.status,
                revision_count=plan.revision_count,
            )
        else:
            plan.revision_count = existing.revision_count or 0

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
        revision_count=plan.revision_count,
        revision_ops_applied=revision_ops_applied,
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
    # Remove the just-answered question from the pending batch. When all
    # questions in the batch are answered, `current_questions` is empty and
    # the next plan turn will decide whether to ask more or finalize.
    plan.current_questions = [
        q for q in plan.current_questions if q.id != answer.question_id
    ]
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
        if plan.current_questions:
            lines.append(f'Currently asked ({len(plan.current_questions)}):')
            for idx, q in enumerate(plan.current_questions, start=1):
                lines.append(
                    f'  {idx}. "{q.question}" '
                    f'(options: {", ".join(q.options) or "(none)"})'
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
    return '\n'.join(lines)
