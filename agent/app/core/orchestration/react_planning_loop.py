from __future__ import annotations

from dataclasses import replace
from time import perf_counter
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.client import LLMPlanner, PlanningResult


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
        child_ids = item.get('child_ids')
        if isinstance(child_ids, list):
            for child_id in child_ids:
                _add(child_id)
        children = item.get('children')
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    _add(child.get('id'))

    return ordered_ids[:20]


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
            planning = PlanningResult(
                assistant_message=(
                    'I reached the planner call budget before safely finalizing this edit. '
                    'Please provide one precise target detail so I can continue.'
                ),
                operations=[],
                parse_mode='deterministic_react_budget_guard',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=True,
                provider_error_code='llm_call_budget_exhausted',
                route_lane=route_lane,
                clarifier_action='ask_clarifier',
                clarifier_reason='llm_call_budget_exhausted',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
                needs_more_info=True,
                stop_reason='tool_budget_exhausted',
                llm_calls_used=0,
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
        planning = PlanningResult(
            assistant_message=(
                'I could not complete planning in this turn. Please restate the exact change '
                'you want to apply.'
            ),
            operations=[],
            parse_mode='deterministic_react_planner_empty',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=True,
            provider_error_code='planner_empty_result',
            route_lane=route_lane,
            clarifier_action='ask_clarifier',
            clarifier_reason='planner_empty_result',
            clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
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
