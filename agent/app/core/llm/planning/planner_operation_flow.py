from __future__ import annotations

import json
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.contracts.clarifier_contract import build_clarifier_contract
from app.core.llm.providers import ProviderAdapterError
from app.core.logging_utils import log_event
from app.core.tools.registry import (
    get_edit_mode_tools,
    get_operation_tools,
    parse_plan_tool_args,
)


def plan_operations(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    intent_type = state.get('intent_type', 'roadmap_edit')
    existing_operations = state.get('existing_operations', [])
    system_prompt = state.get('system_prompt', '')
    session_context = state.get('session_context', {})
    history_messages = planner._build_history_messages(
        session_context,
        max_messages=planner._settings.max_edit_history_messages,
    )
    trace_id = session_context.get('trace_id')
    tool_definitions = (
        get_operation_tools() if intent_type == 'roadmap_plan' else get_edit_mode_tools()
    )
    total_edit_turns = max(1, int(planner._settings.max_edit_tool_turns))
    react_loop_turn_raw = session_context.get('_react_loop_turn')
    react_loop_turn = 1
    if isinstance(react_loop_turn_raw, (int, float, str)):
        try:
            react_loop_turn = max(int(react_loop_turn_raw), 1)
        except (TypeError, ValueError):
            react_loop_turn = 1
    if intent_type == 'roadmap_plan':
        edit_turns = 1
    elif react_loop_turn <= 1:
        edit_turns = total_edit_turns
    else:
        # Follow-up turns should bias toward closure with existing observations.
        edit_turns = max(1, min(total_edit_turns, 3))
    max_attempts = max(1, planner._settings.agent_react_max_attempts)
    max_repair_retries = max(0, planner._settings.agent_react_repair_retries)
    max_attempts = min(max_attempts, max_repair_retries + 1)
    remaining_llm_budget_raw = session_context.get('_llm_calls_budget_remaining')
    remaining_llm_budget: int | None = None
    if isinstance(remaining_llm_budget_raw, (int, float, str)):
        try:
            remaining_llm_budget = max(int(remaining_llm_budget_raw), 0)
        except (TypeError, ValueError):
            remaining_llm_budget = None
    if remaining_llm_budget is not None:
        max_attempts = min(max_attempts, remaining_llm_budget)
    tool_observations: list[dict[str, Any]] = []
    tool_observation_summary: list[dict[str, Any]] = []
    llm_calls_used = 0

    def _capturing_tool_executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
        result = planner._execute_context_tool(name, args, session_context)
        planner._record_react_tool_observation(
            observations=tool_observations,
            summary=tool_observation_summary,
            tool_name=name,
            args=args,
            result=result,
        )
        return result

    def _finalize_state(
        next_state: dict[str, Any],
        *,
        used_calls: int | None = None,
    ) -> dict[str, Any]:
        next_state['react_tool_observation_summary'] = tool_observation_summary[-10:]
        effective_used = llm_calls_used if used_calls is None else used_calls
        next_state['llm_calls_used'] = max(int(effective_used or 0), 0)
        return next_state

    if max_attempts <= 0:
        return _finalize_state(
            planner._neutral_edit_clarifier_state(
                provider_error_code='llm_call_budget_exhausted',
                schema_retries=0,
                stop_reason='tool_budget_exhausted',
                llm_calls_used=0,
            ),
            used_calls=0,
        )

    staged_operations_payload = json.dumps(
        [op.model_dump(exclude_none=True) for op in existing_operations],
        ensure_ascii=True,
        separators=(',', ':'),
    )
    roadmap_id_value = session_context.get('roadmap_id')
    deictic_parent_hint = (
        session_context.get('deictic_parent_hint')
        if isinstance(session_context.get('deictic_parent_hint'), dict)
        else None
    )
    prior_observation = session_context.get('_react_loop_observation')
    prior_provider_error_code = ''
    resolved_node_ids: list[str] = []
    prior_observation_tool_summary: list[dict[str, Any]] = []
    if isinstance(prior_observation, dict) and prior_observation:
        prior_provider_error_code = str(
            prior_observation.get('provider_error_code') or ''
        ).strip().lower()
        resolved_ids_raw = prior_observation.get('resolved_node_ids')
        if isinstance(resolved_ids_raw, list):
            for raw_id in resolved_ids_raw:
                if isinstance(raw_id, str) and raw_id.strip():
                    resolved_node_ids.append(raw_id.strip())
        tool_summary_raw = prior_observation.get('tool_observation_summary')
        if isinstance(tool_summary_raw, list):
            prior_observation_tool_summary = [
                item
                for item in tool_summary_raw
                if isinstance(item, dict)
            ]

    prior_tool_summary = session_context.get('_react_tool_observation_summary')
    prior_tool_summary_list: list[dict[str, Any]] = []
    if isinstance(prior_tool_summary, list):
        prior_tool_summary_list = [
            item
            for item in prior_tool_summary
            if isinstance(item, dict)
        ]
    effective_tool_summary = (
        prior_observation_tool_summary
        if prior_observation_tool_summary
        else prior_tool_summary_list
    )

    followup_closed_world_turn = (
        react_loop_turn > 1
        and prior_provider_error_code == 'max_tool_turns_exceeded'
        and bool(resolved_node_ids or effective_tool_summary)
    )
    simple_edit_profile_enabled = bool(
        planner._settings.agent_simple_edit_planner_profile_enabled
    )
    simple_edit_profile = (
        simple_edit_profile_enabled
        and intent_type == 'roadmap_edit'
        and planner._is_simple_edit_planner_request(user_message)
        and react_loop_turn <= 1
    )
    if followup_closed_world_turn or intent_type == 'roadmap_plan':
        tool_definitions = get_operation_tools()

    planner_profile: str | None = None
    if simple_edit_profile:
        planner_profile = 'simple_edit'
        edit_turns = min(edit_turns, 2)

    if intent_type == 'roadmap_plan':
        planner_prompt = (
            'You are in roadmap planning mode.\n'
            'Call plan_roadmap_operations exactly once.\n'
            'Generate safe roadmap structure with epic -> feature -> task hierarchy.\n'
            'Only stage operations that are valid with available IDs and parent constraints.\n'
            'If required IDs are missing, call plan_roadmap_operations with an empty operations list and place a concise structured plan in assistant_message.\n'
            'Do not call resolve_node_reference, get_children, or other discovery tools in this mode.\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    elif followup_closed_world_turn:
        planner_prompt = (
            'You are in edit planning mode, follow-up ReAct turn.\n'
            f'ReAct loop turn: {react_loop_turn}.\n'
            f'Max tool calls this turn: {edit_turns}.\n'
            'ALL CONTEXT BELOW IS ALREADY RESOLVED.\n'
            'Do not call resolve_node_reference or get_children again for the same target.\n'
            'Your primary action in this turn is to call plan_roadmap_operations exactly once.\n'
            'If you still cannot produce safe operations, call plan_roadmap_operations with an empty '
            'operations list and place the clarifying question in assistant_message.\n\n'
            'Resolved node IDs:\n'
            f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}\n\n'
            'Prior tool observation summary:\n'
            f'{json.dumps(effective_tool_summary[:10], ensure_ascii=True, separators=(",", ":"))}\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    elif simple_edit_profile:
        planner_prompt = (
            'You are in simple edit planning mode.\n'
            'Use context tools only if needed to resolve node IDs.\n'
            'When ready, call plan_roadmap_operations exactly once.\n'
            'Prefer the smallest safe operation set (typically update_node).\n'
            'Do not call commit or discard tools.\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    else:
        planner_prompt = (
            'You are in edit planning mode.\n'
            'Resolve named targets to node IDs with resolve_node_reference before asking for IDs.\n'
            'Use context tools when needed to resolve node IDs and hierarchy before drafting operations.\n'
            'When ready, call plan_roadmap_operations exactly once with assistant_message and operations.\n'
            'Do not call commit or discard tools. Commit remains a UI action.\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}\n\n'
            'If request is ambiguous, use context tools first, then produce the safest possible operation plan.'
        )
        if isinstance(prior_observation, dict) and prior_observation:
            planner_prompt += (
                '\n\nPrevious ReAct observation:\n'
                f'{json.dumps(prior_observation, ensure_ascii=True, separators=(",", ":"))}'
            )
            if prior_provider_error_code == 'max_tool_turns_exceeded':
                planner_prompt += (
                    '\n\nPlanning retry guidance:\n'
                    'The previous planning turn reached its tool-call budget before finalizing operations. '
                    'Use the prior observations, avoid repeating resolved lookups, and call '
                    'plan_roadmap_operations as soon as the minimum safe context is available.'
                )
            if resolved_node_ids:
                planner_prompt += (
                    '\n\nResolved node IDs from previous turn:\n'
                    f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}'
                )
        if prior_tool_summary_list:
            planner_prompt += (
                '\n\nPrevious tool observation summary:\n'
                f'{json.dumps(prior_tool_summary_list[:5], ensure_ascii=True, separators=(",", ":"))}'
            )
        if remaining_llm_budget is not None:
            planner_prompt += (
                '\n\nRemaining planner call budget for this turn:\n'
                f'{remaining_llm_budget}'
            )
        if react_loop_turn > 1:
            planner_prompt += (
                '\n\nFollow-up planning turn guidance:\n'
                f'This is ReAct loop turn {react_loop_turn}. '
                f'You have at most {edit_turns} tool calls this turn. '
                'Prefer previously resolved context and call plan_roadmap_operations '
                'as soon as a safe operation plan can be staged.'
            )
    schema_invalid_attempts = 0
    repair_attempted = False
    last_provider_error_code: str | None = None
    planner_prompt_bytes = len(planner_prompt.encode('utf-8'))
    history_messages_count = len(history_messages)

    def _invoke_plan_with_tools(adapter: Any) -> tuple[str, list[RoadmapOperation]]:
        if planner_profile:
            try:
                return adapter.plan_operations_with_tools(
                    system_prompt=system_prompt,
                    planner_prompt=planner_prompt,
                    history_messages=history_messages,
                    tools=tool_definitions,
                    tool_executor=_capturing_tool_executor,
                    max_tool_turns=edit_turns,
                    planner_profile=planner_profile,
                )
            except TypeError:
                # Backward compatibility for test doubles and legacy adapters
                pass
        return adapter.plan_operations_with_tools(
            system_prompt=system_prompt,
            planner_prompt=planner_prompt,
            history_messages=history_messages,
            tools=tool_definitions,
            tool_executor=_capturing_tool_executor,
            max_tool_turns=edit_turns,
        )

    for attempt in range(max_attempts):
        if attempt > 0:
            repair_attempted = True
        try:
            llm_calls_used += 1
            result = planner._provider_orchestrator.call(
                _invoke_plan_with_tools,
                trace_context={
                    'trace_id': trace_id,
                    'phase': 'edit_plan',
                    'planner_profile': planner_profile or 'default',
                    'planner_prompt_bytes': planner_prompt_bytes,
                    'history_messages_count': history_messages_count,
                },
            )
        except ProviderAdapterError as exc:
            last_provider_error_code = exc.code
            if exc.code == 'max_tool_turns_exceeded':
                provider_used = (
                    'openai'
                    if str(exc.provider).strip().lower() == 'openai'
                    else 'rule_based'
                )
                planner._logger.warning(
                    'Edit tool-call budget exhausted; returning replanning observation. code=%s message=%s',
                    exc.code,
                    exc.message,
                )
                return _finalize_state(
                    {
                        'assistant_message': (
                            'Collected partial context and will continue edit planning in the next turn.'
                        ),
                        'planned_operations': [],
                        'response_mode': 'edit_plan',
                        'preview_recommended': False,
                        'parse_mode': 'deterministic_react_tool_budget_replan',
                        'provider_used': provider_used,
                        'fallback_used': False,
                        'provider_error_code': exc.code,
                        'tokens_input': exc.tokens_input,
                        'tokens_output': exc.tokens_output,
                        'tokens_total': exc.tokens_total,
                        'pending_context_resolution': None,
                        'clear_pending_context_resolution': False,
                        'clarifier_action': None,
                        'clarifier_reason': None,
                        'clarifier_options': None,
                        'clarifier_schema_retries': schema_invalid_attempts,
                        'planner_schema_invalid_attempts': schema_invalid_attempts,
                        'planner_repair_attempted': repair_attempted,
                        'draft_action': 'continue',
                        'tool_plan': [],
                        'needs_more_info': True,
                        'stop_reason': 'tool_budget_exhausted',
                        'llm_calls_used': llm_calls_used,
                    },
                    used_calls=llm_calls_used,
                )
            if exc.code in {'invalid_operation_payload', 'missing_tool_call'} and attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                planner_prompt = planner._augment_repair_planner_prompt(
                    planner_prompt=planner_prompt,
                    error_code=exc.code,
                )
                if exc.code == 'missing_tool_call':
                    # Retry in planning-only mode to avoid rediscovery churn.
                    tool_definitions = get_operation_tools()
                    planner_prompt = planner._augment_missing_tool_call_retry_prompt(
                        planner_prompt=planner_prompt,
                        user_message=user_message,
                        tool_observations=tool_observations,
                    )
                continue
            planner._logger.warning(
                'Provider operation planning failed in react mode, using edit clarifier lane. code=%s message=%s',
                exc.code,
                exc.message,
            )
            synthesized_operations = planner._maybe_synthesize_react_closure_operations(
                user_message=user_message,
                tool_observations=tool_observations,
            )
            if synthesized_operations:
                return _finalize_state(
                    planner._build_synthesized_react_closure_state(
                        operations=synthesized_operations,
                        schema_invalid_attempts=schema_invalid_attempts,
                        repair_attempted=repair_attempted,
                        draft_action='continue',
                        tool_plan=[],
                    )
                )
            clarifier_state = planner._build_edit_clarifier_state(
                user_message=user_message,
                system_prompt=system_prompt,
                history_messages=history_messages,
                trace_id=trace_id,
                provider_error_code=exc.code,
                llm_calls_used_base=llm_calls_used,
            )
            return _finalize_state(
                clarifier_state,
                used_calls=clarifier_state.get('llm_calls_used'),
            )

        if not isinstance(result.value, tuple) or len(result.value) != 2:
            if attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                continue
            break

        assistant_message, raw_operations = result.value
        assistant_message = (
            assistant_message if isinstance(assistant_message, str) else str(assistant_message or '')
        )
        if raw_operations is None:
            operations = []
        elif isinstance(raw_operations, list):
            try:
                _, operations = parse_plan_tool_args(
                    {
                        'assistant_message': assistant_message or 'Prepared roadmap edit operations.',
                        'operations': raw_operations,
                    }
                )
            except Exception:
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                break
        else:
            if attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                continue
            break

        if operations:
            (
                operations,
                parent_hint_applied,
                parent_uuid_violations,
            ) = planner._coerce_parent_hint_for_operations(
                operations=operations,
                deictic_parent_hint=deictic_parent_hint,
            )
            if parent_uuid_violations:
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = planner._augment_parent_uuid_retry_prompt(
                        planner_prompt=planner_prompt,
                        parent_uuid_violations=parent_uuid_violations,
                        deictic_parent_hint=deictic_parent_hint,
                    )
                    continue

                required_parent_types = sorted(
                    {
                        str(item.get('required_parent_type') or '').strip()
                        for item in parent_uuid_violations
                        if str(item.get('required_parent_type') or '').strip()
                    }
                )
                if required_parent_types:
                    target_text = ' or '.join(required_parent_types)
                    question = (
                        'I need the exact parent node before I can safely stage this edit. '
                        f'Please provide the parent {target_text} label or node ID.'
                    )
                else:
                    question = (
                        'I need the exact parent node before I can safely stage this edit. '
                        'Please provide the parent label or node ID.'
                    )
                clarifier_message, clarifier_options = build_clarifier_contract(
                    reason='invalid_parent_uuid_unresolved',
                    question=question,
                    options=['Provide parent label', 'Provide parent node ID', 'Cancel'],
                )
                return _finalize_state(
                    {
                        'assistant_message': clarifier_message,
                        'planned_operations': [],
                        'response_mode': 'chat',
                        'preview_recommended': False,
                        'parse_mode': 'deterministic_react_parent_uuid_clarifier',
                        'provider_used': 'rule_based',
                        'fallback_used': True,
                        'provider_error_code': 'invalid_parent_uuid_unresolved',
                        'tokens_input': result.tokens_input,
                        'tokens_output': result.tokens_output,
                        'tokens_total': result.tokens_total,
                        'pending_context_resolution': None,
                        'clear_pending_context_resolution': False,
                        'clarifier_action': 'ask_clarifier',
                        'clarifier_reason': 'invalid_parent_uuid_unresolved',
                        'clarifier_options': clarifier_options,
                        'clarifier_schema_retries': schema_invalid_attempts,
                        'planner_schema_invalid_attempts': schema_invalid_attempts,
                        'planner_repair_attempted': repair_attempted,
                        'draft_action': 'continue',
                        'tool_plan': [],
                        'needs_more_info': True,
                        'stop_reason': 'awaiting_user_input',
                    }
                )

            log_event(
                planner._logger,
                'plan_generated',
                settings=planner._settings,
                trace_id=trace_id,
                provider_used=result.provider_used,
                fallback_used=result.fallback_used,
                operations_count=len(operations),
                operation_types=[op.op.value for op in operations],
                parent_hint_applied=parent_hint_applied,
                planner_prompt_bytes=planner_prompt_bytes,
                history_messages_count=history_messages_count,
                tokens_input=result.tokens_input,
                tokens_output=result.tokens_output,
                tokens_total=result.tokens_total,
            )
            return _finalize_state(
                {
                    'assistant_message': (
                        assistant_message.strip()
                        if isinstance(assistant_message, str) and assistant_message.strip()
                        else 'Prepared roadmap edit operations.'
                    ),
                    'planned_operations': operations,
                    'response_mode': 'edit_plan',
                    'preview_recommended': bool(operations),
                    'parse_mode': f'{result.provider_used}_tool_calling',
                    'provider_used': result.provider_used,
                    'fallback_used': result.fallback_used,
                    'provider_error_code': result.provider_error_code,
                    'tokens_input': result.tokens_input,
                    'tokens_output': result.tokens_output,
                    'tokens_total': result.tokens_total,
                    'pending_context_resolution': None,
                    'clear_pending_context_resolution': False,
                    'clarifier_action': None,
                    'clarifier_reason': None,
                    'clarifier_options': None,
                    'clarifier_schema_retries': schema_invalid_attempts,
                    'planner_schema_invalid_attempts': schema_invalid_attempts,
                    'planner_repair_attempted': repair_attempted,
                    'draft_action': 'continue',
                    'tool_plan': [],
                    'needs_more_info': False,
                    'stop_reason': 'ready_to_stage',
                }
            )

        synthesized_operations = planner._maybe_synthesize_react_closure_operations(
            user_message=user_message,
            tool_observations=tool_observations,
        )
        if synthesized_operations:
            return _finalize_state(
                planner._build_synthesized_react_closure_state(
                    operations=synthesized_operations,
                    schema_invalid_attempts=schema_invalid_attempts,
                    repair_attempted=repair_attempted,
                    draft_action='continue',
                    tool_plan=[],
                    tokens_input=result.tokens_input,
                    tokens_output=result.tokens_output,
                    tokens_total=result.tokens_total,
                )
            )
        clarifier_message = (
            assistant_message.strip()
            if isinstance(assistant_message, str) and assistant_message.strip()
            else (
                'I can help with that edit. Could you confirm the exact target '
                'or provide the node ID so I can stage the operation safely?'
            )
        )
        clarifier_action = 'ask_clarifier'
        clarifier_reason = 'discovery_unresolved'
        clarifier_options = [
            'Confirm the exact target label',
            'Provide the node ID',
            'Cancel',
        ]
        clarifier_message, clarifier_options = build_clarifier_contract(
            reason=clarifier_reason,
            question=clarifier_message,
            options=clarifier_options,
        )
        return _finalize_state(
            {
                'assistant_message': clarifier_message,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_tool_calling_clarifier',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': last_provider_error_code or result.provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': clarifier_action,
                'clarifier_reason': clarifier_reason,
                'clarifier_options': clarifier_options,
                'clarifier_schema_retries': schema_invalid_attempts,
                'planner_schema_invalid_attempts': schema_invalid_attempts,
                'planner_repair_attempted': repair_attempted,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': 'awaiting_user_input',
            }
        )

    synthesized_operations = planner._maybe_synthesize_react_closure_operations(
        user_message=user_message,
        tool_observations=tool_observations,
    )
    if synthesized_operations:
        return _finalize_state(
            planner._build_synthesized_react_closure_state(
                operations=synthesized_operations,
                schema_invalid_attempts=schema_invalid_attempts,
                repair_attempted=repair_attempted,
                draft_action='continue',
                tool_plan=[],
            )
        )

    return _finalize_state(
        planner._neutral_edit_clarifier_state(
            provider_error_code=last_provider_error_code or 'invalid_planner_schema',
            schema_retries=schema_invalid_attempts,
            llm_calls_used=llm_calls_used,
        )
    )
