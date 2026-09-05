"""Durable snapshot of the agent's memory-class session state.

The Redis session expires (SESSION_TTL_SECONDS); without this snapshot the
web's rehydration replays only the last N text turns and everything the agent
"knew" — a pending plan awaiting confirmation, the undo log, recently
resolved targets, the active run — silently vanishes. At every checkpoint or
terminal that changed memory state, the snapshot is pushed fire-and-forget to
the backend (roadmap_ai_sessions.metadata.agent_state, by scope) and replayed
into CreateSessionRequest.metadata when the web rehydrates.

Caches (roadmap contexts, workspace overview, actor context) are deliberately
excluded — they are refetched naturally on the next turn.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.contracts.sessions import AgentSession
from app.core.logging_utils import log_event

_logger = logging.getLogger(__name__)

SNAPSHOT_VERSION = 2
# Soft cap, comfortably under the backend's 64KB hard limit.
MAX_SNAPSHOT_BYTES = 32_768

_MEMORY_FIELDS = (
    'pending_plan',
    'recent_resolved_targets',
    'recent_applied_changes',
    'change_history',
    'applied_change_ids',
    'conversation_summary',
    'conversation_summary_folded_count',
    'run',
    'run_history',
)

# Run fields that change every step without changing what the run IS; the
# fingerprint ignores them so a `continue` never triggers a snapshot push.
_VOLATILE_RUN_FIELDS = ('updated_at', 'step', 'tokens', 'phase_usage')
_TERMINAL_RUN_STATUSES = {'done', 'failed', 'cancelled'}


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
    # change_history (full per-node snapshots, newest first) is the heaviest
    # field — keep progressively fewer of the most recent groups. The latest
    # group is the common "undo that" target, so keep at least one if we can.
    for keep in (5, 2, 1):
        if _snapshot_bytes(snapshot) <= MAX_SNAPSHOT_BYTES:
            break
        history = snapshot.get('change_history')
        if isinstance(history, list) and len(history) > keep:
            snapshot['change_history'] = history[:keep]
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        targets = snapshot.get('recent_resolved_targets')
        if isinstance(targets, list) and len(targets) > 10:
            snapshot['recent_resolved_targets'] = targets[-10:]
    # Run ladder: history -> impacted items -> batch operations (the run can
    # then report but not resume execute: RUN_STATE_LOST) -> a finished run.
    for keep in (3, 0):
        if _snapshot_bytes(snapshot) <= MAX_SNAPSHOT_BYTES:
            break
        history = snapshot.get('run_history')
        if isinstance(history, list) and len(history) > keep:
            snapshot['run_history'] = history[:keep]
            if keep == 0:
                snapshot.pop('run_history', None)
    run = snapshot.get('run')
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES and isinstance(run, dict):
        for commit in run.get('commits') or []:
            if isinstance(commit, dict):
                commit.pop('impacted_items', None)
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES and isinstance(run, dict):
        truncated = False
        for batch in run.get('batches') or []:
            if isinstance(batch, dict) and batch.get('operations'):
                batch['operations'] = []
                truncated = True
        if truncated:
            run['batches_truncated'] = True
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES and isinstance(run, dict):
        if str(run.get('status') or '') in _TERMINAL_RUN_STATUSES:
            snapshot.pop('run', None)
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        snapshot.pop('pending_plan', None)
    if _snapshot_bytes(snapshot) > MAX_SNAPSHOT_BYTES:
        log_event(
            _logger,
            'agent_state_snapshot_skipped',
            settings=None,
            session_id=session.session_id,
            roadmap_id=session.scope.focus_roadmap_id,
            reason='over_size_cap_after_trim',
        )
        return None
    return snapshot


def snapshot_fingerprint(snapshot: dict[str, Any] | None) -> str:
    """Stable digest for change detection; `saved_at` and the run's volatile
    step/usage fields are excluded so an otherwise-identical snapshot (or a
    plain `continue`) doesn't count as a change."""
    if not snapshot:
        return 'empty'
    comparable = {k: copy.deepcopy(v) for k, v in snapshot.items() if k != 'saved_at'}
    run = comparable.get('run')
    if isinstance(run, dict):
        for field in _VOLATILE_RUN_FIELDS:
            run.pop(field, None)
    canonical = json.dumps(comparable, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _snapshot_bytes(snapshot: dict[str, Any]) -> int:
    return len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8'))


async def push_agent_state_snapshot(
    *,
    nest_client: Any,
    session_id: str,
    snapshot: dict[str, Any],
    auth_header: str,
    trace_id: str | None,
    scope: Any = None,
    roadmap_id: str | None = None,
) -> None:
    """Fire-and-forget write-back to the scope's ai-sessions agent-state
    endpoint. Never raises — the snapshot is a safety net, not a turn
    dependency."""
    kind = getattr(scope, 'kind', None) if scope is not None else None
    workspace_id = getattr(scope, 'workspace_id', None) if scope is not None else None
    target_roadmap_id = roadmap_id or (getattr(scope, 'roadmap_id', None) if scope is not None else None)
    try:
        if kind == 'workspace' and workspace_id:
            await nest_client.put_workspace_session_agent_state(
                workspace_id=workspace_id,
                session_id=session_id,
                payload={'agent_state': snapshot},
                auth_header=auth_header,
                trace_id=trace_id,
            )
        elif target_roadmap_id:
            await nest_client.put_session_agent_state(
                roadmap_id=target_roadmap_id,
                session_id=session_id,
                payload={'agent_state': snapshot},
                auth_header=auth_header,
                trace_id=trace_id,
            )
        else:
            return
        log_event(
            _logger,
            'agent_state_snapshot_write_ok',
            settings=None,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=target_roadmap_id,
            workspace_id=workspace_id,
            snapshot_bytes=_snapshot_bytes(snapshot),
        )
    except Exception as exc:  # noqa: BLE001 — never block or fail the turn
        log_event(
            _logger,
            'agent_state_snapshot_write_failed',
            settings=None,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=target_roadmap_id,
            workspace_id=workspace_id,
            error=str(exc)[:300],
        )


# Metadata keys the web may never smuggle in through CreateSessionRequest.
# Actor context is fetched from the backend as the user, never trusted from the
# client; these are stripped (recursively) before the session is created.
ACTOR_METADATA_KEYS = frozenset(
    {
        'actor_context',
        'actor_id',
        'roadmap_role',
        'actor_context_source',
        'display_name',
        'locale',
        'timezone',
        'fetched_at',
    }
)


def sanitize_session_metadata(
    metadata: dict[str, Any] | None,
    *,
    actor_metadata_keys: frozenset[str] | set[str] = ACTOR_METADATA_KEYS,
) -> tuple[dict[str, Any], bool]:
    if not isinstance(metadata, dict):
        return {}, False

    stripped = False

    def _walk(value: Any) -> Any:
        nonlocal stripped
        if isinstance(value, dict):
            cleaned: dict[str, Any] = {}
            for key, nested in value.items():
                key_text = str(key).strip().lower()
                if key_text in actor_metadata_keys:
                    stripped = True
                    continue
                cleaned[key] = _walk(nested)
            return cleaned
        if isinstance(value, list):
            return [_walk(item) for item in value]
        return value

    sanitized = _walk(metadata)
    if not isinstance(sanitized, dict):
        return {}, stripped
    return sanitized, stripped
