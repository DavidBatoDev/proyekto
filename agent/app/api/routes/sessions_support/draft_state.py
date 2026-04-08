from __future__ import annotations

from datetime import datetime
from typing import Callable

from app.core.contracts.sessions import AgentSession, DraftNode
from app.core.orchestration.agent_service import AgentService


def resolve_draft_snapshot(
    *,
    session: AgentSession,
    agent_service: AgentService,
    draft_graph_enabled: bool,
) -> tuple[str, int, list]:
    if draft_graph_enabled:
        ensure_fn = getattr(agent_service, 'ensure_draft_graph_initialized', None)
        get_active_fn = getattr(agent_service, 'get_active_draft', None)
        if callable(ensure_fn) and callable(get_active_fn):
            ensure_fn(session)
            active_draft = get_active_fn(session)
            return active_draft.draft_id, active_draft.draft_version, active_draft.operations

        drafts = session.metadata.drafts
        if not isinstance(drafts, dict):
            raise RuntimeError('Draft graph metadata is malformed: drafts must be a mapping.')

        active_draft_id = session.metadata.active_draft_id
        if active_draft_id:
            draft = drafts.get(active_draft_id)
            if isinstance(draft, DraftNode):
                return draft.draft_id, draft.draft_version, draft.operations
        raise RuntimeError('Draft graph runtime does not expose active draft helpers.')

    draft_id = session.metadata.active_draft_id or f'{session.session_id}:draft'
    return draft_id, session.staged_operations_version, session.operations


def set_draft_status(
    *,
    session: AgentSession,
    draft_id: str,
    status: str,
    utcnow: Callable[[], datetime],
) -> bool:
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


def get_draft_parent_id(
    *,
    session: AgentSession,
    draft_id: str,
) -> str | None:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return None
    if hasattr(candidate, 'parent_draft_id'):
        parent_draft_id = candidate.parent_draft_id
        return parent_draft_id if isinstance(parent_draft_id, str) and parent_draft_id else None
    if isinstance(candidate, dict):
        parent_draft_id = candidate.get('parent_draft_id')
        return parent_draft_id if isinstance(parent_draft_id, str) and parent_draft_id else None
    return None


def get_draft_status(
    *,
    session: AgentSession,
    draft_id: str,
) -> str | None:
    candidate = session.metadata.drafts.get(draft_id)
    if candidate is None:
        return None
    if hasattr(candidate, 'status'):
        status = candidate.status
        return status if isinstance(status, str) and status else None
    if isinstance(candidate, dict):
        status = candidate.get('status')
        return status if isinstance(status, str) and status else None
    return None


def is_descendant_of_draft(
    session: AgentSession,
    *,
    draft_id: str,
    ancestor_draft_id: str,
    get_parent_id: Callable[..., str | None],
) -> bool:
    visited: set[str] = set()
    current = get_parent_id(session=session, draft_id=draft_id)
    while current is not None and current not in visited:
        if current == ancestor_draft_id:
            return True
        visited.add(current)
        current = get_parent_id(session=session, draft_id=current)
    return False


def repoint_active_draft_after_commit(
    session: AgentSession,
    *,
    selected_draft_id: str,
    is_descendant: Callable[..., bool],
    get_status: Callable[..., str | None],
    set_status: Callable[..., bool],
) -> int:
    if selected_draft_id not in session.metadata.drafts:
        return 0

    session.metadata.active_draft_id = selected_draft_id
    session.metadata.draft_head_ids = [selected_draft_id]

    abandoned_descendants = 0
    for candidate_draft_id in list(session.metadata.drafts.keys()):
        if candidate_draft_id == selected_draft_id:
            continue
        if not is_descendant(
            session,
            draft_id=candidate_draft_id,
            ancestor_draft_id=selected_draft_id,
        ):
            continue

        current_status = get_status(session=session, draft_id=candidate_draft_id)
        if current_status in {'applied', 'abandoned'}:
            continue

        if set_status(session=session, draft_id=candidate_draft_id, status='abandoned'):
            abandoned_descendants += 1

    return abandoned_descendants


def reuse_selected_draft_as_post_commit_head(
    session: AgentSession,
    *,
    selected_draft_id: str,
    utcnow: Callable[[], datetime],
) -> int:
    candidate = session.metadata.drafts.get(selected_draft_id)
    if candidate is None:
        raise RuntimeError(
            f'Cannot reuse draft as post-commit head; draft not found: {selected_draft_id}'
        )

    now = utcnow()
    if hasattr(candidate, 'operations') and hasattr(candidate, 'draft_version'):
        next_version = (
            candidate.draft_version + 1
            if isinstance(candidate.draft_version, int)
            else 1
        )
        candidate.operations = []
        candidate.draft_version = next_version
        candidate.status = 'active'
        candidate.updated_at = now
    elif isinstance(candidate, dict):
        current_version = candidate.get('draft_version')
        next_version = current_version + 1 if isinstance(current_version, int) else 1
        candidate['operations'] = []
        candidate['draft_version'] = next_version
        candidate['status'] = 'active'
        candidate['updated_at'] = now
    else:
        raise RuntimeError(
            f'Cannot reuse draft as post-commit head; malformed draft: {selected_draft_id}'
        )

    session.metadata.active_draft_id = selected_draft_id
    session.metadata.draft_head_ids = [selected_draft_id]
    return next_version
