from __future__ import annotations

from dataclasses import dataclass, field, replace
import asyncio
import logging
import json
from queue import Empty, Queue
import threading
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Any
import re
import string

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    ActorContext,
    DraftNode,
    PendingEditContext,
    PendingEditResolvedReferences,
    PendingContextResolution,
    RecentResolvedTarget,
)
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.clarifier_contract import build_clarifier_contract
from app.core.llm.client import LLMPlanner, PlanningResult
from app.core.llm.deterministic_intents import match_deterministic_context_intent
from app.core.logging_utils import log_event
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.edit_resolver import (
    extract_create_intent,
)
from app.core.session_store import SessionStore


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


@dataclass
class EditReactLoopOutcome:
    planning: PlanningResult
    edit_guard_intervened: bool
    operation_validation_error: dict[str, Any] | None = None


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgentService:
    _CANONICAL_INTENT_FAMILIES = {
        'rename_node',
        'create_epic',
        'create_feature',
        'create_task',
        'move_node',
        'update_node',
        'delete_node',
        'mark_status',
        'shift_dates',
        'roadmap_edit_clarifier',
    }
    _INTENT_FAMILY_ALIASES = {
        'rename': 'rename_node',
        'rename_item': 'rename_node',
        'rename_task': 'rename_node',
        'rename_feature': 'rename_node',
        'rename_epic': 'rename_node',
        'move': 'move_node',
        'move_item': 'move_node',
        'update': 'update_node',
        'delete': 'delete_node',
        'mark': 'mark_status',
        'shift': 'shift_dates',
    }
    _ORDER_INSENSITIVE_SIGNATURE_FIELDS = {'tags'}
    _MIXED_QUERY_CUE_PATTERN = re.compile(
        r'\b(?:how many|what|which|who|where|when|summarize|summary|overview|tell me|show me|list|count)\b',
        re.IGNORECASE,
    )
    _MIXED_EDIT_VERB_PATTERN = re.compile(
        r'\b(?:add|create|remove|delete|mark|rename|move|update|set|assign|unassign|reassign|change)\b',
        re.IGNORECASE,
    )
    _RECENT_TARGET_MAX_ITEMS = 20
    _RECENT_TARGET_MAX_AGE_HOURS = 24
    _RECENT_TARGET_SOURCE_PRIORITY = {
        'deictic_pre_resolver': 4,
        'staged_operations': 3,
        'commit_semantic_diff': 2,
        'context_tool': 1,
    }
    _DEICTIC_PARENT_PATTERN = re.compile(
        r'\b(?:inside|under|within|in)\s+(?:that|it|this|there)\b'
        r'|\b(?:that|it|this)\s+(?:epic|feature|task)\b',
        re.IGNORECASE,
    )

    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._planner = LLMPlanner()
        self._nest_client = NestRoadmapClient()
        self._logger = logging.getLogger(__name__)
        self._actor_refresh_failures_key = 'actor_context_refresh_failures'
        self._uuid_pattern = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

    def get_session_or_404(self, session_id: str) -> AgentSession:
        session = self._store.get(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Session {session_id} was not found or has expired.',
            )
        return session

    def plan_message(
        self,
        session: AgentSession,
        user_message: str,
        replace: bool,
        auth_header: str | None = None,
        trace_id: str | None = None,
    ) -> MessagePlanningOutcome:
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

        pending_edit_context_present = session.metadata.pending_edit_context is not None
        edit_continuation_trigger = self._detect_edit_continuation_trigger(user_message)
        has_staged_operations = bool(staged_operations)
        deictic_reference_present = self._looks_like_deictic_parent_reference(user_message)
        recent_targets_available = bool(self._get_recent_resolved_targets(session))
        pending_continuation_requested = pending_edit_context_present and (
            edit_continuation_trigger in {'confirm', 'cancel', 'correction', 'retry'}
        )
        staged_operation_continuation = (
            edit_continuation_trigger is not None and has_staged_operations
        )
        recent_target_continuation = (
            edit_continuation_trigger is not None
            and deictic_reference_present
            and recent_targets_available
        )
        should_force_edit_preview = (
            pending_continuation_requested
            or staged_operation_continuation
            or recent_target_continuation
        )
        if recent_target_continuation:
            phase_timings['deictic_recent_target_continuation'] = 1
        if should_force_edit_preview:
            preview_intent: IntentType = 'roadmap_edit'
            phase_timings['intent_classification_ms'] = 0
        else:
            classify_started = perf_counter()
            preview_intent, _ = self._planner.preview_intent_classification(
                user_message=user_message,
                session_context=session_context,
            )
            phase_timings['intent_classification_ms'] = int(
                (perf_counter() - classify_started) * 1000
            )
        simple_edit_detected = preview_intent == 'roadmap_edit'
        mixed_query_followup_message = self._extract_mixed_query_followup_message(
            user_message=user_message,
            preview_intent=preview_intent,
        )
        mixed_edit_primary_message = self._extract_mixed_edit_primary_message(
            user_message=user_message,
            query_message=mixed_query_followup_message,
        )
        planning_user_message = mixed_edit_primary_message or user_message
        if mixed_query_followup_message is not None:
            phase_timings['mixed_query_detected'] = 1
        if mixed_edit_primary_message is not None:
            phase_timings['mixed_query_edit_clause_used'] = 1

        actor_fetch_attempted = False
        actor_fetch_skipped_reason: str | None = None
        actor_fetch_ms: int | None = None
        should_fetch_actor, actor_skip_reason = self._should_fetch_actor_context(
            preview_intent=preview_intent,
            user_message=user_message,
            auth_header=auth_header,
            simple_edit_detected=simple_edit_detected,
            actor_context_present=session.metadata.actor_context is not None,
        )
        if should_fetch_actor:
            actor_fetch_attempted = True
            actor_started = perf_counter()
            self._ensure_actor_context(
                session=session,
                auth_header=auth_header,
                trace_id=trace_id,
            )
            actor_fetch_ms = int((perf_counter() - actor_started) * 1000)
            phase_timings['actor_fetch_ms'] = actor_fetch_ms
        else:
            actor_fetch_skipped_reason = actor_skip_reason
            if actor_skip_reason == 'missing_auth_header':
                self._clear_actor_context_for_missing_auth(
                    session=session,
                    trace_id=trace_id,
                )

        session_context = self._build_session_context(session, auth_header, trace_id)
        if should_force_edit_preview:
            session_context['force_edit_continuation'] = True
            session_context['force_edit_continuation_reason'] = (
                edit_continuation_trigger or 'pending_context'
            )
        deictic_resolution = self._resolve_deictic_parent_reference(
            session=session,
            user_message=user_message,
        )
        if deictic_resolution is not None:
            deictic_status = str(deictic_resolution.get('status') or '')
            session_context['deictic_resolution_status'] = deictic_status
            phase_timings['deictic_resolution_detected'] = 1
            if deictic_status == 'resolved':
                parent_hint = {
                    'node_id': deictic_resolution.get('node_id'),
                    'node_type': deictic_resolution.get('node_type'),
                    'title': deictic_resolution.get('title'),
                    'label': deictic_resolution.get('label'),
                }
                session_context['deictic_parent_hint'] = parent_hint
                phase_timings['deictic_resolution_candidates'] = 1
                self._append_recent_resolved_target(
                    session=session,
                    node_id=parent_hint.get('node_id'),
                    node_type=parent_hint.get('node_type'),
                    title=parent_hint.get('title'),
                    label=parent_hint.get('label'),
                    source='deictic_pre_resolver',
                    confidence=1.0,
                )
            elif deictic_status == 'ambiguous':
                candidates = deictic_resolution.get('candidates')
                phase_timings['deictic_resolution_candidates'] = (
                    len(candidates) if isinstance(candidates, list) else 0
                )

        planning: PlanningResult
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

        pending_context = session.metadata.pending_edit_context
        if pending_context is not None:
            pending_context.intent_family = self._normalize_intent_family(
                pending_context.intent_family
            )
        if (
            isinstance(deictic_resolution, dict)
            and str(deictic_resolution.get('status') or '') == 'ambiguous'
        ):
            planning = self._build_deictic_ambiguity_planning(
                deictic_resolution=deictic_resolution,
            )
            phase_timings['provider_planning_ms'] = 0
            route_lane = 'llm_edit_plan'
            llm_skipped_for_simple_edit = True
        elif pending_context is not None and edit_continuation_trigger == 'retry':
            retry_result = self._attempt_retry_autostage(
                session=session,
                pending_context=pending_context,
                trace_id=trace_id,
                auth_header=auth_header,
            )
            retry_tool_calls_used = retry_result.get('tool_calls_used')
            retry_autostage_applied = bool(retry_result.get('retry_autostage_applied'))
            if retry_result.get('planning') is not None:
                planning = retry_result['planning']
                phase_timings['provider_planning_ms'] = 0
                route_lane = 'llm_edit_plan'
                llm_skipped_for_simple_edit = True
            elif retry_result.get('blocked_reason'):
                blocked_reason = str(retry_result.get('blocked_reason') or '')
                if blocked_reason == 'retry_autostage_unsupported_intent_family':
                    planning = None  # Fall through to standard planner path.
                else:
                    planning = PlanningResult(
                        assistant_message=(
                            'I cannot auto-stage this retry yet because the pending edit state changed. '
                            'Please confirm the target again so I can continue safely.'
                        ),
                        operations=[],
                        parse_mode='deterministic_retry_stale_handoff',
                        intent_type='roadmap_edit',
                        response_mode='chat',
                        preview_recommended=False,
                        provider_used='rule_based',
                        fallback_used=False,
                        provider_error_code=blocked_reason,
                        clarifier_action='ask_clarifier',
                        clarifier_reason=blocked_reason,
                        clarifier_options=['Use exact target label', 'Provide node ID', 'Cancel'],
                    )
                    phase_timings['provider_planning_ms'] = 0
                    route_lane = 'llm_edit_plan'
                    llm_skipped_for_simple_edit = True
            else:
                planning = None  # type: ignore[assignment]
        else:
            planning = None  # type: ignore[assignment]
        if planning is None and (
            pending_context is not None
            and edit_continuation_trigger == 'confirm'
            and pending_context.draft_operations
        ):
            planning = PlanningResult(
                assistant_message='Confirmed. I prepared the pending edit operations.',
                operations=[
                    operation.model_copy(deep=True)
                    for operation in pending_context.draft_operations
                ],
                parse_mode='deterministic_pending_edit_confirm',
                intent_type='roadmap_edit',
                response_mode='edit_plan',
                preview_recommended=True,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code=None,
                route_lane='llm_edit_plan',
                draft_action='continue',
                tool_plan=[],
                needs_more_info=False,
                stop_reason='ready_to_stage',
            )
            phase_timings['provider_planning_ms'] = 0
            route_lane = 'llm_edit_plan'
            llm_skipped_for_simple_edit = True
        elif planning is None and (
            pending_context is None
            and has_staged_operations
            and edit_continuation_trigger == 'confirm'
        ):
            planning = PlanningResult(
                assistant_message=(
                    'Confirmed. Your staged edit operations are ready to apply. '
                    'Use Apply to commit these changes.'
                ),
                operations=[],
                parse_mode='deterministic_staged_edit_confirm',
                intent_type='roadmap_edit',
                response_mode='edit_plan',
                preview_recommended=True,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code=None,
                route_lane='llm_edit_plan',
                draft_action='continue',
                tool_plan=[],
                needs_more_info=False,
                stop_reason='ready_to_stage',
            )
            phase_timings['provider_planning_ms'] = 0
            route_lane = 'llm_edit_plan'
            llm_skipped_for_simple_edit = True
        elif planning is None and preview_intent == 'roadmap_edit':
            planning, planning_loop_metrics = self._run_edit_react_planning_loop(
                user_message=planning_user_message,
                existing_operations=staged_operations,
                session_context=session_context,
                route_lane='llm_edit_plan',
            )
            phase_timings['provider_planning_ms'] = int(
                planning_loop_metrics.get('elapsed_ms') or 0
            )
            phase_timings['react_loop_turns'] = int(
                planning_loop_metrics.get('loop_turns') or 0
            )
            phase_timings['react_loop_budget'] = int(
                planning_loop_metrics.get('loop_budget') or 0
            )
            phase_timings['react_loop_termination_reason'] = planning_loop_metrics.get(
                'termination_reason'
            )
            phase_timings['llm_calls_budget'] = int(
                planning_loop_metrics.get('llm_calls_budget') or 0
            )
            phase_timings['llm_calls_used'] = int(
                planning_loop_metrics.get('llm_calls_used') or 0
            )
            phase_timings['llm_calls_remaining'] = int(
                planning_loop_metrics.get('llm_calls_remaining') or 0
            )
            route_lane = 'llm_edit_plan'
        elif planning is None:
            planning, planning_loop_metrics = self._run_edit_react_planning_loop(
                user_message=planning_user_message,
                existing_operations=staged_operations,
                session_context=session_context,
                route_lane='llm_edit_plan',
            )
            phase_timings['provider_planning_ms'] = int(
                planning_loop_metrics.get('elapsed_ms') or 0
            )
            phase_timings['react_loop_turns'] = int(
                planning_loop_metrics.get('loop_turns') or 0
            )
            phase_timings['react_loop_budget'] = int(
                planning_loop_metrics.get('loop_budget') or 0
            )
            phase_timings['react_loop_termination_reason'] = planning_loop_metrics.get(
                'termination_reason'
            )
            phase_timings['llm_calls_budget'] = int(
                planning_loop_metrics.get('llm_calls_budget') or 0
            )
            phase_timings['llm_calls_used'] = int(
                planning_loop_metrics.get('llm_calls_used') or 0
            )
            phase_timings['llm_calls_remaining'] = int(
                planning_loop_metrics.get('llm_calls_remaining') or 0
            )
            route_lane = 'llm_edit_plan' if planning.response_mode == 'edit_plan' else 'chat'

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

        internal_metrics = session_context.get('_phase_metrics', {})
        if isinstance(internal_metrics, dict):
            context_tools_total_ms = float(internal_metrics.get('context_tools_ms') or 0.0)
            context_tools_http_ms = float(
                internal_metrics.get('context_tools_http_call_ms') or 0.0
            )
            phase_timings['context_tools_ms'] = int(context_tools_total_ms)
            phase_timings['context_tools_http_call_ms'] = int(context_tools_http_ms)
            phase_timings['context_tools_executor_overhead_ms'] = int(
                max(context_tools_total_ms - context_tools_http_ms, 0.0)
            )
            phase_timings['context_tools_by_name_ms'] = (
                internal_metrics.get('context_tools_by_name')
                if isinstance(internal_metrics.get('context_tools_by_name'), dict)
                else {}
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
        react_loop_turns = (
            int(phase_timings.get('react_loop_turns'))
            if phase_timings.get('react_loop_turns') is not None
            else None
        )
        react_loop_budget = (
            int(phase_timings.get('react_loop_budget'))
            if phase_timings.get('react_loop_budget') is not None
            else None
        )
        react_loop_termination_reason = (
            str(phase_timings.get('react_loop_termination_reason'))
            if phase_timings.get('react_loop_termination_reason') is not None
            else None
        )
        deterministic_create_fastpath_skipped = False

        self._store.append_message(session, 'user', user_message)

        applied_operations: list[RoadmapOperation] = []
        staged_changed = False
        should_replace_operations = self._should_replace_staged_operations(
            planning=planning,
        )
        if planning.response_mode == 'edit_plan':
            if draft_graph_enabled:
                active_draft = self._get_active_draft(session)
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
                        self._operation_signature(operation)
                        for operation in active_draft.operations
                    }
                    for operation in operations:
                        signature = self._operation_signature(operation)
                        if signature in existing_signatures:
                            if edit_continuation_trigger == 'retry':
                                retry_duplicate_operation_deduped = True
                            continue
                        staged_operation = operation.model_copy(deep=True)
                        active_draft.operations.append(staged_operation)
                        applied_operations.append(staged_operation)
                        existing_signatures.add(signature)
                    staged_changed = bool(applied_operations)
                active_draft.updated_at = _utcnow()
                if staged_changed:
                    active_draft.draft_version += 1
            else:
                if should_replace_operations:
                    session.operations = operations
                    applied_operations = operations
                    staged_changed = bool(operations)
                else:
                    existing_signatures = {
                        self._operation_signature(operation)
                        for operation in session.operations
                    }
                    for operation in operations:
                        signature = self._operation_signature(operation)
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

        self._record_recent_targets_from_observation_summary(
            session=session,
            observation_summary=planning.react_tool_observation_summary,
        )
        if planning.response_mode == 'edit_plan' and staged_changed:
            recently_staged_operations = (
                applied_operations if applied_operations else operations
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
        mixed_query_followup_warning_code: str | None = None
        if (
            mixed_query_followup_message is not None
            and planning.response_mode == 'edit_plan'
        ):
            mixed_query_started = perf_counter()
            staged_operations_for_followup, _ = self._resolve_staged_state(
                session,
                draft_graph_enabled=draft_graph_enabled,
                active_draft=active_draft,
            )
            followup_answer, mixed_query_followup_warning_code = self._run_mixed_query_followup(
                session=session,
                query_message=mixed_query_followup_message,
                staged_operations=staged_operations_for_followup,
                auth_header=auth_header,
                trace_id=trace_id,
            )
            phase_timings['mixed_query_followup_ms'] = int(
                (perf_counter() - mixed_query_started) * 1000
            )
            assistant_message = self._compose_mixed_query_assistant_message(
                edit_message=assistant_message,
                followup_answer=followup_answer,
                warning_code=mixed_query_followup_warning_code,
            )
            if followup_answer:
                parse_mode = f'{parse_mode}+mixed_query_followup'
                phase_timings['mixed_query_followup_applied'] = 1
            if mixed_query_followup_warning_code is not None:
                phase_timings['mixed_query_followup_warning_code'] = (
                    mixed_query_followup_warning_code
                )

        session.last_intent_type = planning.intent_type
        self._store.append_message(session, 'assistant', assistant_message)
        self._store.update(session)

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
            active_draft_id=active_draft_id,
            active_draft_version=active_draft_version,
            draft_graph_migration_applied=draft_graph_migration_applied,
        )

    def _operation_signature(self, operation: RoadmapOperation) -> str:
        payload = self._canonicalize_signature_value(operation.model_dump(exclude_none=True))
        return json.dumps(
            payload,
            sort_keys=True,
            separators=(',', ':'),
        )

    def _canonicalize_signature_value(
        self,
        value: Any,
        *,
        key_path: tuple[str, ...] = (),
    ) -> Any:
        if isinstance(value, dict):
            return {
                key: self._canonicalize_signature_value(
                    item,
                    key_path=key_path + (str(key),),
                )
                for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            }
        if isinstance(value, list):
            field_name = key_path[-1] if key_path else ''
            if (
                field_name in self._ORDER_INSENSITIVE_SIGNATURE_FIELDS
                and all(isinstance(item, str) for item in value)
            ):
                return sorted(value)
            return [
                self._canonicalize_signature_value(item, key_path=key_path)
                for item in value
            ]
        return value

    def _should_replace_staged_operations(
        self,
        *,
        planning: PlanningResult,
    ) -> bool:
        if planning.response_mode != 'edit_plan':
            return False
        return planning.draft_action == 'revise'

    def _detect_edit_continuation_trigger(self, user_message: str) -> str | None:
        normalized = user_message.strip().lower()
        normalized = re.sub(r'[.!?,;:]+', ' ', normalized).strip()
        normalized = re.sub(r'\s+', ' ', normalized)
        if re.fullmatch(
            r'(?:a|option a|no need|no extra details|no additional details|nothing else)',
            normalized,
        ):
            return 'confirm'
        if re.fullmatch(
            r'(?:(?:ok|okay|yes|yep)\s+)?'
            r'(?:cancel|stop|never mind|nevermind|abort)'
            r'(?:\s+(?:please|kindly|now|this|it|that|for now))?',
            normalized,
        ):
            return 'cancel'
        if re.fullmatch(
            r"(?:"
            r"(?:ok|okay|yes|yep)(?:\s+(?:please|kindly))?(?:\s+(?:confirm|proceed|go ahead|do it))?"
            r"|(?:confirm|proceed|go ahead|do it|let'?s do it)"
            r")"
            r"(?:\s+(?:please|kindly|now))?"
            r"(?:\s+(?:with\s+)?(?:this|it|that))?"
            r"(?:\s+(?:please|kindly|now))?",
            normalized,
        ):
            return 'confirm'
        if re.fullmatch(
            r"(?:can you\s+)?(?:try again|retry|again|re-?run|re-?attempt)"
            r"(?:\s+(?:please|kindly|now))?",
            normalized,
        ):
            return 'retry'
        if re.search(
            r'\b(i meant|instead|inside|under|in that|it should|changed my mind|change my mind)\b',
            normalized,
        ):
            return 'correction'
        return None

    def _extract_mixed_query_followup_message(
        self,
        *,
        user_message: str,
        preview_intent: IntentType,
    ) -> str | None:
        if preview_intent != 'roadmap_edit':
            return None
        message = ' '.join(user_message.strip().split())
        if not message:
            return None

        for query_match in self._MIXED_QUERY_CUE_PATTERN.finditer(message):
            start = query_match.start()
            if start <= 0:
                continue
            prefix = message[:start]
            if not self._MIXED_EDIT_VERB_PATTERN.search(prefix):
                continue
            bridge_window = message[max(0, start - 32) : start]
            if not re.search(r'(?:\band\b|\bthen\b|[;,.])', bridge_window, re.IGNORECASE):
                continue
            query_tail = message[start:]
            query_tail = re.sub(
                r'^(?:and|then|also|plus)\s+',
                '',
                query_tail,
                flags=re.IGNORECASE,
            ).strip()
            query_tail = query_tail.rstrip(' .!?')
            if len(query_tail.split()) < 3:
                continue
            return query_tail
        return None

    def _extract_mixed_edit_primary_message(
        self,
        *,
        user_message: str,
        query_message: str | None,
    ) -> str | None:
        if not query_message:
            return None
        message = ' '.join(user_message.strip().split())
        query_tail = ' '.join(query_message.strip().split())
        if not message or not query_tail:
            return None
        lowered_message = message.lower()
        lowered_query = query_tail.lower()
        query_index = lowered_message.find(lowered_query)
        if query_index <= 0:
            return None

        primary = message[:query_index].rstrip(' ,;:.!?')
        primary = re.sub(
            r'(?:\b(?:and|then|also|plus)\b\s*)+$',
            '',
            primary,
            flags=re.IGNORECASE,
        ).strip()
        if len(primary.split()) < 2:
            return None
        return primary

    def _run_mixed_query_followup(
        self,
        *,
        session: AgentSession,
        query_message: str,
        staged_operations: list[RoadmapOperation],
        auth_header: str | None,
        trace_id: str | None,
    ) -> tuple[str | None, str | None]:
        if not staged_operations:
            return None, 'mixed_query_no_staged_operations'
        followup_trace_id = f'{trace_id}:mixed_query_followup' if trace_id else None
        try:
            query_session_context = self._build_session_context(
                session,
                auth_header,
                followup_trace_id,
            )
            query_planning = self._planner.plan(
                user_message=query_message,
                existing_operations=staged_operations,
                session_context=query_session_context,
            )
            query_planning = self._apply_context_answer_output_guard(
                planning=query_planning,
                pending_edit_context_present=session.metadata.pending_edit_context is not None,
            )
            if query_planning.response_mode != 'chat':
                return None, 'mixed_query_non_chat_response'
            if self._is_mixed_query_followup_clarifier(query_planning):
                return None, 'mixed_query_followup_needs_clarification'
            normalized_answer = query_planning.assistant_message.strip()
            if not normalized_answer:
                return None, 'mixed_query_empty_answer'
            if 'could not confirm your actor context' in normalized_answer.lower():
                return None, 'mixed_query_followup_actor_context_missing'
            return normalized_answer, None
        except Exception:
            return None, 'mixed_query_followup_failed'

    def _compose_mixed_query_assistant_message(
        self,
        *,
        edit_message: str,
        followup_answer: str | None,
        warning_code: str | None,
    ) -> str:
        sections: list[str] = []
        normalized_edit_message = edit_message.strip() if edit_message else ''
        if normalized_edit_message:
            sections.append(normalized_edit_message)
        if followup_answer:
            sections.append(
                'Draft-view answer after staging these edits:\n'
                f'{followup_answer.strip()}'
            )
        warning_text = self._mixed_query_warning_text(warning_code)
        if warning_text:
            sections.append(f'Note: {warning_text}')
        if sections:
            return '\n\n'.join(sections)
        return edit_message

    def _is_mixed_query_followup_clarifier(self, planning: PlanningResult) -> bool:
        parse_mode = str(planning.parse_mode or '').strip().lower()
        provider_error_code = str(planning.provider_error_code or '').strip().lower()
        if parse_mode in {
            'deterministic_context_my_tasks_low_confidence',
            'deterministic_context_my_tasks_provider_error',
            'deterministic_context_my_tasks_invalid_payload',
            'deterministic_context_budget_exhausted',
            'deterministic_context_repeat_limit_exhausted',
        }:
            return True
        if provider_error_code in {
            'low_confidence',
            'provider_error',
            'invalid_payload',
            'max_tool_turns_exceeded',
            'discovery_budget_exhausted',
            'discovery_repeat_limit_exhausted',
        }:
            return True
        return False

    def _mixed_query_warning_text(self, warning_code: str | None) -> str | None:
        if not warning_code:
            return None
        if warning_code == 'mixed_query_no_staged_operations':
            return 'I staged no changes, so there was no staged context to answer the follow-up query.'
        if warning_code == 'mixed_query_non_chat_response':
            return (
                'I could not generate a safe staged-context query answer in this turn. '
                'You can ask the question again and I will answer from staged context.'
            )
        if warning_code == 'mixed_query_empty_answer':
            return 'I could not derive a non-empty staged-context answer for the follow-up query.'
        if warning_code == 'mixed_query_followup_actor_context_missing':
            return (
                'I could not answer the follow-up my-tasks question because actor context was missing. '
                'Please retry and I will refresh actor context first.'
            )
        if warning_code == 'mixed_query_followup_needs_clarification':
            return (
                'I staged the edit, but the follow-up query needs clarification '
                '(for example: open tasks vs all tasks).'
            )
        if warning_code == 'mixed_query_followup_failed':
            return 'Staged-context follow-up query execution failed, so only the edit plan was staged.'
        return None

    def _normalize_recent_target_node_type(self, value: Any) -> str | None:
        normalized = str(value or '').strip().lower()
        if normalized in {'epic', 'feature', 'task'}:
            return normalized
        return None

    def _normalize_recent_target_label(self, value: str | None) -> str:
        lowered = str(value or '').strip().lower()
        lowered = lowered.translate(str.maketrans('', '', string.punctuation.replace('-', '')))
        lowered = re.sub(r'\s+', ' ', lowered).strip()
        return lowered

    def _is_recent_target_fresh(self, target: RecentResolvedTarget) -> bool:
        created_at = target.created_at
        if not isinstance(created_at, datetime):
            return False
        cutoff = _utcnow() - timedelta(hours=self._RECENT_TARGET_MAX_AGE_HOURS)
        return created_at >= cutoff

    def _recent_target_rank(self, target: RecentResolvedTarget) -> tuple[datetime, float, int]:
        confidence = float(target.confidence) if isinstance(target.confidence, (int, float)) else 0.0
        source_priority = int(self._RECENT_TARGET_SOURCE_PRIORITY.get(str(target.source), 0))
        return (target.created_at, confidence, source_priority)

    def _prune_recent_resolved_targets(
        self,
        targets: list[RecentResolvedTarget],
    ) -> list[RecentResolvedTarget]:
        fresh_targets = [target for target in targets if self._is_recent_target_fresh(target)]
        if len(fresh_targets) <= self._RECENT_TARGET_MAX_ITEMS:
            return fresh_targets
        return fresh_targets[-self._RECENT_TARGET_MAX_ITEMS :]

    def _get_recent_resolved_targets(self, session: AgentSession) -> list[RecentResolvedTarget]:
        raw_targets = session.metadata.recent_resolved_targets
        if not isinstance(raw_targets, list):
            return []

        normalized_targets: list[RecentResolvedTarget] = []
        for item in raw_targets:
            if isinstance(item, RecentResolvedTarget):
                normalized_targets.append(item)
                continue
            if isinstance(item, dict):
                try:
                    normalized_targets.append(RecentResolvedTarget.model_validate(item))
                except Exception:
                    continue

        pruned_targets = self._prune_recent_resolved_targets(normalized_targets)
        if len(pruned_targets) != len(normalized_targets):
            session.metadata.recent_resolved_targets = pruned_targets
        return pruned_targets

    def _append_recent_resolved_target(
        self,
        *,
        session: AgentSession,
        node_id: Any,
        node_type: Any,
        title: Any = None,
        label: Any = None,
        source: str = 'context_tool',
        confidence: float | None = None,
    ) -> None:
        normalized_node_id = str(node_id or '').strip()
        normalized_node_type = self._normalize_recent_target_node_type(node_type)
        if not self._is_uuid(normalized_node_id) or normalized_node_type is None:
            return

        normalized_title = str(title or '').strip() or None
        normalized_label = str(label or '').strip() or None
        targets = self._get_recent_resolved_targets(session)
        deduped_targets = [
            target
            for target in targets
            if not (
                target.node_id == normalized_node_id
                and target.node_type == normalized_node_type
            )
        ]
        deduped_targets.append(
            RecentResolvedTarget(
                node_id=normalized_node_id,
                node_type=normalized_node_type,
                title=normalized_title,
                label=normalized_label,
                source=source,
                confidence=confidence,
                created_at=_utcnow(),
            )
        )
        session.metadata.recent_resolved_targets = self._prune_recent_resolved_targets(
            deduped_targets
        )

    def _record_recent_targets_from_operations(
        self,
        *,
        session: AgentSession,
        operations: list[RoadmapOperation],
        source: str,
    ) -> None:
        for operation in operations:
            op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
            title = self._read_operation_title(operation)
            if op_name == 'add_epic' and self._is_uuid(operation.node_id):
                self._append_recent_resolved_target(
                    session=session,
                    node_id=operation.node_id,
                    node_type='epic',
                    title=title,
                    label=title,
                    source=source,
                )
            if op_name == 'add_feature':
                if self._is_uuid(operation.node_id):
                    self._append_recent_resolved_target(
                        session=session,
                        node_id=operation.node_id,
                        node_type='feature',
                        title=title,
                        label=title,
                        source=source,
                    )
                if self._is_uuid(operation.parent_id):
                    self._append_recent_resolved_target(
                        session=session,
                        node_id=operation.parent_id,
                        node_type='epic',
                        source=source,
                    )
            if op_name == 'add_task':
                if self._is_uuid(operation.node_id):
                    self._append_recent_resolved_target(
                        session=session,
                        node_id=operation.node_id,
                        node_type='task',
                        title=title,
                        label=title,
                        source=source,
                    )
                if self._is_uuid(operation.parent_id):
                    self._append_recent_resolved_target(
                        session=session,
                        node_id=operation.parent_id,
                        node_type='feature',
                        source=source,
                    )

    def _record_recent_targets_from_observation_summary(
        self,
        *,
        session: AgentSession,
        observation_summary: list[dict[str, Any]] | None,
    ) -> None:
        if not isinstance(observation_summary, list):
            return

        for item in observation_summary:
            if not isinstance(item, dict):
                continue
            label = item.get('label')
            selected_id = item.get('selected_id')
            node_type = self._normalize_recent_target_node_type(item.get('node_type'))
            node_title = item.get('node_title')

            if self._is_uuid(selected_id):
                match_items = item.get('match_items')
                if node_type is None and isinstance(match_items, list):
                    for match_item in match_items:
                        if not isinstance(match_item, dict):
                            continue
                        if str(match_item.get('id') or '').strip() != str(selected_id).strip():
                            continue
                        node_type = self._normalize_recent_target_node_type(match_item.get('type'))
                        node_title = node_title or match_item.get('title')
                        break
                self._append_recent_resolved_target(
                    session=session,
                    node_id=selected_id,
                    node_type=node_type,
                    title=node_title,
                    label=label,
                    source='context_tool',
                )

            node_id = item.get('node_id')
            if self._is_uuid(node_id) and node_type is not None:
                self._append_recent_resolved_target(
                    session=session,
                    node_id=node_id,
                    node_type=node_type,
                    title=node_title,
                    label=label,
                    source='context_tool',
                )

            match_items = item.get('match_items')
            if (
                isinstance(match_items, list)
                and int(item.get('match_count') or 0) == 1
                and len(match_items) >= 1
                and isinstance(match_items[0], dict)
            ):
                only_match = match_items[0]
                self._append_recent_resolved_target(
                    session=session,
                    node_id=only_match.get('id'),
                    node_type=only_match.get('type'),
                    title=only_match.get('title'),
                    label=label,
                    source='context_tool',
                )

    def record_recent_targets_from_preview(
        self,
        *,
        session: AgentSession,
        preview_result: dict[str, Any],
        source: str = 'commit_semantic_diff',
    ) -> None:
        semantic_diff = preview_result.get('semantic_diff')
        changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
        if not isinstance(changes, list):
            return

        for change in changes[:80]:
            if not isinstance(change, dict):
                continue
            node_payload = change.get('node') if isinstance(change.get('node'), dict) else {}
            to_payload = change.get('to') if isinstance(change.get('to'), dict) else {}

            node_id = (
                node_payload.get('id')
                or node_payload.get('node_id')
                or to_payload.get('id')
                or to_payload.get('node_id')
            )
            node_type = (
                node_payload.get('type')
                or node_payload.get('node_type')
                or to_payload.get('type')
                or to_payload.get('node_type')
            )
            title = (
                node_payload.get('title')
                or to_payload.get('title')
                or node_payload.get('name')
                or to_payload.get('name')
            )
            self._append_recent_resolved_target(
                session=session,
                node_id=node_id,
                node_type=node_type,
                title=title,
                label=title,
                source=source,
            )

    def _looks_like_deictic_parent_reference(self, user_message: str) -> bool:
        normalized = str(user_message or '').strip()
        if not normalized:
            return False
        return bool(self._DEICTIC_PARENT_PATTERN.search(normalized))

    def _infer_required_parent_node_type(self, user_message: str) -> str | None:
        create_intent = extract_create_intent(user_message)
        if create_intent is not None:
            if create_intent.node_type == 'feature':
                return 'epic'
            if create_intent.node_type == 'task':
                return 'feature'

        lowered = user_message.strip().lower()
        if re.search(r'\bfeature(?:s)?\b', lowered):
            return 'epic'
        if re.search(r'\btask(?:s)?\b', lowered):
            return 'feature'
        return None

    def _resolve_deictic_parent_reference(
        self,
        *,
        session: AgentSession,
        user_message: str,
    ) -> dict[str, Any] | None:
        if not self._looks_like_deictic_parent_reference(user_message):
            return None

        required_parent_type = self._infer_required_parent_node_type(user_message)
        recent_targets = self._get_recent_resolved_targets(session)
        if not recent_targets:
            return None

        ranked_targets = sorted(
            recent_targets,
            key=self._recent_target_rank,
            reverse=True,
        )

        candidates_by_id: dict[str, RecentResolvedTarget] = {}
        for target in ranked_targets:
            if required_parent_type is not None and target.node_type != required_parent_type:
                continue
            if target.node_id in candidates_by_id:
                continue
            candidates_by_id[target.node_id] = target

        if not candidates_by_id:
            return None

        candidates = list(candidates_by_id.values())
        if len(candidates) == 1:
            target = candidates[0]
            return {
                'status': 'resolved',
                'node_id': target.node_id,
                'node_type': target.node_type,
                'title': target.title,
                'label': target.label,
            }

        return {
            'status': 'ambiguous',
            'required_parent_type': required_parent_type,
            'candidates': [
                {
                    'node_id': target.node_id,
                    'node_type': target.node_type,
                    'title': target.title,
                    'label': target.label,
                }
                for target in candidates[:5]
            ],
        }

    def _build_deictic_ambiguity_planning(
        self,
        *,
        deictic_resolution: dict[str, Any],
    ) -> PlanningResult:
        candidates_raw = deictic_resolution.get('candidates')
        required_parent_type = self._normalize_recent_target_node_type(
            deictic_resolution.get('required_parent_type')
        )
        option_candidates: list[str] = []
        if isinstance(candidates_raw, list):
            for candidate in candidates_raw[:3]:
                if not isinstance(candidate, dict):
                    continue
                node_type = self._normalize_recent_target_node_type(candidate.get('node_type'))
                node_id = str(candidate.get('node_id') or '').strip()
                if not self._is_uuid(node_id):
                    continue
                title = str(candidate.get('title') or candidate.get('label') or '').strip()
                display_type = node_type.title() if node_type else 'Node'
                if title:
                    option_candidates.append(f'{display_type}: {title} ({node_id})')
                else:
                    option_candidates.append(f'{display_type}: {node_id}')

        options = option_candidates + ['Provide node ID', 'Cancel']
        if required_parent_type is not None:
            question = (
                'I found multiple recent targets for "that". '
                f'Which {required_parent_type} should I use as the parent?'
            )
        else:
            question = 'I found multiple recent targets for "that". Which target should I use as the parent?'

        message, normalized_options = build_clarifier_contract(
            reason='deictic_target_ambiguous',
            question=question,
            options=options,
        )
        return PlanningResult(
            assistant_message=message,
            operations=[],
            parse_mode='deterministic_deictic_target_ambiguous',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='deictic_target_ambiguous',
            clarifier_action='ask_clarifier',
            clarifier_reason='deictic_target_ambiguous',
            clarifier_options=normalized_options,
            draft_action='continue',
            tool_plan=[],
            needs_more_info=True,
            stop_reason='awaiting_user_input',
        )

    def _infer_last_staged_create_title(self, session: AgentSession) -> str | None:
        staged_operations = self._get_current_staged_operations(session)
        for operation in reversed(staged_operations):
            op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
            if op_name not in {'add_epic', 'add_feature', 'add_task'}:
                continue
            if isinstance(operation.data, dict):
                title = operation.data.get('title')
                if isinstance(title, str) and title.strip():
                    return title.strip()
        return None

    def _set_pending_edit_context(
        self,
        *,
        session: AgentSession,
        context: PendingEditContext | None,
        event: str,
        trace_id: str | None,
    ) -> None:
        if context is not None:
            context.intent_family = self._normalize_intent_family(context.intent_family)
        session.metadata.pending_edit_context = context
        log_event(
            self._logger,
            'pending_edit_context_event',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            pending_edit_context_event=event,
            pending_edit_context_present=context is not None,
            intent_family=(context.intent_family if context is not None else None),
            confirmation_mode=(context.confirmation_mode if context is not None else None),
        )

    def _sync_pending_edit_context(
        self,
        *,
        session: AgentSession,
        planning: PlanningResult,
        user_message: str,
        edit_continuation_trigger: str | None,
        staged_operations_version: int,
        trace_id: str | None,
        edit_guard_intervened: bool,
    ) -> None:
        existing_context = session.metadata.pending_edit_context
        if edit_continuation_trigger == 'correction' and existing_context is not None:
            invalidated_hints = self._invalidate_retry_hints(
                existing_context.resolver_hints
            )
            existing_context.resolver_hints = invalidated_hints
            existing_context.updated_at = _utcnow()
            self._set_pending_edit_context(
                session=session,
                context=existing_context,
                event='updated',
                trace_id=trace_id,
            )

        if edit_continuation_trigger == 'cancel':
            if session.metadata.pending_edit_context is not None:
                self._set_pending_edit_context(
                    session=session,
                    context=None,
                    event='cleared',
                    trace_id=trace_id,
                )
            return

        if edit_guard_intervened and existing_context is not None:
            existing_context.draft_operations = []
            existing_context.confirmation_mode = 'awaiting_clarification'
            existing_context.resolver_hints = self._invalidate_retry_hints(
                existing_context.resolver_hints
            )
            existing_context.last_guard_reason = planning.provider_error_code
            existing_context.updated_at = _utcnow()
            self._set_pending_edit_context(
                session=session,
                context=existing_context,
                event='updated',
                trace_id=trace_id,
            )
            return

        if planning.intent_type != 'roadmap_edit':
            return
        if planning.response_mode == 'edit_plan' and planning.operations:
            if session.metadata.pending_edit_context is not None:
                self._set_pending_edit_context(
                    session=session,
                    context=None,
                    event='cleared',
                    trace_id=trace_id,
                )
            return

        if planning.response_mode != 'chat':
            return

        clarifier_action = planning.clarifier_action
        if clarifier_action not in {'ask_clarifier', 'propose_safe_default', 'cannot_proceed'}:
            return

        create_intent = extract_create_intent(user_message)
        existing = session.metadata.pending_edit_context
        resolved_refs = (
            existing.resolved_references
            if existing is not None
            else PendingEditResolvedReferences()
        )
        existing_hints = (
            dict(existing.resolver_hints)
            if existing is not None and isinstance(existing.resolver_hints, dict)
            else {}
        )
        default_title = (
            create_intent.title
            if create_intent is not None
            else (existing.default_title if existing is not None else None)
            or self._infer_last_staged_create_title(session)
        )
        draft_operations: list[RoadmapOperation] = []
        required_fields: list[str] = []
        confirmation_mode: str = 'awaiting_clarification'
        intent_family = (
            f'create_{create_intent.node_type}'
            if create_intent is not None
            else (existing.intent_family if existing is not None else 'roadmap_edit_clarifier')
        )
        intent_family = self._normalize_intent_family(intent_family)
        rename_intent = self._extract_rename_intent(user_message)
        if rename_intent is not None:
            intent_family = 'rename_node'

        if clarifier_action == 'propose_safe_default':
            if create_intent is not None and create_intent.node_type == 'epic' and default_title:
                draft_operations = [
                    RoadmapOperation(
                        op='add_epic',
                        data={'title': default_title},
                    )
                ]
                confirmation_mode = 'draft_ready'
            else:
                confirmation_mode = 'awaiting_clarification'
        else:
            if create_intent is not None and create_intent.node_type in {'feature', 'task'}:
                required_fields.append('parent')
            if not default_title and create_intent is not None:
                required_fields.append('title')

        context = PendingEditContext(
            intent_family=intent_family,
            draft_operations=draft_operations,
            required_fields=required_fields,
            resolved_references=resolved_refs,
            confirmation_mode=confirmation_mode,  # type: ignore[arg-type]
            source_user_message=user_message,
            default_title=default_title,
            resolver_hints=self._build_resolver_hints(
                existing_hints=existing_hints,
                user_message=user_message,
                planning=planning,
                edit_continuation_trigger=edit_continuation_trigger,
                intent_family=intent_family,
                staged_operations_version=staged_operations_version,
                rename_intent=rename_intent,
            ),
            last_planner_stop_reason=planning.stop_reason,
            last_planner_needs_more_info=planning.needs_more_info,
            last_planner_draft_action=planning.draft_action,
            last_tool_plan_summary=self._summarize_tool_plan(planning.tool_plan),
            last_guard_reason=(existing.last_guard_reason if existing is not None else None),
            last_retry_blocked_reason=(
                existing.last_retry_blocked_reason if existing is not None else None
            ),
            last_retry_blocked_intent_family=(
                existing.last_retry_blocked_intent_family if existing is not None else None
            ),
            created_at=(existing.created_at if existing is not None else _utcnow()),
            updated_at=_utcnow(),
        )
        self._set_pending_edit_context(
            session=session,
            context=context,
            event='updated' if existing is not None or edit_continuation_trigger else 'set',
            trace_id=trace_id,
        )

    def _apply_context_answer_output_guard(
        self,
        *,
        planning: PlanningResult,
        pending_edit_context_present: bool,
    ) -> PlanningResult:
        if planning.response_mode != 'chat':
            return planning
        parse_mode = (planning.parse_mode or '').lower()
        if 'context_answer' not in parse_mode and parse_mode != 'openai_context_tools':
            return planning
        if not self._looks_like_pseudo_operation_payload(planning.assistant_message):
            return planning
        return PlanningResult(
            assistant_message=(
                'I can continue this as an edit plan, but I need one clear command. '
                'Please state the exact change in one line (or say "cancel").'
            ),
            operations=[],
            parse_mode='deterministic_context_answer_handoff',
            intent_type='roadmap_edit' if pending_edit_context_present else planning.intent_type,
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='context_answer_operation_payload_blocked',
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=planning.route_lane,
            clarifier_action='ask_clarifier',
            clarifier_reason='context_answer_operation_payload_blocked',
            clarifier_options=['Proceed with edit planning', 'Change target details', 'Cancel'],
        )

    def _looks_like_pseudo_operation_payload(self, assistant_message: str) -> bool:
        if not assistant_message:
            return False
        text = assistant_message.lower()
        pseudo_markers = (
            'planned operations',
            "won't be applied",
            'parent_id',
            '"action":',
            '"type":',
        )
        if any(marker in text for marker in pseudo_markers):
            return True
        if re.search(r'^\s*\[\s*\{', assistant_message.strip()):
            return True
        return False

    def _looks_like_found_node_without_operations(self, assistant_message: str) -> bool:
        if not assistant_message:
            return False
        lowered = assistant_message.lower()
        if 'id:' not in lowered and 'node id' not in lowered:
            return False
        if not re.search(
            r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
            assistant_message,
        ):
            return False
        return ('found' in lowered) or ('match' in lowered)

    def _run_edit_react_planning_loop(
        self,
        *,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
        route_lane: str,
    ) -> tuple[PlanningResult, dict[str, Any]]:
        loop_budget = max(1, min(int(self._settings.agent_react_max_attempts), 4))
        llm_call_budget = max(1, int(self._settings.agent_max_total_llm_calls_per_message))
        loop_budget = min(loop_budget, llm_call_budget)
        loop_started = perf_counter()
        loop_turns = 0
        termination_reason = 'planner_terminal'
        planning: PlanningResult | None = None
        remaining_llm_calls = llm_call_budget

        observation_context = dict(session_context)

        def _collect_resolved_node_ids(tool_observation_summary: Any) -> list[str]:
            if not isinstance(tool_observation_summary, list):
                return []

            ordered_ids: list[str] = []
            seen: set[str] = set()

            def _add(node_id: Any) -> None:
                if not isinstance(node_id, str):
                    return
                normalized = node_id.strip()
                if not normalized or normalized in seen:
                    return
                seen.add(normalized)
                ordered_ids.append(normalized)

            for item in tool_observation_summary:
                if not isinstance(item, dict):
                    continue
                _add(item.get('selected_id'))
                _add(item.get('node_id'))
                child_ids = item.get('child_ids')
                if isinstance(child_ids, list):
                    for child_id in child_ids:
                        _add(child_id)
                children = item.get('children')
                if isinstance(children, list):
                    for child in children:
                        if isinstance(child, dict):
                            _add(child.get('id'))

            return ordered_ids[:20]

        for turn_index in range(loop_budget):
            loop_turns += 1
            if remaining_llm_calls <= 0:
                termination_reason = 'llm_call_budget_exhausted'
                planning = PlanningResult(
                    assistant_message=(
                        'I reached the planner call budget before safely finalizing this edit. '
                        'Please provide one precise target detail so I can continue.'
                    ),
                    operations=[],
                    parse_mode='deterministic_react_budget_guard',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=True,
                    provider_error_code='llm_call_budget_exhausted',
                    route_lane=route_lane,
                    clarifier_action='ask_clarifier',
                    clarifier_reason='llm_call_budget_exhausted',
                    clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
                    needs_more_info=True,
                    stop_reason='tool_budget_exhausted',
                    llm_calls_used=0,
                )
                break
            observation_context['_react_loop_turn'] = turn_index + 1
            observation_context['_react_loop_budget'] = loop_budget
            observation_context['_llm_calls_total_budget'] = llm_call_budget
            observation_context['_llm_calls_budget_remaining'] = remaining_llm_calls

            planning = self._planner.plan(
                user_message=user_message,
                existing_operations=existing_operations,
                session_context=observation_context,
            )
            planning = replace(planning, route_lane=route_lane)

            llm_calls_used_raw = planning.llm_calls_used
            if isinstance(llm_calls_used_raw, (int, float)):
                llm_calls_used = max(int(llm_calls_used_raw), 0)
            else:
                llm_calls_used = 0 if planning.provider_used == 'rule_based' else 1
            llm_calls_used = min(llm_calls_used, remaining_llm_calls)
            remaining_llm_calls = max(remaining_llm_calls - llm_calls_used, 0)
            observation_context['_llm_calls_budget_remaining'] = remaining_llm_calls
            observation_context['_react_tool_observation_summary'] = (
                list(planning.react_tool_observation_summary or [])
                if isinstance(planning.react_tool_observation_summary, list)
                else []
            )

            if planning.response_mode == 'edit_plan':
                planning = replace(
                    planning,
                    draft_action=(planning.draft_action or 'continue'),
                    tool_plan=(planning.tool_plan or []),
                    needs_more_info=(
                        planning.needs_more_info
                        if planning.needs_more_info is not None
                        else False
                    ),
                    stop_reason=(
                        planning.stop_reason
                        or ('ready_to_stage' if planning.operations else 'awaiting_user_input')
                    ),
                )

            if not self._settings.agent_hybrid_react_enabled:
                termination_reason = 'hybrid_disabled'
                break
            if planning.response_mode != 'edit_plan':
                termination_reason = 'planner_returned_chat'
                break

            recoverable_tool_budget_replan = (
                planning.provider_error_code == 'max_tool_turns_exceeded'
                and not planning.operations
            )
            if recoverable_tool_budget_replan:
                if remaining_llm_calls <= 0:
                    termination_reason = 'llm_call_budget_exhausted'
                    planning = replace(
                        planning,
                        stop_reason='tool_budget_exhausted',
                        needs_more_info=True,
                    )
                    break

                if turn_index + 1 >= loop_budget:
                    termination_reason = 'budget_exhausted'
                    break

                tool_observation_summary = observation_context.get(
                    '_react_tool_observation_summary', []
                )
                resolved_node_ids = _collect_resolved_node_ids(tool_observation_summary)
                observation_context['_react_loop_observation'] = {
                    'stop_reason': planning.stop_reason,
                    'needs_more_info': planning.needs_more_info,
                    'draft_action': planning.draft_action,
                    'tool_plan_steps': len(planning.tool_plan or []),
                    'llm_calls_used': llm_calls_used,
                    'llm_calls_remaining': remaining_llm_calls,
                    'provider_error_code': planning.provider_error_code,
                    'tool_observation_summary': tool_observation_summary,
                    'resolved_node_ids': resolved_node_ids,
                }
                termination_reason = 'replanned_after_observation'
                continue

            if not planning.operations:
                termination_reason = 'planner_returned_no_operations'
                break
            if planning.stop_reason == 'ready_to_stage':
                termination_reason = 'ready_to_stage'
                break

            if remaining_llm_calls <= 0:
                termination_reason = 'llm_call_budget_exhausted'
                if planning.response_mode == 'edit_plan':
                    planning = replace(
                        planning,
                        stop_reason='tool_budget_exhausted',
                        needs_more_info=True,
                    )
                break

            if turn_index + 1 >= loop_budget:
                termination_reason = 'budget_exhausted'
                break

            tool_observation_summary = observation_context.get('_react_tool_observation_summary', [])
            resolved_node_ids = _collect_resolved_node_ids(tool_observation_summary)
            observation_context['_react_loop_observation'] = {
                'stop_reason': planning.stop_reason,
                'needs_more_info': planning.needs_more_info,
                'draft_action': planning.draft_action,
                'tool_plan_steps': len(planning.tool_plan or []),
                'llm_calls_used': llm_calls_used,
                'llm_calls_remaining': remaining_llm_calls,
                'provider_error_code': planning.provider_error_code,
                'tool_observation_summary': tool_observation_summary,
                'resolved_node_ids': resolved_node_ids,
            }
            termination_reason = 'replanned_after_observation'

        if planning is None:
            planning = PlanningResult(
                assistant_message=(
                    'I could not complete planning in this turn. Please restate the exact change '
                    'you want to apply.'
                ),
                operations=[],
                parse_mode='deterministic_react_planner_empty',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=True,
                provider_error_code='planner_empty_result',
                route_lane=route_lane,
                clarifier_action='ask_clarifier',
                clarifier_reason='planner_empty_result',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
                stop_reason='insufficient_context',
            )

        loop_metrics = {
            'elapsed_ms': int((perf_counter() - loop_started) * 1000),
            'loop_turns': loop_turns,
            'loop_budget': loop_budget,
            'termination_reason': termination_reason,
            'llm_calls_budget': llm_call_budget,
            'llm_calls_used': llm_call_budget - remaining_llm_calls,
            'llm_calls_remaining': remaining_llm_calls,
        }
        return planning, loop_metrics

    def _build_react_guard_handoff(
        self,
        *,
        planning: PlanningResult,
        route_lane: str | None,
        assistant_message: str,
        parse_mode: str,
        provider_error_code: str,
        clarifier_reason: str,
        clarifier_options: list[str],
        needs_more_info: bool | None = None,
        stop_reason: str | None = None,
    ) -> PlanningResult:
        return PlanningResult(
            assistant_message=assistant_message,
            operations=[],
            parse_mode=parse_mode,
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=True,
            provider_error_code=provider_error_code,
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=route_lane,
            clarifier_action='ask_clarifier',
            clarifier_reason=clarifier_reason,
            clarifier_options=clarifier_options,
            draft_action=planning.draft_action,
            tool_plan=planning.tool_plan,
            needs_more_info=needs_more_info,
            stop_reason=stop_reason,
        )

    def _enforce_hybrid_react_terminal_guard(
        self,
        *,
        planning: PlanningResult,
        route_lane: str | None,
        user_message: str,
    ) -> PlanningResult | None:
        if not self._settings.agent_hybrid_react_enabled:
            return None
        if planning.response_mode != 'edit_plan':
            return None

        normalized_draft_action = planning.draft_action or 'continue'
        normalized_tool_plan = planning.tool_plan or []
        normalized_needs_more_info = (
            planning.needs_more_info if planning.needs_more_info is not None else False
        )
        normalized_stop_reason = planning.stop_reason or (
            'ready_to_stage' if planning.operations else 'awaiting_user_input'
        )
        planning = replace(
            planning,
            draft_action=normalized_draft_action,
            tool_plan=normalized_tool_plan,
            needs_more_info=normalized_needs_more_info,
            stop_reason=normalized_stop_reason,
        )

        if planning.draft_action not in {'continue', 'revise', 'new_draft'}:
            return self._build_react_guard_handoff(
                planning=planning,
                route_lane=route_lane,
                assistant_message=(
                    'I need one more confirmation before staging edits because draft intent metadata '
                    'was incomplete. Please restate whether this should continue, revise, or start a new draft.'
                ),
                parse_mode='deterministic_planner_schema_handoff',
                provider_error_code='planner_schema_missing_draft_action',
                clarifier_reason='planner_schema_missing_draft_action',
                clarifier_options=['Continue current draft', 'Revise current draft', 'Start new draft'],
            )

        if planning.needs_more_info:
            return self._build_react_guard_handoff(
                planning=planning,
                route_lane=route_lane,
                assistant_message=(
                    'I could not safely stage edits yet because required context is still missing. '
                    'Please answer the clarification so I can continue.'
                ),
                parse_mode='deterministic_planner_needs_more_info_handoff',
                provider_error_code='planner_needs_more_info_conflict',
                clarifier_reason='planner_needs_more_info_conflict',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
            )

        if planning.stop_reason in {'tool_budget_exhausted', 'insufficient_context', 'awaiting_user_input'}:
            return self._build_react_guard_handoff(
                planning=planning,
                route_lane=route_lane,
                assistant_message=(
                    'I still need one clarification before I can safely stage edits. '
                    'Please provide the missing target details and I will continue.'
                ),
                parse_mode='deterministic_planner_stop_reason_handoff',
                provider_error_code='planner_stop_reason_conflict',
                clarifier_reason='planner_stop_reason_conflict',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
                needs_more_info=True,
                stop_reason=planning.stop_reason,
            )

        if planning.operations and planning.stop_reason != 'ready_to_stage':
            return self._build_react_guard_handoff(
                planning=planning,
                route_lane=route_lane,
                assistant_message=(
                    'I need one more clarification before I can safely stage these edits. '
                    'Please confirm the exact target details.'
                ),
                parse_mode='deterministic_react_terminal_handoff',
                provider_error_code='planner_terminal_state_conflict',
                clarifier_reason='planner_terminal_state_conflict',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
                needs_more_info=True,
                stop_reason=(planning.stop_reason or 'awaiting_user_input'),
            )

        if (
            planning.operations
            and self._is_rename_message(user_message)
            and not self._has_rename_shape_operation(planning.operations)
        ):
            return self._build_react_guard_handoff(
                planning=planning,
                route_lane=route_lane,
                assistant_message=(
                    'I understood this as a rename request, but I could not derive a safe rename '
                    'operation yet. Please provide the exact current label and the new title.'
                ),
                parse_mode='deterministic_rename_shape_handoff',
                provider_error_code='rename_shape_guard_blocked',
                clarifier_reason='rename_shape_guard_blocked',
                clarifier_options=['Provide current label', 'Provide new title', 'Cancel'],
                needs_more_info=True,
                stop_reason='insufficient_context',
            )

        return None

    def _derive_react_terminal_action(
        self,
        *,
        planning: PlanningResult,
        edit_continuation_trigger: str | None,
    ) -> str:
        if edit_continuation_trigger == 'cancel':
            return 'cancel'
        if planning.response_mode == 'edit_plan' and planning.operations:
            return 'execute'
        if planning.clarifier_action in {'ask_clarifier', 'propose_safe_default', 'cannot_proceed'}:
            return 'clarify'
        if planning.response_mode == 'chat':
            return 'clarify'
        return 'execute'

    def _run_edit_react_loop(
        self,
        *,
        planning: PlanningResult,
        pending_edit_context_present: bool,
        edit_continuation_trigger: str | None,
        route_lane: str | None,
        user_message: str,
    ) -> EditReactLoopOutcome:
        edit_guard_intervened = False
        operation_validation_error: dict[str, Any] | None = None

        planning = self._apply_context_answer_output_guard(
            planning=planning,
            pending_edit_context_present=pending_edit_context_present,
        )
        if planning.provider_error_code == 'context_answer_operation_payload_blocked':
            edit_guard_intervened = True
        if (
            pending_edit_context_present
            and edit_continuation_trigger == 'confirm'
            and planning.response_mode != 'edit_plan'
        ):
            planning = PlanningResult(
                assistant_message=(
                    'I still have your pending edit draft, but I could not stage it from that '
                    'confirmation alone. Please provide the exact change in one line '
                    '(or say "cancel").'
                ),
                operations=[],
                parse_mode='deterministic_pending_edit_confirm_handoff',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code='pending_edit_confirm_requires_edit_plan',
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
                route_lane=route_lane,
                clarifier_action='ask_clarifier',
                clarifier_reason='pending_edit_confirm_requires_edit_plan',
                clarifier_options=['Proceed with edit planning', 'Change target details', 'Cancel'],
            )
            edit_guard_intervened = True
        if (
            pending_edit_context_present
            and edit_continuation_trigger in {'confirm', 'retry'}
            and planning.response_mode == 'chat'
            and not planning.operations
            and self._looks_like_found_node_without_operations(planning.assistant_message)
        ):
            planning = PlanningResult(
                assistant_message=(
                    'I found likely target node matches, but I still need one explicit selection '
                    'to stage a safe edit operation. Reply with the exact node ID (or say "cancel").'
                ),
                operations=[],
                parse_mode='deterministic_edit_narrative_handoff',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code='edit_narrative_without_operations',
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
                route_lane=route_lane,
                clarifier_action='ask_clarifier',
                clarifier_reason='edit_narrative_without_operations',
                clarifier_options=['Use the matched node ID', 'Refine the node label', 'Cancel'],
            )
            edit_guard_intervened = True
        hybrid_guard_handoff = self._enforce_hybrid_react_terminal_guard(
            planning=planning,
            route_lane=route_lane,
            user_message=user_message,
        )
        if hybrid_guard_handoff is not None:
            planning = hybrid_guard_handoff
            edit_guard_intervened = True

        planning, operation_validation_error = self._apply_operation_contract_guard(
            planning=planning,
            route_lane=route_lane,
        )

        planning = self._normalize_planning_clarifier_contract(planning)
        return EditReactLoopOutcome(
            planning=planning,
            edit_guard_intervened=edit_guard_intervened,
            operation_validation_error=operation_validation_error,
        )

    def _apply_operation_contract_guard(
        self,
        *,
        planning: PlanningResult,
        route_lane: str | None,
    ) -> tuple[PlanningResult, dict[str, Any] | None]:
        if planning.response_mode != 'edit_plan' or not planning.operations:
            return planning, None

        validation_error = self._validate_operation_contract(planning.operations)
        if validation_error is None:
            return planning, None

        guidance = self._operation_validation_guidance(validation_error.get('reason'))
        return (
            PlanningResult(
                assistant_message=(
                    'I could not safely stage this edit operation. '
                    f'{guidance}'
                ),
                operations=[],
                parse_mode='deterministic_invalid_operation_blocked',
                intent_type=planning.intent_type,
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=True,
                provider_error_code='invalid_operation_contract',
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
                route_lane=route_lane,
            ),
            validation_error,
        )

    def _is_rename_message(self, user_message: str) -> bool:
        normalized = user_message.strip().lower()
        if not normalized:
            return False
        return normalized.startswith('rename ') or ' rename ' in normalized

    def _has_rename_shape_operation(self, operations: list[RoadmapOperation]) -> bool:
        for operation in operations:
            op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
            if op_name != 'update_node':
                continue
            if not operation.node_id:
                continue
            if isinstance(operation.patch, dict):
                title = operation.patch.get('title')
                if isinstance(title, str) and title.strip():
                    return True
        return False

    def _should_fetch_actor_context(
        self,
        *,
        preview_intent: IntentType,
        user_message: str,
        auth_header: str | None,
        simple_edit_detected: bool,
        actor_context_present: bool,
    ) -> tuple[bool, str | None]:
        if not auth_header:
            return False, 'missing_auth_header'
        actor_required = self._is_actor_context_required_message(user_message)
        if preview_intent == 'roadmap_edit' and simple_edit_detected and not actor_required:
            return False, 'simple_edit_turn'
        if actor_required:
            return True, None
        if actor_context_present:
            return False, 'not_required_cached'
        return False, 'not_required_for_turn'

    def _is_actor_context_required_message(self, user_message: str) -> bool:
        lowered = user_message.lower()
        if not lowered.strip():
            return False

        deterministic_match = match_deterministic_context_intent(user_message)
        if deterministic_match is not None:
            deterministic_intent, _ = deterministic_match
            if deterministic_intent.pending_kind == 'my_tasks':
                return True

        actor_required_patterns = (
            r'\bmy(?:\s+\w+){0,2}\s+tasks?\b',
            r'\bassigned\s+to\s+me\b',
            r'\btasks?\s+for\s+me\b',
            r'\bfor\s+me\b',
            r'\bmy\s+role\b',
            r'\bwhat\s+can\s+i\b',
        )
        return any(re.search(pattern, lowered) for pattern in actor_required_patterns)

    def _validate_operation_contract(
        self,
        operations: list[RoadmapOperation],
    ) -> dict[str, Any] | None:
        for index, operation in enumerate(operations):
            op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
            if op_name == 'add_epic':
                if self._read_operation_title(operation) is None:
                    return {
                        'index': index,
                        'reason': 'add_epic.data.title_missing',
                    }
            if op_name in {'add_feature', 'add_task'}:
                if not self._is_uuid(operation.parent_id):
                    return {
                        'index': index,
                        'reason': f'{op_name}.parent_id_invalid_uuid',
                    }
                if self._read_operation_title(operation) is None:
                    return {
                        'index': index,
                        'reason': f'{op_name}.data.title_missing',
                    }
            if op_name in {'update_node', 'delete_node', 'move_node', 'mark_status'}:
                if not self._is_uuid(operation.node_id):
                    return {
                        'index': index,
                        'reason': f'{op_name}.node_id_invalid_uuid',
                    }
            if op_name == 'move_node' and not self._is_uuid(operation.new_parent_id):
                return {
                    'index': index,
                    'reason': 'move_node.new_parent_id_invalid_uuid',
                }
            if operation.parent_id is not None and not self._is_uuid(operation.parent_id):
                return {
                    'index': index,
                    'reason': f'{op_name}.parent_id_invalid_uuid',
                }
        return None

    def _read_operation_title(self, operation: RoadmapOperation) -> str | None:
        if not isinstance(operation.data, dict):
            return None
        title = operation.data.get('title')
        if isinstance(title, str):
            normalized = title.strip()
            if normalized:
                return normalized
        return None

    def _operation_validation_guidance(self, reason: str | None) -> str:
        if not reason:
            return 'Please provide the exact target details and try again.'
        guidance_map = {
            'add_epic.data.title_missing': (
                'The new epic title is missing. Include a title, for example: '
                '"Create a new epic called AI Module".'
            ),
            'add_feature.data.title_missing': (
                'The new feature title is missing. Include the feature title and parent epic.'
            ),
            'add_task.data.title_missing': (
                'The new task title is missing. Include the task title and parent feature.'
            ),
            'add_feature.parent_id_invalid_uuid': (
                'The feature parent reference is invalid. Specify the exact parent epic.'
            ),
            'add_task.parent_id_invalid_uuid': (
                'The task parent reference is invalid. Specify the exact parent feature.'
            ),
        }
        if reason in guidance_map:
            return guidance_map[reason]
        if reason.endswith('node_id_invalid_uuid'):
            return (
                'The target node reference is invalid. Specify the exact node name and type.'
            )
        if reason.endswith('parent_id_invalid_uuid'):
            return (
                'The parent node reference is invalid. Specify the exact parent node.'
            )
        if reason == 'move_node.new_parent_id_invalid_uuid':
            return (
                'The move target parent is invalid. Specify the exact destination parent node.'
            )
        return 'Please provide the exact target details and try again.'

    def _is_uuid(self, value: str | None) -> bool:
        return bool(isinstance(value, str) and self._uuid_pattern.fullmatch(value.strip()))

    def _normalize_planning_clarifier_contract(
        self,
        planning: PlanningResult,
    ) -> PlanningResult:
        if planning.response_mode != 'chat':
            return planning
        if planning.clarifier_action not in {
            'ask_clarifier',
            'propose_safe_default',
            'cannot_proceed',
        }:
            return planning

        fallback_options = [
            'Provide target details',
            'Provide node ID',
            'Cancel',
        ]
        question = planning.assistant_message or 'I need one clarification before I can safely continue.'
        message, normalized_options = build_clarifier_contract(
            reason=planning.clarifier_reason,
            question=question,
            options=planning.clarifier_options or fallback_options,
        )
        return replace(
            planning,
            assistant_message=message,
            clarifier_options=normalized_options,
        )

    def _build_resolver_hints(
        self,
        *,
        existing_hints: dict[str, Any] | None,
        user_message: str,
        planning: PlanningResult,
        edit_continuation_trigger: str | None,
        intent_family: str,
        staged_operations_version: int,
        rename_intent: tuple[str, str] | None,
    ) -> dict[str, Any] | None:
        hints: dict[str, Any] = dict(existing_hints or {})
        hints['intent_family'] = intent_family
        normalized_user_message = user_message.strip()
        if normalized_user_message:
            hints['last_user_message'] = normalized_user_message[:240]
        if edit_continuation_trigger:
            hints['last_trigger'] = edit_continuation_trigger
        prior_version = hints.get('intent_version')
        current_version = int(prior_version) if isinstance(prior_version, int) else 0
        invalidate_retry = edit_continuation_trigger in {'correction', 'cancel'}
        if invalidate_retry:
            current_version += 1
            hints = self._invalidate_retry_hints(hints)
        if rename_intent is not None:
            from_label, to_title = rename_intent
            hints['rename_from_label'] = from_label
            hints['rename_to_title'] = to_title
            if not invalidate_retry:
                hints['retry_autostage_eligible'] = True
        elif intent_family != 'rename_node':
            hints['retry_autostage_eligible'] = False
        if planning.clarifier_reason:
            hints['last_clarifier_reason'] = planning.clarifier_reason
        if planning.clarifier_options:
            hints['last_clarifier_options'] = list(planning.clarifier_options[:3])
        if planning.assistant_message:
            matched_ids = re.findall(
                r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                planning.assistant_message,
            )
            if matched_ids:
                hints['candidate_ids'] = matched_ids[:5]
        hints['intent_version'] = current_version
        hints['hint_intent_version'] = current_version
        hints['hint_staged_operations_version'] = staged_operations_version
        return hints or None

    def _summarize_tool_plan(
        self,
        tool_plan: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        if not isinstance(tool_plan, list):
            return []
        summary: list[dict[str, Any]] = []
        for item in tool_plan[:5]:
            if not isinstance(item, dict):
                continue
            tool_name = item.get('tool_name')
            args = item.get('args')
            arg_keys = sorted(args.keys())[:6] if isinstance(args, dict) else []
            summary.append(
                {
                    'tool_name': str(tool_name or ''),
                    'arg_keys': arg_keys,
                }
            )
        return summary

    def _attempt_retry_autostage(
        self,
        *,
        session: AgentSession,
        pending_context: PendingEditContext,
        trace_id: str | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        hints = pending_context.resolver_hints or {}
        if pending_context.intent_family != 'rename_node':
            blocked_reason = 'retry_autostage_unsupported_intent_family'
            blocked_intent_family = self._normalize_intent_family(pending_context.intent_family)
            pending_context.last_retry_blocked_reason = blocked_reason
            pending_context.last_retry_blocked_intent_family = blocked_intent_family
            pending_context.updated_at = _utcnow()
            self._set_pending_edit_context(
                session=session,
                context=pending_context,
                event='updated',
                trace_id=trace_id,
            )
            log_event(
                self._logger,
                'retry_autostage_unsupported_intent_family',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                blocked_reason=blocked_reason,
                blocked_intent_family=blocked_intent_family,
            )
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': blocked_reason,
                'blocked_intent_family': blocked_intent_family,
                'retry_autostage_applied': False,
            }
        if not isinstance(hints, dict):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
                'retry_autostage_applied': False,
            }
        hint_version = hints.get('hint_intent_version')
        current_version = hints.get('intent_version')
        if (
            not isinstance(hint_version, int)
            or not isinstance(current_version, int)
            or hint_version != current_version
        ):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
                'retry_autostage_applied': False,
            }
        if not bool(hints.get('retry_autostage_eligible')):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
                'retry_autostage_applied': False,
            }
        hint_staged_version = hints.get('hint_staged_operations_version')
        current_staged_version = self._get_current_staged_operations_version(session)
        if (
            not isinstance(hint_staged_version, int)
            or hint_staged_version != current_staged_version
        ):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
                'retry_autostage_applied': False,
            }

        from_label = str(hints.get('rename_from_label') or '').strip()
        to_title = str(hints.get('rename_to_title') or '').strip()
        if not from_label or not to_title:
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
                'retry_autostage_applied': False,
            }

        retry_resolution = self._resolve_retry_candidates(
            roadmap_id=session.roadmap_id,
            label=from_label,
            expected_node_type=(
                str(hints.get('expected_node_type')).strip()
                if isinstance(hints.get('expected_node_type'), str)
                else None
            ),
            auth_header=auth_header,
            trace_id=trace_id,
        )
        candidates = retry_resolution['matches']
        tool_calls_used = retry_resolution['tool_calls_used']
        if retry_resolution['budget_exhausted']:
            return {
                'planning': PlanningResult(
                    assistant_message=(
                        'I reached the retry lookup budget before resolving a safe single target. '
                        'Please choose one node by ID so I can continue.'
                    ),
                    operations=[],
                    parse_mode='deterministic_retry_clarifier_budget',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code='retry_discovery_budget_exhausted',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='retry_discovery_budget_exhausted',
                    clarifier_options=[
                        'Provide exact node ID',
                        'Refine target label',
                        'Cancel',
                    ],
                ),
                'tool_calls_used': tool_calls_used,
                'blocked_reason': None,
                'retry_autostage_applied': False,
            }
        pending_context.resolver_hints = {
            **hints,
            'last_label': from_label,
            'intent_family': pending_context.intent_family,
            'normalized_label': self._normalize_label(from_label),
            'candidate_ids': [item.get('id') for item in candidates if isinstance(item, dict)],
            'candidate_count': len(candidates),
            'hint_staged_operations_version': current_staged_version,
            'hint_intent_version': int(hints.get('intent_version') or 0),
        }
        pending_context.updated_at = _utcnow()
        self._set_pending_edit_context(
            session=session,
            context=pending_context,
            event='updated',
            trace_id=trace_id,
        )

        if len(candidates) == 1:
            candidate = candidates[0]
            node_id = str(candidate.get('id') or '').strip() if isinstance(candidate, dict) else ''
            expected_node_type = (
                str(hints.get('expected_node_type')).strip()
                if isinstance(hints.get('expected_node_type'), str)
                else None
            )
            if self._is_uuid(node_id) and self._passes_rename_autostage_gate(
                candidate=candidate if isinstance(candidate, dict) else {},
                from_label=from_label,
                expected_node_type=expected_node_type,
            ):
                return {
                    'planning': PlanningResult(
                    assistant_message=(
                        f'I found one strong match for "{from_label}" and staged the rename to "{to_title}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=node_id,
                            patch={'title': to_title},
                        )
                    ],
                    parse_mode='deterministic_retry_autostage',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
                    ),
                    'tool_calls_used': tool_calls_used,
                    'blocked_reason': None,
                    'retry_autostage_applied': True,
                }

        if len(candidates) > 1:
            options: list[str] = []
            for index, item in enumerate(candidates[:3], start=1):
                if not isinstance(item, dict):
                    continue
                title = str(item.get('title') or '').strip()
                node_type = str(item.get('type') or '').strip()
                node_id = str(item.get('id') or '').strip()
                if title and node_id:
                    options.append(f'{index}. {node_type} "{title}" ({node_id})')
            if options:
                return {
                    'planning': PlanningResult(
                    assistant_message=(
                        f'I found multiple matches for "{from_label}". '
                        'Reply with the option number to continue:\n' + '\n'.join(options)
                    ),
                    operations=[],
                    parse_mode='deterministic_retry_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code='retry_multiple_matches',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='retry_multiple_matches',
                    clarifier_options=options,
                    ),
                    'tool_calls_used': tool_calls_used,
                    'blocked_reason': None,
                    'retry_autostage_applied': False,
                }
        return {
            'planning': None,
            'tool_calls_used': tool_calls_used,
            'blocked_reason': None,
            'retry_autostage_applied': False,
        }

    def _resolve_retry_candidates(
        self,
        *,
        roadmap_id: str,
        label: str,
        expected_node_type: str | None,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        auth_value = auth_header if isinstance(auth_header, str) and auth_header else None
        variants: list[str] = []
        primary = label.strip()
        if primary:
            variants.append(primary)
        normalized = self._normalize_label(primary)
        if normalized and normalized not in variants:
            variants.append(normalized)
        fallback = self._fallback_label(normalized or primary)
        if fallback and fallback not in variants:
            variants.append(fallback)
        variants = variants[:3]

        all_matches: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        tool_calls_used = 0
        for query in variants:
            tool_calls_used += 1
            result = self._run_async_call(
                self._nest_client.context_search(
                    roadmap_id=roadmap_id,
                    query=query,
                    node_type=expected_node_type,
                    limit=20,
                    auth_header=auth_value,
                    trace_id=trace_id,
                )
            )
            matches = result.get('matches', [])
            if not isinstance(matches, list):
                continue
            for raw in matches:
                if not isinstance(raw, dict):
                    continue
                candidate_id = str(raw.get('id') or '').strip()
                if not candidate_id or candidate_id in seen_ids:
                    continue
                seen_ids.add(candidate_id)
                all_matches.append(raw)

        normalized_label = self._normalize_label(label)
        high_confidence = [
            item
            for item in all_matches
            if self._is_high_confidence_match(item, normalized_label)
        ]
        return {
            'matches': high_confidence or all_matches[:3],
            'tool_calls_used': tool_calls_used,
            'budget_exhausted': tool_calls_used >= 3 and len(all_matches) == 0,
        }

    def _normalize_label(self, value: str) -> str:
        lowered = value.strip().lower()
        if not lowered:
            return ''
        lowered = lowered.translate(str.maketrans('', '', string.punctuation.replace('-', '')))
        lowered = lowered.replace('-', ' ')
        lowered = re.sub(r'\s+', ' ', lowered).strip()
        return lowered

    def _fallback_label(self, value: str) -> str | None:
        tokens = [token for token in value.split(' ') if token]
        if len(tokens) <= 1:
            return None
        if len(tokens[-1]) >= 4:
            return tokens[-1]
        if len(tokens) >= 2 and len(tokens[-2]) >= 4:
            return tokens[-2]
        return None

    def _is_high_confidence_match(
        self,
        candidate: dict[str, Any],
        normalized_label: str,
    ) -> bool:
        title = str(candidate.get('title') or '').strip()
        if not title:
            return False
        candidate_norm = self._normalize_label(title)
        if candidate_norm == normalized_label:
            return True
        if normalized_label and normalized_label in candidate_norm:
            return True
        confidence = candidate.get('confidence')
        return isinstance(confidence, (int, float)) and float(confidence) >= 0.9

    def _normalize_intent_family(self, value: str | None) -> str:
        normalized = str(value or '').strip().lower()
        if not normalized:
            return 'roadmap_edit_clarifier'
        normalized = self._INTENT_FAMILY_ALIASES.get(normalized, normalized)
        if normalized not in self._CANONICAL_INTENT_FAMILIES:
            return 'roadmap_edit_clarifier'
        return normalized

    def _extract_rename_intent(self, user_message: str) -> tuple[str, str] | None:
        rename_match = re.search(
            r'rename\s+(?:my\s+)?["\']?(.+?)["\']?\s+to\s+["\']?(.+?)["\']?$',
            user_message.strip(),
            re.IGNORECASE,
        )
        if rename_match is None:
            return None
        from_label = rename_match.group(1).strip()
        to_title = rename_match.group(2).strip()
        if not from_label or not to_title:
            return None
        return from_label, to_title

    def _invalidate_retry_hints(self, hints: dict[str, Any] | None) -> dict[str, Any]:
        next_hints = dict(hints or {})
        next_hints.pop('candidate_ids', None)
        next_hints.pop('candidate_count', None)
        next_hints.pop('last_label', None)
        next_hints.pop('normalized_label', None)
        next_hints.pop('rename_from_label', None)
        next_hints.pop('rename_to_title', None)
        next_hints.pop('expected_node_type', None)
        next_hints['retry_autostage_eligible'] = False
        next_hints['hint_intent_version'] = None
        next_hints['hint_staged_operations_version'] = None
        return next_hints

    def _passes_rename_autostage_gate(
        self,
        *,
        candidate: dict[str, Any],
        from_label: str,
        expected_node_type: str | None,
    ) -> bool:
        if expected_node_type:
            candidate_type = str(candidate.get('type') or '').strip().lower()
            if candidate_type != expected_node_type.lower():
                return False
        normalized_label = self._normalize_label(from_label)
        title = str(candidate.get('title') or '').strip()
        candidate_norm = self._normalize_label(title)
        if candidate_norm == normalized_label:
            return True
        confidence = candidate.get('confidence')
        return isinstance(confidence, (int, float)) and float(confidence) >= 0.9

    def _ensure_actor_context(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        if not auth_header:
            self._clear_actor_context_for_missing_auth(
                session=session,
                trace_id=trace_id,
            )
            return

        actor_refresh_failures_key = getattr(
            self,
            '_actor_refresh_failures_key',
            'actor_context_refresh_failures',
        )
        previous_actor_context = session.metadata.actor_context
        try:
            actor_payload = self._run_async_call(
                self._nest_client.context_actor(
                    roadmap_id=session.roadmap_id,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )
            )
            session.metadata.actor_context = ActorContext.model_validate(
                {
                    **actor_payload,
                    'actor_context_source': 'backend_context_actor',
                }
            )
            setattr(session.metadata, actor_refresh_failures_key, 0)
        except HTTPException as exc:
            refresh_failures = int(
                getattr(session.metadata, actor_refresh_failures_key, 0) or 0
            ) + 1
            setattr(session.metadata, actor_refresh_failures_key, refresh_failures)
            keep_previous = (
                previous_actor_context is not None
                and previous_actor_context.actor_context_source == 'backend_context_actor'
                and refresh_failures <= 1
            )
            if not keep_previous:
                session.metadata.actor_context = None
            log_event(
                self._logger,
                'actor_context_refresh_failed',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                status_code=exc.status_code,
                error='http_exception',
                keep_previous=keep_previous,
                refresh_failures=refresh_failures,
            )
            return
        except Exception:  # pragma: no cover
            refresh_failures = int(
                getattr(session.metadata, actor_refresh_failures_key, 0) or 0
            ) + 1
            setattr(session.metadata, actor_refresh_failures_key, refresh_failures)
            keep_previous = (
                previous_actor_context is not None
                and previous_actor_context.actor_context_source == 'backend_context_actor'
                and refresh_failures <= 1
            )
            if not keep_previous:
                session.metadata.actor_context = None
            log_event(
                self._logger,
                'actor_context_refresh_failed',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                error='unexpected_exception',
                keep_previous=keep_previous,
                refresh_failures=refresh_failures,
            )
            return

        log_event(
            self._logger,
            'actor_context_loaded',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            actor_present=True,
            roadmap_role=session.metadata.actor_context.roadmap_role,
            actor_context_source=session.metadata.actor_context.actor_context_source,
        )

    def _clear_actor_context_for_missing_auth(
        self,
        *,
        session: AgentSession,
        trace_id: str | None,
    ) -> None:
        actor_refresh_failures_key = getattr(
            self,
            '_actor_refresh_failures_key',
            'actor_context_refresh_failures',
        )
        if session.metadata.actor_context is not None:
            session.metadata.actor_context = None
            log_event(
                self._logger,
                'actor_context_cleared',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                reason='missing_auth_header',
            )
        setattr(session.metadata, actor_refresh_failures_key, 0)

    def _run_async_call(self, coro: Any) -> dict[str, Any]:
        if not asyncio.iscoroutine(coro):
            return coro
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        timeout_seconds = max(float(self._settings.nest_timeout_seconds), 0.1)
        queue: Queue[tuple[str, Any]] = Queue(maxsize=1)

        def _bridge_runner() -> None:
            try:
                queue.put(('result', asyncio.run(coro)))
            except Exception as exc:  # pragma: no cover
                queue.put(('error', exc))

        bridge_thread = threading.Thread(
            target=_bridge_runner,
            name='agent-async-bridge',
            daemon=True,
        )
        bridge_thread.start()
        bridge_thread.join(timeout=timeout_seconds)

        if bridge_thread.is_alive():
            log_event(
                self._logger,
                'async_bridge_fallback',
                settings=self._settings,
                level=logging.WARNING,
                status='timeout',
                timeout_seconds=timeout_seconds,
            )
            raise self._async_bridge_unavailable_error(reason='timeout')

        try:
            outcome_type, payload = queue.get_nowait()
        except Empty:
            log_event(
                self._logger,
                'async_bridge_fallback',
                settings=self._settings,
                level=logging.WARNING,
                status='missing_result',
            )
            raise self._async_bridge_unavailable_error(reason='missing_result')

        if outcome_type == 'error':
            log_event(
                self._logger,
                'async_bridge_fallback',
                settings=self._settings,
                level=logging.WARNING,
                status='error',
                error_type=type(payload).__name__,
            )
            if isinstance(payload, HTTPException):
                raise payload
            raise self._async_bridge_unavailable_error(reason='error')

        log_event(
            self._logger,
            'async_bridge_fallback',
            settings=self._settings,
            status='success',
        )
        return payload

    def _async_bridge_unavailable_error(self, *, reason: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                'code': 'ASYNC_BRIDGE_UNAVAILABLE',
                'message': (
                    'Agent async bridge is temporarily unavailable. '
                    'Please retry the request.'
                ),
                'reason': reason,
                'retryable': True,
            },
        )

    def ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return self._ensure_draft_graph_initialized(session)

    def get_active_draft(self, session: AgentSession) -> DraftNode:
        return self._get_active_draft(session)

    def _ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        initialization_applied = False
        drafts = session.metadata.drafts

        if not drafts:
            if session.operations or int(session.staged_operations_version or 0) > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        'code': 'LEGACY_SESSION_UNSUPPORTED',
                        'message': (
                            'This session uses legacy staged operations and is not compatible with '
                            'draft-graph-only mode. Please create a new session.'
                        ),
                    },
                )
            root_draft = DraftNode(
                draft_id=f'{session.session_id}:root',
                parent_draft_id=None,
                draft_mode='append',
                operations=[],
                draft_version=0,
                base_revision=session.base_revision,
                revision_token=session.revision_token,
                summary='Initial root draft',
                status='active',
            )
            session.metadata.drafts[root_draft.draft_id] = root_draft
            session.metadata.active_draft_id = root_draft.draft_id
            session.metadata.draft_head_ids = [root_draft.draft_id]
            initialization_applied = True

        active_draft_id = session.metadata.active_draft_id
        if not active_draft_id or active_draft_id not in session.metadata.drafts:
            first_draft_id = next(iter(session.metadata.drafts), None)
            if first_draft_id is None:
                raise RuntimeError('Draft graph initialization failed because no drafts are available.')
            session.metadata.active_draft_id = first_draft_id
            if first_draft_id not in session.metadata.draft_head_ids:
                session.metadata.draft_head_ids.append(first_draft_id)
            initialization_applied = True

        return initialization_applied

    def _get_active_draft(self, session: AgentSession) -> DraftNode:
        active_draft_id = session.metadata.active_draft_id
        if not active_draft_id:
            raise RuntimeError('Active draft is not initialized.')
        draft = self._get_active_draft_if_available(session)
        if draft is None:
            raise RuntimeError(f'Active draft {active_draft_id} is missing from draft graph.')
        return draft

    def _get_active_draft_if_available(self, session: AgentSession) -> DraftNode | None:
        active_draft_id = session.metadata.active_draft_id
        if not isinstance(active_draft_id, str) or not active_draft_id:
            return None

        candidate = session.metadata.drafts.get(active_draft_id)
        if isinstance(candidate, DraftNode):
            return candidate
        if isinstance(candidate, dict):
            try:
                normalized_draft = DraftNode.model_validate(candidate)
            except Exception:
                return None
            session.metadata.drafts[active_draft_id] = normalized_draft
            return normalized_draft
        return None

    def _resolve_staged_state(
        self,
        session: AgentSession,
        *,
        draft_graph_enabled: bool | None = None,
        active_draft: DraftNode | None = None,
    ) -> tuple[list[RoadmapOperation], int]:
        use_draft_graph = (
            self._settings.agent_draft_graph_enabled
            if draft_graph_enabled is None
            else draft_graph_enabled
        )
        if use_draft_graph:
            resolved_draft = active_draft or self._get_active_draft_if_available(session)
            if isinstance(resolved_draft, DraftNode):
                return resolved_draft.operations, int(resolved_draft.draft_version)
        return session.operations, int(session.staged_operations_version)

    def _get_current_staged_operations(self, session: AgentSession) -> list[RoadmapOperation]:
        staged_operations, _ = self._resolve_staged_state(session)
        return staged_operations

    def _get_current_staged_operations_version(self, session: AgentSession) -> int:
        _, staged_operations_version = self._resolve_staged_state(session)
        return staged_operations_version

    def _build_session_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict:
        active_draft = self._get_active_draft_if_available(session)
        staged_operations_count = (
            len(active_draft.operations)
            if isinstance(active_draft, DraftNode)
            else len(session.operations)
        )
        recent_messages = [
            {'role': item.role, 'content': item.content}
            for item in session.messages[-self._settings.max_chat_history_messages :]
        ]
        recent_resolved_targets = [
            target.model_dump(mode='json', exclude_none=True)
            for target in self._get_recent_resolved_targets(session)
        ]
        return {
            'roadmap_id': session.roadmap_id,
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'staged_operations_count': staged_operations_count,
            'active_draft_id': session.metadata.active_draft_id,
            'active_draft_version': (
                active_draft.draft_version if active_draft is not None else None
            ),
            'active_draft_mode': (
                active_draft.draft_mode if active_draft is not None else None
            ),
            'last_intent_type': session.last_intent_type,
            'recent_messages': recent_messages,
            'recent_resolved_targets': recent_resolved_targets,
            'auth_header': auth_header,
            'trace_id': trace_id,
            'actor_context': (
                session.metadata.actor_context.model_dump(mode='json', exclude_none=True)
                if session.metadata.actor_context is not None
                else None
            ),
            'actor_present': session.metadata.actor_context is not None,
            'roadmap_role': (
                session.metadata.actor_context.roadmap_role
                if session.metadata.actor_context is not None
                else None
            ),
            'actor_context_source': (
                session.metadata.actor_context.actor_context_source
                if session.metadata.actor_context is not None
                else None
            ),
            'pending_context_resolution': (
                session.metadata.pending_context_resolution.model_dump(
                    mode='json',
                    exclude_none=True,
                )
                if session.metadata.pending_context_resolution is not None
                else None
            ),
            'pending_edit_context': (
                session.metadata.pending_edit_context.model_dump(
                    mode='json',
                    exclude_none=True,
                )
                if session.metadata.pending_edit_context is not None
                else None
            ),
        }
