from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.client import PlanningResult


@dataclass
class MessagePlanningOutcome:
    session: AgentSession
    assistant_message: str
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    operations: list[RoadmapOperation]
    preview_available: bool
    preview_recommended: bool
    staged_operations_version: int
    staged_operations_count: int
    provider_used: ProviderUsed
    fallback_used: bool
    provider_error_code: str | None
    tokens_input: int | None
    tokens_output: int | None
    tokens_total: int | None
    route_lane: str | None
    phase_timings: dict[str, Any] = field(default_factory=dict)
    invalid_operation_detected: bool = False
    invalid_operation_reason: str | None = None
    invalid_operation_index: int | None = None
    llm_skipped_for_simple_edit: bool = False
    actor_fetch_attempted: bool = False
    actor_fetch_skipped_reason: str | None = None
    actor_fetch_ms: int | None = None
    pending_edit_context_present: bool = False
    edit_continuation_trigger: str | None = None
    planner_schema_invalid_attempts: int | None = None
    planner_repair_attempted: bool | None = None
    deterministic_create_fastpath_skipped: bool = False
    edit_guard_intervened: bool = False
    retry_tool_calls_used: int | None = None
    retry_duplicate_operation_deduped: bool = False
    retry_autostage_applied: bool = False
    draft_action: str | None = None
    needs_more_info: bool | None = None
    stop_reason: str | None = None
    tool_plan_steps: int | None = None
    active_draft_id: str | None = None
    active_draft_version: int | None = None
    draft_graph_migration_applied: bool = False
    react_terminal_action: str | None = None
    react_loop_turns: int | None = None
    react_loop_budget: int | None = None
    react_loop_termination_reason: str | None = None
    resolve_cache_hits: int | None = None
    resolve_cache_misses: int | None = None
    resolve_dedup_hits: int | None = None


@dataclass
class EditReactLoopOutcome:
    planning: PlanningResult
    edit_guard_intervened: bool
    operation_validation_error: dict[str, Any] | None = None
