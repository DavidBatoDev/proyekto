"""Tool execution for the v2 loop.

Read tools run through the existing ``ToolDispatcher`` (parallel-safe via
``execute_many``). The edit/stage tool (``plan_roadmap_operations``) is parsed
and contract-validated with the SAME helpers the v1 path uses, so a parse or
validation failure becomes an error result fed back into the loop for the
model to self-correct — no separate repair lane.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.operation_contracts import validate_operation_contract
from app.core.tools.registry import (
    parse_plan_tool_args,
    parse_plan_tool_clarifier_options,
    parse_plan_tool_revision_operations,
    reset_active_handle_map,
    set_active_handle_map,
)
from app.core.uuid_utils import is_uuid_like


@dataclass
class PlanToolError:
    message: str


@dataclass
class PlanToolParsed:
    assistant_message: str
    operations: list[RoadmapOperation] = field(default_factory=list)
    revision_operations: list[dict[str, Any]] = field(default_factory=list)
    clarifier_options: list[str] = field(default_factory=list)


def run_read_tools(
    dispatcher: Any,
    calls: list[tuple[str, dict[str, Any]]],
    session_context: dict[str, Any],
) -> list[dict[str, Any]]:
    """Execute read tools concurrently. The active session roadmap_id is forced
    onto each call so the model never has to supply it (and can't scope-escape).
    """
    roadmap_id = session_context.get('roadmap_id')
    normalized: list[tuple[str, dict[str, Any]]] = []
    for name, args in calls:
        merged = dict(args or {})
        merged['roadmap_id'] = roadmap_id
        normalized.append((name, merged))
    return dispatcher.execute_many(normalized, session_context)


def interpret_plan_tool(
    args: dict[str, Any],
    handle_map: dict[str, dict[str, str]] | None,
) -> PlanToolError | PlanToolParsed:
    """Parse + contract-validate a ``plan_roadmap_operations`` call.

    Returns ``PlanToolError`` (fed back to the model) on any parse/validation
    failure, otherwise ``PlanToolParsed``. Handle expansion (E1 / E1.F2 → uuid)
    is installed for the duration of the parse, mirroring the v1 edit lane.
    """
    cleaned = _strip_null_plan_args(args)
    cleaned = _normalize_mutation_ops(cleaned)
    token = set_active_handle_map(handle_map or None)
    try:
        try:
            assistant_message, operations = parse_plan_tool_args(cleaned)
        except ValueError as exc:
            return PlanToolError(message=str(exc))
    finally:
        reset_active_handle_map(token)

    if operations:
        validation_error = validate_operation_contract(operations, is_uuid=is_uuid_like)
        if validation_error is not None:
            return PlanToolError(message=_format_validation_error(validation_error))

    return PlanToolParsed(
        assistant_message=assistant_message or '',
        operations=operations,
        revision_operations=parse_plan_tool_revision_operations(cleaned),
        clarifier_options=parse_plan_tool_clarifier_options(cleaned),
    )


def _format_validation_error(error: dict[str, Any]) -> str:
    index = error.get('index')
    reason = error.get('reason')
    op = error.get('op')
    detail = error.get('detail') or reason
    return (
        f'Operation at index {index} (op={op}) is invalid: {detail}. '
        'Fix this operation and re-stage.'
    )


def _normalize_mutation_ops(args: dict[str, Any]) -> dict[str, Any]:
    """Fix the two shapes the model gets wrong on ``update_node``:

    1. Reparenting. The model emits a move as ``update_node ... new_parent_ref=
       <feature>`` but ``update_node`` can't reparent (the contract reports
       ``mutation_missing``); the move op is ``move_node``. Retag it.
    2. Field edits in ``data``. A rename / field change comes as
       ``update_node ... data={'title': 'New'}`` (mirroring add_* ops), but
       field changes on an existing node go in ``patch`` — ``data`` is not
       allowed on update_node, so the backend 400s. Fold ``data`` into
       ``patch``.

    Both produce a staged op the backend accepts.
    """
    if not isinstance(args, dict):
        return args
    operations = args.get('operations')
    if not isinstance(operations, list):
        return args
    for op in operations:
        if not isinstance(op, dict) or op.get('op') != 'update_node':
            continue
        if op.get('new_parent_id') or op.get('new_parent_ref'):
            op['op'] = 'move_node'
            continue
        data = op.get('data')
        if isinstance(data, dict) and data and not op.get('patch'):
            op['patch'] = dict(data)
            op.pop('data', None)
    return args


def _strip_null_plan_args(args: Any) -> dict[str, Any]:
    """Drop top-level and per-operation null fields. Models on ``tool_choice=
    auto`` occasionally emit JSON null for optional fields, which the
    ``RoadmapOperation`` parser (extra='forbid' on some shapes) would reject.
    """
    if not isinstance(args, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for key, value in args.items():
        if value is None:
            continue
        if key == 'operations' and isinstance(value, list):
            ops: list[Any] = []
            for op in value:
                if isinstance(op, dict):
                    ops.append({k: v for k, v in op.items() if v is not None})
                else:
                    ops.append(op)
            cleaned[key] = ops
        else:
            cleaned[key] = value
    return cleaned
