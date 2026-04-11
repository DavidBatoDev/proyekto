from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType
from app.core.llm.client import PlanningResult
from app.core.orchestration.planning.planning_phase_metrics import record_planning_loop_metrics


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

    planning: PlanningResult | None = None
    route_lane: str | None = None
    llm_skipped_for_simple_edit = False
    retry_tool_calls_used: int | None = None
    retry_autostage_applied = False

    pending_context = session.metadata.pending_edit_context
    if pending_context is not None:
        pending_context.intent_family = self._normalize_intent_family(
            pending_context.intent_family
        )

    # Pending follow-up and ambiguity metadata remain in session context,
    # but planning should always flow through the LLM lane.
    if pending_context is not None and edit_continuation_trigger in {'delegate', 'slot_value', 'retry', 'confirm'}:
        phase_timings['pending_followup_auto_apply_attempted'] = 0
        phase_timings['pending_followup_auto_apply_outcome'] = 'routed_to_llm'

    if planning is None and preview_intent == 'roadmap_edit':
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

    _ = has_staged_operations
    _ = deictic_resolution
    _ = auth_header
    _ = trace_id

    return PlanningResultDispatchOutcome(
        planning=planning,
        route_lane=route_lane,
        llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
        retry_tool_calls_used=retry_tool_calls_used,
        retry_autostage_applied=retry_autostage_applied,
    )
