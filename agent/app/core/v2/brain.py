"""v2 entrypoint — the agent's single brain, called by ``AgentService.plan_message``.

Loads context (reusing the shared context/staging helpers), runs the single
tool-calling loop, and assembles a ``MessagePlanningOutcome``. Synchronous: it
runs in the route's worker thread. A provider failure degrades to a graceful
chat reply instead of a 500.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Callable

from app.core.contracts.sessions import AgentSession
from app.core.llm.context.dispatch import ToolDispatcher
from app.core.logging_utils import log_event
from app.core.orchestration.context.actor_context_provider import (
    ensure_actor_context as ensure_actor_context_helper,
)
from app.core.orchestration.shared.outcomes import MessagePlanningOutcome
from app.core.v2.context import build_messages
from app.core.v2.loop import LoopResult, run_loop
from app.core.v2.openai_client import V2LLMClient
from app.core.v2.progress import AssistantDeltaEmitter
from app.core.v2.sentinels import parse_and_fold
from app.core.v2.summarizer import apply_pending_compaction
from app.core.v2.terminal import to_outcome
from app.core.v2.tools_spec import build_tools

logger = logging.getLogger('app.core.v2')

# Reasoning effort escalates on "hard" turns. Ordered so we can take a max
# without downgrading a higher configured base.
_EFFORT_ORDER = {'minimal': 0, 'low': 1, 'medium': 2, 'high': 3}


def _message_references_ambiguous_title(
    message: str, handle_map: dict[str, Any]
) -> bool:
    """True when the message names a node title that more than one node shares
    (e.g. two features both called "Login"). Such an edit is ambiguous, so the
    turn should reason harder and raise a clarifier instead of guessing — at
    low effort the model picks the first match roughly half the time. Escalating
    is safe even when the user did disambiguate ("the Login under alpha"): more
    reasoning never forces a wrong pick, it just avoids a blind one."""
    if not message or not handle_map:
        return False
    counts: dict[str, int] = {}
    for entry in handle_map.values():
        title = entry.get('title') if isinstance(entry, dict) else None
        if not isinstance(title, str):
            continue
        norm = title.strip().lower()
        if norm:
            counts[norm] = counts.get(norm, 0) + 1
    lowered = message.lower()
    for norm, count in counts.items():
        if count < 2:
            continue
        # Word-boundary match so a duplicated title doesn't fire on a substring
        # buried inside an unrelated word.
        if re.search(rf'(?<!\w){re.escape(norm)}(?!\w)', lowered):
            return True
    return False


def _hard_turn_trigger(
    session: AgentSession, *, user_message: str, handle_map: dict[str, Any]
) -> str:
    """Which signal (if any) makes this a 'hard' turn warranting more reasoning:
    a plan awaiting confirmation, a previously-raised ambiguity being resolved,
    or a message targeting a title shared by multiple nodes. Returns 'none' for
    ordinary direct edits/chat. First match wins (used as the reported reason)."""
    if session.metadata.pending_plan is not None:
        return 'pending_plan'
    if session.metadata.pending_context_resolution is not None:
        return 'pending_context_resolution'
    if _message_references_ambiguous_title(user_message, handle_map):
        return 'ambiguous_title'
    return 'none'


def _turn_reasoning_effort(settings: Any, trigger: str) -> str | None:
    """Direct edits/chat run at the configured base (``low`` by default); a hard
    turn (trigger != 'none') escalates to at least ``medium``. Never downgrades a
    higher configured base, and respects ``None`` (reasoning disabled)."""
    base = settings.openai_v2_reasoning_effort
    if base is None:
        return None
    if trigger == 'none':
        return base
    if _EFFORT_ORDER.get(base, 1) >= _EFFORT_ORDER['medium']:
        return base
    return 'medium'


def run_v2_message(
    *,
    service: Any,
    session: AgentSession,
    user_message: str,
    replace: bool,
    auth_header: str | None,
    trace_id: str | None,
    utcnow: Callable[[], datetime],
) -> MessagePlanningOutcome:
    _ = replace  # API-compatible; v2 staging is append/draft-action driven.
    settings = service._settings

    # Fold any pending conversation-summary candidate before context builds —
    # the request path is the single writer, so applying here cannot race a
    # save (see app/core/v2/summarizer.py).
    apply_pending_compaction(service._store, session, settings, trace_id)

    # Context prep — reuse the v1 helpers so behavior matches exactly.
    _ensure_actor_context(service, session, auth_header, trace_id)
    service._ensure_roadmap_overview_summary(
        session=session,
        auth_header=auth_header,
        trace_id=trace_id,
    )
    service._ensure_memory_notes(
        session=session,
        auth_header=auth_header,
        trace_id=trace_id,
    )
    session_context = service._build_session_context(session, auth_header, trace_id)

    folded_message = parse_and_fold(session, user_message)
    handle_map = dict(session.metadata.roadmap_handle_map)
    messages = build_messages(session, session_context, folded_message)

    actor = session.metadata.actor_context
    actor_id = actor.actor_id if actor is not None else None

    pending_plan = session.metadata.pending_plan
    pending_plan_titles = _pending_plan_titles(pending_plan)
    tools = build_tools(has_pending_plan=pending_plan is not None)
    # Only override the client's configured effort when this turn escalates it;
    # otherwise pass None so the client uses its default and the common path
    # stays byte-identical to the pre-escalation call.
    effort_trigger = _hard_turn_trigger(
        session, user_message=user_message, handle_map=handle_map
    )
    resolved_effort = _turn_reasoning_effort(settings, effort_trigger)
    reasoning_effort = (
        resolved_effort
        if resolved_effort != settings.openai_v2_reasoning_effort
        else None
    )
    # Observability for the adaptive-effort feature: records the effort this turn
    # runs at and which signal (if any) escalated it. Grep logs for
    # `reasoning_effort_selected` to confirm low→medium on hard turns.
    log_event(
        logger,
        'reasoning_effort_selected',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        brain='v2',
        effort=resolved_effort,
        escalated=reasoning_effort is not None,
        trigger=effort_trigger,
    )

    # Pin the prompt-cache to the roadmap: every session/turn on this roadmap
    # shares the same system-prompt + overview prefix, so routing them together
    # maximizes cache hits.
    client = V2LLMClient(settings, prompt_cache_key=f'roadmap:{session.roadmap_id}')
    dispatcher = ToolDispatcher(
        settings=settings,
        logger=service._logger,
        nest_client=service._nest_client,
    )
    # Streamed assistant text → throttled assistant_delta trace events the web
    # polls into a live typing preview. Needs a trace to attach to; the config
    # flag is the kill switch back to plain (non-streaming) model calls.
    delta_emitter = (
        AssistantDeltaEmitter(settings, trace_id)
        if trace_id and getattr(settings, 'openai_v2_streaming_enabled', False)
        else None
    )

    try:
        loop_result = run_loop(
            client=client,
            messages=messages,
            tools=tools,
            dispatcher=dispatcher,
            session_context=session_context,
            handle_map=handle_map,
            settings=settings,
            trace_id=trace_id,
            pending_plan_titles=pending_plan_titles,
            actor_id=actor_id,
            reasoning_effort=reasoning_effort,
            delta_emitter=delta_emitter,
        )
        # A save_memory/forget_memory tool ran this turn — drop the cached
        # notes so the next turn refetches the authoritative list.
        if session_context.get('memory_notes_dirty'):
            service.invalidate_memory_notes(session)
        return to_outcome(
            service=service,
            session=session,
            loop_result=loop_result,
            session_context=session_context,
            user_message=user_message,
            trace_id=trace_id,
            utcnow=utcnow,
        )
    except Exception as exc:  # noqa: BLE001 — keep the endpoint resilient
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.ERROR,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            brain='v2',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        fallback = LoopResult(
            kind='chat',
            assistant_message=(
                "I hit an issue reaching the model and couldn't process that "
                'just now. Please try again in a moment.'
            ),
            termination_reason='provider_error',
        )
        return to_outcome(
            service=service,
            session=session,
            loop_result=fallback,
            session_context=session_context,
            user_message=user_message,
            trace_id=trace_id,
            utcnow=utcnow,
            provider_used='rule_based',
            fallback_used=True,
            provider_error_code='v2_provider_error',
        )


def _pending_plan_titles(pending_plan: Any) -> frozenset[str]:
    """Lower-cased titles across a pending plan's epic/feature/task hierarchy.
    Used by the loop guard to tell a genuine plan revision from a misrouted
    live edit. Empty when no plan is pending.
    """
    if pending_plan is None:
        return frozenset()
    titles: set[str] = set()
    for epic in getattr(pending_plan, 'proposed_hierarchy', None) or []:
        _add_title(titles, getattr(epic, 'title', None))
        for feature in getattr(epic, 'features', None) or []:
            _add_title(titles, getattr(feature, 'title', None))
            for task in getattr(feature, 'tasks', None) or []:
                _add_title(titles, getattr(task, 'title', None))
    return frozenset(titles)


def _add_title(acc: set[str], title: Any) -> None:
    if isinstance(title, str) and title.strip():
        acc.add(title.strip().lower())


def _ensure_actor_context(
    service: Any,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
) -> None:
    """Best-effort, once-per-session actor fetch (gives the model the actor id
    for "assign to me"-style edits). Cached on session.metadata thereafter.
    """
    if session.metadata.actor_context is not None or not auth_header:
        return
    try:
        ensure_actor_context_helper(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            nest_client=service._nest_client,
            run_async_call=service._run_async_call,
            logger=service._logger,
            settings=service._settings,
            actor_refresh_failures_key=getattr(
                service, '_actor_refresh_failures_key', 'actor_context_refresh_failures'
            ),
        )
    except Exception:  # pragma: no cover - actor context is best-effort
        pass
