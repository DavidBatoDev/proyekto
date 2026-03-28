import json
from datetime import datetime, UTC

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession, Message

try:
    from upstash_redis import Redis
except Exception:  # pragma: no cover
    Redis = None  # type: ignore[assignment]


class SessionStore:
    def __init__(self) -> None:
        settings = get_settings()
        if Redis is None:
            raise RuntimeError('upstash-redis package is required for durable session storage')
        if not settings.upstash_redis_rest_url or not settings.upstash_redis_rest_token:
            raise RuntimeError(
                'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for durable session storage'
            )
        self._ttl_seconds = settings.session_ttl_seconds
        self._key_prefix = settings.redis_session_key_prefix.rstrip(':')
        self._redis = Redis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )

    def _key(self, session_id: str) -> str:
        return f'{self._key_prefix}:{session_id}'

    def create(self, session: AgentSession) -> AgentSession:
        self._save(session)
        return session

    def get(self, session_id: str) -> AgentSession | None:
        payload = self._redis.get(self._key(session_id))
        if payload is None:
            return None
        session = AgentSession.model_validate_json(payload)
        self._redis.expire(self._key(session_id), self._ttl_seconds)
        return session

    def update(self, session: AgentSession) -> AgentSession:
        session.updated_at = datetime.now(UTC).replace(tzinfo=None)
        self._save(session)
        return session

    def append_message(self, session: AgentSession, role: str, content: str) -> AgentSession:
        session.messages.append(Message(role=role, content=content))
        return self.update(session)

    def _save(self, session: AgentSession) -> None:
        payload = json.dumps(session.model_dump(mode='json'))
        key = self._key(session.session_id)
        self._redis.set(key, payload)
        self._redis.expire(key, self._ttl_seconds)
