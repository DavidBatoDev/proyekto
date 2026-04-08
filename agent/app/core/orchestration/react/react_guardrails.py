from __future__ import annotations

from dataclasses import replace
import re
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.clarifier_contract import build_clarifier_contract
from app.core.llm.client import PlanningResult
from app.core.orchestration.shared.outcomes import EditReactLoopOutcome


def apply_context_answer_output_guard(
    *,
    planning: PlanningResult,
    pending_edit_context_present: bool,
) -> PlanningResult:
    if planning.response_mode != 'chat':
        return planning
    parse_mode = (planning.parse_mode or '').lower()
    if 'context_answer' not in parse_mode and parse_mode != 'openai_context_tools':
        return planning
    if not looks_like_pseudo_operation_payload(planning.assistant_message):
        return planning
    return PlanningResult(
        assistant_message=(
            'I can continue this as an edit plan, but I need one clear command. '
            'Please state the exact change in one line (or say "cancel").'
        ),
        operations=[],
        parse_mode='deterministic_context_answer_handoff',
        intent_type='roadmap_edit' if pending_edit_context_present else planning.intent_type,
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code='context_answer_operation_payload_blocked',
        tokens_input=planning.tokens_input,
        tokens_output=planning.tokens_output,
        tokens_total=planning.tokens_total,
        route_lane=planning.route_lane,
        clarifier_action='ask_clarifier',
        clarifier_reason='context_answer_operation_payload_blocked',
        clarifier_options=['Proceed with edit planning', 'Change target details', 'Cancel'],
    )


def looks_like_pseudo_operation_payload(assistant_message: str) -> bool:
    if not assistant_message:
        return False
    text = assistant_message.lower()
    pseudo_markers = (
        'planned operations',
        "won't be applied",
        'parent_id',
        '"action":',
        '"type":',
    )
    if any(marker in text for marker in pseudo_markers):
        return True
    if re.search(r'^\s*\[\s*\{', assistant_message.strip()):
        return True
    return False


def looks_like_found_node_without_operations(assistant_message: str) -> bool:
    if not assistant_message:
        return False
    lowered = assistant_message.lower()
    if 'id:' not in lowered and 'node id' not in lowered:
        return False
    if not re.search(
        r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
        assistant_message,
    ):
        return False
    return ('found' in lowered) or ('match' in lowered)


def build_react_guard_handoff(
    *,
    planning: PlanningResult,
    route_lane: str | None,
    assistant_message: str,
    parse_mode: str,
    provider_error_code: str,
    clarifier_reason: str,
    clarifier_options: list[str],
    needs_more_info: bool | None = None,
    stop_reason: str | None = None,
) -> PlanningResult:
    return PlanningResult(
        assistant_message=assistant_message,
        operations=[],
        parse_mode=parse_mode,
        intent_type='roadmap_edit',
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=True,
        provider_error_code=provider_error_code,
        tokens_input=planning.tokens_input,
        tokens_output=planning.tokens_output,
        tokens_total=planning.tokens_total,
        route_lane=route_lane,
        clarifier_action='ask_clarifier',
        clarifier_reason=clarifier_reason,
        clarifier_options=clarifier_options,
        draft_action=planning.draft_action,
        tool_plan=planning.tool_plan,
        needs_more_info=needs_more_info,
        stop_reason=stop_reason,
    )


def enforce_hybrid_react_terminal_guard(
    *,
    planning: PlanningResult,
    route_lane: str | None,
    user_message: str,
    agent_hybrid_react_enabled: bool,
    build_react_guard_handoff: Callable[..., PlanningResult],
    is_rename_message: Callable[[str], bool],
    has_rename_shape_operation: Callable[[list[RoadmapOperation]], bool],
    recover_rename_shape_operations: Callable[..., list[RoadmapOperation] | None],
) -> PlanningResult | None:
    if not agent_hybrid_react_enabled:
        return None
    if planning.response_mode != 'edit_plan':
        return None

    normalized_draft_action = planning.draft_action or 'continue'
    normalized_tool_plan = planning.tool_plan or []
    normalized_needs_more_info = (
        planning.needs_more_info if planning.needs_more_info is not None else False
    )
    normalized_stop_reason = planning.stop_reason or (
        'ready_to_stage' if planning.operations else 'awaiting_user_input'
    )
    planning = replace(
        planning,
        draft_action=normalized_draft_action,
        tool_plan=normalized_tool_plan,
        needs_more_info=normalized_needs_more_info,
        stop_reason=normalized_stop_reason,
    )

    if planning.draft_action not in {'continue', 'revise', 'new_draft'}:
        return build_react_guard_handoff(
            planning=planning,
            route_lane=route_lane,
            assistant_message=(
                'I need one more confirmation before staging edits because draft intent metadata '
                'was incomplete. Please restate whether this should continue, revise, or start a new draft.'
            ),
            parse_mode='deterministic_planner_schema_handoff',
            provider_error_code='planner_schema_missing_draft_action',
            clarifier_reason='planner_schema_missing_draft_action',
            clarifier_options=['Continue current draft', 'Revise current draft', 'Start new draft'],
        )

    if planning.needs_more_info:
        return build_react_guard_handoff(
            planning=planning,
            route_lane=route_lane,
            assistant_message=(
                'I could not safely stage edits yet because required context is still missing. '
                'Please answer the clarification so I can continue.'
            ),
            parse_mode='deterministic_planner_needs_more_info_handoff',
            provider_error_code='planner_needs_more_info_conflict',
            clarifier_reason='planner_needs_more_info_conflict',
            clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
        )

    if planning.stop_reason in {'tool_budget_exhausted', 'insufficient_context', 'awaiting_user_input'}:
        return build_react_guard_handoff(
            planning=planning,
            route_lane=route_lane,
            assistant_message=(
                'I still need one clarification before I can safely stage edits. '
                'Please provide the missing target details and I will continue.'
            ),
            parse_mode='deterministic_planner_stop_reason_handoff',
            provider_error_code='planner_stop_reason_conflict',
            clarifier_reason='planner_stop_reason_conflict',
            clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
            needs_more_info=True,
            stop_reason=planning.stop_reason,
        )

    if planning.operations and planning.stop_reason != 'ready_to_stage':
        return build_react_guard_handoff(
            planning=planning,
            route_lane=route_lane,
            assistant_message=(
                'I need one more clarification before I can safely stage these edits. '
                'Please confirm the exact target details.'
            ),
            parse_mode='deterministic_react_terminal_handoff',
            provider_error_code='planner_terminal_state_conflict',
            clarifier_reason='planner_terminal_state_conflict',
            clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
            needs_more_info=True,
            stop_reason=(planning.stop_reason or 'awaiting_user_input'),
        )

    if (
        planning.operations
        and is_rename_message(user_message)
        and not has_rename_shape_operation(planning.operations)
    ):
        recovered_operations = recover_rename_shape_operations(
            user_message=user_message,
            react_tool_observation_summary=planning.react_tool_observation_summary,
        )
        if recovered_operations:
            return replace(
                planning,
                operations=recovered_operations,
                parse_mode='deterministic_rename_shape_recovered',
                provider_error_code=None,
                preview_recommended=True,
                needs_more_info=False,
                stop_reason='ready_to_stage',
            )
        return build_react_guard_handoff(
            planning=planning,
            route_lane=route_lane,
            assistant_message=(
                'I understood this as a rename request, but I could not derive a safe rename '
                'operation yet. Please provide the exact current label and the new title.'
            ),
            parse_mode='deterministic_rename_shape_handoff',
            provider_error_code='rename_shape_guard_blocked',
            clarifier_reason='rename_shape_guard_blocked',
            clarifier_options=['Provide current label', 'Provide new title', 'Cancel'],
            needs_more_info=True,
            stop_reason='insufficient_context',
        )

    return None


def derive_react_terminal_action(
    *,
    planning: PlanningResult,
    edit_continuation_trigger: str | None,
) -> str:
    if edit_continuation_trigger == 'cancel':
        return 'cancel'
    if planning.response_mode == 'edit_plan' and planning.operations:
        return 'execute'
    if planning.clarifier_action in {'ask_clarifier', 'propose_safe_default', 'cannot_proceed'}:
        return 'clarify'
    if planning.response_mode == 'chat':
        return 'clarify'
    return 'execute'


def run_edit_react_loop(
    *,
    planning: PlanningResult,
    pending_edit_context_present: bool,
    edit_continuation_trigger: str | None,
    route_lane: str | None,
    user_message: str,
    apply_context_answer_output_guard: Callable[..., PlanningResult],
    looks_like_found_node_without_operations: Callable[[str], bool],
    enforce_hybrid_react_terminal_guard: Callable[..., PlanningResult | None],
    apply_operation_contract_guard: Callable[..., tuple[PlanningResult, dict[str, Any] | None]],
    normalize_planning_clarifier_contract: Callable[[PlanningResult], PlanningResult],
) -> EditReactLoopOutcome:
    edit_guard_intervened = False

    planning = apply_context_answer_output_guard(
        planning=planning,
        pending_edit_context_present=pending_edit_context_present,
    )
    if planning.provider_error_code == 'context_answer_operation_payload_blocked':
        edit_guard_intervened = True
    if (
        pending_edit_context_present
        and edit_continuation_trigger == 'confirm'
        and planning.response_mode != 'edit_plan'
    ):
        planning = PlanningResult(
            assistant_message=(
                'I still have your pending edit draft, but I could not stage it from that '
                'confirmation alone. Please provide the exact change in one line '
                '(or say "cancel").'
            ),
            operations=[],
            parse_mode='deterministic_pending_edit_confirm_handoff',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='pending_edit_confirm_requires_edit_plan',
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=route_lane,
            clarifier_action='ask_clarifier',
            clarifier_reason='pending_edit_confirm_requires_edit_plan',
            clarifier_options=['Proceed with edit planning', 'Change target details', 'Cancel'],
        )
        edit_guard_intervened = True
    if (
        pending_edit_context_present
        and edit_continuation_trigger in {'confirm', 'retry'}
        and planning.response_mode == 'chat'
        and not planning.operations
        and looks_like_found_node_without_operations(planning.assistant_message)
    ):
        planning = PlanningResult(
            assistant_message=(
                'I found likely target node matches, but I still need one explicit selection '
                'to stage a safe edit operation. Reply with the exact node ID (or say "cancel").'
            ),
            operations=[],
            parse_mode='deterministic_edit_narrative_handoff',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='edit_narrative_without_operations',
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=route_lane,
            clarifier_action='ask_clarifier',
            clarifier_reason='edit_narrative_without_operations',
            clarifier_options=['Use the matched node ID', 'Refine the node label', 'Cancel'],
        )
        edit_guard_intervened = True
    hybrid_guard_handoff = enforce_hybrid_react_terminal_guard(
        planning=planning,
        route_lane=route_lane,
        user_message=user_message,
    )
    if hybrid_guard_handoff is not None:
        planning = hybrid_guard_handoff
        edit_guard_intervened = True

    planning, operation_validation_error = apply_operation_contract_guard(
        planning=planning,
        route_lane=route_lane,
    )

    planning = normalize_planning_clarifier_contract(planning)
    return EditReactLoopOutcome(
        planning=planning,
        edit_guard_intervened=edit_guard_intervened,
        operation_validation_error=operation_validation_error,
    )


def normalize_planning_clarifier_contract(
    planning: PlanningResult,
) -> PlanningResult:
    if planning.response_mode != 'chat':
        return planning
    if planning.clarifier_action not in {
        'ask_clarifier',
        'propose_safe_default',
        'cannot_proceed',
    }:
        return planning

    fallback_options = [
        'Provide target details',
        'Provide node ID',
        'Cancel',
    ]
    question = planning.assistant_message or 'I need one clarification before I can safely continue.'
    message, normalized_options = build_clarifier_contract(
        reason=planning.clarifier_reason,
        question=question,
        options=planning.clarifier_options or fallback_options,
    )
    return replace(
        planning,
        assistant_message=message,
        clarifier_options=normalized_options,
    )
