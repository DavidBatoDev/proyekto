from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType
from app.core.llm.client import PlanningResult
from app.core.orchestration.planning.pending_plan_materializer import (
    SynthesisResult,
)
from app.core.orchestration.planning.planning_phase_metrics import record_planning_loop_metrics


def _planning_result_from_synthesis(synthesis: SynthesisResult) -> PlanningResult:
    # The hybrid-react terminal guard (react_guardrails.enforce_hybrid_react_terminal_guard)
    # accepts only `draft_action in {'continue', 'revise', 'new_draft'}` and only
    # `stop_reason == 'ready_to_stage'` when operations are present. Synthesized
    # ops are a "continue the draft with these concrete edits" signal, so we
    # pick `continue` + `ready_to_stage` — the same values a successful LLM
    # plan would emit — so the existing staging pipeline accepts them verbatim.
    return PlanningResult(
        assistant_message=synthesis.assistant_message,
        operations=synthesis.operations,
        parse_mode='synthesized_plan_confirmation',
        intent_type='roadmap_edit',
        response_mode='edit_plan',
        preview_recommended=True,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code=None,
        tokens_input=0,
        tokens_output=0,
        tokens_total=0,
        planner_schema_invalid_attempts=0,
        planner_repair_attempted=False,
        draft_action='continue',
        tool_plan=[],
        needs_more_info=False,
        stop_reason='ready_to_stage',
        llm_calls_used=0,
    )


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
    synthesized_plan_confirmation: SynthesisResult | None = None,
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

    # Confirmed pending plans materialize deterministically — no LLM turn
    # needed when the pre-dispatcher built the operations from the stored
    # hierarchy. See pending_plan_materializer for the transform.
    if (
        synthesized_plan_confirmation is not None
        and synthesized_plan_confirmation.operations
    ):
        planning = _planning_result_from_synthesis(synthesized_plan_confirmation)
        route_lane = 'deterministic_plan_apply'
        llm_skipped_for_simple_edit = True
        phase_timings['pending_plan_synthesis_applied'] = 1
        phase_timings['pending_plan_synthesis_operations_count'] = len(
            synthesized_plan_confirmation.operations
        )

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
