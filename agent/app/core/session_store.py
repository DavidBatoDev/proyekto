from datetime import datetime, timedelta

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession, Message


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}

    def create(self, session: AgentSession) -> AgentSession:
        self._sessions[session.session_id] = session
        self._cleanup_expired()
        return session

    def get(self, session_id: str) -> AgentSession | None:
        self._cleanup_expired()
        return self._sessions.get(session_id)

    def update(self, session: AgentSession) -> AgentSession:
        session.updated_at = datetime.utcnow()
        self._sessions[session.session_id] = session
        return session

    def append_message(self, session: AgentSession, role: str, content: str) -> AgentSession:
        session.messages.append(Message(role=role, content=content))
        return self.update(session)

    def _cleanup_expired(self) -> None:
        settings = get_settings()
        threshold = datetime.utcnow() - timedelta(seconds=settings.session_ttl_seconds)
        expired_ids = [
            session_id
            for session_id, session in self._sessions.items()
            if session.updated_at < threshold
        ]
        for session_id in expired_ids:
            self._sessions.pop(session_id, None)