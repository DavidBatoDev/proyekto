from __future__ import annotations

from datetime import datetime
from typing import Callable

from app.core.contracts.sessions import AgentSession


def resolve_draft_snapshot(
    *,
    session: AgentSession,
) -> tuple[str, int, list]:
    # Drafts/branching were removed; staged edits live directly on the session.
    draft_id = session.metadata.active_draft_id or f'{session.session_id}:draft'
    return draft_id, session.staged_operations_version, session.operations


def set_draft_status(
    *,
    session: AgentSession,
    draft_id: str,
    status: str,
    utcnow: Callable[[], datetime],
) -> bool:
    # Safe no-op unless a legacy DraftNode/dict is still present on the session.
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return False

    if hasattr(candidate, 'status') and hasattr(candidate, 'updated_at'):
        candidate.status = status
        candidate.updated_at = utcnow()
        return True

    if isinstance(candidate, dict):
        candidate['status'] = status
        candidate['updated_at'] = utcnow()
        return True

    return False
