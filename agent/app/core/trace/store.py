"""Redis-backed AI-trace progress store with a per-process active buffer.

Why this exists: Cloud Run runs several agent instances with no session
affinity, so the web's trace poll can land on an instance that never saw the
trace. Events therefore live in Upstash Redis:

    {prefix}:{trace_id}          hash  session_id, roadmap_id, user_id,
                                       owner_key, run_id, phase, started_at,
                                       completed_at, done, head_seq, run_next
    {prefix}:{trace_id}:events   list  JSON events, RPUSH + LTRIM -250

Both keys get ``EXPIRE AGENT_TRACE_TTL_SECONDS`` on every flush, so an active
trace never ages out while a step is still writing to it.

``head_seq`` is the seq the NEXT event will receive; the events list holds
seqs ``[head_seq - llen, head_seq)`` after trimming, which is what the read
path's ``first_seq = head_seq - llen`` relies on.

Threading contract (the Upstash client is synchronous REST):

* ``capture(payload, settings)`` never does network I/O on the calling
  thread when that thread runs an event loop. It appends to the per-process
  active buffer and, when a flush threshold is crossed, flushes inline from a
  plain worker thread or hands the flush to a daemon thread from a loop
  thread.
* ``flush(trace_id)``, ``end_active(trace_id)`` and ``activate(trace_id)``
  are synchronous and do Redis I/O — call them from the worker thread that
  owns the step (``run_store_call`` / ``asyncio.to_thread``).
* ``read(...)`` serves memory when this process holds the trace active and
  the cursor is inside the buffered range (no I/O); otherwise it reads Redis.
  The trace route calls it through ``run_store_call``.

The store gets its Redis client through ``configure(redis_client_or_none,
settings)`` — it never imports the session store. Without a client (tests,
local runs without Upstash) an ``InMemoryTraceBackend`` provides the same
semantics in-process; ``reset_for_tests()`` drops everything.
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable

from app.core import realtime_push

logger = logging.getLogger('app.core.trace.store')

DEFAULT_KEY_PREFIX = 'roadmap:ai:trace'
DEFAULT_TTL_SECONDS = 900
DEFAULT_FLUSH_EVERY_EVENTS = 5
DEFAULT_FLUSH_INTERVAL_SECONDS = 0.5
MAX_EVENTS_PER_TRACE = 250
MAX_READ_LIMIT = 200
_FLUSH_QUEUE_MAX = 1000
_END_ACTIVE_MAX_PASSES = 3

# Events that become progress-trace rows. Everything else logged through
# log_event is log-only. Hidden-in-web run events: run_started, phase_entered,
# phase_completed, run_step_completed, run_checkpoint, refs_resolved; curated
# rows: commit_started, commit_completed, commit_failed, verify_completed.
PROGRESS_EVENT_ALLOWLIST = frozenset(
    {
        'message_received',
        'actor_context_loaded',
        'intent_classified',
        'route_selected',
        'provider_attempt',
        'provider_success',
        'provider_failure',
        'tool_call_requested',
        'tool_call_result',
        'planner_summary',
        'plan_generated',
        'session_staged_state',
        'message_completed',
        # Throttled chunks of streamed assistant text (details.text) — the web
        # accumulates them in seq order into a live typing preview.
        'assistant_delta',
        # Sanitized reasoning-summary parts (details.text) — the "thought" lines
        # rendered between tool steps in the web activity timeline.
        'assistant_thought',
        'run_started',
        'phase_entered',
        'phase_completed',
        'run_step_completed',
        'run_checkpoint',
        'refs_resolved',
        'commit_started',
        'commit_completed',
        'commit_failed',
        'verify_completed',
    }
)

# Only these events may move the trace's `phase` (provider_* events carry a
# model-call `phase` that must not overwrite the run phase).
_RUN_PHASE_EVENTS = frozenset(
    {
        'run_started',
        'phase_entered',
        'phase_completed',
        'run_step_completed',
        'run_checkpoint',
    }
)

_META_TEXT_FIELDS = (
    'session_id',
    'roadmap_id',
    'user_id',
    'owner_key',
    'run_id',
    'phase',
    'started_at',
    'completed_at',
    'run_next',
)

_UNSET: Any = object()


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------


@dataclass
class TraceEvent:
    seq: int
    ts: str
    event: str
    title: str
    status: str
    summary: str
    details: dict[str, Any] | None = None

    def to_json(self) -> str:
        return json.dumps(
            {
                'seq': self.seq,
                'ts': self.ts,
                'event': self.event,
                'title': self.title,
                'status': self.status,
                'summary': self.summary,
                'details': self.details,
            },
            ensure_ascii=False,
            default=str,
        )

    @classmethod
    def from_json(cls, raw: Any) -> TraceEvent | None:
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8')
        if not isinstance(raw, str):
            return None
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return None
        if not isinstance(parsed, dict):
            return None
        try:
            seq = int(parsed.get('seq'))
        except (TypeError, ValueError):
            return None
        details = parsed.get('details')
        return cls(
            seq=seq,
            ts=str(parsed.get('ts') or ''),
            event=str(parsed.get('event') or ''),
            title=str(parsed.get('title') or ''),
            status=str(parsed.get('status') or 'running'),
            summary=str(parsed.get('summary') or ''),
            details=details if isinstance(details, dict) else None,
        )


@dataclass
class TraceMeta:
    trace_id: str
    session_id: str | None = None
    roadmap_id: str | None = None
    # Supabase user id (bound trace-context actor_id) — the `user:{id}`
    # realtime room that receives pushed copies of this trace's events.
    user_id: str | None = None
    # Forwarded-auth identity of the session owner (actor id or "Guest <id>");
    # the trace route 404s on mismatch.
    owner_key: str | None = None
    run_id: str | None = None
    phase: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    done: bool = False
    # Seq the next event will receive (events list holds [head_seq - llen, head_seq)).
    head_seq: int = 1
    # `next` of the latest run_step_completed; while it is 'continue' a
    # legacy message_completed must not flip `done`.
    run_next: str | None = None

    def to_hash(self) -> dict[str, str]:
        values: dict[str, str] = {'trace_id': self.trace_id}
        for name in _META_TEXT_FIELDS:
            value = getattr(self, name)
            values[name] = '' if value is None else str(value)
        values['done'] = '1' if self.done else '0'
        values['head_seq'] = str(int(self.head_seq))
        return values

    @classmethod
    def from_hash(cls, trace_id: str, raw: Any) -> TraceMeta | None:
        if not isinstance(raw, dict) or not raw:
            return None
        decoded: dict[str, Any] = {}
        for key, value in raw.items():
            if isinstance(key, bytes):
                key = key.decode('utf-8')
            if isinstance(value, bytes):
                value = value.decode('utf-8')
            decoded[str(key)] = value
        meta = cls(trace_id=trace_id)
        for name in _META_TEXT_FIELDS:
            setattr(meta, name, _text_or_none(decoded.get(name)))
        meta.done = str(decoded.get('done') or '0').strip() in {'1', 'true', 'True'}
        try:
            meta.head_seq = max(1, int(decoded.get('head_seq') or 1))
        except (TypeError, ValueError):
            meta.head_seq = 1
        return meta


# ---------------------------------------------------------------------------
# In-memory Redis stand-in (tests / local without Upstash)
# ---------------------------------------------------------------------------


class InMemoryRedis:
    """Minimal in-process stand-in for the sync Upstash client.

    Implements the hash/list/expiry subset the trace backend uses plus
    ``pipeline()``. ``clock`` is injectable so tests can advance TTLs; every
    executed command name is appended to ``calls`` for spying.
    """

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._data: dict[str, Any] = {}
        self._expires: dict[str, float] = {}
        self._lock = threading.RLock()
        self.calls: list[str] = []

    # -- helpers ----------------------------------------------------------
    def _purge(self, key: str) -> None:
        expires_at = self._expires.get(key)
        if expires_at is not None and self._clock() >= expires_at:
            self._data.pop(key, None)
            self._expires.pop(key, None)

    def _record(self, name: str) -> None:
        self.calls.append(name)

    # -- hashes -----------------------------------------------------------
    def hset(
        self,
        key: str,
        field: str | None = None,
        value: Any = None,
        values: dict[str, Any] | None = None,
    ) -> int:
        with self._lock:
            self._record('hset')
            self._purge(key)
            bucket = self._data.get(key)
            if not isinstance(bucket, dict):
                bucket = {}
                self._data[key] = bucket
            added = 0
            pairs: list[tuple[str, Any]] = []
            if field is not None:
                pairs.append((field, value))
            if values:
                pairs.extend(values.items())
            for name, item in pairs:
                if name not in bucket:
                    added += 1
                bucket[name] = str(item)
            return added

    def hgetall(self, key: str) -> dict[str, str]:
        with self._lock:
            self._record('hgetall')
            self._purge(key)
            bucket = self._data.get(key)
            if not isinstance(bucket, dict):
                return {}
            return dict(bucket)

    # -- lists ------------------------------------------------------------
    def rpush(self, key: str, *elements: Any) -> int:
        with self._lock:
            self._record('rpush')
            self._purge(key)
            items = self._data.get(key)
            if not isinstance(items, list):
                items = []
                self._data[key] = items
            items.extend(str(element) for element in elements)
            return len(items)

    def ltrim(self, key: str, start: int, stop: int) -> str:
        with self._lock:
            self._record('ltrim')
            self._purge(key)
            items = self._data.get(key)
            if not isinstance(items, list):
                return 'OK'
            first, last = _normalize_range(len(items), start, stop)
            if first > last:
                self._data.pop(key, None)
                self._expires.pop(key, None)
            else:
                self._data[key] = items[first : last + 1]
            return 'OK'

    def llen(self, key: str) -> int:
        with self._lock:
            self._record('llen')
            self._purge(key)
            items = self._data.get(key)
            return len(items) if isinstance(items, list) else 0

    def lrange(self, key: str, start: int, stop: int) -> list[str]:
        with self._lock:
            self._record('lrange')
            self._purge(key)
            items = self._data.get(key)
            if not isinstance(items, list):
                return []
            first, last = _normalize_range(len(items), start, stop)
            if first > last:
                return []
            return list(items[first : last + 1])

    # -- keys / expiry ----------------------------------------------------
    def expire(self, key: str, seconds: int) -> bool:
        with self._lock:
            self._record('expire')
            self._purge(key)
            if key not in self._data:
                return False
            self._expires[key] = self._clock() + float(seconds)
            return True

    def ttl(self, key: str) -> int:
        with self._lock:
            self._record('ttl')
            self._purge(key)
            if key not in self._data:
                return -2
            expires_at = self._expires.get(key)
            if expires_at is None:
                return -1
            remaining = expires_at - self._clock()
            return max(0, int(remaining + 0.999))

    def exists(self, *keys: str) -> int:
        with self._lock:
            self._record('exists')
            count = 0
            for key in keys:
                self._purge(key)
                if key in self._data:
                    count += 1
            return count

    def delete(self, *keys: str) -> int:
        with self._lock:
            self._record('delete')
            removed = 0
            for key in keys:
                if key in self._data:
                    removed += 1
                self._data.pop(key, None)
                self._expires.pop(key, None)
            return removed

    def pipeline(self) -> _InMemoryPipeline:
        return _InMemoryPipeline(self)

    def multi(self) -> _InMemoryPipeline:
        return _InMemoryPipeline(self)


class _InMemoryPipeline:
    def __init__(self, redis: InMemoryRedis) -> None:
        self._redis = redis
        self._stack: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def __getattr__(self, name: str) -> Callable[..., _InMemoryPipeline]:
        target = getattr(self._redis, name)
        if not callable(target):
            raise AttributeError(name)

        def _queue(*args: Any, **kwargs: Any) -> _InMemoryPipeline:
            self._stack.append((name, args, kwargs))
            return self

        return _queue

    def exec(self) -> list[Any]:
        results: list[Any] = []
        with self._redis._lock:
            for name, args, kwargs in self._stack:
                results.append(getattr(self._redis, name)(*args, **kwargs))
        self._stack = []
        return results

    def reset(self) -> None:
        self._stack = []


def _normalize_range(length: int, start: int, stop: int) -> tuple[int, int]:
    if start < 0:
        start = length + start
    if stop < 0:
        stop = length + stop
    start = max(0, start)
    stop = min(length - 1, stop)
    return start, stop


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------


class RedisTraceBackend:
    """Hash + list per trace over any client with the Upstash sync API."""

    def __init__(
        self,
        redis: Any,
        *,
        key_prefix: str = DEFAULT_KEY_PREFIX,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._redis = redis
        self._key_prefix = (key_prefix or DEFAULT_KEY_PREFIX).rstrip(':')
        self._ttl_seconds = max(1, int(ttl_seconds))

    @property
    def redis(self) -> Any:
        return self._redis

    @property
    def ttl_seconds(self) -> int:
        return self._ttl_seconds

    def meta_key(self, trace_id: str) -> str:
        return f'{self._key_prefix}:{trace_id}'

    def events_key(self, trace_id: str) -> str:
        return f'{self._key_prefix}:{trace_id}:events'

    def write_batch(self, meta: TraceMeta, events: list[TraceEvent]) -> None:
        """One pipeline: HSET meta, RPUSH events, LTRIM, EXPIRE x2."""
        meta_key = self.meta_key(meta.trace_id)
        events_key = self.events_key(meta.trace_id)
        pipe = self._redis.pipeline()
        pipe.hset(meta_key, values=meta.to_hash())
        if events:
            pipe.rpush(events_key, *[event.to_json() for event in events])
            pipe.ltrim(events_key, -MAX_EVENTS_PER_TRACE, -1)
        pipe.expire(meta_key, self._ttl_seconds)
        pipe.expire(events_key, self._ttl_seconds)
        pipe.exec()

    def read_meta(self, trace_id: str) -> TraceMeta | None:
        return TraceMeta.from_hash(trace_id, self._redis.hgetall(self.meta_key(trace_id)))

    def read_meta_and_len(self, trace_id: str) -> tuple[TraceMeta | None, int]:
        pipe = self._redis.pipeline()
        pipe.hgetall(self.meta_key(trace_id))
        pipe.llen(self.events_key(trace_id))
        raw_meta, raw_len = pipe.exec()
        meta = TraceMeta.from_hash(trace_id, raw_meta)
        if meta is None:
            return None, 0
        try:
            length = max(0, int(raw_len or 0))
        except (TypeError, ValueError):
            length = 0
        return meta, length

    def read_range(self, trace_id: str, start: int, stop: int) -> list[TraceEvent]:
        raw_items = self._redis.lrange(self.events_key(trace_id), start, stop) or []
        events: list[TraceEvent] = []
        for raw in raw_items:
            event = TraceEvent.from_json(raw)
            if event is not None:
                events.append(event)
        return events


class InMemoryTraceBackend(RedisTraceBackend):
    """Same semantics as the Redis backend over an in-process fake client."""

    def __init__(
        self,
        redis: InMemoryRedis | None = None,
        *,
        key_prefix: str = DEFAULT_KEY_PREFIX,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> None:
        super().__init__(
            redis if redis is not None else InMemoryRedis(),
            key_prefix=key_prefix,
            ttl_seconds=ttl_seconds,
        )


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


@dataclass
class _ActiveTrace:
    meta: TraceMeta
    created_monotonic: float
    last_seen_monotonic: float
    last_flush_monotonic: float
    events: list[TraceEvent] = field(default_factory=list)
    pending: list[TraceEvent] = field(default_factory=list)
    # False until head_seq/meta were reconciled with Redis (a trace continued
    # on another instance already holds events there).
    hydrated: bool = False
    meta_dirty: bool = True
    # A completion event was observed in this process; hydration must not
    # overwrite `done` afterwards.
    completion_seen: bool = False
    # Created by a capture that landed after this process ended the trace
    # (the route logs the legacy message_completed after step()). Its seqs,
    # owner and done flag are reconciled with Redis only at flush time, so
    # reads treat Redis as the authority until then.
    resumed_after_end: bool = False
    flush_lock: threading.Lock = field(default_factory=threading.Lock)


class TraceStore:
    def __init__(
        self,
        backend: RedisTraceBackend | None = None,
        *,
        flush_every_events: int = DEFAULT_FLUSH_EVERY_EVENTS,
        flush_interval_seconds: float = DEFAULT_FLUSH_INTERVAL_SECONDS,
        memory_ttl_seconds: float | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._lock = threading.Lock()
        self._active: dict[str, _ActiveTrace] = {}
        # trace ids this process ended (end_active) -> when; a later capture
        # for one of them creates a `resumed_after_end` buffer.
        self._ended: dict[str, float] = {}
        self._clock = clock
        self._backend: RedisTraceBackend = backend or InMemoryTraceBackend()
        self._flush_every = _clamp_int(flush_every_events, 1, 50)
        self._flush_interval = _clamp_float(flush_interval_seconds, 0.05, 10.0)
        self._memory_ttl = (
            float(memory_ttl_seconds)
            if memory_ttl_seconds is not None
            else float(self._backend.ttl_seconds)
        )
        self._flusher_lock = threading.Lock()
        self._flush_queue: queue.Queue | None = None
        self._flusher: threading.Thread | None = None

    # -- configuration ----------------------------------------------------

    @property
    def backend(self) -> RedisTraceBackend:
        return self._backend

    def configure(self, redis_client: Any, settings: Any) -> None:
        """Bind the shared Upstash client (or None for in-memory) + tunables."""
        prefix = str(getattr(settings, 'redis_trace_key_prefix', None) or DEFAULT_KEY_PREFIX)
        ttl = _clamp_int(getattr(settings, 'agent_trace_ttl_seconds', DEFAULT_TTL_SECONDS), 60, 86400)
        flush_every = _clamp_int(
            getattr(settings, 'agent_trace_flush_every_events', DEFAULT_FLUSH_EVERY_EVENTS), 1, 50
        )
        flush_interval = _clamp_float(
            getattr(settings, 'agent_trace_flush_interval_seconds', DEFAULT_FLUSH_INTERVAL_SECONDS),
            0.05,
            10.0,
        )
        if redis_client is None:
            backend: RedisTraceBackend = InMemoryTraceBackend(key_prefix=prefix, ttl_seconds=ttl)
        else:
            backend = RedisTraceBackend(redis_client, key_prefix=prefix, ttl_seconds=ttl)
        with self._lock:
            self._backend = backend
            self._flush_every = flush_every
            self._flush_interval = flush_interval
            self._memory_ttl = float(ttl)

    def reset_for_tests(self) -> None:
        with self._lock:
            self._active.clear()
            self._ended.clear()
            self._backend = InMemoryTraceBackend()
            self._flush_every = DEFAULT_FLUSH_EVERY_EVENTS
            self._flush_interval = DEFAULT_FLUSH_INTERVAL_SECONDS
            self._memory_ttl = float(DEFAULT_TTL_SECONDS)
        flush_queue = self._flush_queue
        if flush_queue is not None:
            while True:
                try:
                    flush_queue.get_nowait()
                    flush_queue.task_done()
                except queue.Empty:
                    break

    # -- write path -------------------------------------------------------

    def capture(self, payload: dict[str, Any], settings: Any) -> None:
        """Enqueue one log payload as a trace event (allowlist-gated).

        Never does network I/O on an event-loop thread: a flush threshold
        crossed there is handed to the flusher daemon thread.
        """
        if not getattr(settings, 'agent_progress_events_enabled', True):
            return
        trace_id = _text_or_none(payload.get('trace_id'))
        if trace_id is None:
            return
        event_name = str(payload.get('event') or '').strip().lower()
        if event_name not in PROGRESS_EVENT_ALLOWLIST:
            return

        presentation = _presentation()
        details = presentation._build_progress_event_details(payload)
        title = presentation._progress_event_title(event_name)
        status = presentation._progress_event_status(event_name, payload)
        summary = presentation._progress_event_summary(event_name, payload)
        ts = str(payload.get('ts') or datetime.now(timezone.utc).isoformat())

        now = self._clock()
        publish_user_id: str | None = None
        publish_envelope: dict[str, Any] | None = None
        should_flush = False
        with self._lock:
            self._evict_expired_locked(now)
            active = self._active.get(trace_id)
            if active is None:
                active = self._create_locked(trace_id, now)
                if self._ended.pop(trace_id, None) is not None:
                    active.resumed_after_end = True
            active.last_seen_monotonic = now
            _apply_payload_meta(active.meta, event_name, payload)

            event = TraceEvent(
                seq=active.meta.head_seq,
                ts=ts,
                event=event_name,
                title=title,
                status=status,
                summary=summary,
                details=details,
            )
            active.meta.head_seq += 1
            active.events.append(event)
            if len(active.events) > MAX_EVENTS_PER_TRACE:
                del active.events[: len(active.events) - MAX_EVENTS_PER_TRACE]
            active.pending.append(event)
            if len(active.pending) > MAX_EVENTS_PER_TRACE:
                del active.pending[: len(active.pending) - MAX_EVENTS_PER_TRACE]
            _apply_completion(active, event_name, payload)
            active.meta_dirty = True

            should_flush = (
                len(active.pending) >= self._flush_every
                or (now - active.last_flush_monotonic) >= self._flush_interval
            )

            # Realtime push: mirror this event to the user's realtime room so
            # the web sees it without waiting for the next poll. Structured
            # details match the web's `detail=structured` polling; the enqueue
            # happens outside the lock.
            if active.meta.user_id is not None and getattr(
                settings, 'agent_realtime_trace_push_enabled', False
            ):
                publish_user_id = active.meta.user_id
                publish_envelope = realtime_push.build_trace_envelope(
                    active.meta,
                    presentation._serialize_progress_trace_event(
                        event, include_verbose_details=False
                    ),
                )

        if publish_envelope is not None:
            realtime_push.publish_trace_event(settings, publish_user_id, publish_envelope)
        if should_flush:
            self._request_flush(trace_id)

    def activate(
        self,
        trace_id: str,
        *,
        session_id: str | None = None,
        roadmap_id: str | None = None,
        user_id: str | None = None,
        owner_key: str | None = None,
        run_id: str | None = None,
        phase: str | None = None,
    ) -> TraceMeta:
        """Own `trace_id` on this process and reconcile it with Redis.

        Synchronous (Redis read on a cold trace) — call from the step's
        worker thread before the step logs events for a continued run, so a
        trace resumed on another instance keeps its seq numbering and meta.
        """
        self._warn_if_on_loop('activate')
        trace_id = str(trace_id).strip()
        now = self._clock()
        with self._lock:
            self._evict_expired_locked(now)
            active = self._active.get(trace_id)
            if active is None:
                active = self._create_locked(trace_id, now)
            self._ended.pop(trace_id, None)
            active.last_seen_monotonic = now
        with active.flush_lock:
            self._hydrate_locked(active)
        with self._lock:
            meta = active.meta
            for name, value in (
                ('session_id', session_id),
                ('roadmap_id', roadmap_id),
                ('user_id', user_id),
                ('owner_key', owner_key),
                ('run_id', run_id),
                ('phase', phase),
            ):
                normalized = _text_or_none(value)
                if normalized is not None:
                    setattr(meta, name, normalized)
            active.meta_dirty = True
            return replace(meta)

    def flush(self, trace_id: str) -> None:
        """Write everything pending for `trace_id` to Redis (synchronous)."""
        self._warn_if_on_loop('flush')
        self._flush_by_id(str(trace_id).strip())

    def end_active(self, trace_id: str) -> None:
        """Flush and drop the per-process buffer for `trace_id` (synchronous)."""
        self._warn_if_on_loop('end_active')
        trace_id = str(trace_id).strip()
        # A capture racing between the flush and the delete would strand its
        # event, so re-flush until the buffer is empty at delete time.
        for _ in range(_END_ACTIVE_MAX_PASSES):
            with self._lock:
                active = self._active.get(trace_id)
            if active is None:
                return
            self._flush_active(active)
            with self._lock:
                if self._active.get(trace_id) is not active:
                    return
                if not active.pending:
                    del self._active[trace_id]
                    self._ended[trace_id] = self._clock()
                    return
                if not active.hydrated:
                    # Redis is unreachable (hydration failed): retrying would
                    # only stall the step's finally block. Same-process polls
                    # already served these events from memory.
                    break
        with self._lock:
            if self._active.get(trace_id) is active:
                logger.warning(
                    'trace end_active dropping %d unflushed events trace_id=%s',
                    len(active.pending),
                    trace_id,
                )
                del self._active[trace_id]
                self._ended[trace_id] = self._clock()

    def is_active(self, trace_id: str) -> bool:
        with self._lock:
            return str(trace_id).strip() in self._active

    # -- read path --------------------------------------------------------

    def read(
        self,
        *,
        session_id: str,
        trace_id: str,
        after_seq: int = 0,
        limit: int = 50,
        detail: str = 'verbose',
        settings: Any,
        owner_key: Any = _UNSET,
    ) -> dict[str, Any] | None:
        """Page events with seq > after_seq; None when the trace is unknown,
        belongs to another session, or (when `owner_key` is given) to another
        owner. Memory is served without I/O while this process holds the
        trace active and the cursor sits inside the buffered range."""
        if not getattr(settings, 'agent_progress_events_enabled', True):
            return None
        trace_id = str(trace_id).strip()
        normalized_after_seq = max(0, int(after_seq))
        normalized_limit = max(1, min(int(limit), MAX_READ_LIMIT))
        presentation = _presentation()
        normalized_detail = presentation._normalize_progress_detail_mode(detail)
        verbose_allowed = bool(getattr(settings, 'agent_progress_events_allow_verbose', False))
        include_verbose_details = normalized_detail == 'verbose' and verbose_allowed

        memory_fallback: tuple[TraceMeta, list[TraceEvent]] | None = None
        now = self._clock()
        with self._lock:
            self._evict_expired_locked(now)
            active = self._active.get(trace_id)
            if active is not None:
                active.last_seen_monotonic = now
                memory_first_seq = active.events[0].seq if active.events else active.meta.head_seq
                filtered = [
                    event for event in active.events if event.seq > normalized_after_seq
                ][:normalized_limit]
                snapshot = (replace(active.meta), filtered)
                authoritative = active.hydrated or not active.resumed_after_end
                if authoritative and normalized_after_seq + 1 >= memory_first_seq:
                    return self._build_response(
                        snapshot[0],
                        snapshot[1],
                        after_seq=normalized_after_seq,
                        session_id=session_id,
                        owner_key=owner_key,
                        include_verbose_details=include_verbose_details,
                        presentation=presentation,
                    )
                # Either the cursor predates what this process buffered (trace
                # continued from another instance) or the buffer was created
                # by a capture after this process ended the trace (the legacy
                # message_completed the route logs after step()): its seqs,
                # owner and done flag are reconciled with Redis only at flush
                # time, so Redis is the authority while it exists and memory
                # only the fallback.
                memory_fallback = snapshot

        try:
            stored = self._read_from_backend(trace_id, normalized_after_seq, normalized_limit)
        except Exception:  # noqa: BLE001 — a Redis blip must not 500 the poll
            logger.warning('trace read failed trace_id=%s', trace_id, exc_info=True)
            stored = None
        if stored is None:
            if memory_fallback is None:
                return None
            stored = memory_fallback
        meta, events = stored
        return self._build_response(
            meta,
            events,
            after_seq=normalized_after_seq,
            session_id=session_id,
            owner_key=owner_key,
            include_verbose_details=include_verbose_details,
            presentation=presentation,
        )

    # -- internals --------------------------------------------------------

    def _create_locked(self, trace_id: str, now: float) -> _ActiveTrace:
        active = _ActiveTrace(
            meta=TraceMeta(trace_id=trace_id),
            created_monotonic=now,
            last_seen_monotonic=now,
            last_flush_monotonic=now,
        )
        self._active[trace_id] = active
        return active

    def _evict_expired_locked(self, now: float) -> None:
        expired = [
            trace_id
            for trace_id, active in self._active.items()
            if now - active.last_seen_monotonic > self._memory_ttl
        ]
        for trace_id in expired:
            self._active.pop(trace_id, None)
        for trace_id in [
            trace_id for trace_id, ended_at in self._ended.items() if now - ended_at > self._memory_ttl
        ]:
            self._ended.pop(trace_id, None)

    def _build_response(
        self,
        meta: TraceMeta,
        events: list[TraceEvent],
        *,
        after_seq: int,
        session_id: str,
        owner_key: Any,
        include_verbose_details: bool,
        presentation: Any,
    ) -> dict[str, Any] | None:
        if meta.session_id is not None and meta.session_id != session_id:
            return None
        if owner_key is not _UNSET and meta.owner_key is not None and owner_key != meta.owner_key:
            return None
        events_payload = [
            presentation._serialize_progress_trace_event(
                event, include_verbose_details=include_verbose_details
            )
            for event in events
        ]
        next_seq = events[-1].seq if events else after_seq
        response: dict[str, Any] = {
            'trace_id': meta.trace_id,
            'session_id': meta.session_id,
            'roadmap_id': meta.roadmap_id,
            'run_id': meta.run_id,
            'phase': meta.phase,
            'events': events_payload,
            'next_seq': next_seq,
            'done': meta.done,
            'started_at': meta.started_at,
            'completed_at': meta.completed_at,
        }
        elapsed_ms = _compute_elapsed_ms(meta)
        if elapsed_ms is not None:
            response['elapsed_ms'] = elapsed_ms
        return response

    def _read_from_backend(
        self, trace_id: str, after_seq: int, limit: int
    ) -> tuple[TraceMeta, list[TraceEvent]] | None:
        # Two round trips (HGETALL+LLEN, then LRANGE); the common "nothing
        # new" poll needs only the first. An LTRIM racing between them shifts
        # indices, which the contiguity check catches with one re-read.
        for attempt in range(2):
            meta, length = self._backend.read_meta_and_len(trace_id)
            if meta is None:
                return None
            first_seq = meta.head_seq - length
            start = max(0, after_seq + 1 - first_seq)
            events: list[TraceEvent] = []
            if length > 0 and start < length:
                events = self._backend.read_range(trace_id, start, start + limit - 1)
            events = [event for event in events if event.seq > after_seq]
            expected_first = max(after_seq + 1, first_seq)
            skipped = bool(events) and events[0].seq > expected_first
            starved = not events and length > 0 and start < length
            if attempt == 0 and (skipped or starved):
                continue
            return meta, events
        return None  # pragma: no cover — loop always returns

    def _request_flush(self, trace_id: str) -> None:
        if _on_event_loop_thread():
            self._enqueue_background_flush(trace_id)
            return
        self._flush_by_id(trace_id)

    def _flush_by_id(self, trace_id: str) -> None:
        with self._lock:
            active = self._active.get(trace_id)
        if active is None:
            return
        self._flush_active(active)

    def _flush_active(self, active: _ActiveTrace) -> None:
        with active.flush_lock:
            if not self._hydrate_locked(active):
                # Redis unreachable: keep the batch buffered for the next flush
                # point; same-process polls keep being served from memory.
                return
            with self._lock:
                batch = active.pending
                active.pending = []
                if not batch and not active.meta_dirty:
                    return
                active.meta_dirty = False
                meta = replace(active.meta)
            try:
                self._backend.write_batch(meta, batch)
            except Exception:  # noqa: BLE001 — tracing must never break the step
                logger.warning(
                    'trace flush failed trace_id=%s events=%d',
                    meta.trace_id,
                    len(batch),
                    exc_info=True,
                )
                with self._lock:
                    active.meta_dirty = True
                return
            with self._lock:
                active.last_flush_monotonic = self._clock()

    def _hydrate_locked(self, active: _ActiveTrace) -> bool:
        """Reconcile a cold buffer with what Redis already holds.

        Called with `active.flush_lock` held. A trace continued on another
        instance already has events in Redis: shift this process's seqs past
        the stored head_seq and adopt stored meta the process has not set.
        Returns False when Redis could not be read (caller skips the flush).
        """
        if active.hydrated:
            return True
        try:
            stored = self._backend.read_meta(active.meta.trace_id)
        except Exception:  # noqa: BLE001
            logger.warning(
                'trace hydrate failed trace_id=%s', active.meta.trace_id, exc_info=True
            )
            return False
        with self._lock:
            if stored is not None:
                offset = stored.head_seq - 1
                if offset > 0:
                    shifted: set[int] = set()
                    for event in [*active.events, *active.pending]:
                        if id(event) in shifted:
                            continue
                        shifted.add(id(event))
                        event.seq += offset
                    active.meta.head_seq += offset
                meta = active.meta
                for name in ('session_id', 'roadmap_id', 'user_id', 'owner_key', 'run_id', 'phase'):
                    if getattr(meta, name) is None:
                        setattr(meta, name, getattr(stored, name))
                if meta.started_at is None:
                    meta.started_at = stored.started_at
                if not active.completion_seen:
                    meta.done = stored.done
                    meta.run_next = stored.run_next
                    if meta.completed_at is None:
                        meta.completed_at = stored.completed_at
            active.hydrated = True
            active.meta_dirty = True
        return True

    def _enqueue_background_flush(self, trace_id: str) -> None:
        try:
            self._ensure_flusher().put_nowait(trace_id)
        except queue.Full:
            # Pathological backlog — the next flush point catches up.
            pass
        except Exception:  # noqa: BLE001
            logger.debug('trace flush enqueue failed', exc_info=True)

    def _ensure_flusher(self) -> queue.Queue:
        with self._flusher_lock:
            if self._flush_queue is None:
                self._flush_queue = queue.Queue(maxsize=_FLUSH_QUEUE_MAX)
            if self._flusher is None or not self._flusher.is_alive():
                self._flusher = threading.Thread(
                    target=self._run_flusher,
                    args=(self._flush_queue,),
                    name='trace-flush',
                    daemon=True,
                )
                self._flusher.start()
        return self._flush_queue

    def _run_flusher(self, flush_queue: queue.Queue) -> None:
        while True:
            trace_id = flush_queue.get()
            try:
                self._flush_by_id(trace_id)
            except Exception:  # noqa: BLE001
                logger.debug('background trace flush failed', exc_info=True)
            finally:
                flush_queue.task_done()

    @staticmethod
    def _warn_if_on_loop(operation: str) -> None:
        if _on_event_loop_thread():
            logger.warning(
                'trace store %s called on an event-loop thread; run it via run_store_call',
                operation,
            )


# ---------------------------------------------------------------------------
# Payload -> meta rules
# ---------------------------------------------------------------------------


def _apply_payload_meta(meta: TraceMeta, event_name: str, payload: dict[str, Any]) -> None:
    meta.session_id = _text_or_none(payload.get('session_id')) or meta.session_id
    meta.roadmap_id = _text_or_none(payload.get('roadmap_id')) or meta.roadmap_id
    meta.user_id = _text_or_none(payload.get('actor_id')) or meta.user_id
    meta.owner_key = _text_or_none(payload.get('owner_key')) or meta.owner_key
    meta.run_id = _text_or_none(payload.get('run_id')) or meta.run_id
    if event_name in _RUN_PHASE_EVENTS:
        meta.phase = _text_or_none(payload.get('phase')) or meta.phase
    payload_ts = _text_or_none(payload.get('ts'))
    if meta.started_at is None and payload_ts is not None:
        meta.started_at = payload_ts
    if event_name == 'message_received' and payload_ts is not None:
        meta.started_at = payload_ts


def _apply_completion(active: _ActiveTrace, event_name: str, payload: dict[str, Any]) -> None:
    meta = active.meta
    payload_ts = _text_or_none(payload.get('ts'))
    if event_name == 'run_step_completed':
        run_next = _text_or_none(payload.get('run_next'))
        meta.run_next = run_next
        meta.done = run_next != 'continue'
        active.completion_seen = True
        if meta.done:
            if payload_ts is not None:
                meta.completed_at = payload_ts
        else:
            meta.completed_at = None
        return
    if event_name == 'message_completed':
        payload_next = _text_or_none(payload.get('run_next'))
        if meta.run_next == 'continue' or payload_next == 'continue':
            # Run-aware trace still going; message_completed is the legacy
            # sync-mode terminal and must not end a continuing run's trace.
            # The payload's own run_next covers a cold buffer (the route logs
            # this event after step() ended the active trace).
            meta.run_next = payload_next or meta.run_next
            return
        meta.done = True
        active.completion_seen = True
        if payload_ts is not None:
            meta.completed_at = payload_ts


def _compute_elapsed_ms(meta: TraceMeta) -> int | None:
    if meta.started_at is None:
        return None
    end_ts = meta.completed_at
    if end_ts is None:
        if meta.done:
            end_ts = meta.started_at
        else:
            return None
    try:
        start_dt = datetime.fromisoformat(meta.started_at.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_ts.replace('Z', '+00:00'))
    except ValueError:
        return None
    return max(0, int((end_dt - start_dt).total_seconds() * 1000))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PRESENTATION: Any = None


def _presentation() -> Any:
    # Title/status/summary/detail helpers live in logging_utils (the log
    # renderer shares them). Resolved lazily because logging_utils imports
    # this module for capture(); the lookup is a sys.modules hit after the
    # first call.
    global _PRESENTATION
    if _PRESENTATION is None:
        from app.core import logging_utils

        _PRESENTATION = logging_utils
    return _PRESENTATION


def _on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode('utf-8', errors='replace')
    text = str(value).strip()
    return text or None


def _clamp_int(value: Any, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = low
    return max(low, min(high, number))


def _clamp_float(value: Any, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = low
    return max(low, min(high, number))


# ---------------------------------------------------------------------------
# Module-level singleton API (`from app.core import trace; trace.store.read(...)`)
# ---------------------------------------------------------------------------

_default_store = TraceStore()


def get_default_store() -> TraceStore:
    return _default_store


def configure(redis_client: Any, settings: Any) -> None:
    _default_store.configure(redis_client, settings)


def reset_for_tests() -> None:
    _default_store.reset_for_tests()


def capture(payload: dict[str, Any], settings: Any) -> None:
    _default_store.capture(payload, settings)


def activate(trace_id: str, **meta: Any) -> TraceMeta:
    return _default_store.activate(trace_id, **meta)


def flush(trace_id: str) -> None:
    _default_store.flush(trace_id)


def end_active(trace_id: str) -> None:
    _default_store.end_active(trace_id)


def is_active(trace_id: str) -> bool:
    return _default_store.is_active(trace_id)


def read(
    *,
    session_id: str,
    trace_id: str,
    after_seq: int = 0,
    limit: int = 50,
    detail: str = 'verbose',
    settings: Any,
    owner_key: Any = _UNSET,
) -> dict[str, Any] | None:
    return _default_store.read(
        session_id=session_id,
        trace_id=trace_id,
        after_seq=after_seq,
        limit=limit,
        detail=detail,
        settings=settings,
        owner_key=owner_key,
    )
