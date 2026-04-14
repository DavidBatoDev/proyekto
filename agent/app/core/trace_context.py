from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_TRACE_ID: ContextVar[str | None] = ContextVar('agent_trace_id', default=None)
_SESSION_ID: ContextVar[str | None] = ContextVar('agent_session_id', default=None)
_ROADMAP_ID: ContextVar[str | None] = ContextVar('agent_roadmap_id', default=None)
_ACTOR_ID: ContextVar[str | None] = ContextVar('agent_actor_id', default=None)

_VARS = (
    ('trace_id', _TRACE_ID),
    ('session_id', _SESSION_ID),
    ('roadmap_id', _ROADMAP_ID),
    ('actor_id', _ACTOR_ID),
)


def get_trace_id() -> str | None:
    return _TRACE_ID.get()


def get_session_id() -> str | None:
    return _SESSION_ID.get()


def get_roadmap_id() -> str | None:
    return _ROADMAP_ID.get()


def get_actor_id() -> str | None:
    return _ACTOR_ID.get()


def get_trace_fields() -> dict[str, str | None]:
    """Snapshot of all four context fields, keyed by log_event field name.

    Returned dict keys match the kwargs `log_event` expects, so the mapping
    can be merged into a log payload to auto-populate trace correlation
    without requiring callers to pass them explicitly.
    """
    return {name: var.get() for name, var in _VARS}


def bind(
    *,
    trace_id: str | None = None,
    session_id: str | None = None,
    roadmap_id: str | None = None,
    actor_id: str | None = None,
) -> None:
    """Imperative bind — intended for call at the entry of an async task
    (e.g., a FastAPI route handler). FastAPI runs each request in its own
    asyncio Task, and ContextVars are per-task, so the binding naturally
    expires when the task completes — no reset needed.

    Only non-None values are applied; pass `None` to leave the current
    binding unchanged.
    """
    if trace_id is not None:
        _TRACE_ID.set(trace_id)
    if session_id is not None:
        _SESSION_ID.set(session_id)
    if roadmap_id is not None:
        _ROADMAP_ID.set(roadmap_id)
    if actor_id is not None:
        _ACTOR_ID.set(actor_id)


@contextmanager
def bind_trace_context(
    *,
    trace_id: str | None = None,
    session_id: str | None = None,
    roadmap_id: str | None = None,
    actor_id: str | None = None,
) -> Iterator[None]:
    """Scoped bind. Restores prior values on exit.

    Use when nesting a scope inside an already-bound context (e.g., a
    background thread or a child task that needs different values
    temporarily). For top-level request binding, prefer `bind()`.
    """
    tokens: list[tuple[ContextVar[str | None], object]] = []
    for name, var in _VARS:
        value = {
            'trace_id': trace_id,
            'session_id': session_id,
            'roadmap_id': roadmap_id,
            'actor_id': actor_id,
        }[name]
        if value is not None:
            tokens.append((var, var.set(value)))
    try:
        yield
    finally:
        for var, token in reversed(tokens):
            var.reset(token)
