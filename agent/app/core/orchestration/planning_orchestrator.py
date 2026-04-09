from __future__ import annotations

from datetime import datetime
import logging
from time import perf_counter
from typing import Any, Callable

from fastapi import HTTPException, status

from app.core.contracts.sessions import AgentSession, PendingContextResolution
from app.core.logging_utils import log_event
from app.core.orchestration.shared.outcomes import MessagePlanningOutcome
from app.core.orchestration.planning.planning_phase_metrics import (
    read_react_loop_metrics,
    read_resolve_cache_metrics,
    record_context_tool_phase_metrics,
)
from app.core.orchestration.planning.planning_post_execution import run_post_execution_phase
from app.core.orchestration.planning.planning_pre_dispatcher import dispatch_pre_planning_phase
from app.core.orchestration.planning.planning_result_dispatcher import dispatch_planning_result
from app.core.orchestration.planning.staged_operations_applier import apply_planned_operations


def plan_message(
    *,
    service: Any,
    session: AgentSession,
    user_message: str,
    replace: bool,
    auth_header: str | None = None,
    trace_id: str | None = None,
    utcnow: Callable[[], datetime],
) -> MessagePlanningOutcome:
    self = service
    _utcnow = utcnow

    phase_timings: dict[str, Any] = {}
    draft_graph_enabled = self._settings.agent_draft_graph_enabled
    draft_graph_migration_applied = False
    active_draft = None
    if draft_graph_enabled:
        draft_graph_migration_applied = self._ensure_draft_graph_initialized(session)
        active_draft = self._get_active_draft(session)
    session_context = self._build_session_context(session, auth_header, trace_id)
    staged_operations, staged_operations_version = self._resolve_staged_state(
        session,
        draft_graph_enabled=draft_graph_enabled,
        active_draft=active_draft,
    )

    pre_dispatch_result = dispatch_pre_planning_phase(
        service=self,
        session=session,
        user_message=user_message,
        auth_header=auth_header,
        trace_id=trace_id,
        staged_operations=staged_operations,
        phase_timings=phase_timings,
    )
    session_context = pre_dispatch_result.session_context
    pending_edit_context_present = pre_dispatch_result.pending_edit_context_present
    edit_continuation_trigger = pre_dispatch_result.edit_continuation_trigger
    has_staged_operations = pre_dispatch_result.has_staged_operations
    preview_intent = pre_dispatch_result.preview_intent
    planning_user_message = pre_dispatch_result.planning_user_message
    mixed_query_followup_message = pre_dispatch_result.mixed_query_followup_message
    deictic_resolution = pre_dispatch_result.deictic_resolution
    actor_fetch_attempted = pre_dispatch_result.actor_fetch_attempted
    actor_fetch_skipped_reason = pre_dispatch_result.actor_fetch_skipped_reason
    actor_fetch_ms = pre_dispatch_result.actor_fetch_ms

    route_lane: str | None = None
    llm_skipped_for_simple_edit = False
    invalid_operation_detected = False
    invalid_operation_reason: str | None = None
    invalid_operation_index: int | None = None
    edit_guard_intervened = False
    retry_tool_calls_used: int | None = None
    retry_duplicate_operation_deduped = False
    retry_autostage_applied = False
    _ = replace  # Kept for API compatibility; replacement semantics are draft_action-driven.

    planning_dispatch_result = dispatch_planning_result(
        service=self,
        session=session,
        planning_user_message=planning_user_message,
        preview_intent=preview_intent,
        has_staged_operations=has_staged_operations,
        staged_operations=staged_operations,
        edit_continuation_trigger=edit_continuation_trigger,
        deictic_resolution=deictic_resolution,
        auth_header=auth_header,
        trace_id=trace_id,
        session_context=session_context,
        phase_timings=phase_timings,
    )
    planning = planning_dispatch_result.planning
    route_lane = planning_dispatch_result.route_lane
    llm_skipped_for_simple_edit = planning_dispatch_result.llm_skipped_for_simple_edit
    retry_tool_calls_used = planning_dispatch_result.retry_tool_calls_used
    retry_autostage_applied = planning_dispatch_result.retry_autostage_applied

    react_loop_outcome = self._run_edit_react_loop(
        planning=planning,
        pending_edit_context_present=pending_edit_context_present,
        edit_continuation_trigger=edit_continuation_trigger,
        route_lane=route_lane,
        user_message=planning_user_message,
    )
    planning = react_loop_outcome.planning
    edit_guard_intervened = react_loop_outcome.edit_guard_intervened
    operation_validation_error = react_loop_outcome.operation_validation_error

    if operation_validation_error is not None:
        invalid_operation_detected = True
        invalid_operation_reason = operation_validation_error.get('reason')
        invalid_operation_index = operation_validation_error.get('index')
        log_event(
            self._logger,
            'operation_contract_validation_failed',
            settings=self._settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            route_lane=route_lane,
            parse_mode=planning.parse_mode,
            validation_error=operation_validation_error,
        )

    record_context_tool_phase_metrics(
        phase_timings=phase_timings,
        session_context=session_context,
    )
    resolve_cache_hits, resolve_cache_misses, resolve_dedup_hits = read_resolve_cache_metrics(
        phase_timings=phase_timings,
    )

    operations = planning.operations
    if planning.response_mode == 'edit_plan' and len(operations) > self._settings.max_operations_per_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f'Operation count {len(operations)} exceeds max_operations_per_request '
                f'({self._settings.max_operations_per_request}).'
            ),
        )

    self._sync_pending_edit_context(
        session=session,
        planning=planning,
        user_message=planning_user_message,
        edit_continuation_trigger=edit_continuation_trigger,
        staged_operations_version=staged_operations_version,
        trace_id=trace_id,
        edit_guard_intervened=edit_guard_intervened,
    )

    planner_schema_invalid_attempts = planning.planner_schema_invalid_attempts
    planner_repair_attempted = planning.planner_repair_attempted
    draft_action = planning.draft_action
    needs_more_info = planning.needs_more_info
    stop_reason = planning.stop_reason
    tool_plan_steps = len(planning.tool_plan or []) if planning.tool_plan is not None else 0
    react_terminal_action = self._derive_react_terminal_action(
        planning=planning,
        edit_continuation_trigger=edit_continuation_trigger,
    )
    react_loop_turns, react_loop_budget, react_loop_termination_reason = read_react_loop_metrics(
        phase_timings=phase_timings,
    )
    deterministic_create_fastpath_skipped = False

    self._store.append_message(session, 'user', user_message)

    apply_result = apply_planned_operations(
        session=session,
        planning=planning,
        draft_graph_enabled=draft_graph_enabled,
        active_draft=active_draft,
        edit_continuation_trigger=edit_continuation_trigger,
        should_replace_staged_operations=self._should_replace_staged_operations,
        get_active_draft=self._get_active_draft,
        operation_signature=self._operation_signature,
        utcnow=_utcnow,
    )
    applied_operations = apply_result.applied_operations
    staged_changed = apply_result.staged_changed
    retry_duplicate_operation_deduped = (
        retry_duplicate_operation_deduped
        or apply_result.retry_duplicate_operation_deduped
    )
    active_draft = apply_result.active_draft

    post_execution_outcome = run_post_execution_phase(
        service=self,
        session=session,
        planning=planning,
        applied_operations=applied_operations,
        staged_changed=staged_changed,
        mixed_query_followup_message=mixed_query_followup_message,
        draft_graph_enabled=draft_graph_enabled,
        active_draft=active_draft,
        auth_header=auth_header,
        trace_id=trace_id,
        phase_timings=phase_timings,
    )
    assistant_message = post_execution_outcome.assistant_message
    parse_mode = post_execution_outcome.parse_mode
    mixed_query_followup_warning_code = post_execution_outcome.mixed_query_followup_warning_code

    staged_operations, staged_operations_version = self._resolve_staged_state(
        session,
        draft_graph_enabled=draft_graph_enabled,
        active_draft=active_draft,
    )
    preview_available = len(staged_operations) > 0
    preview_recommended = planning.preview_recommended and preview_available
    active_draft_id: str | None = None
    active_draft_version: int | None = None
    if draft_graph_enabled:
        active_draft = self._get_active_draft(session)
        active_draft_id = active_draft.draft_id
        active_draft_version = active_draft.draft_version

    log_event(
        self._logger,
        'session_staged_state',
        settings=self._settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        staged_operations_count=len(staged_operations),
        staged_operations_version=staged_operations_version,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        draft_graph_migration_applied=draft_graph_migration_applied,
        preview_available=preview_available,
        preview_recommended=preview_recommended,
        intent_type=planning.intent_type,
        response_mode=planning.response_mode,
        actor_present=session.metadata.actor_context is not None,
        roadmap_role=(
            session.metadata.actor_context.roadmap_role
            if session.metadata.actor_context is not None
            else None
        ),
        actor_context_source=(
            session.metadata.actor_context.actor_context_source
            if session.metadata.actor_context is not None
            else None
        ),
        route_lane=route_lane,
        invalid_operation_detected=invalid_operation_detected,
        invalid_operation_reason=invalid_operation_reason,
        invalid_operation_index=invalid_operation_index,
        llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
        actor_fetch_attempted=actor_fetch_attempted,
        actor_fetch_skipped_reason=actor_fetch_skipped_reason,
        actor_fetch_ms=actor_fetch_ms,
        pending_edit_context_present=session.metadata.pending_edit_context is not None,
        edit_continuation_trigger=edit_continuation_trigger,
        planner_schema_invalid_attempts=planner_schema_invalid_attempts,
        planner_repair_attempted=planner_repair_attempted,
        draft_action=draft_action,
        needs_more_info=needs_more_info,
        stop_reason=stop_reason,
        tool_plan_steps=tool_plan_steps,
        react_terminal_action=react_terminal_action,
        react_loop_turns=react_loop_turns,
        react_loop_budget=react_loop_budget,
        react_loop_termination_reason=react_loop_termination_reason,
        deterministic_create_fastpath_skipped=deterministic_create_fastpath_skipped,
        edit_guard_intervened=edit_guard_intervened,
        retry_tool_calls_used=retry_tool_calls_used,
        retry_duplicate_operation_deduped=retry_duplicate_operation_deduped,
        retry_autostage_applied=retry_autostage_applied,
        mixed_query_followup_warning_code=mixed_query_followup_warning_code,
        resolve_cache_hits=resolve_cache_hits,
        resolve_cache_misses=resolve_cache_misses,
        resolve_dedup_hits=resolve_dedup_hits,
        phase_timings=phase_timings,
    )

    return MessagePlanningOutcome(
        session=session,
        assistant_message=assistant_message,
        parse_mode=parse_mode,
        intent_type=planning.intent_type,
        response_mode=planning.response_mode,
        operations=applied_operations if planning.response_mode == 'edit_plan' else [],
        preview_available=preview_available,
        preview_recommended=preview_recommended,
        staged_operations_version=staged_operations_version,
        staged_operations_count=len(staged_operations),
        provider_used=planning.provider_used,
        fallback_used=planning.fallback_used,
        provider_error_code=planning.provider_error_code,
        tokens_input=planning.tokens_input,
        tokens_output=planning.tokens_output,
        tokens_total=planning.tokens_total,
        route_lane=route_lane,
        phase_timings=phase_timings,
        invalid_operation_detected=invalid_operation_detected,
        invalid_operation_reason=invalid_operation_reason,
        invalid_operation_index=invalid_operation_index,
        llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
        actor_fetch_attempted=actor_fetch_attempted,
        actor_fetch_skipped_reason=actor_fetch_skipped_reason,
        actor_fetch_ms=actor_fetch_ms,
        pending_edit_context_present=session.metadata.pending_edit_context is not None,
        edit_continuation_trigger=edit_continuation_trigger,
        planner_schema_invalid_attempts=planner_schema_invalid_attempts,
        planner_repair_attempted=planner_repair_attempted,
        draft_action=draft_action,
        needs_more_info=needs_more_info,
        stop_reason=stop_reason,
        tool_plan_steps=tool_plan_steps,
        react_terminal_action=react_terminal_action,
        react_loop_turns=react_loop_turns,
        react_loop_budget=react_loop_budget,
        react_loop_termination_reason=react_loop_termination_reason,
        deterministic_create_fastpath_skipped=deterministic_create_fastpath_skipped,
        edit_guard_intervened=edit_guard_intervened,
        retry_tool_calls_used=retry_tool_calls_used,
        retry_duplicate_operation_deduped=retry_duplicate_operation_deduped,
        retry_autostage_applied=retry_autostage_applied,
        resolve_cache_hits=resolve_cache_hits,
        resolve_cache_misses=resolve_cache_misses,
        resolve_dedup_hits=resolve_dedup_hits,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        draft_graph_migration_applied=draft_graph_migration_applied,
    )
