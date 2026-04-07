from __future__ import annotations

from typing import Callable

from fastapi import HTTPException, status

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode
from app.core.session_store import SessionStore


def get_session_or_404(
    *,
    store: SessionStore,
    session_id: str,
) -> AgentSession:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Session {session_id} was not found or has expired.',
        )
    return session


def resolve_session_staged_state(
    *,
    session: AgentSession,
    draft_graph_enabled: bool | None,
    active_draft: DraftNode | None,
    settings_agent_draft_graph_enabled: bool,
    resolve_staged_state: Callable[..., tuple[list[RoadmapOperation], int]],
) -> tuple[list[RoadmapOperation], int]:
    use_draft_graph = (
        settings_agent_draft_graph_enabled
        if draft_graph_enabled is None
        else draft_graph_enabled
    )
    return resolve_staged_state(
        session,
        draft_graph_enabled=use_draft_graph,
        active_draft=active_draft,
    )


def get_current_staged_operations(
    *,
    session: AgentSession,
    resolve_staged_state: Callable[[AgentSession], tuple[list[RoadmapOperation], int]],
) -> list[RoadmapOperation]:
    staged_operations, _ = resolve_staged_state(session)
    return staged_operations


def get_current_staged_operations_version(
    *,
    session: AgentSession,
    resolve_staged_state: Callable[[AgentSession], tuple[list[RoadmapOperation], int]],
) -> int:
    _, staged_operations_version = resolve_staged_state(session)
    return staged_operations_version
