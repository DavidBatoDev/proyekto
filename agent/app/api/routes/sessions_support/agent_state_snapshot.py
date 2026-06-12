"""Durable snapshot of the agent's memory-class session state.

The Redis session expires (SESSION_TTL_SECONDS); without this snapshot the
web's rehydration replays only the last N text turns and everything the agent
"knew" — a pending plan awaiting confirmation, the undo log, recently
resolved targets — silently vanishes. After each turn that changed memory
state, the snapshot is pushed fire-and-forget to the backend
(roadmap_ai_sessions.metadata.agent_state) and replayed into
CreateSessionRequest.metadata when the web rehydrates.

Caches (roadmap overview, handle map, actor context, memory notes) are
deliberately excluded — they are refetched naturally on the next turn.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.contracts.sessions import AgentSession
from app.core.logging_utils import log_event

_logger = logging.getLogger(__name__)

SNAPSHOT_VERSION = 1
# Soft cap, comfortably under the backend's 64KB hard limit.
MAX_SNAPSHOT_BYTES = 32_768

_MEMORY_FIELDS = (
    'pending_plan',
    'pending_edit_context',
    'pending_context_resolution',
    'recent_resolved_targets',
    'recent_applied_changes',
    'applied_change_ids',
    'conversation_summary',
    'conversation_summary_folded_count',
)


def build_agent_state_snapshot(session: AgentSession) -> dict[str, Any] | None:
    """Memory-class fields only, JSON-ready. Returns None when nothing is
    worth persisting or the snapshot cannot be brought under the size cap."""
    metadata_dump = session.metadata.model_dump(
        mode='json',
        exclude_none=True,
        include=set(_MEMORY_FIELDS),
    )
    if not any(metadata_dump.get(field) for field in _MEMORY_FIELDS):
        return None

    snapshot: dict[str, Any] = {
        'snapshot_version': SNAPSHOT_VERSION,
        'saved_at': datetime.now(timezone.utc).isoformat(),
        **metadata_dump,
    }

    if _snapshot_bytes(snapshot) <= MAX_SNAPSHOT_BYTES:
        return snapshot

    # Trim in order of least-precious first; pending_plan is dropped last
    # because losing it is the exact amnesia this module exists to prevent.
    applied = snapshot.get('recent_applied_changes')
    if isinstance(applied, list) and len(applied) > 5:
        snapshot['recent_applied_changes'] = applied[:5]
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        targets = snapshot.get('recent_resolved_targets')
        if isinstance(targets, list) and len(targets) > 10:
            snapshot['recent_resolved_targets'] = targets[-10:]
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        edit_context = snapshot.get('pending_edit_context')
        if isinstance(edit_context, dict):
            edit_context.pop('last_tool_plan_summary', None)
            edit_context.pop('preview_validation_errors', None)
            edit_context.pop('staging_validation_errors', None)
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        snapshot.pop('pending_edit_context', None)
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        log_event(
            _logger,
            'agent_state_snapshot_skipped',
            settings=None,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            reason='over_size_cap_after_trim',
        )
        return None
    return snapshot


def snapshot_fingerprint(snapshot: dict[str, Any] | None) -> str:
    """Stable digest for change detection; `saved_at` excluded so an
    otherwise-identical snapshot doesn't count as a change."""
    if not snapshot:
        return 'empty'
    comparable = {k: v for k, v in snapshot.items() if k != 'saved_at'}
    canonical = json.dumps(comparable, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _snapshot_bytes(snapshot: dict[str, Any]) -> int:
    return len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8'))


async def push_agent_state_snapshot(
    *,
    nest_client: Any,
    roadmap_id: str,
    session_id: str,
    snapshot: dict[str, Any],
    auth_header: str,
    trace_id: str | None,
) -> None:
    """Fire-and-forget write-back. Never raises — the snapshot is a safety
    net, not a turn dependency."""
    try:
        await nest_client.put_session_agent_state(
            roadmap_id=roadmap_id,
            session_id=session_id,
            payload={'agent_state': snapshot},
            auth_header=auth_header,
            trace_id=trace_id,
        )
        log_event(
            _logger,
            'agent_state_snapshot_write_ok',
            settings=None,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            snapshot_bytes=_snapshot_bytes(snapshot),
        )
    except Exception as exc:  # noqa: BLE001 — never block or fail the turn
        log_event(
            _logger,
            'agent_state_snapshot_write_failed',
            settings=None,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            error=str(exc)[:300],
        )
