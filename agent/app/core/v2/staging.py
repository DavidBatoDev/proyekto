"""Stage v2-produced operations onto the session.

Reuses ``apply_planned_operations`` by constructing a minimal
``PlanningResult``, so staging, dedup, and replace-vs-append semantics live in
one place. Default append semantics (``draft_action='append'``) — replacement
only happens for explicit revisions, which v2 does not emit.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.orchestration.shared.planning_result import PlanningResult
from app.core.orchestration.planning.staged_operations_applier import (
    ApplyPlannedOperationsResult,
    apply_planned_operations,
)


def stage_operations(
    *,
    service: Any,
    session: Any,
    operations: list[RoadmapOperation],
    assistant_message: str,
) -> ApplyPlannedOperationsResult:
    planning = PlanningResult(
        assistant_message=assistant_message or 'Staged your changes.',
        operations=operations,
        parse_mode='edit_plan',
        intent_type='roadmap_edit',
        response_mode='edit_plan',
        preview_recommended=True,
        provider_used='openai',
        fallback_used=False,
        provider_error_code=None,
        draft_action='append',
    )
    return apply_planned_operations(
        session=session,
        planning=planning,
        edit_continuation_trigger=None,
        should_replace_staged_operations=service._should_replace_staged_operations,
        operation_signature=service._operation_signature,
    )
