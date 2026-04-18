from __future__ import annotations

from typing import Any, Callable

from app.core.contracts.sessions import AgentSession, DraftNode


def build_session_context(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    get_active_draft_if_available: Callable[[AgentSession], DraftNode | None],
    get_recent_resolved_targets: Callable[[AgentSession], list[Any]],
) -> dict[str, Any]:
    active_draft = get_active_draft_if_available(session)
    staged_operations_count = (
        len(active_draft.operations)
        if isinstance(active_draft, DraftNode)
        else len(session.operations)
    )
    recent_messages = [
        {'role': item.role, 'content': item.content}
        for item in session.messages[-settings.max_chat_history_messages :]
    ]
    recent_resolved_targets = [
        target.model_dump(mode='json', exclude_none=True)
        for target in get_recent_resolved_targets(session)
    ]
    return {
        'roadmap_id': session.roadmap_id,
        'base_revision': session.base_revision,
        'revision_token': session.revision_token,
        'staged_operations_count': staged_operations_count,
        'active_draft_id': session.metadata.active_draft_id,
        'active_draft_version': (
            active_draft.draft_version if active_draft is not None else None
        ),
        'active_draft_mode': (
            active_draft.draft_mode if active_draft is not None else None
        ),
        'last_intent_type': session.last_intent_type,
        'recent_messages': recent_messages,
        'recent_resolved_targets': recent_resolved_targets,
        'auth_header': auth_header,
        'trace_id': trace_id,
        'actor_context': (
            session.metadata.actor_context.model_dump(mode='json', exclude_none=True)
            if session.metadata.actor_context is not None
            else None
        ),
        'actor_present': session.metadata.actor_context is not None,
        'roadmap_role': (
            session.metadata.actor_context.roadmap_role
            if session.metadata.actor_context is not None
            else None
        ),
        'actor_context_source': (
            session.metadata.actor_context.actor_context_source
            if session.metadata.actor_context is not None
            else None
        ),
        'pending_context_resolution': (
            session.metadata.pending_context_resolution.model_dump(
                mode='json',
                exclude_none=True,
            )
            if session.metadata.pending_context_resolution is not None
            else None
        ),
        'pending_edit_context': (
            session.metadata.pending_edit_context.model_dump(
                mode='json',
                exclude_none=True,
            )
            if session.metadata.pending_edit_context is not None
            else None
        ),
        'roadmap_overview_summary': session.metadata.roadmap_overview_summary,
        'recent_applied_changes': [
            change.model_dump(mode='json', exclude_none=True)
            for change in session.metadata.recent_applied_changes
        ],
        'pending_plan': (
            session.metadata.pending_plan.model_dump(mode='json', exclude_none=True)
            if (
                session.metadata.pending_plan is not None
                and session.metadata.pending_plan.status == 'proposed'
            )
            else None
        ),
    }
