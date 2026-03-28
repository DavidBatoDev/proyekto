from __future__ import annotations

from dataclasses import dataclass
import asyncio
import logging
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import PendingDisambiguation
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.client import LLMPlanner, PlanningResult
from app.core.logging_utils import log_event
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.edit_resolver import (
    build_ambiguity_message,
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


class AgentService:
    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._planner = LLMPlanner()
        self._nest_client = NestRoadmapClient()
        self._logger = logging.getLogger(__name__)

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
        planning = self._planner.plan(
            user_message=user_message,
            existing_operations=session.operations,
            session_context=self._build_session_context(session, auth_header, trace_id),
        )
        planning = self._apply_deterministic_resolution(
            session=session,
            user_message=user_message,
            planning=planning,
            auth_header=auth_header,
            trace_id=trace_id,
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
            log_event(
                self._logger,
                'resolver_result',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=roadmap_id,
                status=resolution.status,
                candidates_count=len(resolution.candidates),
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
        }
