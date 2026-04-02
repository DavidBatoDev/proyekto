from __future__ import annotations

from dataclasses import dataclass
import asyncio
import logging
from time import perf_counter
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    ActorContext,
    PendingContextResolution,
    PendingDisambiguation,
)
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.client import LLMPlanner, PlanningResult
from app.core.logging_utils import log_event
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.edit_resolver import (
    build_ambiguity_message,
    extract_mark_status_intent,
    extract_move_intent,
    extract_rename_intent,
    parse_selection_index,
    resolve_candidates,
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
    fastpath_bypass_reason: str | None
    phase_timings: dict[str, Any]


class AgentService:
    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._planner = LLMPlanner()
        self._nest_client = NestRoadmapClient()
        self._logger = logging.getLogger(__name__)
        self._actor_refresh_failures_key = 'actor_context_refresh_failures'

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
        self._ensure_actor_context(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        session_context = self._build_session_context(session, auth_header, trace_id)

        classify_started = perf_counter()
        preview_intent, _ = self._planner.preview_intent_classification(
            user_message=user_message,
            session_context=session_context,
        )
        phase_timings['intent_classification_ms'] = int(
            (perf_counter() - classify_started) * 1000
        )

        planning: PlanningResult
        route_lane: str | None = None
        fastpath_bypass_reason: str | None = None

        if preview_intent == 'roadmap_edit':
            fastpath_started = perf_counter()
            fastpath_result, fastpath_bypass_reason = self._try_deterministic_edit_fastpath(
                session=session,
                user_message=user_message,
                auth_header=auth_header,
                trace_id=trace_id,
                session_context=session_context,
            )
            phase_timings['provider_planning_ms'] = int(
                (perf_counter() - fastpath_started) * 1000
            )
            if fastpath_result is not None:
                planning = fastpath_result
                route_lane = 'deterministic_edit_fastpath'
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
                planning = self._apply_deterministic_resolution(
                    session=session,
                    user_message=user_message,
                    planning=planning,
                    auth_header=auth_header,
                    trace_id=trace_id,
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

        internal_metrics = session_context.get('_phase_metrics', {})
        if isinstance(internal_metrics, dict):
            phase_timings['context_tools_ms'] = int(
                float(internal_metrics.get('context_tools_ms') or 0.0)
            )
            phase_timings['context_tools_by_name_ms'] = (
                internal_metrics.get('context_tools_by_name')
                if isinstance(internal_metrics.get('context_tools_by_name'), dict)
                else {}
            )

        operations = planning.operations
        if len(operations) > self._settings.max_operations_per_request:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f'Operation count {len(operations)} exceeds max_operations_per_request '
                    f'({self._settings.max_operations_per_request}).'
                ),
            )

        self._store.append_message(session, 'user', user_message)

        if planning.response_mode == 'edit_plan':
            if replace:
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
            fastpath_bypass_reason=fastpath_bypass_reason,
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
            fastpath_bypass_reason=fastpath_bypass_reason,
            phase_timings=phase_timings,
        )

    def _try_deterministic_edit_fastpath(
        self,
        *,
        session: AgentSession,
        user_message: str,
        auth_header: str | None,
        trace_id: str | None,
        session_context: dict[str, Any],
    ) -> tuple[PlanningResult | None, str | None]:
        pending = session.metadata.pending_disambiguation
        if pending is not None:
            selected_index = parse_selection_index(user_message)
            if selected_index is None:
                return None, 'pending_disambiguation_requires_selection'
            if not (1 <= selected_index <= len(pending.candidates)):
                return None, 'pending_disambiguation_selection_out_of_range'
            selected = pending.candidates[selected_index - 1]
            if pending.kind != 'rename_node' or not pending.new_title:
                return None, 'pending_disambiguation_unsupported_kind'
            session.metadata.pending_disambiguation = None
            return (
                PlanningResult(
                    assistant_message=(
                        f'Great, I will rename {selected.type} "{selected.title}" '
                        f'to "{pending.new_title}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=selected.id,
                            patch={'title': pending.new_title},
                        )
                    ],
                    parse_mode='deterministic_disambiguation_selected',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    route_lane='deterministic_edit_fastpath',
                ),
                None,
            )

        rename_intent = extract_rename_intent(user_message)
        if rename_intent is not None:
            candidate = self._resolve_unique_candidate(
                session=session,
                trace_id=trace_id,
                auth_header=auth_header,
                session_context=session_context,
                label=rename_intent.label,
                node_type=rename_intent.node_type,
            )
            if candidate is None:
                return None, 'rename_target_ambiguous_or_not_found'
            return (
                PlanningResult(
                    assistant_message=(
                        f'Rename {candidate.type} "{candidate.title}" '
                        f'to "{rename_intent.new_title}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=candidate.id,
                            patch={'title': rename_intent.new_title},
                        )
                    ],
                    parse_mode='deterministic_fastpath_rename',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    route_lane='deterministic_edit_fastpath',
                ),
                None,
            )

        mark_status_intent = extract_mark_status_intent(user_message)
        if mark_status_intent is not None:
            candidate = self._resolve_unique_candidate(
                session=session,
                trace_id=trace_id,
                auth_header=auth_header,
                session_context=session_context,
                label=mark_status_intent.label,
                node_type=mark_status_intent.node_type,
            )
            if candidate is None:
                return None, 'status_target_ambiguous_or_not_found'
            return (
                PlanningResult(
                    assistant_message=(
                        f'Set {candidate.type} "{candidate.title}" status to "{mark_status_intent.status}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=candidate.id,
                            patch={'status': mark_status_intent.status},
                        )
                    ],
                    parse_mode='deterministic_fastpath_mark_status',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    route_lane='deterministic_edit_fastpath',
                ),
                None,
            )

        move_intent = extract_move_intent(user_message)
        if move_intent is not None:
            source = self._resolve_unique_candidate(
                session=session,
                trace_id=trace_id,
                auth_header=auth_header,
                session_context=session_context,
                label=move_intent.label,
                node_type=move_intent.node_type,
            )
            if source is None:
                return None, 'move_source_ambiguous_or_not_found'
            expected_parent_type = self._expected_parent_type_for_move(source.type)
            if expected_parent_type is None:
                return None, 'move_source_type_unsupported'
            if (
                move_intent.target_node_type is not None
                and move_intent.target_node_type != expected_parent_type
            ):
                return None, 'move_target_type_mismatch'
            target = self._resolve_unique_candidate(
                session=session,
                trace_id=trace_id,
                auth_header=auth_header,
                session_context=session_context,
                label=move_intent.target_label,
                node_type=expected_parent_type,
            )
            if target is None:
                return None, 'move_target_ambiguous_or_not_found'
            return (
                PlanningResult(
                    assistant_message=(
                        f'Move {source.type} "{source.title}" under '
                        f'{target.type} "{target.title}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=source.id,
                            patch={'parent_id': target.id},
                        )
                    ],
                    parse_mode='deterministic_fastpath_move',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    route_lane='deterministic_edit_fastpath',
                ),
                None,
            )

        return None, 'not_simple_edit_intent'

    def _resolve_unique_candidate(
        self,
        *,
        session: AgentSession,
        trace_id: str | None,
        auth_header: str | None,
        session_context: dict[str, Any],
        label: str,
        node_type: str | None,
    ) -> Any | None:
        roadmap_id = session.roadmap_id.strip()
        if not roadmap_id or not label.strip():
            return None
        started = perf_counter()
        try:
            search_result = self._run_async_call(
                self._nest_client.context_search(
                    roadmap_id=roadmap_id,
                    query=label,
                    node_type=node_type,
                    limit=10,
                    auth_header=auth_header,
                )
            )
        except Exception as exc:
            self._logger.warning('Deterministic fastpath resolver search failed: %s', exc)
            return None
        finally:
            self._record_context_tool_timing(
                session_context=session_context,
                tool_name='resolve_node_reference',
                elapsed_ms=(perf_counter() - started) * 1000,
            )

        raw_matches = search_result.get('matches', [])
        if not isinstance(raw_matches, list):
            raw_matches = []
        resolution = resolve_candidates(
            raw_matches,
            label=label,
            node_type=node_type,
        )
        top_score = resolution.candidates[0].confidence if resolution.candidates else None
        second_score = (
            resolution.candidates[1].confidence if len(resolution.candidates) > 1 else None
        )
        score_margin = (
            round((top_score or 0) - (second_score or 0), 4)
            if top_score is not None and second_score is not None
            else None
        )
        log_event(
            self._logger,
            'resolver_result',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=roadmap_id,
            status=resolution.status,
            candidates_count=len(resolution.candidates),
            top_score=top_score,
            second_score=second_score,
            score_margin=score_margin,
            top_matched_fields=(
                resolution.candidates[0].matched_fields if resolution.candidates else None
            ),
        )
        if resolution.status == 'unique' and resolution.selected is not None:
            session.metadata.pending_disambiguation = None
            return resolution.selected
        return None

    def _record_context_tool_timing(
        self,
        *,
        session_context: dict[str, Any],
        tool_name: str,
        elapsed_ms: float,
    ) -> None:
        metrics = session_context.setdefault('_phase_metrics', {})
        if not isinstance(metrics, dict):
            return
        current_total = float(metrics.get('context_tools_ms') or 0.0)
        metrics['context_tools_ms'] = current_total + float(elapsed_ms)
        by_name = metrics.get('context_tools_by_name')
        if not isinstance(by_name, dict):
            by_name = {}
            metrics['context_tools_by_name'] = by_name
        by_name[tool_name] = float(by_name.get(tool_name) or 0.0) + float(elapsed_ms)

    def _expected_parent_type_for_move(self, source_type: str | None) -> str | None:
        if source_type == 'feature':
            return 'epic'
        if source_type == 'task':
            return 'feature'
        return None

    def _ensure_actor_context(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        actor_refresh_failures_key = getattr(
            self,
            '_actor_refresh_failures_key',
            'actor_context_refresh_failures',
        )
        if not auth_header:
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
            return

        previous_actor_context = session.metadata.actor_context
        try:
            actor_payload = self._run_async_call(
                self._nest_client.context_actor(
                    roadmap_id=session.roadmap_id,
                    auth_header=auth_header,
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

    def _apply_deterministic_resolution(
        self,
        *,
        session: AgentSession,
        user_message: str,
        planning: PlanningResult,
        auth_header: str | None,
        trace_id: str | None,
    ) -> PlanningResult:
        if planning.intent_type != 'roadmap_edit':
            return planning

        if planning.operations:
            session.metadata.pending_disambiguation = None
            return planning

        fallback_used = bool(
            planning.provider_error_code is not None
            or planning.provider_used != 'rule_based'
            or planning.fallback_used
        )
        rename_intent = extract_rename_intent(user_message)
        roadmap_id = session.roadmap_id.strip()

        if rename_intent is not None and roadmap_id:
            log_event(
                self._logger,
                'resolver_attempt',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=roadmap_id,
                label=rename_intent.label,
                node_type=rename_intent.node_type,
            )
            try:
                search_result = self._run_async_call(
                    self._nest_client.context_search(
                        roadmap_id=roadmap_id,
                        query=rename_intent.label,
                        node_type=rename_intent.node_type,
                        limit=20,
                        auth_header=auth_header,
                    )
                )
            except Exception as exc:
                self._logger.warning('Deterministic resolver search failed: %s', exc)
                return planning

            raw_matches = search_result.get('matches', [])
            if not isinstance(raw_matches, list):
                raw_matches = []
            resolution = resolve_candidates(
                raw_matches,
                label=rename_intent.label,
                node_type=rename_intent.node_type,
            )
            top_score = resolution.candidates[0].confidence if resolution.candidates else None
            second_score = (
                resolution.candidates[1].confidence
                if len(resolution.candidates) > 1
                else None
            )
            score_margin = (
                round((top_score or 0) - (second_score or 0), 4)
                if top_score is not None and second_score is not None
                else None
            )
            log_event(
                self._logger,
                'resolver_result',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=roadmap_id,
                status=resolution.status,
                candidates_count=len(resolution.candidates),
                top_score=top_score,
                second_score=second_score,
                score_margin=score_margin,
                top_matched_fields=(
                    resolution.candidates[0].matched_fields
                    if resolution.candidates
                    else None
                ),
            )
            if resolution.status == 'unique' and resolution.selected is not None:
                session.metadata.pending_disambiguation = None
                operation = RoadmapOperation(
                    op='update_node',
                    node_id=resolution.selected.id,
                    patch={'title': rename_intent.new_title},
                )
                return PlanningResult(
                    assistant_message=(
                        f'Rename {resolution.selected.type} "{resolution.selected.title}" '
                        f'to "{rename_intent.new_title}".'
                    ),
                    operations=[operation],
                    parse_mode='deterministic_resolver_rename',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=fallback_used,
                    provider_error_code=planning.provider_error_code,
                    tokens_input=planning.tokens_input,
                    tokens_output=planning.tokens_output,
                    tokens_total=planning.tokens_total,
                )

            if resolution.status == 'ambiguous':
                session.metadata.pending_disambiguation = PendingDisambiguation(
                    kind='rename_node',
                    label=rename_intent.label,
                    node_type=rename_intent.node_type,
                    new_title=rename_intent.new_title,
                    candidates=resolution.candidates[:5],
                )
                return PlanningResult(
                    assistant_message=build_ambiguity_message(
                        rename_intent.label,
                        resolution.candidates,
                    ),
                    operations=[],
                    parse_mode='deterministic_resolver_disambiguation',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=fallback_used,
                    provider_error_code=planning.provider_error_code,
                    tokens_input=planning.tokens_input,
                    tokens_output=planning.tokens_output,
                    tokens_total=planning.tokens_total,
                )

            session.metadata.pending_disambiguation = None
            return PlanningResult(
                assistant_message=(
                    f'I could not find a unique roadmap node for "{rename_intent.label}". '
                    'Please add more context (for example parent epic/feature) and I will resolve it.'
                ),
                operations=[],
                parse_mode='deterministic_resolver_not_found',
                intent_type='roadmap_edit',
                response_mode='edit_plan',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=fallback_used,
                provider_error_code=planning.provider_error_code,
                tokens_input=planning.tokens_input,
                tokens_output=planning.tokens_output,
                tokens_total=planning.tokens_total,
            )

        pending = session.metadata.pending_disambiguation
        if pending is not None:
            selected_index = parse_selection_index(user_message)
            if selected_index is not None and 1 <= selected_index <= len(pending.candidates):
                selected = pending.candidates[selected_index - 1]
                if pending.kind == 'rename_node' and pending.new_title:
                    session.metadata.pending_disambiguation = None
                    operation = RoadmapOperation(
                        op='update_node',
                        node_id=selected.id,
                        patch={'title': pending.new_title},
                    )
                    return PlanningResult(
                        assistant_message=(
                            f'Great, I will rename {selected.type} "{selected.title}" '
                            f'to "{pending.new_title}".'
                        ),
                        operations=[operation],
                        parse_mode='deterministic_disambiguation_selected',
                        intent_type='roadmap_edit',
                        response_mode='edit_plan',
                        preview_recommended=True,
                        provider_used='rule_based',
                        fallback_used=fallback_used,
                        provider_error_code=planning.provider_error_code,
                        tokens_input=planning.tokens_input,
                        tokens_output=planning.tokens_output,
                        tokens_total=planning.tokens_total,
                    )

        return planning

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
        }
