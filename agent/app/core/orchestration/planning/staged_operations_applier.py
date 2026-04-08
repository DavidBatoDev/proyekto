from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode
from app.core.llm.client import PlanningResult


@dataclass
class ApplyPlannedOperationsResult:
    applied_operations: list[RoadmapOperation]
    staged_changed: bool
    retry_duplicate_operation_deduped: bool
    active_draft: DraftNode | None


def apply_planned_operations(
    *,
    session: AgentSession,
    planning: PlanningResult,
    draft_graph_enabled: bool,
    active_draft: DraftNode | None,
    edit_continuation_trigger: str | None,
    should_replace_staged_operations: Callable[..., bool],
    get_active_draft: Callable[[AgentSession], DraftNode],
    operation_signature: Callable[[RoadmapOperation], str],
    utcnow: Callable[[], datetime],
) -> ApplyPlannedOperationsResult:
    applied_operations: list[RoadmapOperation] = []
    staged_changed = False
    retry_duplicate_operation_deduped = False

    should_replace_operations = should_replace_staged_operations(
        planning=planning,
    )
    operations = planning.operations

    if planning.response_mode == 'edit_plan':
        if draft_graph_enabled:
            active_draft = get_active_draft(session)
            if active_draft.status != 'active':
                active_draft.status = 'active'
            if should_replace_operations:
                active_draft.operations = [
                    operation.model_copy(deep=True) for operation in operations
                ]
                applied_operations = [
                    operation.model_copy(deep=True) for operation in operations
                ]
                staged_changed = bool(operations)
            else:
                existing_signatures = {
                    operation_signature(operation)
                    for operation in active_draft.operations
                }
                for operation in operations:
                    signature = operation_signature(operation)
                    if signature in existing_signatures:
                        if edit_continuation_trigger == 'retry':
                            retry_duplicate_operation_deduped = True
                        continue
                    staged_operation = operation.model_copy(deep=True)
                    active_draft.operations.append(staged_operation)
                    applied_operations.append(staged_operation)
                    existing_signatures.add(signature)
                staged_changed = bool(applied_operations)
            active_draft.updated_at = utcnow()
            if staged_changed:
                active_draft.draft_version += 1
        else:
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
        active_draft=active_draft,
    )
