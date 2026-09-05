"""Per-session context caches, keyed by roadmap.

Every loaded roadmap has a ``RoadmapContext`` in ``session.metadata.roadmaps``
holding its outline (handle map), revision token, memory notes and project
context. The scope roadmap (roadmap scope) is the *focus* and keeps bare
``E1`` handles; every other roadmap gets an ``R{n}`` prefix that is handed
out monotonically and never reused in a session. Workspace-scope sessions
have no focus roadmap: everything they load is prefixed.

Each loader is idempotent per turn: it returns early when the cache is fresh,
otherwise it fetches through the NestJS client (as the user, so authorization
stays on the backend) and stamps the cache. The overview is invalidated by a
commit (``invalidate_overview``); memory notes, project context and the
workspace overview expire on ``AGENT_CACHE_TTL_SECONDS``. Every loader is
best-effort — a failed fetch leaves the session as it was.

Dependencies are passed explicitly (settings, nest client, logger, the
sync->async bridge) so the loaders can run from any caller that holds them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import HTTPException

from app.core.contracts.sessions import AgentSession, RoadmapContext
from app.core.logging_utils import log_event
from app.core.runtime.overview import (
    DEFAULT_MAX_EPICS,
    DEFAULT_MAX_FEATURES_PER_EPIC,
    NON_FOCUS_MAX_EPICS,
    NON_FOCUS_MAX_FEATURES_PER_EPIC,
    extract_revision_token,
    format_overview_summary,
)

RunAsyncCall = Callable[[Any], dict[str, Any]]


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clean_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _cache_is_fresh(fetched_at: datetime | None, ttl_seconds: Any) -> bool:
    if fetched_at is None:
        return False
    try:
        ttl = float(ttl_seconds)
    except (TypeError, ValueError):
        ttl = 0.0
    return (_utcnow() - fetched_at).total_seconds() < ttl


# ---------------------------------------------------------------------------
# Roadmap overview + handle prefixes
# ---------------------------------------------------------------------------


def is_loaded(session: AgentSession, roadmap_id: str | None) -> bool:
    """True when the roadmap has a fresh (non-invalidated) outline cached."""
    if not roadmap_id:
        return False
    context = session.metadata.roadmaps.get(roadmap_id)
    return context is not None and context.overview_fetched_at is not None


def touch(session: AgentSession, roadmap_id: str | None) -> None:
    if not roadmap_id:
        return
    context = session.metadata.roadmaps.get(roadmap_id)
    if context is not None:
        context.last_used_at = _utcnow()


def assign_handle_prefix(session: AgentSession, roadmap_id: str, *, as_focus: bool) -> str | None:
    """The prefix a roadmap renders with. The focus roadmap has none; a roadmap
    that already holds a prefix keeps it; anything else takes the next
    ``R{n}`` (monotonic; an evicted-and-reloaded roadmap gets a NEW index so a
    stale handle in the conversation can never alias a different node)."""
    if as_focus:
        return None
    existing = session.metadata.roadmaps.get(roadmap_id)
    if existing is not None and existing.handle_prefix:
        return existing.handle_prefix
    index = max(1, int(session.metadata.next_handle_prefix_index or 1))
    session.metadata.next_handle_prefix_index = index + 1
    return f'R{index}'


def register_roadmap_from_summary(
    session: AgentSession,
    roadmap_id: str,
    payload: dict[str, Any],
    *,
    as_focus: bool | None = None,
) -> RoadmapContext:
    """Pure (no I/O) half of ``load_roadmap``: render the summary payload into
    a ``RoadmapContext`` and store it. Also used by the ``on_roadmap_loaded``
    tool callback so a roadmap the model reads mid-loop gets the same
    handles the next prompt will show."""
    if as_focus is None:
        as_focus = roadmap_id == session.scope.focus_roadmap_id
    prefix = assign_handle_prefix(session, roadmap_id, as_focus=as_focus)
    max_epics = DEFAULT_MAX_EPICS if as_focus else NON_FOCUS_MAX_EPICS
    max_features = DEFAULT_MAX_FEATURES_PER_EPIC if as_focus else NON_FOCUS_MAX_FEATURES_PER_EPIC
    summary, handle_map = format_overview_summary(
        payload,
        max_epics=max_epics,
        max_features_per_epic=max_features,
        handle_prefix=prefix,
        roadmap_id=roadmap_id,
    )
    now = _utcnow()
    context = session.metadata.roadmaps.get(roadmap_id)
    if context is None:
        context = RoadmapContext(roadmap_id=roadmap_id, loaded_at=now)
        session.metadata.roadmaps[roadmap_id] = context
    context.handle_prefix = prefix
    context.title = _clean_str(payload.get('title')) or context.title
    project = payload.get('project')
    project_id = _clean_str(payload.get('project_id'))
    workspace_id = _clean_str(payload.get('workspace_id'))
    if isinstance(project, dict):
        project_id = project_id or _clean_str(project.get('id'))
        workspace_id = workspace_id or _clean_str(project.get('workspace_id'))
    if project_id:
        context.project_id = project_id
    if workspace_id:
        context.workspace_id = workspace_id
    context.overview_summary = summary
    context.overview_fetched_at = now
    context.handle_map = handle_map
    fresh_token = extract_revision_token(payload)
    if fresh_token:
        context.revision_token = fresh_token
        if as_focus:
            # Legacy mirror for the focus roadmap (CreateSessionResponse).
            session.revision_token = fresh_token
    base_revision = payload.get('base_revision')
    if isinstance(base_revision, int) and not isinstance(base_revision, bool):
        context.base_revision = base_revision
    elif as_focus and context.base_revision is None:
        context.base_revision = session.base_revision
    context.last_used_at = now
    return context


def load_roadmap(
    *,
    session: AgentSession,
    roadmap_id: str,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: RunAsyncCall,
    as_focus: bool | None = None,
    run: Any = None,
    force: bool = False,
    reason: str = 'turn',
) -> RoadmapContext | None:
    """Ensure ``roadmap_id`` is loaded: ``GET /roadmaps/{id}/ai/context/summary``
    rendered into a ``RoadmapContext`` (see ``register_roadmap_from_summary``).

    Returns the context (cached or fresh), or ``None`` when the roadmap could
    not be fetched (403/404 → the caller treats it as inaccessible; transport
    errors are logged and also yield ``None``). Loading above
    ``AGENT_MAX_LOADED_ROADMAPS`` evicts the least recently used roadmap that
    is neither the focus roadmap nor in ``run.focus_roadmap_ids``.
    """
    roadmap_id = str(roadmap_id or '').strip()
    if not roadmap_id or not auth_header:
        return session.metadata.roadmaps.get(roadmap_id) if roadmap_id else None
    if as_focus is None:
        as_focus = roadmap_id == session.scope.focus_roadmap_id
    existing = session.metadata.roadmaps.get(roadmap_id)
    if existing is not None and existing.overview_fetched_at is not None and not force:
        existing.last_used_at = _utcnow()
        return existing
    try:
        payload = run_async_call(
            nest_client.context_summary(
                roadmap_id=roadmap_id,
                preview_id=None,
                auth_header=auth_header,
                trace_id=trace_id,
            )
        )
    except HTTPException as exc:
        log_event(
            logger,
            'roadmap_load_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=roadmap_id,
            status_code=exc.status_code,
            reason=reason,
        )
        return None
    except Exception as exc:  # noqa: BLE001 — a missing outline never fails the turn
        log_event(
            logger,
            'roadmap_load_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=roadmap_id,
            error=type(exc).__name__,
            reason=reason,
        )
        return None
    if not isinstance(payload, dict) or isinstance(payload.get('error'), dict):
        log_event(
            logger,
            'roadmap_overview_summary_fetch_empty',
            settings=settings,
            trace_id=trace_id,
            roadmap_id=roadmap_id,
            session_id=session.session_id,
            reason='backend_returned_no_summary',
        )
        return None
    previous_token = existing.revision_token if existing is not None else session.revision_token
    context = register_roadmap_from_summary(session, roadmap_id, payload, as_focus=as_focus)
    log_event(
        logger,
        'roadmap_overview_summary_loaded',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=roadmap_id,
        session_id=session.session_id,
        handle_prefix=context.handle_prefix,
        summary_chars=len(context.overview_summary or ''),
        summary_lines=(context.overview_summary or '').count('\n') + 1,
        handle_map_size=len(context.handle_map),
        # Emit full summary so we can confirm post-commit freshness
        # end-to-end without guessing from a 240-char preview.
        summary_full=context.overview_summary,
        reason=reason,
    )
    if context.revision_token and context.revision_token != previous_token:
        # The backend derives the token from the roadmap's latest updated_at,
        # so every summary fetch captures out-of-band writes that would
        # otherwise 409 STALE_REVISION on the next commit.
        log_event(
            logger,
            'roadmap_revision_token_refreshed',
            settings=settings,
            trace_id=trace_id,
            roadmap_id=roadmap_id,
            session_id=session.session_id,
            source='context_summary',
            previous_token=previous_token,
            current_token=context.revision_token,
        )
    evict_stale_roadmaps(
        session,
        max_loaded=getattr(settings, 'agent_max_loaded_roadmaps', 6),
        protected=protected_roadmap_ids(session, run) | {roadmap_id},
    )
    return context


def protected_roadmap_ids(session: AgentSession, run: Any = None) -> set[str]:
    """Roadmaps the LRU may never evict: the scope focus plus the run's focus set."""
    protected: set[str] = set()
    focus = session.scope.focus_roadmap_id
    if focus:
        protected.add(focus)
    for roadmap_id in getattr(run, 'focus_roadmap_ids', None) or []:
        if isinstance(roadmap_id, str) and roadmap_id:
            protected.add(roadmap_id)
    return protected


def evict_stale_roadmaps(
    session: AgentSession,
    *,
    max_loaded: Any,
    protected: set[str] | None = None,
) -> list[str]:
    """Drop least-recently-used roadmap contexts above ``max_loaded``, never
    touching ``protected`` ids. Returns the evicted roadmap ids."""
    try:
        cap = max(1, int(max_loaded))
    except (TypeError, ValueError):
        cap = 6
    roadmaps = session.metadata.roadmaps
    if len(roadmaps) <= cap:
        return []
    protected = protected or set()
    candidates = sorted(
        (context for rid, context in roadmaps.items() if rid not in protected),
        key=lambda context: (context.last_used_at, context.loaded_at),
    )
    evicted: list[str] = []
    for context in candidates:
        if len(roadmaps) <= cap:
            break
        roadmaps.pop(context.roadmap_id, None)
        evicted.append(context.roadmap_id)
    return evicted


def invalidate_overview(session: AgentSession, roadmap_id: str | None) -> None:
    """Forget a roadmap's outline after a commit (or a failed one) so the next
    turn refetches it. The context itself (title, prefix, project, memory
    notes) stays so handles keep their prefix."""
    if not roadmap_id:
        return
    context = session.metadata.roadmaps.get(roadmap_id)
    if context is None:
        return
    context.overview_summary = None
    context.overview_fetched_at = None
    context.handle_map = {}


def refresh_focus_for_run(
    *,
    session: AgentSession,
    run: Any,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: RunAsyncCall,
) -> list[RoadmapContext]:
    """Load the scope roadmap (roadmap scope) and every roadmap in
    ``run.focus_roadmap_ids`` that is missing or invalidated. Returns the
    contexts that are loaded afterwards, focus first."""
    wanted: list[str] = []
    focus = session.scope.focus_roadmap_id
    if focus:
        wanted.append(focus)
    for roadmap_id in getattr(run, 'focus_roadmap_ids', None) or []:
        if isinstance(roadmap_id, str) and roadmap_id and roadmap_id not in wanted:
            wanted.append(roadmap_id)
    loaded: list[RoadmapContext] = []
    for roadmap_id in wanted:
        context = load_roadmap(
            session=session,
            roadmap_id=roadmap_id,
            auth_header=auth_header,
            trace_id=trace_id,
            settings=settings,
            nest_client=nest_client,
            logger=logger,
            run_async_call=run_async_call,
            as_focus=(roadmap_id == focus),
            run=run,
            reason='refresh_focus',
        )
        if context is not None:
            loaded.append(context)
    return loaded


def make_on_roadmap_loaded(
    *,
    session: AgentSession,
    run: Any = None,
    settings: Any = None,
    logger: logging.Logger | None = None,
    trace_id: str | None = None,
) -> Callable[[str, dict[str, Any]], dict[str, Any] | None]:
    """The ``session_context['on_roadmap_loaded']`` callback: when a read tool
    fetches a roadmap summary, register the ``RoadmapContext`` (assigning a
    prefix), add the roadmap to the run's focus set, and hand back the
    prefixed outline so the tool result shows the same handles the next
    prompt will."""

    def _on_roadmap_loaded(roadmap_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        roadmap_id = str(roadmap_id or '').strip()
        if not roadmap_id or not isinstance(payload, dict):
            return None
        context = register_roadmap_from_summary(session, roadmap_id, payload)
        focus_ids = getattr(run, 'focus_roadmap_ids', None)
        if isinstance(focus_ids, list) and roadmap_id not in focus_ids:
            focus_ids.append(roadmap_id)
        evict_stale_roadmaps(
            session,
            max_loaded=getattr(settings, 'agent_max_loaded_roadmaps', 6),
            protected=protected_roadmap_ids(session, run) | {roadmap_id},
        )
        if logger is not None:
            log_event(
                logger,
                'roadmap_loaded_by_tool',
                settings=settings,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=roadmap_id,
                handle_prefix=context.handle_prefix,
                handle_map_size=len(context.handle_map),
            )
        return {
            'handle_prefix': context.handle_prefix,
            'outline': context.overview_summary,
        }

    return _on_roadmap_loaded


# ---------------------------------------------------------------------------
# Memory notes (per roadmap)
# ---------------------------------------------------------------------------


def _resolve_context(session: AgentSession, roadmap_id: str | None) -> RoadmapContext | None:
    """The ``RoadmapContext`` a per-roadmap cache lives on. The focus roadmap's
    context is created on demand (its notes / project pack are worth having
    even when the outline fetch failed); a non-focus roadmap must have been
    loaded first."""
    target = roadmap_id or session.scope.focus_roadmap_id
    if not target:
        return None
    context = session.metadata.roadmaps.get(target)
    if context is None and target == session.scope.focus_roadmap_id:
        context = RoadmapContext(roadmap_id=target)
        session.metadata.roadmaps[target] = context
    return context


def ensure_memory_notes(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: RunAsyncCall,
    roadmap_id: str | None = None,
) -> None:
    """Fetch a roadmap's long-term memory notes (shared, durable preferences)
    and cache them on its ``RoadmapContext``. Defaults to the focus roadmap;
    a roadmap that is not loaded is skipped. Refetched on a short TTL so a
    collaborator's new note propagates within minutes."""
    if not auth_header:
        return
    context = _resolve_context(session, roadmap_id)
    if context is None:
        return
    if context.memory_notes is not None and _cache_is_fresh(
        context.memory_notes_fetched_at, settings.agent_cache_ttl_seconds
    ):
        return
    try:
        payload = run_async_call(
            nest_client.ai_memories_list(
                roadmap_id=context.roadmap_id,
                auth_header=auth_header,
                trace_id=trace_id,
            )
        )
    except Exception:  # noqa: BLE001 — notes are an enhancement
        return
    memories = payload.get('memories') if isinstance(payload, dict) else None
    if not isinstance(memories, list):
        return
    context.memory_notes = [
        {
            'id': str(item.get('id') or ''),
            'content': str(item.get('content') or ''),
            'source': str(item.get('source') or 'user_request'),
            'scope': str(item.get('scope') or 'roadmap'),
            'category': str(item.get('category') or 'preference'),
        }
        for item in memories
        if isinstance(item, dict) and item.get('content')
    ]
    context.memory_notes_fetched_at = _utcnow()
    log_event(
        logger,
        'memory_notes_loaded',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=context.roadmap_id,
        session_id=session.session_id,
        note_count=len(context.memory_notes),
    )


def invalidate_memory_notes(session: AgentSession, roadmap_id: str | None = None) -> None:
    """Forget cached notes for one roadmap (``None`` = every loaded roadmap)
    after a save/forget so the next turn refetches."""
    contexts = (
        [session.metadata.roadmaps.get(roadmap_id)]
        if roadmap_id
        else list(session.metadata.roadmaps.values())
    )
    for context in contexts:
        if context is None:
            continue
        context.memory_notes = None
        context.memory_notes_fetched_at = None


# ---------------------------------------------------------------------------
# Project context (per roadmap)
# ---------------------------------------------------------------------------


def ensure_project_context(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: RunAsyncCall,
    roadmap_id: str | None = None,
) -> None:
    """Load the compact linked-project context for a roadmap (default: the
    focus roadmap) into its ``RoadmapContext``.

    A fresh timestamp is sufficient to satisfy the cache, even when the value
    is ``None``. That negative-caches denied/projectless lookups and avoids
    retrying the same optional read on every turn.
    """
    if not settings.agent_project_context_enabled:
        # This must be a real kill switch for sessions created before the
        # flag changed, whose Redis payload may already contain a cache.
        for context in session.metadata.roadmaps.values():
            context.project_context = None
            context.project_context_fetched_at = None
        return
    if not auth_header:
        return
    context = _resolve_context(session, roadmap_id)
    if context is None:
        return
    if _cache_is_fresh(context.project_context_fetched_at, settings.agent_cache_ttl_seconds):
        return
    try:
        payload = run_async_call(
            nest_client.context_project(
                roadmap_id=context.roadmap_id,
                auth_header=auth_header,
                trace_id=trace_id,
            )
        )
    except HTTPException as exc:
        if exc.status_code in {403, 404}:
            context.project_context = None
            context.project_context_fetched_at = _utcnow()
        return
    except Exception:  # noqa: BLE001 - project context is an enhancement
        return
    if not isinstance(payload, dict):
        return
    project = payload.get('project')
    if project is not None and not isinstance(project, dict):
        return
    # Keep {project: None}: it is the backend's projectless-roadmap
    # sentinel and lets the normal TTL guard negative-cache the result.
    context.project_context = payload
    context.project_context_fetched_at = _utcnow()
    if isinstance(project, dict):
        project_id = _clean_str(project.get('id'))
        if project_id and not context.project_id:
            context.project_id = project_id
        workspace_id = _clean_str(project.get('workspace_id'))
        if workspace_id and not context.workspace_id:
            context.workspace_id = workspace_id
    log_event(
        logger,
        'project_context_loaded',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=context.roadmap_id,
        session_id=session.session_id,
        project_linked=isinstance(project, dict),
    )


# ---------------------------------------------------------------------------
# Workspace overview (workspace scope)
# ---------------------------------------------------------------------------


def ensure_workspace_overview(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: RunAsyncCall,
    force: bool = False,
) -> dict[str, Any] | None:
    """Workspace scope: cache ``GET /api/ai/context/overview?workspace_id=``
    on ``metadata.workspace_context`` under ``AGENT_CACHE_TTL_SECONDS``.
    Returns the cached payload (or ``None`` when unavailable)."""
    if session.scope.kind != 'workspace' or not auth_header:
        return session.metadata.workspace_context
    if not force and session.metadata.workspace_context is not None and _cache_is_fresh(
        session.metadata.workspace_context_fetched_at, settings.agent_cache_ttl_seconds
    ):
        return session.metadata.workspace_context
    try:
        payload = run_async_call(
            nest_client.ai_context_overview(
                session.scope.workspace_id,
                auth_header,
                trace_id=trace_id,
            )
        )
    except HTTPException as exc:
        log_event(
            logger,
            'workspace_overview_load_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            workspace_id=session.scope.workspace_id,
            status_code=exc.status_code,
        )
        return session.metadata.workspace_context
    except Exception as exc:  # noqa: BLE001 — the overview is an enhancement
        log_event(
            logger,
            'workspace_overview_load_failed',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            workspace_id=session.scope.workspace_id,
            error=type(exc).__name__,
        )
        return session.metadata.workspace_context
    if not isinstance(payload, dict) or isinstance(payload.get('error'), dict):
        return session.metadata.workspace_context
    session.metadata.workspace_context = payload
    session.metadata.workspace_context_fetched_at = _utcnow()
    log_event(
        logger,
        'workspace_overview_loaded',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        workspace_id=session.scope.workspace_id,
        project_count=len(payload.get('projects') or []) if isinstance(payload.get('projects'), list) else 0,
        roadmap_count=len(payload.get('roadmaps') or []) if isinstance(payload.get('roadmaps'), list) else 0,
        team_count=len(payload.get('teams') or []) if isinstance(payload.get('teams'), list) else 0,
    )
    return payload
