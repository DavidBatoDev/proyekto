"""Map a finished loop into a ``MessagePlanningOutcome`` (+ side effects).

The envelope is byte-compatible with the v1 path so ``send_message_flow`` and
the auto-commit trigger (``response_mode == 'edit_plan'`` + staged ops) are
unchanged. Side effects: stage edits, record a pending plan, build a clarifier
card, and persist the user + assistant turns (which saves the whole session,
including staged ops and metadata).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable
from uuid import uuid4

from app.core.logging_utils import log_event
from app.core.orchestration.context.pending_plan_manager import (
    record_pending_plan_from_planner_output,
)
from app.core.orchestration.shared.outcomes import MessagePlanningOutcome
from app.core.v2 import progress, staging
from app.core.v2.loop import LoopResult

logger = logging.getLogger('app.core.v2')


def to_outcome(
    *,
    service: Any,
    session: Any,
    loop_result: LoopResult,
    session_context: dict[str, Any],
    user_message: str,
    trace_id: str | None,
    utcnow: Callable[[], datetime],
    provider_used: str = 'openai',
    fallback_used: bool = False,
    provider_error_code: str | None = None,
) -> MessagePlanningOutcome:
    settings = service._settings
    # Drafts/branching were removed — staged edits live directly on the session.
    draft_graph_enabled = False
    kind = loop_result.kind

    response_mode = 'chat'
    parse_mode = 'chat'
    intent_type = 'general_question'
    operations_out: list[Any] = []
    plan_proposal_payload: dict[str, Any] | None = None
    clarifier_card: dict[str, Any] | None = None
    assistant_message = (loop_result.assistant_message or '').strip()

    if kind == 'edit':
        response_mode, parse_mode, intent_type = 'edit_plan', 'edit_plan', 'roadmap_edit'
        apply_result = staging.stage_operations(
            service=service,
            session=session,
            operations=loop_result.operations,
            assistant_message=assistant_message,
            utcnow=utcnow,
        )
        operations_out = apply_result.applied_operations
        try:
            service._record_recent_targets_from_operations(
                session=session,
                operations=operations_out,
                source='staged_operations',
            )
        except Exception:  # pragma: no cover - telemetry best-effort
            pass
        if not assistant_message:
            assistant_message = 'Staged your changes.'

    elif kind == 'plan_proposal':
        response_mode, parse_mode, intent_type = 'plan_proposal', 'plan_proposal', 'roadmap_plan'
        payload = dict(loop_result.plan_payload or {})
        payload.setdefault('status', 'plan_ready')
        record_pending_plan_from_planner_output(
            session=session,
            payload=payload,
            user_message=user_message,
            trace_id=trace_id,
            logger=service._logger,
            settings=settings,
            intent_type='roadmap_plan',
        )
        if session.metadata.pending_plan is not None:
            plan_proposal_payload = session.metadata.pending_plan.model_dump(
                mode='json', exclude_none=True
            )
        if not assistant_message:
            assistant_message = 'Here is a proposed plan for your review.'

    elif kind == 'plan_revision':
        response_mode, parse_mode, intent_type, plan_proposal_payload = _apply_plan_revision(
            service=service,
            session=session,
            loop_result=loop_result,
            user_message=user_message,
            trace_id=trace_id,
        )
        if not assistant_message:
            assistant_message = (
                'Updated the proposed plan.'
                if response_mode == 'plan_proposal'
                else 'I could not find a plan to revise.'
            )

    elif kind == 'clarifier':
        response_mode, parse_mode, intent_type = 'chat', 'clarifier', 'roadmap_edit'
        clarifier_card = _build_clarifier_card(loop_result.clarifier)
        if not assistant_message and loop_result.clarifier:
            assistant_message = str(loop_result.clarifier.get('question') or '').strip()

    elif kind == 'budget':
        response_mode, parse_mode, intent_type = 'chat', 'clarifier', 'unclear'
        assistant_message = (
            "I couldn't finish that within the available steps. "
            'Could you rephrase or narrow the request?'
        )
        clarifier_card = {
            'lane': 'edit',
            'question_id': str(uuid4()),
            'question': assistant_message,
            'options': [],
            'allow_custom': True,
            'reason': 'budget_exhausted',
        }

    else:  # chat
        response_mode = 'chat'
        if loop_result.used_read_tools:
            parse_mode, intent_type = 'context_answer', 'roadmap_query'
        else:
            parse_mode, intent_type = 'chat', 'general_question'
        if not assistant_message:
            assistant_message = 'How can I help with your roadmap?'

    session.last_intent_type = intent_type

    # Persist the turn. append_message saves the whole session, so staged ops
    # and metadata mutated above are captured by the final (assistant) save.
    service._store.append_message(session, 'user', user_message)
    service._store.append_message(session, 'assistant', assistant_message)

    staged_operations, staged_operations_version = service._resolve_staged_state(
        session,
        draft_graph_enabled=draft_graph_enabled,
        active_draft=None,
    )
    preview_available = len(staged_operations) > 0
    preview_recommended = response_mode == 'edit_plan' and preview_available

    active_draft_id: str | None = None
    active_draft_version: int | None = None

    route_lane = f'v2_{kind}'
    progress.route_selected(
        settings,
        trace_id,
        route_lane=route_lane,
        response_mode=response_mode,
        turns=loop_result.turns,
        tool_calls_used=loop_result.tool_calls_used,
        termination_reason=loop_result.termination_reason,
    )
    log_event(
        logger,
        'session_staged_state',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        staged_operations_count=len(staged_operations),
        staged_operations_version=staged_operations_version,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        response_mode=response_mode,
        intent_type=intent_type,
        route_lane=route_lane,
        react_loop_turns=loop_result.turns,
        react_loop_termination_reason=loop_result.termination_reason,
        preview_available=preview_available,
        brain='v2',
    )

    return MessagePlanningOutcome(
        session=session,
        assistant_message=assistant_message,
        parse_mode=parse_mode,
        intent_type=intent_type,
        response_mode=response_mode,
        operations=operations_out if response_mode == 'edit_plan' else [],
        preview_available=preview_available,
        preview_recommended=preview_recommended,
        staged_operations_version=staged_operations_version,
        staged_operations_count=len(staged_operations),
        provider_used=provider_used,
        fallback_used=fallback_used,
        provider_error_code=provider_error_code,
        tokens_input=loop_result.tokens_input or None,
        tokens_output=loop_result.tokens_output or None,
        tokens_total=loop_result.tokens_total or None,
        route_lane=route_lane,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        react_loop_turns=loop_result.turns,
        react_loop_budget=settings.agent_v2_max_turns,
        react_loop_termination_reason=loop_result.termination_reason,
        pending_edit_context_present=session.metadata.pending_edit_context is not None,
        plan_proposal_payload=plan_proposal_payload,
        clarifier_card=clarifier_card,
    )


def _build_clarifier_card(clarifier: dict[str, Any] | None) -> dict[str, Any] | None:
    if not clarifier:
        return None
    options = [o for o in (clarifier.get('options') or []) if isinstance(o, str) and o.strip()]
    question = str(clarifier.get('question') or '').strip()
    allow_custom = bool(clarifier.get('allow_custom', True))
    if not question and not options:
        return None
    lane = clarifier.get('lane')
    if lane not in {'edit', 'query', 'plan'}:
        lane = 'edit'
    return {
        'lane': lane,
        'question_id': str(uuid4()),
        'question': question,
        'options': options,
        'allow_custom': allow_custom,
        'reason': 'agent_clarifier',
    }


def _apply_plan_revision(
    *,
    service: Any,
    session: Any,
    loop_result: LoopResult,
    user_message: str,
    trace_id: str | None,
) -> tuple[str, str, str, dict[str, Any] | None]:
    """Merge revision ops into the pending plan. Degrades to chat when there's
    no prior proposed plan to revise.
    """
    existing = session.metadata.pending_plan
    if existing is None or not loop_result.revision_operations:
        return 'chat', 'chat', 'general_question', None
    try:
        payload = existing.model_dump(mode='json', exclude_none=True)
        payload['status'] = 'plan_ready'
        payload['revision_operations'] = loop_result.revision_operations
        record_pending_plan_from_planner_output(
            session=session,
            payload=payload,
            user_message=user_message,
            trace_id=trace_id,
            logger=service._logger,
            settings=service._settings,
            intent_type='plan_revision',
        )
    except Exception:  # pragma: no cover - revision is best-effort
        return 'chat', 'chat', 'general_question', None
    plan_payload = (
        session.metadata.pending_plan.model_dump(mode='json', exclude_none=True)
        if session.metadata.pending_plan is not None
        else None
    )
    return 'plan_proposal', 'plan_proposal', 'plan_revision', plan_payload
