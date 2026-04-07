from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType
from app.core.llm.client import PlanningResult
from app.core.orchestration.planning_phase_metrics import record_planning_loop_metrics


@dataclass
class PlanningResultDispatchOutcome:
    planning: PlanningResult
    route_lane: str | None
    llm_skipped_for_simple_edit: bool
    retry_tool_calls_used: int | None
    retry_autostage_applied: bool


def dispatch_planning_result(
    *,
    service: Any,
    session: AgentSession,
    planning_user_message: str,
    preview_intent: IntentType,
    has_staged_operations: bool,
    staged_operations: list[RoadmapOperation],
    edit_continuation_trigger: str | None,
    deictic_resolution: dict[str, Any] | None,
    auth_header: str | None,
    trace_id: str | None,
    session_context: dict[str, Any],
    phase_timings: dict[str, Any],
) -> PlanningResultDispatchOutcome:
    self = service

    planning: PlanningResult
    route_lane: str | None = None
    llm_skipped_for_simple_edit = False
    retry_tool_calls_used: int | None = None
    retry_autostage_applied = False

    pending_context = session.metadata.pending_edit_context
    if pending_context is not None:
        pending_context.intent_family = self._normalize_intent_family(
            pending_context.intent_family
        )
    if (
        isinstance(deictic_resolution, dict)
        and str(deictic_resolution.get('status') or '') == 'ambiguous'
    ):
        planning = self._build_deictic_ambiguity_planning(
            deictic_resolution=deictic_resolution,
        )
        phase_timings['provider_planning_ms'] = 0
        route_lane = 'llm_edit_plan'
        llm_skipped_for_simple_edit = True
    elif pending_context is not None and edit_continuation_trigger == 'retry':
        retry_result = self._attempt_retry_autostage(
            session=session,
            pending_context=pending_context,
            trace_id=trace_id,
            auth_header=auth_header,
        )
        retry_tool_calls_used = retry_result.get('tool_calls_used')
        retry_autostage_applied = bool(retry_result.get('retry_autostage_applied'))
        if retry_result.get('planning') is not None:
            planning = retry_result['planning']
            phase_timings['provider_planning_ms'] = 0
            route_lane = 'llm_edit_plan'
            llm_skipped_for_simple_edit = True
        elif retry_result.get('blocked_reason'):
            blocked_reason = str(retry_result.get('blocked_reason') or '')
            if blocked_reason == 'retry_autostage_unsupported_intent_family':
                planning = None  # Fall through to standard planner path.
            else:
                planning = PlanningResult(
                    assistant_message=(
                        'I cannot auto-stage this retry yet because the pending edit state changed. '
                        'Please confirm the target again so I can continue safely.'
                    ),
                    operations=[],
                    parse_mode='deterministic_retry_stale_handoff',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=blocked_reason,
                    clarifier_action='ask_clarifier',
                    clarifier_reason=blocked_reason,
                    clarifier_options=['Use exact target label', 'Provide node ID', 'Cancel'],
                )
                phase_timings['provider_planning_ms'] = 0
                route_lane = 'llm_edit_plan'
                llm_skipped_for_simple_edit = True
        else:
            planning = None  # type: ignore[assignment]
    else:
        planning = None  # type: ignore[assignment]
    if planning is None and (
        pending_context is not None
        and edit_continuation_trigger == 'confirm'
        and pending_context.draft_operations
    ):
        planning = PlanningResult(
            assistant_message='Confirmed. I prepared the pending edit operations.',
            operations=[
                operation.model_copy(deep=True)
                for operation in pending_context.draft_operations
            ],
            parse_mode='deterministic_pending_edit_confirm',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=True,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code=None,
            route_lane='llm_edit_plan',
            draft_action='continue',
            tool_plan=[],
            needs_more_info=False,
            stop_reason='ready_to_stage',
        )
        phase_timings['provider_planning_ms'] = 0
        route_lane = 'llm_edit_plan'
        llm_skipped_for_simple_edit = True
    elif planning is None and (
        pending_context is None
        and has_staged_operations
        and edit_continuation_trigger == 'confirm'
    ):
        planning = PlanningResult(
            assistant_message=(
                'Confirmed. Your staged edit operations are ready to apply. '
                'Use Apply to commit these changes.'
            ),
            operations=[],
            parse_mode='deterministic_staged_edit_confirm',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=True,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code=None,
            route_lane='llm_edit_plan',
            draft_action='continue',
            tool_plan=[],
            needs_more_info=False,
            stop_reason='ready_to_stage',
        )
        phase_timings['provider_planning_ms'] = 0
        route_lane = 'llm_edit_plan'
        llm_skipped_for_simple_edit = True
    elif planning is None and preview_intent == 'roadmap_edit':
        planning, planning_loop_metrics = self._run_edit_react_planning_loop(
            user_message=planning_user_message,
            existing_operations=staged_operations,
            session_context=session_context,
            route_lane='llm_edit_plan',
        )
        record_planning_loop_metrics(
            phase_timings=phase_timings,
            planning_loop_metrics=planning_loop_metrics,
        )
        route_lane = 'llm_edit_plan'
    elif planning is None:
        planning, planning_loop_metrics = self._run_edit_react_planning_loop(
            user_message=planning_user_message,
            existing_operations=staged_operations,
            session_context=session_context,
            route_lane='llm_edit_plan',
        )
        record_planning_loop_metrics(
            phase_timings=phase_timings,
            planning_loop_metrics=planning_loop_metrics,
        )
        route_lane = 'llm_edit_plan' if planning.response_mode == 'edit_plan' else 'chat'

    return PlanningResultDispatchOutcome(
        planning=planning,
        route_lane=route_lane,
        llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
        retry_tool_calls_used=retry_tool_calls_used,
        retry_autostage_applied=retry_autostage_applied,
    )
