import logging
import random
import time
from datetime import datetime, UTC
from time import perf_counter
from typing import Any, Callable

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession, Message

try:
    from upstash_redis import Redis
except Exception:  # pragma: no cover
    Redis = None  # type: ignore[assignment]


# Lua script: compare-and-set on the `version` counter key. Returns:
#   ['ok', new_version]   on success — caller increments its local version
#   ['conflict', stored]  on mismatch — caller should re-load and retry
# KEYS[1] = session JSON key, KEYS[2] = version counter key
# ARGV[1] = new JSON payload, ARGV[2] = expected version (string int),
# ARGV[3] = ttl seconds (0 = no ttl)
_SAVE_CAS_LUA = """
local stored = redis.call('GET', KEYS[2])
local expected = ARGV[2]
if stored == false then
    if expected ~= '0' then
        return {'conflict', '0'}
    end
else
    if stored ~= expected then
        return {'conflict', stored}
    end
end
redis.call('SET', KEYS[1], ARGV[1])
local new_version = redis.call('INCR', KEYS[2])
local ttl = tonumber(ARGV[3])
if ttl and ttl > 0 then
    redis.call('EXPIRE', KEYS[1], ttl)
    redis.call('EXPIRE', KEYS[2], ttl)
end
return {'ok', tostring(new_version)}
"""


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

    def _version_key(self, session_id: str) -> str:
        return f'{self._key_prefix}:{session_id}:v'

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

    def save_cas(self, session: AgentSession) -> AgentSession:
        """Atomic check-and-set save.

        Uses `session.version` as the expected stored version. On success,
        increments both the stored counter and the in-memory `session.version`
        so the caller can continue mutating and saving. On mismatch, raises
        `SessionStoreConflictError` and leaves `session.version` unchanged.
        """
        session.updated_at = datetime.now(UTC).replace(tzinfo=None)
        serialize_started_at = perf_counter()
        payload = session.model_dump_json()
        serialize_ms = int((perf_counter() - serialize_started_at) * 1000)
        payload_bytes = len(payload.encode('utf-8'))
        json_key = self._key(session.session_id)
        version_key = self._version_key(session.session_id)
        save_started_at = perf_counter()
        try:
            result = self._redis.eval(
                _SAVE_CAS_LUA,
                keys=[json_key, version_key],
                args=[payload, str(session.version), str(self._ttl_seconds)],
            )
        except Exception as exc:  # pragma: no cover
            raise SessionStoreUnavailableError('save_cas', str(exc)) from exc

        outcome, detail = _parse_cas_result(result)
        elapsed_ms = int((perf_counter() - save_started_at) * 1000)
        if outcome == 'conflict':
            self._log_timing(
                'session_store_save_cas_conflict',
                session_id=session.session_id,
                expected_version=session.version,
                stored_version=detail,
                elapsed_ms=elapsed_ms,
            )
            raise SessionStoreConflictError(
                session_id=session.session_id,
                expected_version=session.version,
                stored_version=int(detail) if detail.isdigit() else None,
            )

        # outcome == 'ok' — detail is the new version as a string
        try:
            session.version = int(detail)
        except (TypeError, ValueError):
            # Malformed response from Redis: best-effort increment locally so
            # the next save attempt isn't immediately stale. The next read from
            # Redis will re-anchor us to the truth.
            session.version += 1
        self._log_timing(
            'session_store_save_cas',
            session_id=session.session_id,
            serialize_ms=serialize_ms,
            elapsed_ms=elapsed_ms,
            payload_bytes=payload_bytes,
            new_version=session.version,
        )
        return session

    def append_message(
        self,
        session: AgentSession,
        role: str,
        content: str,
        *,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
    ) -> AgentSession:
        session.messages.append(
            Message(
                role=role,
                content=content,
                tool_calls=tool_calls,
                tool_call_id=tool_call_id,
            )
        )
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


class SessionStoreConflictError(RuntimeError):
    """Raised by SessionStore.save_cas when the expected version doesn't match
    the currently-stored version. Caller should re-read the session and
    re-apply the intended mutation, then retry.
    """

    def __init__(
        self,
        *,
        session_id: str,
        expected_version: int,
        stored_version: int | None,
    ) -> None:
        self.session_id = session_id
        self.expected_version = expected_version
        self.stored_version = stored_version
        super().__init__(
            f'Session {session_id} CAS conflict: '
            f'expected version {expected_version}, stored {stored_version}.'
        )


def _coerce_to_str(value: Any) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode('utf-8')
        except UnicodeDecodeError:
            return ''
    return str(value)


def _parse_cas_result(result: Any) -> tuple[str, str]:
    """Normalize Upstash eval() return shapes into (outcome, detail).

    Upstash's REST client may return the Lua table as a list of strings,
    a list of bytes, or a list of mixed types depending on SDK version.
    Decode bytes before string-compare so the outcome check stays exact.
    """
    if isinstance(result, (list, tuple)) and len(result) >= 2:
        outcome_raw = result[0]
        detail_raw = result[1]
    else:
        return 'conflict', ''
    outcome = _coerce_to_str(outcome_raw).strip().lower()
    detail = _coerce_to_str(detail_raw).strip()
    if outcome not in {'ok', 'conflict'}:
        return 'conflict', detail
    return outcome, detail


def with_cas_retry(
    load_fn: Callable[[], AgentSession | None],
    mutate_fn: Callable[[AgentSession], AgentSession],
    save_fn: Callable[[AgentSession], AgentSession],
    *,
    max_attempts: int = 3,
    base_backoff_ms: float = 20.0,
    jitter_ms: float = 30.0,
    on_conflict: Callable[[int, SessionStoreConflictError], None] | None = None,
) -> AgentSession:
    """Run a read-modify-write cycle with CAS retry on conflict.

    `load_fn`    — returns the latest session (or None if missing).
    `mutate_fn`  — applies the intended change to the loaded session; MUST be
                   safe to re-run on a freshly-loaded session (idempotent or
                   derived purely from the incoming request). Should return
                   the session to save (may be the same instance).
    `save_fn`    — persists the mutated session. Usually a closure calling
                   `SessionStore.save_cas`.
    `on_conflict`— optional callback invoked with (attempt_index, error) when
                   a conflict occurs. Use this to emit telemetry.

    Raises the last `SessionStoreConflictError` if `max_attempts` is exhausted,
    or `ValueError` if `load_fn` returns None (session missing).
    """
    attempt = 0
    last_error: SessionStoreConflictError | None = None
    while attempt < max_attempts:
        session = load_fn()
        if session is None:
            raise ValueError('Session not found; cannot apply CAS mutation.')
        mutated = mutate_fn(session)
        try:
            return save_fn(mutated)
        except SessionStoreConflictError as exc:
            last_error = exc
            if on_conflict is not None:
                on_conflict(attempt, exc)
            attempt += 1
            if attempt >= max_attempts:
                break
            backoff_seconds = (base_backoff_ms + random.random() * jitter_ms) / 1000.0
            time.sleep(backoff_seconds)
    assert last_error is not None  # loop only exits via break after a conflict
    raise last_error
