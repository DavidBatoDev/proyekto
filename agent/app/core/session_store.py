import logging
from datetime import datetime, UTC
from time import perf_counter

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
        self._logger = logging.getLogger(__name__)
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
        key = self._key(session_id)
        started_at = perf_counter()
        try:
            payload = self._get_with_touch(key)
            if payload is None:
                self._log_timing(
                    'session_store_get_miss',
                    session_id=session_id,
                    elapsed_ms=int((perf_counter() - started_at) * 1000),
                )
                return None
            if isinstance(payload, bytes):
                payload = payload.decode('utf-8')
            session = AgentSession.model_validate_json(payload)
            self._log_timing(
                'session_store_get_hit',
                session_id=session_id,
                elapsed_ms=int((perf_counter() - started_at) * 1000),
                payload_bytes=len(payload.encode('utf-8')),
            )
            return session
        except Exception as exc:  # pragma: no cover
            raise SessionStoreUnavailableError('get', str(exc)) from exc

    def update(self, session: AgentSession) -> AgentSession:
        session.updated_at = datetime.now(UTC).replace(tzinfo=None)
        self._save(session)
        return session

    def append_message(self, session: AgentSession, role: str, content: str) -> AgentSession:
        session.messages.append(Message(role=role, content=content))
        return self.update(session)

    def _save(self, session: AgentSession) -> None:
        serialize_started_at = perf_counter()
        payload = session.model_dump_json()
        serialize_ms = int((perf_counter() - serialize_started_at) * 1000)
        payload_bytes = len(payload.encode('utf-8'))
        key = self._key(session.session_id)
        save_started_at = perf_counter()
        try:
            self._set_with_ttl(key, payload)
            self._log_timing(
                'session_store_save',
                session_id=session.session_id,
                serialize_ms=serialize_ms,
                elapsed_ms=int((perf_counter() - save_started_at) * 1000),
                payload_bytes=payload_bytes,
            )
        except Exception as exc:  # pragma: no cover
            raise SessionStoreUnavailableError('save', str(exc)) from exc

    def _set_with_ttl(self, key: str, payload: str) -> None:
        try:
            self._redis.set(key, payload, ex=self._ttl_seconds)
            return
        except TypeError:
            # Older clients may not support the `ex` kwarg.
            pass
        self._redis.set(key, payload)
        self._redis.expire(key, self._ttl_seconds)

    def _get_with_touch(self, key: str) -> str | bytes | None:
        getex = getattr(self._redis, 'getex', None)
        if callable(getex):
            try:
                return getex(key, ex=self._ttl_seconds)
            except TypeError:
                payload = getex(key)
                if payload is not None:
                    self._redis.expire(key, self._ttl_seconds)
                return payload
        payload = self._redis.get(key)
        if payload is not None:
            self._redis.expire(key, self._ttl_seconds)
        return payload

    def _log_timing(self, event: str, **fields: object) -> None:
        if not self._logger.isEnabledFor(logging.DEBUG):
            return
        segments = [f'event={event}']
        for key, value in fields.items():
            if value is None:
                continue
            segments.append(f'{key}={value}')
        self._logger.debug(' '.join(segments))


class SessionStoreUnavailableError(RuntimeError):
    def __init__(self, operation: str, reason: str) -> None:
        super().__init__(f'Session store operation failed: {operation}. {reason}')
        self.operation = operation
        self.reason = reason
