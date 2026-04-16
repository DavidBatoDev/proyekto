from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode, PendingContextResolution
from app.core.llm.client import PlanningResult


@dataclass
class PostExecutionOutcome:
    assistant_message: str
    parse_mode: str


def run_post_execution_phase(
    *,
    service: Any,
    session: AgentSession,
    planning: PlanningResult,
    applied_operations: list[RoadmapOperation],
    staged_changed: bool,
    draft_graph_enabled: bool,
    active_draft: DraftNode | None,
    auth_header: str | None,
    trace_id: str | None,
    phase_timings: dict[str, Any],
) -> PostExecutionOutcome:
    self = service

    self._record_recent_targets_from_observation_summary(
        session=session,
        observation_summary=planning.react_tool_observation_summary,
    )
    if planning.response_mode == 'edit_plan' and staged_changed:
        recently_staged_operations = (
            applied_operations if applied_operations else planning.operations
        )
        self._record_recent_targets_from_operations(
            session=session,
            operations=recently_staged_operations,
            source='staged_operations',
        )

    if planning.clear_pending_context_resolution:
        session.metadata.pending_context_resolution = None
    if planning.pending_context_resolution is not None:
        session.metadata.pending_context_resolution = PendingContextResolution.model_validate(
            planning.pending_context_resolution
        )

    assistant_message = planning.assistant_message
    parse_mode = planning.parse_mode

    session.last_intent_type = planning.intent_type
    self._store.append_message(session, 'assistant', assistant_message)
    self._store.update(session)

    return PostExecutionOutcome(
        assistant_message=assistant_message,
        parse_mode=parse_mode,
    )
