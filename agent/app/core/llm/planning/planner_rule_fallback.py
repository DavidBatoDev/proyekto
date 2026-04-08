from __future__ import annotations

import re
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType


def rule_based_chat_response(user_message: str, intent_type: IntentType) -> str:
    lowered = user_message.strip().lower()
    if intent_type == 'smalltalk':
        return 'Hi. I can chat normally and help you prepare roadmap edits when you are ready.'
    if intent_type in {'general_question', 'question'}:
        return (
            'I can help explain roadmap structure, suggest planning steps, and prepare safe edit operations '
            'that you can preview manually.'
        )
    if intent_type == 'roadmap_query':
        return 'I can answer roadmap data questions using read-only context tools. Ask about epics, features, tasks, or statuses.'
    if intent_type == 'roadmap_plan':
        return 'I can draft a roadmap plan with epic, feature, and task structure. Share your objective and constraints.'
    if intent_type == 'confirm_action':
        return 'I can apply confirmations when there is a pending plan. If you want to execute changes, confirm the exact draft or target.'
    if lowered:
        return (
            'I can help with normal chat or roadmap edits. If you keep seeing this style of response, '
            'the model provider is likely unavailable or out of quota. '
            'If you want edits, describe the action and target node IDs, then we can generate a preview.'
        )
    return 'Tell me what you want to do, and I will help.'


def rule_based_operation_plan(
    *,
    user_message: str,
    planning_result_cls: type[Any],
) -> Any:
    text = user_message.strip()
    operations: list[RoadmapOperation] = []
    uuid_match = re.search(r'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', text)

    rename_match = re.search(
        r'(?:rename|retitle|change(?:\s+the)?\s+name(?:\s+of)?)\b.*?(?:to|as)\s+[\"\']([^\"\']+)[\"\']',
        text,
        re.IGNORECASE,
    )
    if rename_match and uuid_match:
        operations.append(
            RoadmapOperation(
                op='update_node',
                node_id=uuid_match.group(1),
                patch={'title': rename_match.group(1).strip()},
            )
        )

    move_match = re.search(
        r'move\s+([0-9a-fA-F-]{36})\s+under\s+([0-9a-fA-F-]{36})(?:\s+at\s+(\d+))?',
        text,
        re.IGNORECASE,
    )
    if move_match:
        operations.append(
            RoadmapOperation(
                op='move_node',
                node_id=move_match.group(1),
                new_parent_id=move_match.group(2),
                position=int(move_match.group(3)) if move_match.group(3) else None,
            )
        )

    mark_done_match = re.search(
        r'mark\s+([0-9a-fA-F-]{36})\s+(done|completed|in_progress|blocked|todo)',
        text,
        re.IGNORECASE,
    )
    if mark_done_match:
        status_value = mark_done_match.group(2).lower()
        if status_value == 'completed':
            status_value = 'done'
        operations.append(
            RoadmapOperation(
                op='mark_status',
                node_id=mark_done_match.group(1),
                status=status_value,
            )
        )

    delete_match = re.search(r'delete\s+([0-9a-fA-F-]{36})', text, re.IGNORECASE)
    if delete_match:
        operations.append(
            RoadmapOperation(
                op='delete_node',
                node_id=delete_match.group(1),
            )
        )

    shift_match = re.search(
        r'shift\s+([0-9a-fA-F-]{36})\s+by\s+(-?\d+)\s+days?',
        text,
        re.IGNORECASE,
    )
    if shift_match:
        operations.append(
            RoadmapOperation(
                op='shift_dates',
                node_id=shift_match.group(1),
                delta_days=int(shift_match.group(2)),
            )
        )

    if operations:
        return planning_result_cls(
            assistant_message='I prepared roadmap edit operations. Click Preview to validate them before commit.',
            operations=operations,
            parse_mode='rule_based_edit',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=True,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code=None,
            draft_action='continue',
            tool_plan=[],
            needs_more_info=False,
            stop_reason='ready_to_stage',
        )

    return planning_result_cls(
        assistant_message=(
            'I can help with that roadmap edit. Could you confirm the exact action and target '
            '(for example: create epic, rename feature, or move task)?'
        ),
        operations=[],
        parse_mode='neutral_edit_clarifier',
        intent_type='roadmap_edit',
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code='missing_tool_call',
        clarifier_action='ask_clarifier',
        clarifier_reason='missing_tool_call',
        draft_action='continue',
        tool_plan=[],
        needs_more_info=True,
        stop_reason='awaiting_user_input',
    )


def plan_with_rules(
    *,
    user_message: str,
    existing_operations: list[RoadmapOperation],
    planning_result_cls: type[Any],
    heuristic_intent_resolver: Callable[[str], IntentType],
) -> Any:
    _ = existing_operations
    intent_type = heuristic_intent_resolver(user_message)
    if intent_type == 'roadmap_edit':
        return rule_based_operation_plan(
            user_message=user_message,
            planning_result_cls=planning_result_cls,
        )

    return planning_result_cls(
        assistant_message=rule_based_chat_response(user_message, intent_type),
        operations=[],
        parse_mode='rule_based_chat',
        intent_type=intent_type,
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code='no_provider_available',
    )
