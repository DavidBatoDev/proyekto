from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession
from app.core.orchestration.shared.planning_result import PlanningResult


@dataclass
class ApplyPlannedOperationsResult:
    applied_operations: list[RoadmapOperation]
    staged_changed: bool
    retry_duplicate_operation_deduped: bool


def apply_planned_operations(
    *,
    session: AgentSession,
    planning: PlanningResult,
    edit_continuation_trigger: str | None,
    should_replace_staged_operations: Callable[..., bool],
    operation_signature: Callable[[RoadmapOperation], str],
) -> ApplyPlannedOperationsResult:
    """Fold this turn's planned operations into the session's staged list.

    Either replaces the staged list wholesale or appends, skipping operations
    whose signature is already staged so a retry cannot double-apply the same
    edit.
    """
    applied_operations: list[RoadmapOperation] = []
    staged_changed = False
    retry_duplicate_operation_deduped = False

    should_replace_operations = should_replace_staged_operations(
        planning=planning,
    )
    operations = planning.operations

    if planning.response_mode == 'edit_plan':
        if should_replace_operations:
            session.operations = operations
            applied_operations = operations
            staged_changed = bool(operations)
        else:
            existing_signatures = {
                operation_signature(operation)
                for operation in session.operations
            }
            for operation in operations:
                signature = operation_signature(operation)
                if signature in existing_signatures:
                    if edit_continuation_trigger == 'retry':
                        retry_duplicate_operation_deduped = True
                    continue
                session.operations.append(operation)
                applied_operations.append(operation)
                existing_signatures.add(signature)
            staged_changed = bool(applied_operations)
        if staged_changed:
            session.staged_operations_version += 1

    return ApplyPlannedOperationsResult(
        applied_operations=applied_operations,
        staged_changed=staged_changed,
        retry_duplicate_operation_deduped=retry_duplicate_operation_deduped,
    )
