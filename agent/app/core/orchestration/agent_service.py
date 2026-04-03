from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
import logging
from datetime import datetime
from time import perf_counter
from typing import Any
import re

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    ActorContext,
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


class AgentService:
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
        session_context = self._build_session_context(session, auth_header, trace_id)

        pending_edit_context_present = session.metadata.pending_edit_context is not None
        edit_continuation_trigger = self._detect_edit_continuation_trigger(user_message)
        has_staged_operations = bool(session.operations)
        pending_continuation_requested = pending_edit_context_present and (
            edit_continuation_trigger in {'confirm', 'cancel', 'correction'}
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

        planning: PlanningResult
        route_lane: str | None = None
        fastpath_reason: str | None = None
        fastpath_bypass_reason: str | None = None
        force_replace_operations = False
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

        pending_context = session.metadata.pending_edit_context
        if (
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
        elif preview_intent == 'roadmap_edit':
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
        else:
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
            (pending_edit_context_present or has_staged_operations)
            and edit_continuation_trigger == 'correction'
            and planning.response_mode == 'edit_plan'
            and planning.operations
        ):
            force_replace_operations = True

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
        deterministic_create_fastpath_skipped = False
        if self._settings.agent_llm_first_edit_enabled:
            fastpath_reason = None
            fastpath_bypass_reason = None

        self._store.append_message(session, 'user', user_message)

        if planning.response_mode == 'edit_plan':
            if replace or force_replace_operations:
                session.operations = operations
            else:
                session.operations.extend(operations)
            if operations:
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

        log_event(
            self._logger,
            'session_staged_state',
            settings=self._settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            staged_operations_count=len(session.operations),
            staged_operations_version=session.staged_operations_version,
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
            deterministic_create_fastpath_skipped=deterministic_create_fastpath_skipped,
            edit_guard_intervened=edit_guard_intervened,
            phase_timings=phase_timings,
        )

        return MessagePlanningOutcome(
            session=session,
            assistant_message=planning.assistant_message,
            parse_mode=planning.parse_mode,
            intent_type=planning.intent_type,
            response_mode=planning.response_mode,
            operations=operations if planning.response_mode == 'edit_plan' else [],
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
            deterministic_create_fastpath_skipped=deterministic_create_fastpath_skipped,
            edit_guard_intervened=edit_guard_intervened,
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
        if re.search(r'\b(i meant|instead|inside|under|in that|it should)\b', normalized):
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

    def _build_session_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict:
        recent_messages = [
            {'role': item.role, 'content': item.content}
            for item in session.messages[-self._settings.max_chat_history_messages :]
        ]
        return {
            'roadmap_id': session.roadmap_id,
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'staged_operations_count': len(session.operations),
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
