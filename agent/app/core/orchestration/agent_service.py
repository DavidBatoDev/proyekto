from __future__ import annotations

from dataclasses import replace
import logging
from datetime import datetime, timezone
from typing import Any
import re

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    DraftNode,
    PendingEditContext,
    RecentResolvedTarget,
)
from app.core.contracts.sessions import AgentSession, IntentType
from app.core.llm.client import LLMPlanner, PlanningResult
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.context.actor_context_provider import (
    clear_actor_context_for_missing_auth as clear_actor_context_for_missing_auth_helper,
    ensure_actor_context as ensure_actor_context_helper,
    should_fetch_actor_context as should_fetch_actor_context_helper,
)
from app.core.orchestration.shared.async_bridge import run_async_call
from app.core.orchestration.shared.common_text import (
    detect_edit_continuation_trigger,
    extract_mixed_edit_primary_message,
    extract_mixed_query_followup_message,
    extract_rename_intent,
    fallback_label,
    is_rename_message,
    normalize_intent_family,
    normalize_label,
    normalize_label_for_matching,
    strip_quotes_and_punctuation,
)
from app.core.orchestration.edits.draft_graph_manager import (
    ensure_draft_graph_initialized as ensure_draft_graph_initialized_helper,
    get_active_draft as get_active_draft_helper,
    get_active_draft_if_available as get_active_draft_if_available_helper,
    resolve_staged_state as resolve_staged_state_helper,
)
from app.core.orchestration.context.deictic_resolver import (
    build_deictic_ambiguity_planning as build_deictic_ambiguity_planning_helper,
    infer_required_parent_node_type as infer_required_parent_node_type_helper,
    looks_like_deictic_parent_reference as looks_like_deictic_parent_reference_helper,
    resolve_deictic_parent_reference as resolve_deictic_parent_reference_helper,
)
from app.core.orchestration.edits.edit_resolver import (
    extract_create_intent,
)
from app.core.orchestration.shared.operation_contracts import (
    apply_operation_contract_guard,
    operation_signature,
    read_operation_title,
    should_replace_staged_operations,
    validate_operation_contract,
)
from app.core.orchestration.shared.outcomes import EditReactLoopOutcome, MessagePlanningOutcome
from app.core.orchestration.context.pending_edit_context_manager import (
    build_resolver_hints as build_resolver_hints_helper,
    infer_last_staged_create_title as infer_last_staged_create_title_helper,
    invalidate_retry_hints as invalidate_retry_hints_helper,
    set_pending_edit_context as set_pending_edit_context_helper,
    sync_pending_edit_context as sync_pending_edit_context_helper,
)
from app.core.orchestration.planning_orchestrator import (
    plan_message as plan_message_orchestrator,
)
from app.core.orchestration.edits.rename_shape_recovery import (
    has_rename_shape_operation,
    recover_rename_shape_operations,
)
from app.core.orchestration.react.react_guardrails import (
    apply_context_answer_output_guard as apply_context_answer_output_guard_helper,
    build_react_guard_handoff as build_react_guard_handoff_helper,
    derive_react_terminal_action as derive_react_terminal_action_helper,
    enforce_hybrid_react_terminal_guard as enforce_hybrid_react_terminal_guard_helper,
    looks_like_found_node_without_operations as looks_like_found_node_without_operations_helper,
    normalize_planning_clarifier_contract as normalize_planning_clarifier_contract_helper,
    run_edit_react_loop as run_edit_react_loop_helper,
)
from app.core.orchestration.react.react_planning_loop import (
    run_edit_react_planning_loop as run_edit_react_planning_loop_helper,
)
from app.core.orchestration.context.recent_targets_manager import (
    append_recent_resolved_target as append_recent_resolved_target_helper,
    get_recent_resolved_targets as get_recent_resolved_targets_helper,
    is_recent_target_fresh as is_recent_target_fresh_helper,
    normalize_recent_target_node_type as normalize_recent_target_node_type_helper,
    prune_recent_resolved_targets as prune_recent_resolved_targets_helper,
    recent_target_rank as recent_target_rank_helper,
    record_recent_targets_from_observation_summary as record_recent_targets_from_observation_summary_helper,
    record_recent_targets_from_operations as record_recent_targets_from_operations_helper,
    record_recent_targets_from_preview as record_recent_targets_from_preview_helper,
)
from app.core.uuid_utils import is_uuid_like
from app.core.orchestration.edits.retry_autostage_handler import (
    attempt_retry_autostage as attempt_retry_autostage_helper,
    is_high_confidence_match as is_high_confidence_match_helper,
    passes_rename_autostage_gate as passes_rename_autostage_gate_helper,
    resolve_retry_candidates as resolve_retry_candidates_helper,
)
from app.core.orchestration.context.session_context_builder import (
    build_session_context as build_session_context_helper,
)
from app.core.orchestration.context.session_runtime_access import (
    get_current_staged_operations as get_current_staged_operations_helper,
    get_current_staged_operations_version as get_current_staged_operations_version_helper,
    get_session_or_404 as get_session_or_404_helper,
    resolve_session_staged_state as resolve_session_staged_state_helper,
)
from app.core.orchestration.shared.mixed_query_handler import (
    compose_mixed_query_assistant_message as compose_mixed_query_assistant_message_helper,
    is_mixed_query_followup_clarifier as is_mixed_query_followup_clarifier_helper,
    mixed_query_warning_text as mixed_query_warning_text_helper,
    run_mixed_query_followup as run_mixed_query_followup_helper,
)
from app.core.session_store import SessionStore


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgentService:
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

    # ------------------------------------------------------------------
    # Public Entrypoints
    # ------------------------------------------------------------------
    def get_session_or_404(self, session_id: str) -> AgentSession:
        return get_session_or_404_helper(
            store=self._store,
            session_id=session_id,
        )

    def plan_message(
        self,
        session: AgentSession,
        user_message: str,
        replace: bool,
        auth_header: str | None = None,
        trace_id: str | None = None,
    ) -> MessagePlanningOutcome:
        return plan_message_orchestrator(
            service=self,
            session=session,
            user_message=user_message,
            replace=replace,
            auth_header=auth_header,
            trace_id=trace_id,
            utcnow=_utcnow,
        )

    # ------------------------------------------------------------------
    # Operation Contract Helpers
    # ------------------------------------------------------------------
    def _operation_signature(self, operation: RoadmapOperation) -> str:
        return operation_signature(
            operation,
            order_insensitive_signature_fields=self._ORDER_INSENSITIVE_SIGNATURE_FIELDS,
        )

    def _should_replace_staged_operations(
        self,
        *,
        planning: PlanningResult,
    ) -> bool:
        return should_replace_staged_operations(planning=planning)

    def _validate_operation_contract(
        self,
        operations: list[RoadmapOperation],
    ) -> dict[str, Any] | None:
        return validate_operation_contract(
            operations,
            is_uuid=self._is_uuid,
        )

    def _read_operation_title(self, operation: RoadmapOperation) -> str | None:
        return read_operation_title(operation)

    def _is_uuid(self, value: str | None) -> bool:
        return is_uuid_like(value)

    def _apply_operation_contract_guard(
        self,
        *,
        planning: PlanningResult,
        route_lane: str | None,
    ) -> tuple[PlanningResult, dict[str, Any] | None]:
        return apply_operation_contract_guard(
            planning=planning,
            route_lane=route_lane,
            is_uuid=self._is_uuid,
        )

    # ------------------------------------------------------------------
    # Common Text Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _strip_quotes_and_punctuation(value: str) -> str:
        return strip_quotes_and_punctuation(value)

    @staticmethod
    def _normalize_label_for_matching(value: str) -> str:
        return normalize_label_for_matching(value)

    def _normalize_intent_family(self, value: str | None) -> str:
        return normalize_intent_family(value)

    def _extract_rename_intent(self, user_message: str) -> tuple[str, str] | None:
        return extract_rename_intent(user_message)

    # ------------------------------------------------------------------
    # Mixed Edit/Query Helpers
    # ------------------------------------------------------------------
    def _detect_edit_continuation_trigger(self, user_message: str) -> str | None:
        return detect_edit_continuation_trigger(user_message)

    def _extract_mixed_query_followup_message(
        self,
        *,
        user_message: str,
        preview_intent: IntentType,
    ) -> str | None:
        return extract_mixed_query_followup_message(
            user_message=user_message,
            preview_intent=preview_intent,
            mixed_query_cue_pattern=self._MIXED_QUERY_CUE_PATTERN,
            mixed_edit_verb_pattern=self._MIXED_EDIT_VERB_PATTERN,
        )

    def _extract_mixed_edit_primary_message(
        self,
        *,
        user_message: str,
        query_message: str | None,
    ) -> str | None:
        return extract_mixed_edit_primary_message(
            user_message=user_message,
            query_message=query_message,
        )

    def _run_mixed_query_followup(
        self,
        *,
        session: AgentSession,
        query_message: str,
        staged_operations: list[RoadmapOperation],
        auth_header: str | None,
        trace_id: str | None,
    ) -> tuple[str | None, str | None]:
        return run_mixed_query_followup_helper(
            session=session,
            query_message=query_message,
            staged_operations=staged_operations,
            auth_header=auth_header,
            trace_id=trace_id,
            planner=self._planner,
            build_session_context=self._build_session_context,
            apply_context_answer_output_guard=self._apply_context_answer_output_guard,
            is_mixed_query_followup_clarifier=self._is_mixed_query_followup_clarifier,
        )

    def _compose_mixed_query_assistant_message(
        self,
        *,
        edit_message: str,
        followup_answer: str | None,
        warning_code: str | None,
    ) -> str:
        return compose_mixed_query_assistant_message_helper(
            edit_message=edit_message,
            followup_answer=followup_answer,
            warning_code=warning_code,
            mixed_query_warning_text=self._mixed_query_warning_text,
        )

    def _is_mixed_query_followup_clarifier(self, planning: PlanningResult) -> bool:
        return is_mixed_query_followup_clarifier_helper(planning)

    def _mixed_query_warning_text(self, warning_code: str | None) -> str | None:
        return mixed_query_warning_text_helper(warning_code)

    # ------------------------------------------------------------------
    # Recent Target Helpers
    # ------------------------------------------------------------------
    def _normalize_recent_target_node_type(self, value: Any) -> str | None:
        return normalize_recent_target_node_type_helper(value)

    def _is_recent_target_fresh(self, target: RecentResolvedTarget) -> bool:
        return is_recent_target_fresh_helper(
            target,
            utcnow=_utcnow,
            max_age_hours=self._RECENT_TARGET_MAX_AGE_HOURS,
        )

    def _recent_target_rank(self, target: RecentResolvedTarget) -> tuple[datetime, float, int]:
        return recent_target_rank_helper(
            target,
            source_priority=self._RECENT_TARGET_SOURCE_PRIORITY,
        )

    def _prune_recent_resolved_targets(
        self,
        targets: list[RecentResolvedTarget],
    ) -> list[RecentResolvedTarget]:
        return prune_recent_resolved_targets_helper(
            targets,
            is_recent_target_fresh=self._is_recent_target_fresh,
            max_items=self._RECENT_TARGET_MAX_ITEMS,
        )

    def _get_recent_resolved_targets(self, session: AgentSession) -> list[RecentResolvedTarget]:
        return get_recent_resolved_targets_helper(
            session,
            prune_recent_resolved_targets=self._prune_recent_resolved_targets,
        )

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
        append_recent_resolved_target_helper(
            session=session,
            node_id=node_id,
            node_type=node_type,
            title=title,
            label=label,
            source=source,
            confidence=confidence,
            normalize_recent_target_node_type=self._normalize_recent_target_node_type,
            is_uuid=self._is_uuid,
            get_recent_resolved_targets=self._get_recent_resolved_targets,
            prune_recent_resolved_targets=self._prune_recent_resolved_targets,
            utcnow=_utcnow,
        )

    def _record_recent_targets_from_operations(
        self,
        *,
        session: AgentSession,
        operations: list[RoadmapOperation],
        source: str,
    ) -> None:
        record_recent_targets_from_operations_helper(
            session=session,
            operations=operations,
            source=source,
            read_operation_title=self._read_operation_title,
            is_uuid=self._is_uuid,
            append_recent_resolved_target=self._append_recent_resolved_target,
        )

    def _record_recent_targets_from_observation_summary(
        self,
        *,
        session: AgentSession,
        observation_summary: list[dict[str, Any]] | None,
    ) -> None:
        record_recent_targets_from_observation_summary_helper(
            session=session,
            observation_summary=observation_summary,
            normalize_recent_target_node_type=self._normalize_recent_target_node_type,
            is_uuid=self._is_uuid,
            append_recent_resolved_target=self._append_recent_resolved_target,
        )

    def record_recent_targets_from_preview(
        self,
        *,
        session: AgentSession,
        preview_result: dict[str, Any],
        source: str = 'commit_semantic_diff',
    ) -> None:
        record_recent_targets_from_preview_helper(
            session=session,
            preview_result=preview_result,
            source=source,
            append_recent_resolved_target=self._append_recent_resolved_target,
        )

    # ------------------------------------------------------------------
    # Deictic Resolver Helpers
    # ------------------------------------------------------------------
    def _looks_like_deictic_parent_reference(self, user_message: str) -> bool:
        return looks_like_deictic_parent_reference_helper(
            user_message,
            deictic_parent_pattern=self._DEICTIC_PARENT_PATTERN,
        )

    def _infer_required_parent_node_type(self, user_message: str) -> str | None:
        return infer_required_parent_node_type_helper(
            user_message,
            extract_create_intent=extract_create_intent,
        )

    def _resolve_deictic_parent_reference(
        self,
        *,
        session: AgentSession,
        user_message: str,
    ) -> dict[str, Any] | None:
        return resolve_deictic_parent_reference_helper(
            session=session,
            user_message=user_message,
            looks_like_deictic_parent_reference=self._looks_like_deictic_parent_reference,
            infer_required_parent_node_type=self._infer_required_parent_node_type,
            get_recent_resolved_targets=self._get_recent_resolved_targets,
            recent_target_rank=self._recent_target_rank,
        )

    def _build_deictic_ambiguity_planning(
        self,
        *,
        deictic_resolution: dict[str, Any],
    ) -> PlanningResult:
        return build_deictic_ambiguity_planning_helper(
            deictic_resolution=deictic_resolution,
            normalize_recent_target_node_type=self._normalize_recent_target_node_type,
            is_uuid=self._is_uuid,
        )

    # ------------------------------------------------------------------
    # Pending Edit Context Helpers
    # ------------------------------------------------------------------
    def _infer_last_staged_create_title(self, session: AgentSession) -> str | None:
        return infer_last_staged_create_title_helper(
            staged_operations=self._get_current_staged_operations(session),
        )

    def _set_pending_edit_context(
        self,
        *,
        session: AgentSession,
        context: PendingEditContext | None,
        event: str,
        trace_id: str | None,
    ) -> None:
        set_pending_edit_context_helper(
            session=session,
            context=context,
            event=event,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            normalize_intent_family=self._normalize_intent_family,
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
        sync_pending_edit_context_helper(
            session=session,
            planning=planning,
            user_message=user_message,
            edit_continuation_trigger=edit_continuation_trigger,
            staged_operations_version=staged_operations_version,
            trace_id=trace_id,
            edit_guard_intervened=edit_guard_intervened,
            logger=self._logger,
            settings=self._settings,
            utcnow=_utcnow,
            normalize_intent_family=self._normalize_intent_family,
            extract_create_intent=extract_create_intent,
            infer_last_staged_create_title=self._infer_last_staged_create_title,
            extract_rename_intent=self._extract_rename_intent,
            invalidate_retry_hints=self._invalidate_retry_hints,
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
        return build_resolver_hints_helper(
            existing_hints=existing_hints,
            user_message=user_message,
            planning=planning,
            edit_continuation_trigger=edit_continuation_trigger,
            intent_family=intent_family,
            staged_operations_version=staged_operations_version,
            rename_intent=rename_intent,
            invalidate_retry_hints=self._invalidate_retry_hints,
        )

    def _apply_context_answer_output_guard(
        self,
        *,
        planning: PlanningResult,
        pending_edit_context_present: bool,
    ) -> PlanningResult:
        return apply_context_answer_output_guard_helper(
            planning=planning,
            pending_edit_context_present=pending_edit_context_present,
        )

    def _normalize_planning_clarifier_contract(
        self,
        planning: PlanningResult,
    ) -> PlanningResult:
        return normalize_planning_clarifier_contract_helper(
            planning,
        )

    def _looks_like_found_node_without_operations(self, assistant_message: str) -> bool:
        return looks_like_found_node_without_operations_helper(assistant_message)

    # ------------------------------------------------------------------
    # ReAct Planning And Guardrail Helpers
    # ------------------------------------------------------------------
    def _run_edit_react_planning_loop(
        self,
        *,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
        route_lane: str,
    ) -> tuple[PlanningResult, dict[str, Any]]:
        return run_edit_react_planning_loop_helper(
            user_message=user_message,
            existing_operations=existing_operations,
            session_context=session_context,
            route_lane=route_lane,
            planner=self._planner,
            settings=self._settings,
        )

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
        return build_react_guard_handoff_helper(
            planning=planning,
            route_lane=route_lane,
            assistant_message=assistant_message,
            parse_mode=parse_mode,
            provider_error_code=provider_error_code,
            clarifier_reason=clarifier_reason,
            clarifier_options=clarifier_options,
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
        return enforce_hybrid_react_terminal_guard_helper(
            planning=planning,
            route_lane=route_lane,
            user_message=user_message,
            agent_hybrid_react_enabled=self._settings.agent_hybrid_react_enabled,
            build_react_guard_handoff=self._build_react_guard_handoff,
            is_rename_message=self._is_rename_message,
            has_rename_shape_operation=self._has_rename_shape_operation,
            recover_rename_shape_operations=self._recover_rename_shape_operations,
        )

    def _derive_react_terminal_action(
        self,
        *,
        planning: PlanningResult,
        edit_continuation_trigger: str | None,
    ) -> str:
        return derive_react_terminal_action_helper(
            planning=planning,
            edit_continuation_trigger=edit_continuation_trigger,
        )

    def _run_edit_react_loop(
        self,
        *,
        planning: PlanningResult,
        pending_edit_context_present: bool,
        edit_continuation_trigger: str | None,
        route_lane: str | None,
        user_message: str,
    ) -> EditReactLoopOutcome:
        return run_edit_react_loop_helper(
            planning=planning,
            pending_edit_context_present=pending_edit_context_present,
            edit_continuation_trigger=edit_continuation_trigger,
            route_lane=route_lane,
            user_message=user_message,
            apply_context_answer_output_guard=self._apply_context_answer_output_guard,
            looks_like_found_node_without_operations=self._looks_like_found_node_without_operations,
            enforce_hybrid_react_terminal_guard=self._enforce_hybrid_react_terminal_guard,
            apply_operation_contract_guard=self._apply_operation_contract_guard,
            normalize_planning_clarifier_contract=self._normalize_planning_clarifier_contract,
        )

    # ------------------------------------------------------------------
    # Rename Recovery Helpers
    # ------------------------------------------------------------------

    def _is_rename_message(self, user_message: str) -> bool:
        return is_rename_message(user_message)

    def _has_rename_shape_operation(self, operations: list[RoadmapOperation]) -> bool:
        return has_rename_shape_operation(operations)

    def _recover_rename_shape_operations(
        self,
        *,
        user_message: str,
        react_tool_observation_summary: list[dict[str, Any]] | None,
    ) -> list[RoadmapOperation] | None:
        return recover_rename_shape_operations(
            user_message=user_message,
            react_tool_observation_summary=react_tool_observation_summary,
            uuid_pattern=self._uuid_pattern,
        )

    # ------------------------------------------------------------------
    # Retry Autostage Helpers
    # ------------------------------------------------------------------
    def _attempt_retry_autostage(
        self,
        *,
        session: AgentSession,
        pending_context: PendingEditContext,
        trace_id: str | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        return attempt_retry_autostage_helper(
            session=session,
            pending_context=pending_context,
            trace_id=trace_id,
            auth_header=auth_header,
            logger=self._logger,
            settings=self._settings,
            utcnow=_utcnow,
            normalize_intent_family=self._normalize_intent_family,
            set_pending_edit_context=self._set_pending_edit_context,
            get_current_staged_operations_version=self._get_current_staged_operations_version,
            resolve_retry_candidates=self._resolve_retry_candidates,
            normalize_label=self._normalize_label,
            is_uuid=self._is_uuid,
            passes_rename_autostage_gate=self._passes_rename_autostage_gate,
        )

    def _resolve_retry_candidates(
        self,
        *,
        roadmap_id: str,
        label: str,
        expected_node_type: str | None,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict[str, Any]:
        return resolve_retry_candidates_helper(
            roadmap_id=roadmap_id,
            label=label,
            expected_node_type=expected_node_type,
            auth_header=auth_header,
            trace_id=trace_id,
            nest_client=self._nest_client,
            run_async_call=self._run_async_call,
            normalize_label=self._normalize_label,
            fallback_label=self._fallback_label,
            is_high_confidence_match=self._is_high_confidence_match,
        )

    def _normalize_label(self, value: str) -> str:
        return normalize_label(value)

    def _fallback_label(self, value: str) -> str | None:
        return fallback_label(value)

    def _is_high_confidence_match(
        self,
        candidate: dict[str, Any],
        normalized_label: str,
    ) -> bool:
        return is_high_confidence_match_helper(
            candidate=candidate,
            normalized_label=normalized_label,
            normalize_label=self._normalize_label,
        )

    def _invalidate_retry_hints(self, hints: dict[str, Any] | None) -> dict[str, Any]:
        return invalidate_retry_hints_helper(hints)

    def _passes_rename_autostage_gate(
        self,
        *,
        candidate: dict[str, Any],
        from_label: str,
        expected_node_type: str | None,
    ) -> bool:
        return passes_rename_autostage_gate_helper(
            candidate=candidate,
            from_label=from_label,
            expected_node_type=expected_node_type,
            normalize_label=self._normalize_label,
        )

    # ------------------------------------------------------------------
    # Actor Context And Async Bridge Helpers
    # ------------------------------------------------------------------
    def _ensure_actor_context(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        ensure_actor_context_helper(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            nest_client=self._nest_client,
            run_async_call=self._run_async_call,
            logger=self._logger,
            settings=self._settings,
            actor_refresh_failures_key=getattr(
                self,
                '_actor_refresh_failures_key',
                'actor_context_refresh_failures',
            ),
        )

    def _clear_actor_context_for_missing_auth(
        self,
        *,
        session: AgentSession,
        trace_id: str | None,
    ) -> None:
        clear_actor_context_for_missing_auth_helper(
            session=session,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            actor_refresh_failures_key=getattr(
                self,
                '_actor_refresh_failures_key',
                'actor_context_refresh_failures',
            ),
        )

    def _should_fetch_actor_context(
        self,
        *,
        preview_intent: IntentType,
        user_message: str,
        auth_header: str | None,
        simple_edit_detected: bool,
        actor_context_present: bool,
    ) -> tuple[bool, str | None]:
        return should_fetch_actor_context_helper(
            preview_intent=preview_intent,
            user_message=user_message,
            auth_header=auth_header,
            simple_edit_detected=simple_edit_detected,
            actor_context_present=actor_context_present,
        )

    def _run_async_call(self, coro: Any) -> dict[str, Any]:
        return run_async_call(
            coro,
            settings=self._settings,
            logger=self._logger,
        )

    # ------------------------------------------------------------------
    # Public Draft Graph Accessors
    # ------------------------------------------------------------------
    def ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return self._ensure_draft_graph_initialized(session)

    def get_active_draft(self, session: AgentSession) -> DraftNode:
        return self._get_active_draft(session)

    # ------------------------------------------------------------------
    # Draft Graph And Session Runtime Helpers
    # ------------------------------------------------------------------
    def _ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return ensure_draft_graph_initialized_helper(session)

    def _get_active_draft(self, session: AgentSession) -> DraftNode:
        return get_active_draft_helper(session)

    def _get_active_draft_if_available(self, session: AgentSession) -> DraftNode | None:
        return get_active_draft_if_available_helper(session)

    def _resolve_staged_state(
        self,
        session: AgentSession,
        *,
        draft_graph_enabled: bool | None = None,
        active_draft: DraftNode | None = None,
    ) -> tuple[list[RoadmapOperation], int]:
        return resolve_session_staged_state_helper(
            session=session,
            draft_graph_enabled=draft_graph_enabled,
            active_draft=active_draft,
            settings_agent_draft_graph_enabled=self._settings.agent_draft_graph_enabled,
            resolve_staged_state=resolve_staged_state_helper,
        )

    def _get_current_staged_operations(self, session: AgentSession) -> list[RoadmapOperation]:
        return get_current_staged_operations_helper(
            session=session,
            resolve_staged_state=self._resolve_staged_state,
        )

    def _get_current_staged_operations_version(self, session: AgentSession) -> int:
        return get_current_staged_operations_version_helper(
            session=session,
            resolve_staged_state=self._resolve_staged_state,
        )

    def _build_session_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict:
        return build_session_context_helper(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            settings=self._settings,
            get_active_draft_if_available=self._get_active_draft_if_available,
            get_recent_resolved_targets=self._get_recent_resolved_targets,
        )
