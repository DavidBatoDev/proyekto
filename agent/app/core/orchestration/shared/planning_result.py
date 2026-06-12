"""The ``PlanningResult`` value object — the shape a brain produces for a turn.

Lives here (not in any brain module) because it is the seam every staging /
outcome path consumes: the v2 loop builds one in ``v2/staging.py``, and the
shared appliers / envelope assemblers (``staged_operations_applier``,
``shared/outcomes``, ``shared/operation_contracts``) read it. Keeping it in a
dependency-free shared module lets the brains and the staging layer share it
without importing each other.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ProviderUsed, ResponseMode


@dataclass
class PlanningResult:
    assistant_message: str
    operations: list[RoadmapOperation]
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    preview_recommended: bool
    provider_used: ProviderUsed
    fallback_used: bool
    provider_error_code: str | None
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_total: int | None = None
    pending_context_resolution: dict[str, Any] | None = None
    clear_pending_context_resolution: bool = False
    route_lane: str | None = None
    clarifier_action: str | None = None
    clarifier_reason: str | None = None
    clarifier_options: list[str] | None = None
    clarifier_question: str | None = None
    clarifier_schema_retries: int | None = None
    planner_schema_invalid_attempts: int | None = None
    planner_repair_attempted: bool | None = None
    draft_action: str | None = None
    tool_plan: list[dict[str, Any]] | None = None
    needs_more_info: bool | None = None
    stop_reason: str | None = None
    llm_calls_used: int | None = None
    react_tool_observation_summary: list[dict[str, Any]] | None = None
    plan_proposal_payload: dict[str, Any] | None = None
    tool_observations: list[dict[str, Any]] | None = None
