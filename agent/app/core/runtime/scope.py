"""Session-scope helpers.

A session is focused on one roadmap (``kind='roadmap'``: bare ``E1`` handles,
in-roadmap behaviour byte for byte) or on a workspace (``kind='workspace'``:
no focus roadmap; everything the user can access is in reach). The scope key
doubles as the prompt-cache key and the run lock's scope label.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.sessions import AgentSession, SessionScope


def prompt_cache_key(scope: SessionScope) -> str:
    """Investigate/verify prompt-cache key: the scope key. Materialize and
    repair loops use ``roadmap:{rid}`` for the roadmap they are pinned to."""
    return scope.key


def roadmap_cache_key(roadmap_id: str) -> str:
    return f'roadmap:{roadmap_id}'


def focus_roadmap_id(session: AgentSession) -> str | None:
    """The roadmap bare handles refer to — the scope roadmap, or None in
    workspace scope (every loaded roadmap is prefixed there)."""
    return session.scope.focus_roadmap_id


def default_roadmap_id(session: AgentSession, run: Any = None) -> str | None:
    """The roadmap a read tool targets when the model omits ``roadmap_id``:
    the scope roadmap, or — in workspace scope — the single accessible
    referenced roadmap when the run mentions exactly one. Handles stay
    prefixed for the latter; this is only a tool-argument default."""
    scoped = session.scope.focus_roadmap_id
    if scoped:
        return scoped
    if run is None:
        return None
    candidates: list[str] = []
    for ref in getattr(run, 'resolved_refs', None) or []:
        if not getattr(ref, 'accessible', False):
            continue
        roadmap_id = ref.id if getattr(ref, 'kind', None) == 'roadmap' else getattr(ref, 'roadmap_id', None)
        if isinstance(roadmap_id, str) and roadmap_id and roadmap_id not in candidates:
            candidates.append(roadmap_id)
    if len(candidates) == 1:
        return candidates[0]
    return None


def workspace_id(session: AgentSession) -> str | None:
    """The scope workspace, or the focus roadmap's workspace when known."""
    if session.scope.kind == 'workspace':
        return session.scope.workspace_id
    focus = session.scope.focus_roadmap_id
    context = session.metadata.roadmaps.get(focus) if focus else None
    return getattr(context, 'workspace_id', None) if context is not None else None


def focus_project_id(session: AgentSession) -> str | None:
    """The focus roadmap's project id when the roadmap context (or its cached
    project pack) knows it; None otherwise."""
    focus = session.scope.focus_roadmap_id
    if not focus:
        return None
    context = session.metadata.roadmaps.get(focus)
    if context is None:
        return None
    if context.project_id:
        return context.project_id
    pack = context.project_context
    project = pack.get('project') if isinstance(pack, dict) else None
    project_id = project.get('id') if isinstance(project, dict) else None
    return project_id if isinstance(project_id, str) and project_id else None


def loaded_project_ids(session: AgentSession) -> list[str]:
    """Projects of the focus + loaded roadmaps (knowledge-search default),
    focus first, deduplicated."""
    ordered: list[str] = []
    focus = session.scope.focus_roadmap_id
    contexts = list(session.metadata.roadmaps.values())
    contexts.sort(key=lambda ctx: 0 if ctx.roadmap_id == focus else 1)
    for context in contexts:
        project_id = context.project_id
        if not project_id:
            pack = context.project_context
            project = pack.get('project') if isinstance(pack, dict) else None
            project_id = project.get('id') if isinstance(project, dict) else None
        if isinstance(project_id, str) and project_id and project_id not in ordered:
            ordered.append(project_id)
    return ordered
