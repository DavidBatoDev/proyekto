from __future__ import annotations

import json
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.llm.client import PlanningResult
from app.core.uuid_utils import normalize_uuid

_ORDER_INSENSITIVE_SIGNATURE_FIELDS = {'tags'}


def operation_signature(
    operation: RoadmapOperation,
    *,
    order_insensitive_signature_fields: set[str] | None = None,
) -> str:
    payload = canonicalize_signature_value(
        operation.model_dump(exclude_none=True),
        order_insensitive_signature_fields=(
            order_insensitive_signature_fields
            if order_insensitive_signature_fields is not None
            else _ORDER_INSENSITIVE_SIGNATURE_FIELDS
        ),
    )
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(',', ':'),
    )


def canonicalize_signature_value(
    value: Any,
    *,
    key_path: tuple[str, ...] = (),
    order_insensitive_signature_fields: set[str] | None = None,
) -> Any:
    normalized_fields = (
        order_insensitive_signature_fields
        if order_insensitive_signature_fields is not None
        else _ORDER_INSENSITIVE_SIGNATURE_FIELDS
    )
    if isinstance(value, dict):
        return {
            key: canonicalize_signature_value(
                item,
                key_path=key_path + (str(key),),
                order_insensitive_signature_fields=normalized_fields,
            )
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, list):
        field_name = key_path[-1] if key_path else ''
        if (
            field_name in normalized_fields
            and all(isinstance(item, str) for item in value)
        ):
            return sorted(value)
        return [
            canonicalize_signature_value(
                item,
                key_path=key_path,
                order_insensitive_signature_fields=normalized_fields,
            )
            for item in value
        ]
    return value


def should_replace_staged_operations(*, planning: PlanningResult) -> bool:
    if planning.response_mode != 'edit_plan':
        return False
    return planning.draft_action == 'revise'


def read_operation_title(operation: RoadmapOperation) -> str | None:
    if not isinstance(operation.data, dict):
        return None
    title = operation.data.get('title')
    if isinstance(title, str):
        normalized = title.strip()
        if normalized:
            return normalized
    return None


def validate_operation_contract(
    operations: list[RoadmapOperation],
    *,
    is_uuid: Callable[[str | None], bool],
) -> dict[str, Any] | None:
    for index, operation in enumerate(operations):
        issues = operation.semantic_contract_issues(is_uuid=is_uuid)
        if issues:
            reason = issues[0]
            issue_detail = _extract_uuid_issue_detail(operation, reason)
            return {
                'index': index,
                'reason': reason,
                'op': operation.op.value,
                'node_type': operation.node_type.value if operation.node_type is not None else None,
                'issue_detail': issue_detail,
                'operation': operation.model_dump(exclude_none=True),
            }
    return None


def _extract_uuid_issue_detail(operation: RoadmapOperation, reason: str) -> dict[str, Any] | None:
    id_field: str | None = None
    if reason == 'move_node.new_parent_id_invalid_uuid':
        id_field = 'new_parent_id'
    elif reason.endswith('node_id_invalid_uuid'):
        id_field = 'node_id'
    elif reason.endswith('parent_id_invalid_uuid'):
        id_field = 'parent_id'
    if id_field is None:
        return None

    raw_value = getattr(operation, id_field, None)
    normalized_value = normalize_uuid(raw_value)
    if isinstance(raw_value, str):
        value_preview = raw_value.strip()[:120]
    elif raw_value is None:
        value_preview = None
    else:
        value_preview = str(raw_value)[:120]
    return {
        'id_field': id_field,
        'id_value_preview': value_preview,
        'id_value_normalized': normalized_value,
    }


def operation_validation_guidance(reason: str | None) -> str:
    if not reason:
        return 'Please provide the exact target details and try again.'
    guidance_map = {
        'add_epic.data.title_missing': (
            'The new epic title is missing. Include a title, for example: '
            '"Create a new epic called AI Module".'
        ),
        'add_feature.data.title_missing': (
            'The new feature title is missing. Include the feature title and parent epic.'
        ),
        'add_task.data.title_missing': (
            'The new task title is missing. Include the task title and parent feature.'
        ),
        'add_feature.parent_id_invalid_uuid': (
            'The feature parent reference is invalid. Specify the exact parent epic.'
        ),
        'add_task.parent_id_invalid_uuid': (
            'The task parent reference is invalid. Specify the exact parent feature.'
        ),
        'mark_status.status_missing': (
            'The status update is missing a status value. Specify the exact status to apply.'
        ),
        'shift_dates.delta_days_missing': (
            'The date shift amount is missing. Specify how many days to shift dates by.'
        ),
        'shift_dates.delta_days_out_of_range': (
            'The requested date shift is too large. Use a value between -3650 and 3650 days.'
        ),
        'shift_dates.node_id_invalid_uuid': (
            'The date shift target is invalid. Specify the exact roadmap item to shift.'
        ),
    }
    if reason in guidance_map:
        return guidance_map[reason]
    if reason.endswith('node_id_invalid_uuid'):
        return (
            'The target reference is invalid. Please specify the exact item name and type (epic, feature, or task).'
        )
    if reason.endswith('parent_id_invalid_uuid'):
        return (
            'The parent reference is invalid. Please specify the exact parent epic or feature.'
        )
    if reason == 'move_node.new_parent_id_invalid_uuid':
        return (
            'The move destination is invalid. Please specify the exact destination epic or feature.'
        )
    return 'Please provide the exact target details and try again.'


def apply_operation_contract_guard(
    *,
    planning: PlanningResult,
    route_lane: str | None,
    is_uuid: Callable[[str | None], bool],
) -> tuple[PlanningResult, dict[str, Any] | None]:
    if planning.response_mode != 'edit_plan' or not planning.operations:
        return planning, None

    validation_error = validate_operation_contract(
        planning.operations,
        is_uuid=is_uuid,
    )
    if validation_error is None:
        return planning, None

    guidance = operation_validation_guidance(validation_error.get('reason'))
    return (
        PlanningResult(
            assistant_message=(
                'I could not safely stage this edit operation. '
                f'{guidance}'
            ),
            operations=[],
            parse_mode='deterministic_invalid_operation_blocked',
            intent_type=planning.intent_type,
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=True,
            provider_error_code='invalid_operation_contract',
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=route_lane,
        ),
        validation_error,
    )
