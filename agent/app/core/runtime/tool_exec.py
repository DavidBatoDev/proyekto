"""Tool execution for the loop.

Read tools run through the ``ToolDispatcher`` (parallel-safe via
``execute_many``); the dispatcher resolves the roadmap each call targets from
the call's own ``roadmap_id`` (defaulting to the focus roadmap), so nothing is
force-injected here. The stage tool (``stage_edits``) is parsed and
contract-validated with the shared registry helpers, then checked against the
batch's roadmap, so a parse / validation / cross-roadmap failure becomes an
error result fed back into the loop for the model to self-correct — no
separate repair lane.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from app.core.contracts.operations import RoadmapOperation
from app.core.runtime.handles import node_types_by_id, validate_batch_roadmap
from app.core.runtime.operation_contracts import validate_operation_contract
from app.core.tools.registry import (
    UPDATE_NODE_PATCH_FIELDS,
    parse_plan_tool_args,
    parse_plan_tool_clarifier_options,
    parse_plan_tool_revision_operations,
    reset_active_handle_map,
    set_active_handle_map,
)
from app.core.uuid_utils import is_uuid_like, is_valid_temp_ref


@dataclass
class PlanToolError:
    message: str
    code: str = 'INVALID_OPERATIONS'


@dataclass
class PlanToolParsed:
    assistant_message: str
    operations: list[RoadmapOperation] = field(default_factory=list)
    revision_operations: list[dict[str, Any]] = field(default_factory=list)
    clarifier_options: list[str] = field(default_factory=list)
    # The roadmap the batch targets (the call's roadmap_id, else the expected
    # one the caller passed); None when neither was given.
    roadmap_id: str | None = None


def run_read_tools(
    dispatcher: Any,
    calls: list[tuple[str, dict[str, Any]]],
    session_context: dict[str, Any],
) -> list[dict[str, Any]]:
    """Execute read tools concurrently. Each call keeps its own args — the
    dispatcher resolves ``roadmap_id`` per call (explicit arg, else the
    session's focus roadmap) and writes it back onto that call's args."""
    normalized: list[tuple[str, dict[str, Any]]] = [
        (name, dict(args or {})) for name, args in calls
    ]
    return dispatcher.execute_many(normalized, session_context)


def interpret_stage_edits(
    args: dict[str, Any],
    handle_map: dict[str, dict[str, Any]] | None,
    actor_id: str | None = None,
    expected_roadmap_id: str | None = None,
    *,
    recent_targets: Iterable[Any] | None = None,
    roadmap_titles: dict[str, str | None] | None = None,
    roadmap_prefixes: dict[str, str | None] | None = None,
) -> PlanToolError | PlanToolParsed:
    """Parse + contract-validate one ``stage_edits`` call.

    ``handle_map`` is the MERGED (already prefixed) map of every loaded
    roadmap; handle expansion (E1 / R2.E1.F2 → uuid) is installed for the
    duration of the parse. ``expected_roadmap_id`` is the roadmap the batch
    is for (the call's own ``roadmap_id`` wins when present); after expansion
    every referenced node whose roadmap is known must belong to it
    (``validate_batch_roadmap``). Returns ``PlanToolError`` (fed back to the
    model) on any failure, otherwise ``PlanToolParsed``.
    """
    cleaned = _strip_null_plan_args(args)
    call_roadmap_id = cleaned.pop('roadmap_id', None)
    roadmap_id = (
        str(call_roadmap_id).strip()
        if isinstance(call_roadmap_id, str) and call_roadmap_id.strip()
        else (expected_roadmap_id or None)
    )
    if expected_roadmap_id and roadmap_id and roadmap_id != expected_roadmap_id:
        return PlanToolError(
            message=(
                f'This turn stages edits for roadmap_id="{expected_roadmap_id}" only; '
                f'the call named "{roadmap_id}". Re-stage with the expected roadmap_id.'
            ),
            code='ROADMAP_MISMATCH',
        )
    # Only a MODEL-supplied id is shape-checked; the session's own scope id
    # is trusted as-is (test fixtures use non-uuid ids by design).
    if isinstance(call_roadmap_id, str) and call_roadmap_id.strip() and not is_uuid_like(roadmap_id):
        return PlanToolError(
            message=(
                f'roadmap_id "{roadmap_id}" is not a roadmap id. Use the id from '
                'list_roadmaps or get_roadmap_overview.'
            ),
            code='INVALID_ROADMAP_ID',
        )
    cleaned = _normalize_mutation_ops(cleaned, actor_id=actor_id)
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
        patch_error = _validate_update_node_patch_fields(operations, handle_map)
        if patch_error is not None:
            return PlanToolError(message=patch_error)
        mismatch = validate_batch_roadmap(
            operations,
            roadmap_id,
            handle_map,
            recent_targets=recent_targets,
            roadmap_titles=roadmap_titles,
            roadmap_prefixes=roadmap_prefixes,
        )
        if mismatch is not None:
            return PlanToolError(message=mismatch, code='HANDLE_ROADMAP_MISMATCH')

    return PlanToolParsed(
        assistant_message=assistant_message or '',
        operations=operations,
        revision_operations=parse_plan_tool_revision_operations(cleaned),
        clarifier_options=parse_plan_tool_clarifier_options(cleaned),
        roadmap_id=roadmap_id,
    )


def interpret_plan_tool(
    args: dict[str, Any],
    handle_map: dict[str, dict[str, str]] | None,
    actor_id: str | None = None,
) -> PlanToolError | PlanToolParsed:
    """Single-roadmap entry (no expected roadmap): the engine loop's current
    call shape and the revert builder's re-parse."""
    return interpret_stage_edits(args, handle_map, actor_id, None)


_PATCH_FIELD_HINTS = {
    'assignee_id': (
        'Only tasks can be assigned — epics, features and milestones have no '
        'assignee. Assign the tasks underneath instead, and tell the user the '
        'rest cannot be assigned.'
    ),
    'status': (
        'Feature status is derived from its child tasks and cannot be set '
        'directly. Set the status on the tasks instead.'
    ),
    'priority': 'Only epics and tasks carry a priority.',
    'due_date': 'Only tasks have a due_date; epics and features use start_date/end_date.',
    'target_date': 'Only milestones have a target_date.',
}


def _validate_update_node_patch_fields(
    operations: list[RoadmapOperation],
    handle_map: dict[str, dict[str, Any]] | None,
) -> str | None:
    """Reject `update_node` patch keys the backend would refuse at apply time.

    Without this the commit fails wholesale — one bad key on one op discards
    every valid op in the batch, and the error surfaces as user-facing text the
    model never sees. Catching it here turns it into a tool error the loop feeds
    back, so the model drops the impossible edit and re-stages the rest.
    """
    types_by_id = node_types_by_id(handle_map)
    for index, operation in enumerate(operations):
        op_name = getattr(operation.op, 'value', str(operation.op or ''))
        if op_name != 'update_node' or not isinstance(operation.patch, dict):
            continue
        # The live roadmap is the authority on what this node IS; fall back to
        # the model's declared node_type only when the id isn't in the outline.
        node_type = types_by_id.get(operation.node_id or '')
        if node_type is None and operation.node_type is not None:
            node_type = getattr(operation.node_type, 'value', str(operation.node_type))
        allowed = UPDATE_NODE_PATCH_FIELDS.get(node_type or '')
        if allowed is None:
            continue
        for key in operation.patch:
            if key in allowed:
                continue
            hint = _PATCH_FIELD_HINTS.get(key, '')
            return (
                f'Operation at index {index} (op=update_node) is invalid: '
                f'"{key}" cannot be set on a {node_type}. '
                f'A {node_type} accepts only: {", ".join(sorted(allowed))}. '
                f'{hint} Re-stage without that field.'
            ).replace('  ', ' ')
    return None


def _format_validation_error(error: dict[str, Any]) -> str:
    index = error.get('index')
    reason = error.get('reason')
    op = error.get('op')
    detail = error.get('detail') or reason
    return (
        f'Operation at index {index} (op={op}) is invalid: {detail}. '
        'Fix this operation and re-stage.'
    )


_SELF_ASSIGNEE_ALIASES = frozenset({'me', 'myself', 'self', 'current user', 'current_user'})


def _normalize_mutation_ops(
    args: dict[str, Any],
    actor_id: str | None = None,
) -> dict[str, Any]:
    """Fix the shapes the model gets wrong on ``update_node``:

    1. Reparenting. The model emits a move as ``update_node ... new_parent_ref=
       <feature>`` but ``update_node`` can't reparent (the contract reports
       ``mutation_missing``); the move op is ``move_node``. Retag it.
    2. Field edits in ``data``. A rename / field change comes as
       ``update_node ... data={'title': 'New'}`` (mirroring add_* ops), but
       field changes on an existing node go in ``patch`` — ``data`` is not
       allowed on update_node, so the backend 400s. Fold ``data`` into
       ``patch``.
    3. Assignment. "Assign X to me" comes out as ``patch.assignee`` (wrong
       field) and/or the literal value ``"me"`` the model cannot resolve.
       Rename to ``assignee_id`` and substitute the session actor's id.

    All produce a staged op the backend accepts.
    """
    if not isinstance(args, dict):
        return args
    operations = args.get('operations')
    if not isinstance(operations, list):
        return args
    for op in operations:
        if not isinstance(op, dict):
            continue
        _move_temp_refs_out_of_id_fields(op)
        if op.get('op') != 'update_node':
            continue
        if op.get('new_parent_id') or op.get('new_parent_ref'):
            op['op'] = 'move_node'
            continue
        data = op.get('data')
        if isinstance(data, dict) and data and not op.get('patch'):
            op['patch'] = dict(data)
            op.pop('data', None)
        patch = op.get('patch')
        if isinstance(patch, dict):
            if 'assignee' in patch and 'assignee_id' not in patch:
                patch['assignee_id'] = patch.pop('assignee')
            assignee = patch.get('assignee_id')
            if (
                actor_id
                and isinstance(assignee, str)
                and assignee.strip().lower() in _SELF_ASSIGNEE_ALIASES
            ):
                patch['assignee_id'] = actor_id
    return args


def _move_temp_refs_out_of_id_fields(op: dict[str, Any]) -> None:
    """Models sometimes put same-batch temp refs in *_id fields. The contract
    reserves *_id for UUIDs and *_ref for temp refs, so normalize that common
    slip before validation.
    """

    for id_field, ref_field in (
        ('node_id', 'node_ref'),
        ('parent_id', 'parent_ref'),
        ('new_parent_id', 'new_parent_ref'),
    ):
        value = op.get(id_field)
        if not (isinstance(value, str) and is_valid_temp_ref(value)):
            continue
        if op.get(ref_field) is None:
            op[ref_field] = value.strip()
            op.pop(id_field, None)


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
