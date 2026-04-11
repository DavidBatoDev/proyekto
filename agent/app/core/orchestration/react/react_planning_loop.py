from __future__ import annotations

from dataclasses import replace
from time import perf_counter
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.client import LLMPlanner, PlanningResult


def _planning_result_from_state(
    planning_state: dict[str, Any],
    *,
    fallback_provider_error_code: str | None = None,
) -> PlanningResult:
    raw_operations = planning_state.get('planned_operations')
    operations = (
        [item for item in raw_operations if isinstance(item, RoadmapOperation)]
        if isinstance(raw_operations, list)
        else []
    )
    return PlanningResult(
        assistant_message=str(
            planning_state.get('assistant_message')
            or 'I need one clarification before continuing this edit.'
        ),
        operations=operations,
        parse_mode=str(planning_state.get('parse_mode') or 'neutral_edit_clarifier'),
        intent_type=str(planning_state.get('intent_type') or 'roadmap_edit'),
        response_mode=str(planning_state.get('response_mode') or 'chat'),
        preview_recommended=bool(planning_state.get('preview_recommended', False)),
        provider_used=str(planning_state.get('provider_used') or 'rule_based'),
        fallback_used=bool(planning_state.get('fallback_used', False)),
        provider_error_code=(
            planning_state.get('provider_error_code')
            or fallback_provider_error_code
        ),
        tokens_input=planning_state.get('tokens_input'),
        tokens_output=planning_state.get('tokens_output'),
        tokens_total=planning_state.get('tokens_total'),
        route_lane=planning_state.get('route_lane'),
        clarifier_action=planning_state.get('clarifier_action'),
        clarifier_reason=planning_state.get('clarifier_reason'),
        clarifier_options=planning_state.get('clarifier_options'),
        clarifier_schema_retries=planning_state.get('clarifier_schema_retries'),
        planner_schema_invalid_attempts=planning_state.get('planner_schema_invalid_attempts'),
        planner_repair_attempted=planning_state.get('planner_repair_attempted'),
        draft_action=planning_state.get('draft_action'),
        tool_plan=planning_state.get('tool_plan'),
        needs_more_info=planning_state.get('needs_more_info'),
        stop_reason=planning_state.get('stop_reason'),
        llm_calls_used=planning_state.get('llm_calls_used'),
        react_tool_observation_summary=planning_state.get('react_tool_observation_summary'),
    )


def _build_llm_clarifier_or_fallback(
    *,
    planner: LLMPlanner,
    user_message: str,
    trace_id: str | None,
    provider_error_code: str,
    llm_calls_used_base: int,
) -> PlanningResult:
    clarifier_builder = getattr(planner, '_build_edit_clarifier_state', None)
    if callable(clarifier_builder):
        try:
            clarifier_state = clarifier_builder(
                user_message=user_message,
                system_prompt='',
                history_messages=[],
                trace_id=trace_id,
                provider_error_code=provider_error_code,
                llm_calls_used_base=llm_calls_used_base,
            )
            return _planning_result_from_state(
                clarifier_state,
                fallback_provider_error_code=provider_error_code,
            )
        except Exception:
            pass

    return PlanningResult(
        assistant_message=(
            'I need one more clarification before I can safely continue this edit. '
            'Please provide the exact target details.'
        ),
        operations=[],
        parse_mode='neutral_edit_clarifier',
        intent_type='roadmap_edit',
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code=provider_error_code,
        clarifier_action='ask_clarifier',
        clarifier_reason=provider_error_code,
        clarifier_options=['Provide target details', 'Provide the exact name', 'Cancel'],
        needs_more_info=True,
        stop_reason='awaiting_user_input',
        llm_calls_used=max(int(llm_calls_used_base), 0),
    )


def _collect_resolved_node_ids(tool_observation_summary: Any) -> list[str]:
    if not isinstance(tool_observation_summary, list):
        return []

    ordered_ids: list[str] = []
    seen: set[str] = set()

    def _add(node_id: Any) -> None:
        if not isinstance(node_id, str):
            return
        normalized = node_id.strip()
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        ordered_ids.append(normalized)

    for item in tool_observation_summary:
        if not isinstance(item, dict):
            continue
        _add(item.get('selected_id'))
        _add(item.get('node_id'))
        _add(item.get('queried_node_id'))
        _add(item.get('feature_id'))
        _add(item.get('epic_id'))
        match_ids = item.get('match_ids')
        if isinstance(match_ids, list):
            for match_id in match_ids:
                _add(match_id)
        match_items = item.get('match_items')
        if isinstance(match_items, list):
            for match_item in match_items:
                if isinstance(match_item, dict):
                    _add(match_item.get('id'))
        child_ids = item.get('child_ids')
        if isinstance(child_ids, list):
            for child_id in child_ids:
                _add(child_id)
        children = item.get('children')
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    _add(child.get('id'))
        task_ids = item.get('task_ids')
        if isinstance(task_ids, list):
            for task_id in task_ids:
                _add(task_id)
        tasks = item.get('tasks')
        if isinstance(tasks, list):
            for task in tasks:
                if isinstance(task, dict):
                    _add(task.get('id'))
        operation_node_ids = item.get('operation_node_ids')
        if isinstance(operation_node_ids, list):
            for operation_node_id in operation_node_ids:
                _add(operation_node_id)

    return ordered_ids[:50]


def run_edit_react_planning_loop(
    *,
    user_message: str,
    existing_operations: list[RoadmapOperation],
    session_context: dict[str, Any],
    route_lane: str,
    planner: LLMPlanner,
    settings: Any,
) -> tuple[PlanningResult, dict[str, Any]]:
    loop_budget = max(1, min(int(settings.agent_react_max_attempts), 4))
    llm_call_budget = max(1, int(settings.agent_max_total_llm_calls_per_message))
    loop_budget = min(loop_budget, llm_call_budget)
    loop_started = perf_counter()
    loop_turns = 0
    termination_reason = 'planner_terminal'
    planning: PlanningResult | None = None
    remaining_llm_calls = llm_call_budget

    observation_context = dict(session_context)

    for turn_index in range(loop_budget):
        loop_turns += 1
        if remaining_llm_calls <= 0:
            termination_reason = 'llm_call_budget_exhausted'
            used_calls = llm_call_budget - remaining_llm_calls
            planning = _build_llm_clarifier_or_fallback(
                planner=planner,
                user_message=user_message,
                trace_id=observation_context.get('trace_id'),
                provider_error_code='llm_call_budget_exhausted',
                llm_calls_used_base=used_calls,
            )
            planning = replace(
                planning,
                route_lane=route_lane,
                needs_more_info=True,
                stop_reason='tool_budget_exhausted',
            )
            break
        observation_context['_react_loop_turn'] = turn_index + 1
        observation_context['_react_loop_budget'] = loop_budget
        observation_context['_llm_calls_total_budget'] = llm_call_budget
        observation_context['_llm_calls_budget_remaining'] = remaining_llm_calls

        planning = planner.plan(
            user_message=user_message,
            existing_operations=existing_operations,
            session_context=observation_context,
        )
        planning = replace(planning, route_lane=route_lane)

        llm_calls_used_raw = planning.llm_calls_used
        if isinstance(llm_calls_used_raw, (int, float)):
            llm_calls_used = max(int(llm_calls_used_raw), 0)
        else:
            llm_calls_used = 0 if planning.provider_used == 'rule_based' else 1
        llm_calls_used = min(llm_calls_used, remaining_llm_calls)
        remaining_llm_calls = max(remaining_llm_calls - llm_calls_used, 0)
        observation_context['_llm_calls_budget_remaining'] = remaining_llm_calls
        observation_context['_react_tool_observation_summary'] = (
            list(planning.react_tool_observation_summary or [])
            if isinstance(planning.react_tool_observation_summary, list)
            else []
        )

        if planning.response_mode == 'edit_plan':
            planning = replace(
                planning,
                draft_action=(planning.draft_action or 'continue'),
                tool_plan=(planning.tool_plan or []),
                needs_more_info=(
                    planning.needs_more_info
                    if planning.needs_more_info is not None
                    else False
                ),
                stop_reason=(
                    planning.stop_reason
                    or ('ready_to_stage' if planning.operations else 'awaiting_user_input')
                ),
            )

        if not settings.agent_hybrid_react_enabled:
            termination_reason = 'hybrid_disabled'
            break
        if planning.response_mode != 'edit_plan':
            termination_reason = 'planner_returned_chat'
            break

        recoverable_tool_budget_replan = (
            planning.provider_error_code == 'max_tool_turns_exceeded'
            and not planning.operations
        )
        if recoverable_tool_budget_replan:
            if remaining_llm_calls <= 0:
                termination_reason = 'llm_call_budget_exhausted'
                planning = replace(
                    planning,
                    stop_reason='tool_budget_exhausted',
                    needs_more_info=True,
                )
                break

            if turn_index + 1 >= loop_budget:
                termination_reason = 'budget_exhausted'
                break

            tool_observation_summary = observation_context.get(
                '_react_tool_observation_summary', []
            )
            resolved_node_ids = _collect_resolved_node_ids(tool_observation_summary)
            observation_context['_react_loop_observation'] = {
                'stop_reason': planning.stop_reason,
                'needs_more_info': planning.needs_more_info,
                'draft_action': planning.draft_action,
                'tool_plan_steps': len(planning.tool_plan or []),
                'llm_calls_used': llm_calls_used,
                'llm_calls_remaining': remaining_llm_calls,
                'provider_error_code': planning.provider_error_code,
                'tool_observation_summary': tool_observation_summary,
                'resolved_node_ids': resolved_node_ids,
            }
            termination_reason = 'replanned_after_observation'
            continue

        if not planning.operations:
            termination_reason = 'planner_returned_no_operations'
            break
        if planning.stop_reason == 'ready_to_stage':
            termination_reason = 'ready_to_stage'
            break

        if remaining_llm_calls <= 0:
            termination_reason = 'llm_call_budget_exhausted'
            if planning.response_mode == 'edit_plan':
                planning = replace(
                    planning,
                    stop_reason='tool_budget_exhausted',
                    needs_more_info=True,
                )
            break

        if turn_index + 1 >= loop_budget:
            termination_reason = 'budget_exhausted'
            break

        tool_observation_summary = observation_context.get('_react_tool_observation_summary', [])
        resolved_node_ids = _collect_resolved_node_ids(tool_observation_summary)
        observation_context['_react_loop_observation'] = {
            'stop_reason': planning.stop_reason,
            'needs_more_info': planning.needs_more_info,
            'draft_action': planning.draft_action,
            'tool_plan_steps': len(planning.tool_plan or []),
            'llm_calls_used': llm_calls_used,
            'llm_calls_remaining': remaining_llm_calls,
            'provider_error_code': planning.provider_error_code,
            'tool_observation_summary': tool_observation_summary,
            'resolved_node_ids': resolved_node_ids,
        }
        termination_reason = 'replanned_after_observation'

    if planning is None:
        used_calls = llm_call_budget - remaining_llm_calls
        planning = _build_llm_clarifier_or_fallback(
            planner=planner,
            user_message=user_message,
            trace_id=observation_context.get('trace_id'),
            provider_error_code='planner_empty_result',
            llm_calls_used_base=used_calls,
        )
        planning = replace(
            planning,
            route_lane=route_lane,
            stop_reason='insufficient_context',
        )

    loop_metrics = {
        'elapsed_ms': int((perf_counter() - loop_started) * 1000),
        'loop_turns': loop_turns,
        'loop_budget': loop_budget,
        'termination_reason': termination_reason,
        'llm_calls_budget': llm_call_budget,
        'llm_calls_used': llm_call_budget - remaining_llm_calls,
        'llm_calls_remaining': remaining_llm_calls,
    }
    return planning, loop_metrics
