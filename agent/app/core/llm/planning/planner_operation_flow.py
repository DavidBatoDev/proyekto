from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.contracts.clarifier_contract import build_clarifier_contract
from app.core.llm.providers import ProviderAdapterError
from app.core.logging_utils import log_event
from app.core.tools.registry import (
    get_edit_helper_tools,
    get_edit_mode_tools,
    get_operation_tools,
    get_planning_tool,
    PLANNING_TOOL_NAME,
    parse_plan_tool_args,
)


def _is_bulk_task_scope_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_update_verb = bool(re.search(r'\b(mark|update|set|move|change)\b', normalized))
    return has_bulk_scope and has_update_verb


def _explicit_parent_type_hint(user_message: str) -> str | None:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized:
        return None
    mentions_epic = bool(re.search(r'\bepic\b', normalized))
    mentions_feature = bool(re.search(r'\bfeature\b', normalized))
    if mentions_epic and not mentions_feature:
        return 'epic'
    if mentions_feature and not mentions_epic:
        return 'feature'
    return None


def _is_parent_scoped_bulk_status_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_status_update_verb = bool(re.search(r'\b(mark|update|set|change)\b', normalized))
    has_parent_scope = bool(re.search(r'\b(in|under|within|inside|for)\b', normalized))
    has_filter_hint = bool(
        re.search(r'\b(assignee|assigned|owner|priority|keyword|title|name|contains)\b', normalized)
    )
    return has_bulk_scope and has_status_update_verb and has_parent_scope and not has_filter_hint


def _is_parent_scoped_bulk_filter_update_intent(user_message: str) -> bool:
    normalized = ' '.join(str(user_message or '').lower().split())
    if not normalized or 'task' not in normalized:
        return False
    has_bulk_scope = bool(re.search(r'\b(all|every)\b', normalized))
    has_update_verb = bool(re.search(r'\b(mark|update|set|change)\b', normalized))
    has_parent_scope = bool(re.search(r'\b(in|under|within|inside|for)\b', normalized))
    has_filter_hint = bool(
        re.search(r'\b(assignee|assigned|owner|priority|keyword|title|name|contains)\b', normalized)
    )
    return has_bulk_scope and has_update_verb and has_parent_scope and has_filter_hint


def _has_resolved_parent_context(
    *,
    deictic_parent_hint: dict[str, Any] | None,
    effective_tool_summary: list[dict[str, Any]],
) -> bool:
    if isinstance(deictic_parent_hint, dict):
        hint_node_type = str(deictic_parent_hint.get('node_type') or '').strip().lower()
        hint_node_id = str(deictic_parent_hint.get('node_id') or '').strip()
        if hint_node_type in {'epic', 'feature'} and hint_node_id:
            return True

    for item in effective_tool_summary:
        if not isinstance(item, dict):
            continue
        node_type = str(item.get('node_type') or '').strip().lower()
        if node_type in {'epic', 'feature'} and str(item.get('node_id') or '').strip():
            return True
        if str(item.get('epic_id') or '').strip() or str(item.get('feature_id') or '').strip():
            return True
        matches = item.get('match_items')
        if not isinstance(matches, list):
            continue
        for match in matches:
            if not isinstance(match, dict):
                continue
            match_type = str(match.get('type') or '').strip().lower()
            match_id = str(match.get('id') or '').strip()
            if match_type in {'epic', 'feature'} and match_id:
                return True
    return False


def _select_tools_by_name(
    tools: list[dict[str, Any]],
    allowed_names: set[str],
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for tool in tools:
        tool_name = str(tool.get('function', {}).get('name') or '').strip()
        if tool_name in allowed_names:
            selected.append(tool)
    return selected


def _operation_payloads(operations: list[RoadmapOperation]) -> list[dict[str, Any]]:
    return [
        operation.model_dump(mode='json', exclude_none=True)
        for operation in operations
    ]


def _has_bulk_task_status_semantic_mismatch(
    *,
    user_message: str,
    operations: list[RoadmapOperation],
) -> bool:
    if not _is_parent_scoped_bulk_status_intent(user_message):
        return False
    mark_status_operations = [
        operation
        for operation in operations
        if operation.op.value == 'mark_status'
    ]
    if not mark_status_operations:
        return True
    for operation in mark_status_operations:
        node_type = operation.node_type.value if operation.node_type is not None else ''
        if node_type != 'task':
            return True
    return False


def _augment_bulk_task_status_contract_retry_prompt(
    *,
    planner_prompt: str,
    operations: list[RoadmapOperation],
) -> str:
    marker = 'BULK TASK STATUS CONTRACT REPAIR:'
    if marker in planner_prompt:
        return planner_prompt
    payload = json.dumps(
        _operation_payloads(operations)[:5],
        ensure_ascii=True,
        separators=(',', ':'),
    )
    return (
        f'{planner_prompt}\n\n'
        'BULK TASK STATUS CONTRACT REPAIR:\n'
        'User asked to update status for all tasks under a parent scope.\n'
        'Do not mark feature or epic status directly for this intent.\n'
        'Call bulk_update_tasks_by_parent with include_completed=true '
        '(or bulk_update_tasks_by_filter when explicit filters are requested), '
        'then call plan_roadmap_operations with task-level mark_status operations only.\n\n'
        f'Invalid operations from previous attempt:\n{payload}'
    )


def _safe_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return 0
    return 0


def _latest_bulk_parent_helper_result(
    tool_observations: list[dict[str, Any]],
) -> dict[str, Any] | None:
    for observation in reversed(tool_observations):
        if str(observation.get('tool_name') or '').strip() != 'bulk_update_tasks_by_parent':
            continue
        result = observation.get('result')
        if isinstance(result, dict):
            return result
    return None


def _synthesize_bulk_parent_operations_from_result(
    helper_result: dict[str, Any] | None,
) -> list[RoadmapOperation]:
    if not isinstance(helper_result, dict):
        return []
    raw_operations = helper_result.get('operations')
    if not isinstance(raw_operations, list):
        return []

    synthesized: list[RoadmapOperation] = []
    for item in raw_operations:
        if not isinstance(item, dict):
            continue
        try:
            synthesized.append(RoadmapOperation.model_validate(item))
        except Exception:
            continue
    return synthesized


def _build_bulk_status_noop_message(
    *,
    helper_result: dict[str, Any],
    fallback_message: str,
) -> str:
    total_child_count = _safe_int(helper_result.get('total_child_task_count'))
    excluded_completed_count = _safe_int(helper_result.get('excluded_completed_count'))
    eligible_count = _safe_int(helper_result.get('eligible_task_count'))
    already_target_count = _safe_int(helper_result.get('already_target_status_count'))
    target_status = str(helper_result.get('target_status') or '').strip().replace('_', ' ')
    target_suffix = f'"{target_status}"' if target_status else 'the requested status'

    if total_child_count <= 0:
        return (
            'I found the selected parent scope, but it currently has no child tasks to update.'
        )

    if excluded_completed_count > 0 and eligible_count <= 0:
        return (
            f'I found {total_child_count} child task(s), but all were completed and excluded '
            'by the current include_completed policy.'
        )

    if eligible_count > 0 and already_target_count >= eligible_count:
        return (
            f'I found {eligible_count} eligible task(s), and they are already set to {target_suffix}. '
            'No changes were staged.'
        )

    if eligible_count <= 0:
        return (
            f'I found {total_child_count} child task(s), but none were eligible for updates '
            'with the current filters.'
        )

    if fallback_message.strip():
        return fallback_message.strip()

    return (
        f'I found {eligible_count} eligible task(s), but no status changes were needed.'
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
    dedupe_tool_names = {'resolve_node_reference', 'search_nodes'}
    dedupe_result_cache: dict[tuple[str, str], dict[str, Any]] = {}
    bulk_scope_update_intent = (
        intent_type == 'roadmap_edit'
        and _is_bulk_task_scope_update_intent(user_message)
    )
    force_include_completed_for_bulk_status = (
        intent_type == 'roadmap_edit'
        and _is_parent_scoped_bulk_status_intent(user_message)
    )
    strict_mutation_authority_enabled = (
        intent_type == 'roadmap_edit'
        and bool(
            getattr(
                planner._settings,
                'agent_strict_mutation_authority_enabled',
                False,
            )
        )
    )
    explicit_parent_type_hint = _explicit_parent_type_hint(user_message)
    operation_op_guardrail = (
        'Helper tool names are never valid operation op values. '
        'Only use operation op values: add_epic, add_feature, add_task, '
        'update_node, move_node, delete_node, mark_status, shift_dates.'
    )

    def _serialize_tool_args(value: dict[str, Any]) -> str:
        try:
            return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
        except TypeError:
            return repr(value)

    def _record_tool_dedupe_hit() -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        metrics['resolve_dedup_hits'] = int(metrics.get('resolve_dedup_hits') or 0) + 1

    def _record_invalid_payload_metric(metric_label: str) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        if metric_label == 'enum_op':
            key = 'planner_invalid_payload_enum_op'
        elif metric_label == 'missing_required':
            key = 'planner_invalid_payload_missing_required'
        else:
            key = 'planner_invalid_payload_other'
        metrics[key] = int(metrics.get(key) or 0) + 1

    def _classify_invalid_payload(error_message: str | None) -> str:
        if planner._is_invalid_operation_enum_payload(error_message):
            return 'enum_op'
        detail = str(error_message or '').strip().lower()
        if "'type': 'missing'" in detail or 'field required' in detail:
            return 'missing_required'
        return 'other'

    def _capturing_tool_executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
        effective_args = dict(args) if isinstance(args, dict) else {}
        if name == 'resolve_node_reference' and bulk_scope_update_intent:
            if explicit_parent_type_hint in {'epic', 'feature'}:
                effective_args['allowed_node_types'] = [explicit_parent_type_hint]
            else:
                effective_args['allowed_node_types'] = ['feature', 'epic']
            effective_args.pop('node_type', None)
        if name == 'bulk_update_tasks_by_parent' and force_include_completed_for_bulk_status:
            effective_args['include_completed'] = True

        cache_key: tuple[str, str] | None = None
        if name in dedupe_tool_names and isinstance(effective_args, dict):
            cache_key = (name, _serialize_tool_args(effective_args))
            cached = dedupe_result_cache.get(cache_key)
            if cached is not None:
                _record_tool_dedupe_hit()
                result = deepcopy(cached)
                planner._record_react_tool_observation(
                    observations=tool_observations,
                    summary=tool_observation_summary,
                    tool_name=name,
                    args=effective_args,
                    result=result,
                )
                return result

        result = planner._execute_context_tool(name, effective_args, session_context)
        if cache_key is not None and isinstance(result, dict):
            dedupe_result_cache[cache_key] = deepcopy(result)
        planner._record_react_tool_observation(
            observations=tool_observations,
            summary=tool_observation_summary,
            tool_name=name,
            args=effective_args,
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

    def _is_strict_synthesis_fallback_allowed(
        *,
        provider_error_code: str | None,
    ) -> bool:
        if not strict_mutation_authority_enabled:
            return True
        normalized_error_code = str(provider_error_code or '').strip().lower()
        if normalized_error_code not in {'invalid_operation_payload', 'missing_tool_call'}:
            return False
        return bool(tool_observations)

    def _try_synthesize_react_closure_state(
        *,
        reason: str,
        provider_error_code: str | None,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> dict[str, Any] | None:
        if not _is_strict_synthesis_fallback_allowed(provider_error_code=provider_error_code):
            if strict_mutation_authority_enabled:
                log_event(
                    planner._logger,
                    'react_synthesis_skipped_strict_authority',
                    settings=planner._settings,
                    trace_id=trace_id,
                    reason=reason,
                    provider_error_code=provider_error_code,
                    tool_observation_count=len(tool_observations),
                )
            return None

        synthesized_operations = planner._maybe_synthesize_react_closure_operations(
            user_message=user_message,
            tool_observations=tool_observations,
            session_context=session_context,
            force_include_completed=force_include_completed_for_bulk_status,
        )
        if not synthesized_operations:
            return None

        if strict_mutation_authority_enabled:
            log_event(
                planner._logger,
                'react_synthesis_used_strict_fallback',
                settings=planner._settings,
                trace_id=trace_id,
                reason=reason,
                provider_error_code=provider_error_code,
                operations_count=len(synthesized_operations),
            )

        return _finalize_state(
            planner._build_synthesized_react_closure_state(
                operations=synthesized_operations,
                schema_invalid_attempts=schema_invalid_attempts,
                repair_attempted=repair_attempted,
                draft_action='continue',
                tool_plan=[],
                tokens_input=tokens_input,
                tokens_output=tokens_output,
                tokens_total=tokens_total,
            )
        )

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
    bulk_scope_parent_guard = (
        bulk_scope_update_intent
        and _has_resolved_parent_context(
            deictic_parent_hint=deictic_parent_hint,
            effective_tool_summary=effective_tool_summary,
        )
    )
    strict_parent_bulk_status_guard = (
        bulk_scope_parent_guard
        and _is_parent_scoped_bulk_status_intent(user_message)
    )
    parent_scoped_bulk_filter_guard = (
        bulk_scope_parent_guard
        and _is_parent_scoped_bulk_filter_update_intent(user_message)
    )
    helper_guarded_bulk_scope_intent = (
        strict_parent_bulk_status_guard
        or parent_scoped_bulk_filter_guard
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
    elif helper_guarded_bulk_scope_intent:
        helper_tools = get_edit_helper_tools()
        if strict_parent_bulk_status_guard:
            tool_definitions = [
                *_select_tools_by_name(helper_tools, {'bulk_update_tasks_by_parent'}),
                get_planning_tool(),
            ]
        else:
            tool_definitions = [
                *_select_tools_by_name(
                    helper_tools,
                    {'bulk_update_tasks_by_parent', 'bulk_update_tasks_by_filter'},
                ),
                get_planning_tool(),
            ]
        edit_turns = max(1, min(edit_turns, 2))

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
            f'{operation_op_guardrail}\n\n'
            'Current staged operations:\n'
            f'{staged_operations_payload}\n\n'
            'Roadmap ID:\n'
            f'{roadmap_id_value}\n\n'
            'User request:\n'
            f'{user_message}'
        )
    elif helper_guarded_bulk_scope_intent and not followup_closed_world_turn:
        helper_call_guidance = (
            'Call bulk_update_tasks_by_parent exactly once with include_completed=true, then call '
            'plan_roadmap_operations exactly once.'
            if strict_parent_bulk_status_guard
            else (
                'Call one helper first (bulk_update_tasks_by_parent or '
                'bulk_update_tasks_by_filter), then call plan_roadmap_operations exactly once.'
            )
        )
        planner_prompt = (
            'You are in edit planning mode with resolved parent context for a bulk task update.\n'
            f'ReAct loop turn: {react_loop_turn}.\n'
            f'Max tool calls this turn: {edit_turns}.\n'
            'Do not call discovery/read tools in this turn.\n'
            f'{helper_call_guidance}\n'
            'Avoid low-level task-by-task discovery when parent scope is already available.\n\n'
            f'{operation_op_guardrail}\n\n'
            'Resolved context summary:\n'
            f'{json.dumps(effective_tool_summary[:10], ensure_ascii=True, separators=(",", ":"))}\n\n'
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
            'For intents like "mark/update all tasks in or under X", use '
            'bulk_update_tasks_by_parent with include_completed=true and the resolved parent ID instead of asking for task IDs.\n'
            'For combined scope + filter updates (for example assignee/status/keyword), use bulk_update_tasks_by_filter.\n'
            'If task_ids or task summaries are already present in prior observations, stage operations immediately.\n'
            'If you still cannot produce safe operations, call plan_roadmap_operations with an empty '
            'operations list and place the clarifying question in assistant_message.\n\n'
            f'{operation_op_guardrail}\n\n'
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
            f'{operation_op_guardrail}\n'
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
            'Use intent-level helper tools for common actions (create_*, move_*, reorder_*, bulk_*).\n'
            f'{operation_op_guardrail}\n'
            'For "all tasks under a feature/epic" status updates, prefer bulk_update_tasks_by_parent with include_completed=true.\n'
            'For broad task updates with filters, prefer bulk_update_tasks_by_filter.\n'
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
    if strict_mutation_authority_enabled:
        planner_prompt += (
            '\n\nStrict mutation-authority policy:\n'
            'Only plan_roadmap_operations may finalize staged operations. '
            'Treat helper tool results as intermediate context or drafts.'
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
            if exc.code == 'invalid_operation_payload':
                _record_invalid_payload_metric(_classify_invalid_payload(exc.message))
                if attempt == 0:
                    synthesized_state = _try_synthesize_react_closure_state(
                        reason='provider_invalid_operation_payload_initial',
                        provider_error_code=exc.code,
                        tokens_input=exc.tokens_input,
                        tokens_output=exc.tokens_output,
                        tokens_total=exc.tokens_total,
                    )
                    if synthesized_state is not None:
                        return synthesized_state
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
                enum_op_payload = (
                    exc.code == 'invalid_operation_payload'
                    and planner._is_invalid_operation_enum_payload(exc.message)
                )
                schema_invalid_attempts += 1
                repair_attempted = True
                planner_prompt = planner._augment_repair_planner_prompt(
                    planner_prompt=planner_prompt,
                    error_code=exc.code,
                    error_message=exc.message,
                )
                if exc.code == 'missing_tool_call' or enum_op_payload:
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
            synthesized_state = _try_synthesize_react_closure_state(
                reason='provider_react_exception_fallback',
                provider_error_code=exc.code,
            )
            if synthesized_state is not None:
                return synthesized_state
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
        planning_tool_args = {
            'assistant_message': assistant_message.strip()[:200],
            'operations_count': len(raw_operations) if isinstance(raw_operations, list) else 0,
        }
        log_event(
            planner._logger,
            'tool_call_requested',
            settings=planner._settings,
            trace_id=trace_id,
            tool_name=PLANNING_TOOL_NAME,
            tool_args=planning_tool_args,
            arg_keys=sorted(planning_tool_args.keys()),
            roadmap_id=roadmap_id_value,
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
                log_event(
                    planner._logger,
                    'tool_call_result',
                    settings=planner._settings,
                    trace_id=trace_id,
                    tool_name=PLANNING_TOOL_NAME,
                    tool_error_code='invalid_operation_payload',
                    result_summary={
                        'result_type': 'dict',
                        'error_code': 'invalid_operation_payload',
                        'operations_count': planning_tool_args.get('operations_count'),
                    },
                )
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                break
        else:
            log_event(
                planner._logger,
                'tool_call_result',
                settings=planner._settings,
                trace_id=trace_id,
                tool_name=PLANNING_TOOL_NAME,
                tool_error_code='invalid_operation_payload',
                result_summary={
                    'result_type': 'dict',
                    'error_code': 'invalid_operation_payload',
                    'operations_count': 0,
                },
            )
            if attempt + 1 < max_attempts:
                schema_invalid_attempts += 1
                repair_attempted = True
                continue
            break

        log_event(
            planner._logger,
            'tool_call_result',
            settings=planner._settings,
            trace_id=trace_id,
            tool_name=PLANNING_TOOL_NAME,
            result_summary={
                'result_type': 'dict',
                'operations_count': len(operations),
                'operation_types': [operation.op.value for operation in operations],
                'assistant_message_present': bool(assistant_message.strip()),
            },
        )

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
                        f'Please provide the parent {target_text} name.'
                    )
                else:
                    question = (
                        'I need the exact parent node before I can safely stage this edit. '
                        'Please provide the parent name.'
                    )
                clarifier_message, clarifier_options = build_clarifier_contract(
                    reason='invalid_parent_uuid_unresolved',
                    question=question,
                    options=['Provide parent name', 'Provide the exact name', 'Cancel'],
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

            if _has_bulk_task_status_semantic_mismatch(
                user_message=user_message,
                operations=operations,
            ):
                log_event(
                    planner._logger,
                    'bulk_task_scope_operation_mismatch',
                    settings=planner._settings,
                    trace_id=trace_id,
                    operation_payloads=_operation_payloads(operations),
                )
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = _augment_bulk_task_status_contract_retry_prompt(
                        planner_prompt=planner_prompt,
                        operations=operations,
                    )
                    helper_tools = get_edit_helper_tools()
                    helper_names = (
                        {'bulk_update_tasks_by_parent', 'bulk_update_tasks_by_filter'}
                        if _is_parent_scoped_bulk_filter_update_intent(user_message)
                        else {'bulk_update_tasks_by_parent'}
                    )
                    tool_definitions = [
                        *_select_tools_by_name(helper_tools, helper_names),
                        get_planning_tool(),
                    ]
                    edit_turns = max(1, min(edit_turns, 2))
                    continue
                synthesized_state = _try_synthesize_react_closure_state(
                    reason='bulk_task_scope_operation_mismatch',
                    provider_error_code=result.provider_error_code,
                    tokens_input=result.tokens_input,
                    tokens_output=result.tokens_output,
                    tokens_total=result.tokens_total,
                )
                if synthesized_state is not None:
                    synthesized_operations = synthesized_state.get('planned_operations')
                    if isinstance(synthesized_operations, list) and synthesized_operations:
                        operations = synthesized_operations
                    else:
                        return synthesized_state
                else:
                    clarifier_message, clarifier_options = build_clarifier_contract(
                        reason='bulk_task_scope_requires_task_targets',
                        question=(
                            'I could not safely stage this update because the plan targeted a feature '
                            'instead of child tasks. Please confirm the exact parent feature or epic.'
                        ),
                        options=['Use the matched parent', 'Provide exact parent', 'Cancel'],
                    )
                    return _finalize_state(
                        {
                            'assistant_message': clarifier_message,
                            'planned_operations': [],
                            'response_mode': 'chat',
                            'preview_recommended': False,
                            'parse_mode': 'deterministic_bulk_task_scope_mismatch_clarifier',
                            'provider_used': 'rule_based',
                            'fallback_used': True,
                            'provider_error_code': 'bulk_task_scope_operation_mismatch',
                            'tokens_input': result.tokens_input,
                            'tokens_output': result.tokens_output,
                            'tokens_total': result.tokens_total,
                            'pending_context_resolution': None,
                            'clear_pending_context_resolution': False,
                            'clarifier_action': 'ask_clarifier',
                            'clarifier_reason': 'bulk_task_scope_operation_mismatch',
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

            operation_payloads = _operation_payloads(operations)
            log_event(
                planner._logger,
                'plan_generated',
                settings=planner._settings,
                trace_id=trace_id,
                provider_used=result.provider_used,
                fallback_used=result.fallback_used,
                operations_count=len(operations),
                operation_types=[op.op.value for op in operations],
                operation_payloads=operation_payloads,
                parent_hint_applied=parent_hint_applied,
                planner_prompt_bytes=planner_prompt_bytes,
                history_messages_count=history_messages_count,
                tokens_input=result.tokens_input,
                tokens_output=result.tokens_output,
                tokens_total=result.tokens_total,
            )
            for operation_index, operation_payload in enumerate(operation_payloads):
                log_event(
                    planner._logger,
                    'llm_planned_operation',
                    settings=planner._settings,
                    trace_id=trace_id,
                    provider_used=result.provider_used,
                    operation_index=operation_index,
                    operation=operation_payload,
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

        if _is_parent_scoped_bulk_status_intent(user_message):
            latest_bulk_result = _latest_bulk_parent_helper_result(tool_observations)
            if latest_bulk_result is not None:
                synthesized_from_observation = _synthesize_bulk_parent_operations_from_result(
                    latest_bulk_result
                )
                if synthesized_from_observation:
                    return _finalize_state(
                        planner._build_synthesized_react_closure_state(
                            operations=synthesized_from_observation,
                            schema_invalid_attempts=schema_invalid_attempts,
                            repair_attempted=repair_attempted,
                            draft_action='continue',
                            tool_plan=[],
                            tokens_input=result.tokens_input,
                            tokens_output=result.tokens_output,
                            tokens_total=result.tokens_total,
                        )
                    )

                no_op_message = _build_bulk_status_noop_message(
                    helper_result=latest_bulk_result,
                    fallback_message=assistant_message,
                )
                return _finalize_state(
                    {
                        'assistant_message': no_op_message,
                        'planned_operations': [],
                        'response_mode': 'chat',
                        'preview_recommended': False,
                        'parse_mode': 'deterministic_bulk_parent_status_noop',
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
                        'stop_reason': 'no_changes_needed',
                    }
                )

        synthesized_state = _try_synthesize_react_closure_state(
            reason='planner_returned_empty_operations',
            provider_error_code=result.provider_error_code,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            tokens_total=result.tokens_total,
        )
        if synthesized_state is not None:
            return synthesized_state
        clarifier_message = (
            assistant_message.strip()
            if isinstance(assistant_message, str) and assistant_message.strip()
            else (
                'I can help with that edit. Could you confirm the exact target '
                'or provide more details so I can stage the operation safely?'
            )
        )
        clarifier_action = 'ask_clarifier'
        clarifier_reason = 'discovery_unresolved'
        clarifier_options = [
            'Confirm the exact target label',
            'Provide the exact name',
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

    synthesized_state = _try_synthesize_react_closure_state(
        reason='planner_attempts_exhausted',
        provider_error_code=last_provider_error_code,
    )
    if synthesized_state is not None:
        return synthesized_state

    return _finalize_state(
        planner._neutral_edit_clarifier_state(
            provider_error_code=last_provider_error_code or 'invalid_planner_schema',
            schema_retries=schema_invalid_attempts,
            llm_calls_used=llm_calls_used,
        )
    )
