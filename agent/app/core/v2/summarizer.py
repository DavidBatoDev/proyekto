"""Rolling conversation compaction for long threads.

Past ``AGENT_SUMMARY_TRIGGER_MESSAGES`` the oldest turns silently fall out of
the prompt window and ``session.messages`` grows unbounded in Redis. This
module folds those turns into a rolling summary instead:

1. **Compute (post-turn, fire-and-forget):** a background task re-reads the
   session, summarizes the turns beyond the keep-window on a cheap model, and
   writes the result to a SIDE Redis key — never to the session document
   (blind-SET saves from the request path would race a background write).
2. **Apply (next turn start, single-writer window):** before the loop runs,
   the candidate is validated against the current message list via
   fingerprints and, on match, folded into ``metadata.conversation_summary``
   while the folded messages are truncated away. The turn's normal saves
   persist it, and the durable agent-state snapshot carries it past Redis
   expiry.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from app.core.contracts.sessions import AgentSession, Message
from app.core.logging_utils import log_event
from app.core.session_store import SessionStore
from app.core.v2.openai_client import V2LLMClient

_logger = logging.getLogger(__name__)

_SUMMARY_SYSTEM_PROMPT = (
    'You maintain a running summary of a conversation between a user and a '
    'roadmap-planning assistant. Merge the previous summary (if any) with the '
    'new conversation turns into ONE updated summary. Preserve: decisions '
    'made, roadmap items mentioned by name, user preferences, and unresolved '
    'questions. Drop pleasantries and repetition. Maximum 300 words. Reply '
    'with the summary text only.'
)


def _message_fingerprint(message: Message) -> str:
    raw = f'{message.role}\x1f{message.content}\x1f{message.created_at.isoformat()}'
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def should_schedule_compaction(session: AgentSession, settings: Any) -> bool:
    return len(session.messages) > max(2, int(settings.agent_summary_trigger_messages))


async def run_summary_compaction(
    *,
    store: SessionStore,
    session_id: str,
    settings: Any,
    trace_id: str | None,
) -> None:
    """Background compute step. Never raises."""
    try:
        session = await asyncio.to_thread(store.get, session_id)
        if session is None:
            return
        keep = max(1, int(settings.agent_summary_keep_messages))
        fold_count = len(session.messages) - keep
        if fold_count <= 0:
            return
        folded = session.messages[:fold_count]
        transcript_lines = [
            f'{item.role}: {item.content}'
            for item in folded
            if item.role in {'user', 'assistant'} and (item.content or '').strip()
        ]
        if not transcript_lines:
            # Nothing textual to fold (tool-call pairs only) — still safe to
            # truncate, but without an LLM call: keep the previous summary.
            summary = session.metadata.conversation_summary or ''
        else:
            previous = session.metadata.conversation_summary or '(none)'
            user_payload = (
                f'Previous summary:\n{previous}\n\n'
                'New turns to merge:\n' + '\n'.join(transcript_lines)
            )
            client = V2LLMClient(settings, model=settings.agent_summary_model)
            response = await asyncio.to_thread(
                client.complete,
                [
                    {'role': 'system', 'content': _SUMMARY_SYSTEM_PROMPT},
                    {'role': 'user', 'content': user_payload},
                ],
                [],
            )
            summary = (response.content or '').strip()
            if not summary:
                return
        max_chars = max(500, int(settings.agent_summary_max_chars))
        candidate = {
            'summary': summary[:max_chars],
            'fold_count': fold_count,
            'first_fp': _message_fingerprint(folded[0]),
            'last_fp': _message_fingerprint(folded[-1]),
        }
        await asyncio.to_thread(store.set_summary_candidate, session_id, candidate)
        log_event(
            _logger,
            'summary_candidate_written',
            settings=settings,
            trace_id=trace_id,
            session_id=session_id,
            fold_count=fold_count,
            summary_chars=len(candidate['summary']),
        )
    except Exception as exc:  # noqa: BLE001 — compaction must never hurt a turn
        log_event(
            _logger,
            'summary_compaction_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session_id,
            error=str(exc)[:300],
        )


def apply_pending_compaction(
    store: SessionStore,
    session: AgentSession,
    settings: Any,
    trace_id: str | None = None,
) -> bool:
    """Turn-start apply step (request path = single writer). Mutates the
    in-memory session only; the turn's normal saves persist the result.
    Returns True when a candidate was applied."""
    try:
        candidate = store.get_summary_candidate(session.session_id)
    except Exception:  # noqa: BLE001 — side-channel read is best-effort
        return False
    if not candidate:
        return False

    fold_count = candidate.get('fold_count')
    summary = candidate.get('summary')
    if (
        not isinstance(fold_count, int)
        or fold_count <= 0
        or not isinstance(summary, str)
        or not summary.strip()
        or len(session.messages) < fold_count
    ):
        _discard_candidate(store, session.session_id)
        return False

    # Messages are append-only, so first/last fingerprints establish that the
    # prefix this candidate folded is still the session's prefix (a rehydrated
    # session seeded from the DB would not match — discard there).
    if (
        _message_fingerprint(session.messages[0]) != candidate.get('first_fp')
        or _message_fingerprint(session.messages[fold_count - 1]) != candidate.get('last_fp')
    ):
        _discard_candidate(store, session.session_id)
        return False

    session.metadata.conversation_summary = summary.strip()
    session.metadata.conversation_summary_folded_count += fold_count
    session.messages = session.messages[fold_count:]
    _discard_candidate(store, session.session_id)
    log_event(
        _logger,
        'summary_compaction_applied',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        fold_count=fold_count,
        remaining_messages=len(session.messages),
        total_folded=session.metadata.conversation_summary_folded_count,
    )
    return True


def _discard_candidate(store: SessionStore, session_id: str) -> None:
    try:
        store.delete_summary_candidate(session_id)
    except Exception:  # noqa: BLE001
        pass
