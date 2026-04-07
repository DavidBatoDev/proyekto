from __future__ import annotations

from fastapi import HTTPException, status

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode


def ensure_draft_graph_initialized(session: AgentSession) -> bool:
    initialization_applied = False
    drafts = session.metadata.drafts

    if not drafts:
        if session.operations or int(session.staged_operations_version or 0) > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    'code': 'LEGACY_SESSION_UNSUPPORTED',
                    'message': (
                        'This session uses legacy staged operations and is not compatible with '
                        'draft-graph-only mode. Please create a new session.'
                    ),
                },
            )
        root_draft = DraftNode(
            draft_id=f'{session.session_id}:root',
            parent_draft_id=None,
            draft_mode='append',
            operations=[],
            draft_version=0,
            base_revision=session.base_revision,
            revision_token=session.revision_token,
            summary='Initial root draft',
            status='active',
        )
        session.metadata.drafts[root_draft.draft_id] = root_draft
        session.metadata.active_draft_id = root_draft.draft_id
        session.metadata.draft_head_ids = [root_draft.draft_id]
        initialization_applied = True

    active_draft_id = session.metadata.active_draft_id
    if not active_draft_id or active_draft_id not in session.metadata.drafts:
        first_draft_id = next(iter(session.metadata.drafts), None)
        if first_draft_id is None:
            raise RuntimeError('Draft graph initialization failed because no drafts are available.')
        session.metadata.active_draft_id = first_draft_id
        if first_draft_id not in session.metadata.draft_head_ids:
            session.metadata.draft_head_ids.append(first_draft_id)
        initialization_applied = True

    return initialization_applied


def get_active_draft(session: AgentSession) -> DraftNode:
    active_draft_id = session.metadata.active_draft_id
    if not active_draft_id:
        raise RuntimeError('Active draft is not initialized.')
    draft = get_active_draft_if_available(session)
    if draft is None:
        raise RuntimeError(f'Active draft {active_draft_id} is missing from draft graph.')
    return draft


def get_active_draft_if_available(session: AgentSession) -> DraftNode | None:
    active_draft_id = session.metadata.active_draft_id
    if not isinstance(active_draft_id, str) or not active_draft_id:
        return None

    candidate = session.metadata.drafts.get(active_draft_id)
    if isinstance(candidate, DraftNode):
        return candidate
    if isinstance(candidate, dict):
        try:
            normalized_draft = DraftNode.model_validate(candidate)
        except Exception:
            return None
        session.metadata.drafts[active_draft_id] = normalized_draft
        return normalized_draft
    return None


def resolve_staged_state(
    session: AgentSession,
    *,
    draft_graph_enabled: bool,
    active_draft: DraftNode | None = None,
) -> tuple[list[RoadmapOperation], int]:
    if draft_graph_enabled:
        resolved_draft = active_draft or get_active_draft_if_available(session)
        if isinstance(resolved_draft, DraftNode):
            return resolved_draft.operations, int(resolved_draft.draft_version)
    return session.operations, int(session.staged_operations_version)
