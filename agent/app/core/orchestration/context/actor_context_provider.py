from __future__ import annotations

import logging
import re
from typing import Any, Callable

from fastapi import HTTPException

from app.core.contracts.sessions import ActorContext, AgentSession, IntentType
from app.core.logging_utils import log_event


def should_fetch_actor_context(
    *,
    preview_intent: IntentType,
    user_message: str,
    auth_header: str | None,
    simple_edit_detected: bool,
    actor_context_present: bool,
) -> tuple[bool, str | None]:
    if not auth_header:
        return False, 'missing_auth_header'
    actor_required = is_actor_context_required_message(user_message)
    if preview_intent == 'roadmap_edit' and simple_edit_detected and not actor_required:
        return False, 'simple_edit_turn'
    if actor_required:
        return True, None
    if actor_context_present:
        return False, 'not_required_cached'
    return False, 'not_required_for_turn'


def is_actor_context_required_message(user_message: str) -> bool:
    lowered = user_message.lower()
    if not lowered.strip():
        return False

    # Any explicit first-person or direct "user" mention should resolve actor context
    # so planner operations can map pronouns like "me" to concrete actor_id values.
    broad_actor_reference_patterns = (
        r'\bme\b',
        r'\bmy\b',
        r'\bmine\b',
        r'\bmyself\b',
        r"\bi\b",
        r"\bi(?:'|\u2019)(?:m|ve|d|ll)\b",
        r'\buser(?:\'s)?\b',
    )
    if any(re.search(pattern, lowered) for pattern in broad_actor_reference_patterns):
        return True

    actor_required_patterns = (
        r'\bmy(?:\s+\w+){0,2}\s+tasks?\b',
        r'\bassigned\s+to\s+me\b',
        r'\btasks?\s+for\s+me\b',
        r'\bfor\s+me\b',
        r'\bmy\s+role\b',
        r'\bwhat\s+can\s+i\b',
    )
    return any(re.search(pattern, lowered) for pattern in actor_required_patterns)


def ensure_actor_context(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    nest_client: Any,
    run_async_call: Callable[[Any], dict[str, Any]],
    logger: logging.Logger,
    settings: Any,
    actor_refresh_failures_key: str = 'actor_context_refresh_failures',
) -> None:
    if not auth_header:
        clear_actor_context_for_missing_auth(
            session=session,
            trace_id=trace_id,
            logger=logger,
            settings=settings,
            actor_refresh_failures_key=actor_refresh_failures_key,
        )
        return

    previous_actor_context = session.metadata.actor_context
    try:
        actor_payload = run_async_call(
            nest_client.context_actor(
                roadmap_id=session.roadmap_id,
                auth_header=auth_header,
                trace_id=trace_id,
            )
        )
        session.metadata.actor_context = ActorContext.model_validate(
            {
                **actor_payload,
                'actor_context_source': 'backend_context_actor',
            }
        )
        setattr(session.metadata, actor_refresh_failures_key, 0)
    except HTTPException as exc:
        refresh_failures = int(
            getattr(session.metadata, actor_refresh_failures_key, 0) or 0
        ) + 1
        setattr(session.metadata, actor_refresh_failures_key, refresh_failures)
        keep_previous = (
            previous_actor_context is not None
            and previous_actor_context.actor_context_source == 'backend_context_actor'
            and refresh_failures <= 1
        )
        if not keep_previous:
            session.metadata.actor_context = None
        log_event(
            logger,
            'actor_context_refresh_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            status_code=exc.status_code,
            error='http_exception',
            keep_previous=keep_previous,
            refresh_failures=refresh_failures,
        )
        return
    except Exception:  # pragma: no cover
        refresh_failures = int(
            getattr(session.metadata, actor_refresh_failures_key, 0) or 0
        ) + 1
        setattr(session.metadata, actor_refresh_failures_key, refresh_failures)
        keep_previous = (
            previous_actor_context is not None
            and previous_actor_context.actor_context_source == 'backend_context_actor'
            and refresh_failures <= 1
        )
        if not keep_previous:
            session.metadata.actor_context = None
        log_event(
            logger,
            'actor_context_refresh_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            error='unexpected_exception',
            keep_previous=keep_previous,
            refresh_failures=refresh_failures,
        )
        return

    log_event(
        logger,
        'actor_context_loaded',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=session.roadmap_id,
        actor_present=True,
        roadmap_role=session.metadata.actor_context.roadmap_role,
        actor_context_source=session.metadata.actor_context.actor_context_source,
    )


def clear_actor_context_for_missing_auth(
    *,
    session: AgentSession,
    trace_id: str | None,
    logger: logging.Logger,
    settings: Any,
    actor_refresh_failures_key: str = 'actor_context_refresh_failures',
) -> None:
    if session.metadata.actor_context is not None:
        session.metadata.actor_context = None
        log_event(
            logger,
            'actor_context_cleared',
            settings=settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            reason='missing_auth_header',
        )
    setattr(session.metadata, actor_refresh_failures_key, 0)
