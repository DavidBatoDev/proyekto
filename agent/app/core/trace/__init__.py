"""AI-trace progress store (Redis-backed, per-process active buffer).

``from app.core import trace`` then ``trace.store.capture(...)``,
``trace.store.read(...)``, ``trace.store.flush(trace_id)``,
``trace.store.end_active(trace_id)``, ``trace.store.configure(redis, settings)``
and ``trace.store.reset_for_tests()`` — see ``store.py`` for the contract.
"""

from __future__ import annotations

from app.core.trace import store
from app.core.trace.store import (
    InMemoryRedis,
    InMemoryTraceBackend,
    RedisTraceBackend,
    TraceEvent,
    TraceMeta,
    TraceStore,
)

__all__ = [
    'InMemoryRedis',
    'InMemoryTraceBackend',
    'RedisTraceBackend',
    'TraceEvent',
    'TraceMeta',
    'TraceStore',
    'store',
]
