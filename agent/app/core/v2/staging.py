"""Stage v2-produced operations onto the session / draft graph.

Reuses ``apply_planned_operations`` (the same applier the v1 edit lane uses)
by constructing a minimal ``PlanningResult``, so staging, dedup, replace-vs-
append, and draft-graph semantics are identical to v1. Default append
semantics (``draft_action='append'``) — replacement only happens for explicit
revisions, which v2 does not emit.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

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
    utcnow: Callable[[], datetime],
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
    # Drafts/branching were removed — staged edits append directly to the session.
    return apply_planned_operations(
        session=session,
        planning=planning,
        draft_graph_enabled=False,
        active_draft=None,
        edit_continuation_trigger=None,
        should_replace_staged_operations=service._should_replace_staged_operations,
        get_active_draft=service._get_active_draft,
        operation_signature=service._operation_signature,
        utcnow=utcnow,
    )
