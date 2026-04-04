from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
import logging
import json
from datetime import datetime
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
)
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.client import LLMPlanner, PlanningResult
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
    fastpath_reason: str | None = None
    fastpath_bypass_reason: str | None = None
    phase_timings: dict[str, Any] = field(default_factory=dict)
    invalid_operation_detected: bool = False
    invalid_operation_reason: str | None = None
    invalid_operation_index: int | None = None
    llm_skipped_for_simple_edit: bool = False
    actor_fetch_attempted: bool = False
    actor_fetch_skipped_reason: str | None = None
    actor_fetch_ms: int | None = None
    planner_mode: str | None = None
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

        pending_edit_context_present = session.metadata.pending_edit_context is not None
        edit_continuation_trigger = self._detect_edit_continuation_trigger(user_message)
        has_staged_operations = bool(active_draft.operations) if active_draft is not None else bool(session.operations)
        pending_continuation_requested = pending_edit_context_present and (
            edit_continuation_trigger in {'confirm', 'cancel', 'correction', 'retry'}
        )
        staged_operation_continuation = (
            edit_continuation_trigger is not None and has_staged_operations
        )
        should_force_edit_preview = (
            pending_continuation_requested or staged_operation_continuation
        )
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

        planning: PlanningResult
        route_lane: str | None = None
        fastpath_reason: str | None = None
        fastpath_bypass_reason: str | None = None
        llm_skipped_for_simple_edit = False
        invalid_operation_detected = False
        invalid_operation_reason: str | None = None
        invalid_operation_index: int | None = None
        planner_mode = (
            self._settings.agent_edit_planner_mode
            if self._settings.agent_llm_first_edit_enabled
            else 'legacy_tool_calling'
        )
        edit_guard_intervened = False
        retry_tool_calls_used: int | None = None
        retry_duplicate_operation_deduped = False
        retry_autostage_applied = False

        pending_context = session.metadata.pending_edit_context
        if pending_context is not None:
            pending_context.intent_family = self._normalize_intent_family(
                pending_context.intent_family
            )
        if pending_context is not None and edit_continuation_trigger == 'retry':
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
                    provider_error_code=str(retry_result.get('blocked_reason')),
                    clarifier_action='ask_clarifier',
                    clarifier_reason=str(retry_result.get('blocked_reason')),
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
            )
            phase_timings['provider_planning_ms'] = 0
            route_lane = 'llm_edit_plan'
            llm_skipped_for_simple_edit = True
        elif planning is None and preview_intent == 'roadmap_edit':
            planner_started = perf_counter()
            planning = self._planner.plan(
                user_message=user_message,
                existing_operations=session.operations,
                session_context=session_context,
            )
            phase_timings['provider_planning_ms'] = int(
                (perf_counter() - planner_started) * 1000
            )
            route_lane = 'llm_edit_plan'
        elif planning is None:
            planner_started = perf_counter()
            planning = self._planner.plan(
                user_message=user_message,
                existing_operations=session.operations,
                session_context=session_context,
            )
            phase_timings['provider_planning_ms'] = int(
                (perf_counter() - planner_started) * 1000
            )
            route_lane = 'llm_edit_plan' if planning.response_mode == 'edit_plan' else 'chat'

        planning = self._apply_context_answer_output_guard(
            planning=planning,
            pending_edit_context_present=session.metadata.pending_edit_context is not None,
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
                fastpath_bypass_reason=planning.fastpath_bypass_reason,
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
                fastpath_bypass_reason=planning.fastpath_bypass_reason,
                clarifier_action='ask_clarifier',
                clarifier_reason='edit_narrative_without_operations',
                clarifier_options=['Use the matched node ID', 'Refine the node label', 'Cancel'],
            )
            edit_guard_intervened = True
        if (
            self._settings.agent_hybrid_react_enabled
            and planning.response_mode == 'edit_plan'
            and planning.draft_action not in {'continue', 'revise', 'new_draft'}
        ):
            planning = PlanningResult(
                assistant_message=(
                    'I need one more confirmation before staging edits because draft intent metadata '
                    'was incomplete. Please restate whether this should continue, revise, or start a new draft.'
                ),
                operations=[],
                parse_mode='deterministic_planner_schema_handoff',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=True,
                provider_error_code='planner_schema_missing_draft_action',
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
                route_lane=route_lane,
                fastpath_bypass_reason=planning.fastpath_bypass_reason,
                clarifier_action='ask_clarifier',
                clarifier_reason='planner_schema_missing_draft_action',
                clarifier_options=['Continue current draft', 'Revise current draft', 'Start new draft'],
            )
            edit_guard_intervened = True
        if planning.response_mode == 'edit_plan' and planning.needs_more_info:
            planning = PlanningResult(
                assistant_message=(
                    'I could not safely stage edits yet because required context is still missing. '
                    'Please answer the clarification so I can continue.'
                ),
                operations=[],
                parse_mode='deterministic_planner_needs_more_info_handoff',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=True,
                provider_error_code='planner_needs_more_info_conflict',
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
                route_lane=route_lane,
                fastpath_bypass_reason=planning.fastpath_bypass_reason,
                clarifier_action='ask_clarifier',
                clarifier_reason='planner_needs_more_info_conflict',
                clarifier_options=['Provide target details', 'Provide node ID', 'Cancel'],
            )
            edit_guard_intervened = True
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

        validation_error = self._validate_operation_contract(planning.operations)
        if validation_error is not None:
            invalid_operation_detected = True
            invalid_operation_reason = validation_error['reason']
            invalid_operation_index = validation_error['index']
            guidance = self._operation_validation_guidance(invalid_operation_reason)
            planning = PlanningResult(
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
                fastpath_bypass_reason=fastpath_bypass_reason,
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
            user_message=user_message,
            edit_continuation_trigger=edit_continuation_trigger,
            trace_id=trace_id,
        )

        planner_schema_invalid_attempts = planning.planner_schema_invalid_attempts
        planner_repair_attempted = planning.planner_repair_attempted
        draft_action = planning.draft_action
        needs_more_info = planning.needs_more_info
        stop_reason = planning.stop_reason
        tool_plan_steps = len(planning.tool_plan or []) if planning.tool_plan is not None else 0
        deterministic_create_fastpath_skipped = False
        if self._settings.agent_llm_first_edit_enabled:
            fastpath_reason = None
            fastpath_bypass_reason = None

        self._store.append_message(session, 'user', user_message)

        applied_operations: list[RoadmapOperation] = []
        staged_changed = False
        should_replace_operations = replace or planning.draft_action == 'revise'
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
                active_draft.updated_at = datetime.utcnow()
                if staged_changed:
                    active_draft.draft_version += 1
                self._mirror_active_draft_to_legacy_fields(session)
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

        if planning.clear_pending_context_resolution:
            session.metadata.pending_context_resolution = None
        if planning.pending_context_resolution is not None:
            session.metadata.pending_context_resolution = PendingContextResolution.model_validate(
                planning.pending_context_resolution
            )

        session.last_intent_type = planning.intent_type
        self._store.append_message(session, 'assistant', planning.assistant_message)
        self._store.update(session)

        preview_available = len(session.operations) > 0
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
            staged_operations_count=len(session.operations),
            staged_operations_version=session.staged_operations_version,
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
            fastpath_reason=fastpath_reason,
            fastpath_bypass_reason=fastpath_bypass_reason,
            invalid_operation_detected=invalid_operation_detected,
            invalid_operation_reason=invalid_operation_reason,
            invalid_operation_index=invalid_operation_index,
            llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
            actor_fetch_attempted=actor_fetch_attempted,
            actor_fetch_skipped_reason=actor_fetch_skipped_reason,
            actor_fetch_ms=actor_fetch_ms,
            planner_mode=planner_mode,
            pending_edit_context_present=session.metadata.pending_edit_context is not None,
            edit_continuation_trigger=edit_continuation_trigger,
            planner_schema_invalid_attempts=planner_schema_invalid_attempts,
            planner_repair_attempted=planner_repair_attempted,
            draft_action=draft_action,
            needs_more_info=needs_more_info,
            stop_reason=stop_reason,
            tool_plan_steps=tool_plan_steps,
            deterministic_create_fastpath_skipped=deterministic_create_fastpath_skipped,
            edit_guard_intervened=edit_guard_intervened,
            retry_tool_calls_used=retry_tool_calls_used,
            retry_duplicate_operation_deduped=retry_duplicate_operation_deduped,
            retry_autostage_applied=retry_autostage_applied,
            phase_timings=phase_timings,
        )

        return MessagePlanningOutcome(
            session=session,
            assistant_message=planning.assistant_message,
            parse_mode=planning.parse_mode,
            intent_type=planning.intent_type,
            response_mode=planning.response_mode,
            operations=applied_operations if planning.response_mode == 'edit_plan' else [],
            preview_available=preview_available,
            preview_recommended=preview_recommended,
            staged_operations_version=session.staged_operations_version,
            staged_operations_count=len(session.operations),
            provider_used=planning.provider_used,
            fallback_used=planning.fallback_used,
            provider_error_code=planning.provider_error_code,
            tokens_input=planning.tokens_input,
            tokens_output=planning.tokens_output,
            tokens_total=planning.tokens_total,
            route_lane=route_lane,
            fastpath_reason=fastpath_reason,
            fastpath_bypass_reason=fastpath_bypass_reason,
            phase_timings=phase_timings,
            invalid_operation_detected=invalid_operation_detected,
            invalid_operation_reason=invalid_operation_reason,
            invalid_operation_index=invalid_operation_index,
            llm_skipped_for_simple_edit=llm_skipped_for_simple_edit,
            actor_fetch_attempted=actor_fetch_attempted,
            actor_fetch_skipped_reason=actor_fetch_skipped_reason,
            actor_fetch_ms=actor_fetch_ms,
            planner_mode=planner_mode,
            pending_edit_context_present=session.metadata.pending_edit_context is not None,
            edit_continuation_trigger=edit_continuation_trigger,
            planner_schema_invalid_attempts=planner_schema_invalid_attempts,
            planner_repair_attempted=planner_repair_attempted,
            draft_action=draft_action,
            needs_more_info=needs_more_info,
            stop_reason=stop_reason,
            tool_plan_steps=tool_plan_steps,
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
        return json.dumps(
            operation.model_dump(exclude_none=True),
            sort_keys=True,
            separators=(',', ':'),
        )

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

    def _infer_last_staged_create_title(self, session: AgentSession) -> str | None:
        for operation in reversed(session.operations):
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
        trace_id: str | None,
    ) -> None:
        existing_context = session.metadata.pending_edit_context
        if edit_continuation_trigger == 'correction' and existing_context is not None:
            invalidated_hints = self._invalidate_retry_hints(
                existing_context.resolver_hints
            )
            existing_context.resolver_hints = invalidated_hints
            existing_context.updated_at = datetime.utcnow()
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
                staged_operations_version=session.staged_operations_version,
                rename_intent=rename_intent,
            ),
            created_at=(existing.created_at if existing is not None else datetime.utcnow()),
            updated_at=datetime.utcnow(),
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
            fastpath_bypass_reason=planning.fastpath_bypass_reason,
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
        if preview_intent == 'roadmap_edit' and simple_edit_detected:
            return False, 'simple_edit_turn'
        if self._is_actor_context_required_message(user_message):
            return True, None
        if actor_context_present:
            return False, 'not_required_cached'
        return False, 'not_required_for_turn'

    def _is_actor_context_required_message(self, user_message: str) -> bool:
        lowered = user_message.lower()
        actor_required_patterns = (
            r'\bmy\s+tasks\b',
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
            hints['retry_autostage_eligible'] = False
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
            return {'planning': None, 'tool_calls_used': 0, 'blocked_reason': None}
        if not isinstance(hints, dict):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
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
            }
        if not bool(hints.get('retry_autostage_eligible')):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
            }
        hint_staged_version = hints.get('hint_staged_operations_version')
        if (
            not isinstance(hint_staged_version, int)
            or hint_staged_version != session.staged_operations_version
        ):
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
            }

        from_label = str(hints.get('rename_from_label') or '').strip()
        to_title = str(hints.get('rename_to_title') or '').strip()
        if not from_label or not to_title:
            return {
                'planning': None,
                'tool_calls_used': 0,
                'blocked_reason': 'retry_stale_hints_blocked',
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
            }
        pending_context.resolver_hints = {
            **hints,
            'last_label': from_label,
            'intent_family': pending_context.intent_family,
            'normalized_label': self._normalize_label(from_label),
            'candidate_ids': [item.get('id') for item in candidates if isinstance(item, dict)],
            'candidate_count': len(candidates),
            'hint_staged_operations_version': session.staged_operations_version,
            'hint_intent_version': int(hints.get('intent_version') or 0),
        }
        pending_context.updated_at = datetime.utcnow()
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
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)
        raise RuntimeError('Async call attempted on running event loop thread')

    def ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return self._ensure_draft_graph_initialized(session)

    def get_active_draft(self, session: AgentSession) -> DraftNode:
        return self._get_active_draft(session)

    def mirror_active_draft_to_legacy_fields(self, session: AgentSession) -> None:
        self._mirror_active_draft_to_legacy_fields(session)

    def _ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        migration_applied = False
        drafts = session.metadata.drafts

        if not drafts:
            root_draft = self._build_root_draft_from_legacy_operations(session)
            session.metadata.drafts[root_draft.draft_id] = root_draft
            session.metadata.active_draft_id = root_draft.draft_id
            session.metadata.draft_head_ids = [root_draft.draft_id]
            migration_applied = True

        active_draft_id = session.metadata.active_draft_id
        if not active_draft_id or active_draft_id not in session.metadata.drafts:
            first_draft_id = next(iter(session.metadata.drafts), None)
            if first_draft_id is None:
                root_draft = self._build_root_draft_from_legacy_operations(session)
                session.metadata.drafts[root_draft.draft_id] = root_draft
                first_draft_id = root_draft.draft_id
            session.metadata.active_draft_id = first_draft_id
            if first_draft_id not in session.metadata.draft_head_ids:
                session.metadata.draft_head_ids.append(first_draft_id)
            migration_applied = True

        active_draft = self._get_active_draft(session)
        if not active_draft.operations and session.operations:
            active_draft.operations = [
                operation.model_copy(deep=True) for operation in session.operations
            ]
            active_draft.draft_version = max(
                active_draft.draft_version,
                session.staged_operations_version,
            )
            active_draft.updated_at = datetime.utcnow()
            migration_applied = True

        self._mirror_active_draft_to_legacy_fields(session)
        return migration_applied

    def _build_root_draft_from_legacy_operations(self, session: AgentSession) -> DraftNode:
        root_draft_id = f'{session.session_id}:root'
        return DraftNode(
            draft_id=root_draft_id,
            parent_draft_id=None,
            draft_mode='append',
            operations=[operation.model_copy(deep=True) for operation in session.operations],
            draft_version=max(0, session.staged_operations_version),
            base_revision=session.base_revision,
            revision_token=session.revision_token,
            summary='Legacy staged operations root draft',
            status='active',
        )

    def _get_active_draft(self, session: AgentSession) -> DraftNode:
        active_draft_id = session.metadata.active_draft_id
        if not active_draft_id:
            raise RuntimeError('Active draft is not initialized.')
        draft = session.metadata.drafts.get(active_draft_id)
        if draft is None:
            raise RuntimeError(f'Active draft {active_draft_id} is missing from draft graph.')
        return draft

    def _mirror_active_draft_to_legacy_fields(self, session: AgentSession) -> None:
        active_draft = self._get_active_draft(session)
        session.operations = [
            operation.model_copy(deep=True) for operation in active_draft.operations
        ]
        session.staged_operations_version = active_draft.draft_version

    def _build_session_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict:
        active_draft = None
        if session.metadata.active_draft_id:
            active_draft = session.metadata.drafts.get(session.metadata.active_draft_id)
        recent_messages = [
            {'role': item.role, 'content': item.content}
            for item in session.messages[-self._settings.max_chat_history_messages :]
        ]
        return {
            'roadmap_id': session.roadmap_id,
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'staged_operations_count': len(session.operations),
            'active_draft_id': session.metadata.active_draft_id,
            'active_draft_version': (
                active_draft.draft_version if active_draft is not None else None
            ),
            'active_draft_mode': (
                active_draft.draft_mode if active_draft is not None else None
            ),
            'last_intent_type': session.last_intent_type,
            'recent_messages': recent_messages,
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
