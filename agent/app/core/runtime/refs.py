"""Context refs — the composer's ``@`` mentions.

``{kind, id, label}`` refs ride the first message of a run. They are hydrated
ONCE per run through ``POST /api/ai/context/resolve-refs`` (the backend fails
closed per ref: a missing row, an unresolvable parent, or a denied read all
come back ``accessible=False``), stored on ``run.resolved_refs``, and rendered
as the per-turn ``# Referenced items`` tail block. Accessible refs that point
at a roadmap join the run's focus set; up to ``AGENT_MAX_LOADED_ROADMAPS - 1``
of those roadmaps auto-load (in ref order) so the first step never fans out
to dozens of backend calls — the rest are listed as "not loaded" for the
model to ``get_roadmap_overview`` on demand.

Refs are a hint about what the user means, never a limit on what the model may
look at.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from app.core.contracts.runs import ContextRef, ResolvedRef
from app.core.contracts.sessions import AgentSession
from app.core.logging_utils import log_event
from app.core.runtime import context_cache
from app.core.runtime.handles import handle_for_node_id
from app.core.uuid_utils import is_uuid_like

RESOLVE_FAILED = 'RESOLVE_FAILED'

REFERENCED_ITEMS_HEADER = (
    '# Referenced items (mentioned by the user; a hint about what they mean, '
    'never a limit on what you may look at)'
)

_NODE_KINDS = frozenset({'epic', 'feature', 'task', 'milestone'})


def dedupe_refs(refs: list[ContextRef] | None, *, cap: int) -> list[ContextRef]:
    """Drop duplicate ``(kind, id)`` pairs (first wins) and cap the list."""
    limit = max(0, int(cap))
    if limit == 0:
        return []
    seen: set[tuple[str, str]] = set()
    deduped: list[ContextRef] = []
    for ref in refs or []:
        key = ref.dedupe_key
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ref)
        if len(deduped) >= limit:
            break
    return deduped


def _failed_ref(ref: ContextRef, error_code: str = RESOLVE_FAILED) -> ResolvedRef:
    return ResolvedRef(
        kind=ref.kind, id=ref.id, accessible=False, label=ref.label, error_code=error_code
    )


def resolved_ref_roadmap_id(ref: ResolvedRef) -> str | None:
    """The roadmap a resolved ref points at: itself for a roadmap ref, its
    ``roadmap_id`` for a node/project ref, nothing for a team."""
    if not ref.accessible:
        return None
    if ref.kind == 'roadmap':
        return ref.id
    if ref.kind == 'team':
        return None
    return ref.roadmap_id or None


def hydrate_refs(
    *,
    session: AgentSession,
    run: Any,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: Callable[[Any], dict[str, Any]],
) -> list[ResolvedRef]:
    """Resolve ``run.refs`` once, store ``run.resolved_refs``, add referenced
    roadmaps to ``run.focus_roadmap_ids`` and auto-load the first few."""
    cap = int(getattr(settings, 'agent_max_refs_per_message', 20) or 0)
    refs = dedupe_refs(list(getattr(run, 'refs', None) or []), cap=cap)
    run.refs = refs
    if not refs:
        run.resolved_refs = []
        return []

    # The backend DTO validates every ref id as a UUID and rejects the WHOLE
    # batch on one bad entry (400), so an id that cannot name a row is failed
    # here as NOT_FOUND and only uuid-shaped refs go over the wire.
    sendable = [ref for ref in refs if is_uuid_like(ref.id)]
    resolved_by_key: dict[tuple[str, str], ResolvedRef] = {}
    if sendable and auth_header:
        try:
            payload = run_async_call(
                nest_client.resolve_refs(
                    [ref.model_dump(mode='json', exclude_none=True) for ref in sendable],
                    auth_header,
                    trace_id=trace_id,
                )
            )
            for item in _parse_resolved(sendable, payload):
                resolved_by_key[(item.kind, item.id)] = item
        except Exception as exc:  # noqa: BLE001 — fail closed, never fail the turn
            log_event(
                logger,
                'refs_resolve_failed',
                settings=settings,
                level=logging.WARNING,
                trace_id=trace_id,
                session_id=session.session_id,
                refs_total=len(sendable),
                error=type(exc).__name__,
                status_code=getattr(exc, 'status_code', None),
            )
            for ref in sendable:
                resolved_by_key[ref.dedupe_key] = _failed_ref(ref)
    elif sendable:
        for ref in sendable:
            resolved_by_key[ref.dedupe_key] = _failed_ref(ref)
    resolved = [
        resolved_by_key.get(ref.dedupe_key) or _failed_ref(ref, 'NOT_FOUND') for ref in refs
    ]
    run.resolved_refs = resolved

    loaded_ids = _auto_load_referenced_roadmaps(
        session=session,
        run=run,
        resolved=resolved,
        auth_header=auth_header,
        trace_id=trace_id,
        settings=settings,
        nest_client=nest_client,
        logger=logger,
        run_async_call=run_async_call,
    )
    accessible = sum(1 for ref in resolved if ref.accessible)
    log_event(
        logger,
        'refs_resolved',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        run_id=getattr(run, 'run_id', None),
        refs_total=len(resolved),
        refs_accessible=accessible,
        refs_inaccessible=len(resolved) - accessible,
        loaded_roadmap_ids=loaded_ids,
    )
    return resolved


def _parse_resolved(refs: list[ContextRef], payload: Any) -> list[ResolvedRef]:
    entries = payload.get('refs') if isinstance(payload, dict) else None
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get('kind') or '').strip()
        ref_id = str(entry.get('id') or '').strip()
        if kind and ref_id:
            by_key[(kind, ref_id)] = entry
    resolved: list[ResolvedRef] = []
    for ref in refs:
        entry = by_key.get(ref.dedupe_key)
        if entry is None:
            resolved.append(_failed_ref(ref))
            continue
        try:
            item = ResolvedRef.model_validate({**entry, 'kind': ref.kind, 'id': ref.id})
        except Exception:  # noqa: BLE001 — a malformed entry is inaccessible
            resolved.append(_failed_ref(ref))
            continue
        item.label = ref.label
        if not item.accessible and not item.error_code:
            item.error_code = 'NOT_FOUND'
        resolved.append(item)
    return resolved


def _auto_load_referenced_roadmaps(
    *,
    session: AgentSession,
    run: Any,
    resolved: list[ResolvedRef],
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    nest_client: Any,
    logger: logging.Logger,
    run_async_call: Callable[[Any], dict[str, Any]],
) -> list[str]:
    max_loaded = int(getattr(settings, 'agent_max_loaded_roadmaps', 6) or 6)
    auto_load_cap = max(0, max_loaded - 1)
    focus = session.scope.focus_roadmap_id
    focus_ids: list[str] = list(getattr(run, 'focus_roadmap_ids', None) or [])
    loaded: list[str] = []
    fetches = 0
    for ref in resolved:
        roadmap_id = resolved_ref_roadmap_id(ref)
        if not roadmap_id:
            continue
        if roadmap_id == focus or context_cache.is_loaded(session, roadmap_id):
            if roadmap_id not in focus_ids:
                focus_ids.append(roadmap_id)
            context_cache.touch(session, roadmap_id)
            continue
        if fetches >= auto_load_cap:
            continue
        fetches += 1
        context = context_cache.load_roadmap(
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
            reason='referenced',
        )
        if context is None:
            continue
        loaded.append(roadmap_id)
        if roadmap_id not in focus_ids:
            focus_ids.append(roadmap_id)
    run.focus_roadmap_ids = focus_ids
    return loaded


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_referenced_items(session: AgentSession, run: Any) -> str:
    """The per-turn ``# Referenced items`` tail block ('' when no refs)."""
    resolved: list[ResolvedRef] = list(getattr(run, 'resolved_refs', None) or [])
    if not resolved:
        return ''
    lines = [REFERENCED_ITEMS_HEADER]
    for ref in resolved:
        lines.append(_render_ref_line(session, ref))
    return '\n'.join(lines)


def _mention(ref: ResolvedRef) -> str:
    return f'@{ref.label or ref.title or ref.id}'


def _chain_title(ref: ResolvedRef, kind: str) -> str | None:
    for entry in ref.parent_chain or []:
        if entry.kind == kind and entry.title:
            return entry.title
    return None


def _roadmap_descriptor(session: AgentSession, roadmap_id: str, fallback_title: str | None) -> str:
    context = session.metadata.roadmaps.get(roadmap_id)
    title = (context.title if context is not None else None) or fallback_title or roadmap_id
    if context is not None and context.overview_fetched_at is not None:
        marker = f'({context.handle_prefix})' if context.handle_prefix else '(focus)'
        return f'roadmap "{title}" {marker}'
    return f'roadmap "{title}" (not loaded; call get_roadmap_overview to work on it)'


def _render_ref_line(session: AgentSession, ref: ResolvedRef) -> str:
    mention = _mention(ref)
    if not ref.accessible:
        code = ref.error_code or 'NOT_FOUND'
        return f'- {mention} -> not accessible ({code}) -- tell the user you cannot see it'
    title = ref.title or ref.label or ref.id
    project_title = _chain_title(ref, 'project')
    project_suffix = f', project "{project_title}"' if project_title else ''

    if ref.kind == 'team':
        return f'- {mention} -> team "{title}"'

    if ref.kind == 'project':
        roadmap_id = ref.roadmap_id
        if roadmap_id:
            return f'- {mention} -> project "{title}" ({_roadmap_descriptor(session, roadmap_id, None)})'
        return f'- {mention} -> project "{title}" (no roadmap)'

    if ref.kind == 'roadmap':
        return f'- {mention} -> {_roadmap_descriptor(session, ref.id, title)}{project_suffix}'

    # epic / feature / task / milestone
    roadmap_id = ref.roadmap_id
    roadmap_title = _chain_title(ref, 'roadmap')
    context = session.metadata.roadmaps.get(roadmap_id) if roadmap_id else None
    handle_map = context.handle_map if context is not None else {}
    handle = handle_for_node_id(handle_map, ref.id)
    detail = ''
    if handle:
        detail = f' ({handle})'
    elif ref.kind == 'task':
        parent_feature = next(
            (entry for entry in (ref.parent_chain or []) if entry.kind == 'feature'), None
        )
        parent_handle = handle_for_node_id(handle_map, parent_feature.id) if parent_feature else None
        if parent_handle:
            detail = f' (under {parent_handle})'
    if ref.status:
        detail = f'{detail[:-1]}, status: {ref.status})' if detail else f' (status: {ref.status})'
    where = f' in {_roadmap_descriptor(session, roadmap_id, roadmap_title)}' if roadmap_id else ''
    return f'- {mention} -> {ref.kind} "{title}"{detail}{where}{project_suffix}'
