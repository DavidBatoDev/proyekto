from __future__ import annotations

import logging
from typing import Any

from app.core.config import Settings
from app.core.logging_utils import log_event


def record_tool_invocation(
    logger: logging.Logger,
    settings: Settings,
    *,
    tool_name: str,
    duration_ms: float,
    outcome: str,
    error_code: str | None = None,
    trace_id: str | None = None,
    roadmap_id: str | None = None,
) -> None:
    """Emit a `tool.invoked` structured event.

    One event per top-level tool dispatch. Complements the existing
    `tool_call_requested` / `tool_call_result` logs with a single
    dashboard-friendly record: (tool, duration_ms, outcome, error_code).
    """
    log_event(
        logger,
        'tool.invoked',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=roadmap_id,
        tool_name=tool_name,
        duration_ms=round(duration_ms, 3),
        outcome=outcome,
        error_code=error_code,
    )


def record_session_cas_conflict(
    logger: logging.Logger,
    settings: Settings,
    *,
    session_id: str,
    attempt: int,
    expected_version: int,
    stored_version: int | None,
    will_retry: bool,
) -> None:
    """Emit `session.cas_conflict` when SessionStore.save_cas detects a version
    mismatch. Fires per retry attempt, so the event count reflects true
    contention frequency.
    """
    log_event(
        logger,
        'session.cas_conflict',
        settings=settings,
        session_id=session_id,
        attempt=attempt,
        expected_version=expected_version,
        stored_version=stored_version,
        will_retry=will_retry,
    )


def record_cache_event(
    logger: logging.Logger,
    settings: Settings,
    *,
    cache: str,
    outcome: str,
    trace_id: str | None = None,
    key_signature: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Emit a `cache.event` record for hit/miss telemetry.

    `cache`: short identifier (e.g. 'resolve_lookup', 'resolve_request',
    'context_answer'). `outcome`: 'hit' | 'miss' | 'write' | 'evict'.
    """
    payload: dict[str, Any] = {
        'cache': cache,
        'outcome': outcome,
        'trace_id': trace_id,
    }
    if key_signature:
        payload['key_signature'] = key_signature
    if extra:
        payload.update(extra)
    log_event(logger, 'cache.event', settings=settings, **payload)
