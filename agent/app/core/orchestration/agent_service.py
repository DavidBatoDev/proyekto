from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession
from app.core.llm.client import LLMPlanner
from app.core.session_store import SessionStore


class AgentService:
    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._planner = LLMPlanner()

    def get_session_or_404(self, session_id: str) -> AgentSession:
        session = self._store.get(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Session {session_id} was not found or has expired.',
            )
        return session

    def plan_message(self, session: AgentSession, user_message: str, replace: bool) -> tuple[AgentSession, str, str]:
        planning = self._planner.plan(user_message, session.operations)

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

        if replace:
            session.operations = operations
        else:
            session.operations.extend(operations)

        self._store.append_message(session, 'assistant', planning.assistant_message)
        self._store.update(session)

        return session, planning.assistant_message, planning.parse_mode