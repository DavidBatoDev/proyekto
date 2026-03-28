from __future__ import annotations

from dataclasses import dataclass
import logging

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType, ProviderUsed, ResponseMode
from app.core.llm.client import LLMPlanner
from app.core.logging_utils import log_event
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


class AgentService:
    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._planner = LLMPlanner()
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
        )

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
            'staged_operations_count': len(session.operations),
            'last_intent_type': session.last_intent_type,
            'recent_messages': recent_messages,
            'auth_header': auth_header,
            'trace_id': trace_id,
        }
