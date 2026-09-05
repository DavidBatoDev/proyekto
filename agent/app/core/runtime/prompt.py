"""Prompt assembly for the loop.

Builds the OpenAI ``messages`` array: one system prompt + trimmed conversation
history + the user turn (+ a resumed tool transcript). The system prompt is

    STATIC_PREFIX + SCOPE_BLOCK + STATE_BLOCKS + TAIL

- STATIC_PREFIX  ``prompts/system.md`` — identical across sessions.
- SCOPE_BLOCK    ``# Scope`` — stable per session.
- STATE_BLOCKS   the compact state header, in a fixed order that only changes
                 when the session's cached state changes (a roadmap loads,
                 a commit lands): ``# Focus roadmap``, ``# Loaded roadmaps``,
                 ``# Workspace overview``, ``# Project context``,
                 ``# Earlier conversation summary``, ``# Memory notes``,
                 ``# Pending proposal awaiting user confirmation``,
                 ``# Recently resolved items``, ``# Recent changes``,
                 ``# Actor``.
- TAIL           per-turn blocks, ALWAYS last: ``# Referenced items``,
                 ``# Relevant memories``, ``# Run`` (the phase file).

Cache invariant: nothing per-turn may render above ``# Actor`` — the prefix
through that block is what the provider's prompt cache keys on, and the
``cache`` log line must not regress to 0% on multi-turn sessions. The full
roadmap is never re-stuffed — the model fetches detail on demand via read
tools, referencing the handle outlines (E1 / E1.F2 / R2.E1).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from app.core.contracts.sessions import AgentSession, RoadmapContext
from app.core.runtime import scope as scope_helpers
from app.core.runtime.handles import merged_handle_map
from app.core.runtime.refs import render_referenced_items

_PROMPTS_DIR = Path(__file__).resolve().parent / 'prompts'
_PROJECT_CONTEXT_BLOCK_MAX_CHARS = 3600
_PROJECT_CONTEXT_TOOL_HINT = (
    '(For more detail, use get_project_brief, list_project_resources, '
    'list_project_meetings, list_project_members, or get_member_details.)'
)
_WORKSPACE_OVERVIEW_MAX_LINES = 40
_WORKSPACE_OVERVIEW_LEGEND = (
    'Projects and roadmaps are different objects: a project holds at most one linked '
    'roadmap, and a roadmap marked "standalone" belongs to no project. Never present '
    'a roadmap as a project or invent a project to hold one.'
)
_ACTOR_HEADER = '# Actor'

_PHASE_FILES = {
    'investigate': 'phase_investigate.md',
    'execute': 'phase_execute.md',
    'verify': 'phase_verify.md',
}


@lru_cache(maxsize=8)
def _prompt_file(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding='utf-8').strip()


def static_prefix() -> str:
    """``prompts/system.md`` — byte-stable across sessions."""
    return _prompt_file('system.md')


def _system_prompt_template() -> str:
    return static_prefix()


# ---------------------------------------------------------------------------
# Turn context (the dict tools and the state renderer read)
# ---------------------------------------------------------------------------


def build_turn_context(
    *,
    session: AgentSession,
    auth_header: str | None,
    trace_id: str | None,
    settings: Any,
    get_recent_resolved_targets: Callable[[AgentSession], list[Any]],
    run: Any = None,
) -> dict[str, Any]:
    """The per-turn ``session_context``: the session's cached state as JSON-
    ready values plus the forwarded auth and trace id the tool dispatcher
    threads into backend calls. ``compact_state`` renders it into the prompt.

    Per-call tool state (the roadmap a call targets) never lives here — the
    dispatcher resolves ``roadmap_id`` per call from the call's own args and
    ``focus_roadmap_id`` below.
    """
    focus_id = session.scope.focus_roadmap_id
    focus_context = session.metadata.roadmaps.get(focus_id) if focus_id else None
    recent_messages = [
        {
            'role': item.role,
            'content': item.content,
            'tool_calls': getattr(item, 'tool_calls', None),
            'tool_call_id': getattr(item, 'tool_call_id', None),
        }
        for item in session.messages[-settings.max_chat_history_messages :]
    ]
    recent_resolved_targets = [
        target.model_dump(mode='json', exclude_none=True)
        for target in get_recent_resolved_targets(session)
    ]
    project_context_enabled = bool(getattr(settings, 'agent_project_context_enabled', True))
    memory_notes_by_roadmap: dict[str, list[dict[str, Any]]] = {}
    for roadmap_id, context in session.metadata.roadmaps.items():
        if context.memory_notes:
            memory_notes_by_roadmap[roadmap_id] = list(context.memory_notes)
    batches = getattr(run, 'batches', None) or []
    staged_operations_count = sum(len(getattr(batch, 'operations', None) or []) for batch in batches)
    actor = session.metadata.actor_context
    return {
        # Legacy key (logging/metrics); tool calls use focus_roadmap_id.
        'roadmap_id': focus_id,
        'focus_roadmap_id': focus_id,
        'scope': session.scope.model_dump(mode='json', exclude_none=True),
        'workspace_id': scope_helpers.workspace_id(session),
        'focus_project_id': scope_helpers.focus_project_id(session),
        'knowledge_project_ids': scope_helpers.loaded_project_ids(session),
        'default_roadmap_id': scope_helpers.default_roadmap_id(session, run),
        'base_revision': (
            focus_context.base_revision
            if focus_context is not None and focus_context.base_revision is not None
            else session.base_revision
        ),
        'revision_token': (
            focus_context.revision_token
            if focus_context is not None and focus_context.revision_token
            else session.revision_token
        ),
        'staged_operations_count': staged_operations_count,
        'last_intent_type': session.last_intent_type,
        'recent_messages': recent_messages,
        'recent_resolved_targets': recent_resolved_targets,
        'conversation_summary': session.metadata.conversation_summary,
        'memory_notes': list(focus_context.memory_notes or []) if focus_context is not None else [],
        'memory_notes_by_roadmap': memory_notes_by_roadmap,
        # Gate at render time too: Redis sessions can outlive a deploy-time
        # flag change and may still carry a previously fetched context pack.
        'project_context': (
            focus_context.project_context
            if focus_context is not None and project_context_enabled
            else None
        ),
        'roadmaps': [
            {
                'roadmap_id': context.roadmap_id,
                'title': context.title,
                'handle_prefix': context.handle_prefix,
                'project_id': context.project_id,
                'workspace_id': context.workspace_id,
                'loaded': context.overview_fetched_at is not None,
            }
            for context in session.metadata.roadmaps.values()
        ],
        'roadmap_titles': {
            context.roadmap_id: context.title for context in session.metadata.roadmaps.values()
        },
        'workspace_context': session.metadata.workspace_context,
        'auth_header': auth_header,
        'trace_id': trace_id,
        'actor_context': (
            actor.model_dump(mode='json', exclude_none=True) if actor is not None else None
        ),
        'actor_present': actor is not None,
        'roadmap_role': actor.roadmap_role if actor is not None else None,
        'actor_context_source': actor.actor_context_source if actor is not None else None,
        # Merged (already prefixed) handle map; the resolver handler reads it
        # for its redundant-resolve telemetry.
        'roadmap_handle_map': merged_handle_map(session, run),
        'recent_applied_changes': [
            change.model_dump(mode='json', exclude_none=True)
            for change in session.metadata.recent_applied_changes
        ],
        'change_history': [
            group.model_dump(mode='json', exclude_none=True)
            for group in session.metadata.change_history
        ],
        'pending_plan': (
            session.metadata.pending_plan.model_dump(mode='json', exclude_none=True)
            if (
                session.metadata.pending_plan is not None
                and session.metadata.pending_plan.status
                in {'proposed', 'awaiting_answers'}
            )
            else None
        ),
        'run_id': getattr(run, 'run_id', None),
        'run_phase': getattr(run, 'phase', None),
    }


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def build_messages(
    session: AgentSession,
    run: Any,
    turn_context: dict[str, Any],
    phase: str = 'investigate',
    *,
    resumed: bool = False,
    user_message: str | None = None,
    transcript: list[dict[str, Any]] | None = None,
    extra_tail: str | None = None,
) -> list[dict[str, Any]]:
    """``[system, ...trimmed text history, user turn, ...resumed transcript]``.

    ``user_message`` defaults to ``run.user_message`` (the folded text);
    materialize/repair turns pass their own instruction. ``transcript`` is the
    echoed ``function_call`` / ``function_call_output`` items of a paused
    loop, appended after the user turn so a resumed step reuses its tool
    results. ``extra_tail`` renders after the phase block (e.g. the
    materialize target outline).
    """
    system = build_system_prompt(
        session, run, turn_context, phase, resumed=resumed, extra_tail=extra_tail
    )
    messages: list[dict[str, Any]] = [{'role': 'system', 'content': system}]
    messages.extend(_trimmed_history(turn_context))
    text = user_message if user_message is not None else str(getattr(run, 'user_message', '') or '')
    messages.append({'role': 'user', 'content': text})
    if transcript:
        messages.extend(dict(item) for item in transcript if isinstance(item, dict))
    return messages


def build_system_prompt(
    session: AgentSession,
    run: Any,
    turn_context: dict[str, Any],
    phase: str = 'investigate',
    *,
    resumed: bool = False,
    extra_tail: str | None = None,
) -> str:
    return (
        static_prefix()
        + '\n\n'
        + scope_block(session)
        + '\n\n'
        + compact_state(
            session,
            turn_context,
            run=run,
            phase=phase,
            resumed=resumed,
            extra_tail=extra_tail,
        )
    )


def prompt_prefix(system_prompt: str) -> str:
    """Everything through the ``# Actor`` block — the cacheable prefix. Tests
    assert it is byte-identical across turns whose tails differ."""
    index = system_prompt.find(f'\n{_ACTOR_HEADER}\n')
    if index == -1:
        return system_prompt
    end = system_prompt.find('\n\n', index + 1)
    return system_prompt if end == -1 else system_prompt[:end]


def _trimmed_history(session_context: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert prior text turns to OpenAI messages.

    Tool-call / tool-result pairs from earlier turns are intentionally dropped:
    the compact state header + recently-resolved-items already carry forward
    what was learned, and omitting them keeps the transcript free of unbalanced
    tool messages (which the API rejects). Fresh tool calls happen this turn.
    """
    history: list[dict[str, Any]] = []
    for item in session_context.get('recent_messages') or []:
        role = item.get('role')
        content = (item.get('content') or '').strip()
        if not content:
            continue
        if role == 'user':
            history.append({'role': 'user', 'content': content})
        elif role == 'assistant':
            history.append({'role': 'assistant', 'content': content})
    return history


# ---------------------------------------------------------------------------
# Scope block
# ---------------------------------------------------------------------------


def scope_block(session: AgentSession) -> str:
    scope = session.scope
    if scope.kind == 'roadmap':
        context = session.metadata.roadmaps.get(scope.roadmap_id or '')
        title = (context.title if context is not None else None) or 'Untitled roadmap'
        return (
            '# Scope\n'
            f'Focus roadmap: "{title}" (bare handles). You may also read or edit '
            'other roadmaps the user can access.'
        )
    workspace = session.metadata.workspace_context
    name = None
    if isinstance(workspace, dict):
        ws = workspace.get('workspace')
        if isinstance(ws, dict):
            name = _clean(ws.get('name') or ws.get('title'))
    label = name or scope.workspace_id or 'workspace'
    return (
        '# Scope\n'
        f'Workspace: "{label}". No focus roadmap — load one with '
        'get_roadmap_overview before editing. Items shared with the user outside '
        'this workspace are also in reach.'
    )


# ---------------------------------------------------------------------------
# State blocks + tail
# ---------------------------------------------------------------------------


def compact_state(
    session: AgentSession,
    session_context: dict[str, Any],
    *,
    run: Any = None,
    phase: str | None = None,
    resumed: bool = False,
    extra_tail: str | None = None,
) -> str:
    """STATE_BLOCKS (fixed order, ends with ``# Actor``) followed by the
    per-turn TAIL."""
    blocks: list[str] = []
    roadmaps = session.metadata.roadmaps
    focus_id = session.scope.focus_roadmap_id
    focus_context = roadmaps.get(focus_id) if focus_id else None

    # 1. Focus roadmap
    if session.scope.kind == 'roadmap':
        overview = focus_context.overview_summary if focus_context is not None else None
        if isinstance(overview, str) and overview.strip():
            blocks.append('# Focus roadmap\n' + overview.strip())
        else:
            blocks.append('# Focus roadmap\n(empty — no epics yet)')
    else:
        blocks.append('# Focus roadmap\n(none loaded)')

    # 2. Loaded roadmaps (non-focus, prefixed)
    loaded = _loaded_roadmaps_block(session, focus_id)
    if loaded:
        blocks.append(loaded)

    # 3. Workspace overview (workspace scope)
    if session.scope.kind == 'workspace':
        actor = session_context.get('actor_context')
        overview_block = _workspace_overview_block(
            session_context.get('workspace_context'),
            actor_id=_clean(actor.get('actor_id')) if isinstance(actor, dict) else None,
        )
        if overview_block:
            blocks.append(overview_block)

    # 4. Project context (focus roadmap)
    project_context = _project_context_block(session_context.get('project_context'))
    if project_context:
        if len([c for c in roadmaps.values() if c.overview_fetched_at is not None]) > 1 and focus_context is not None:
            title = focus_context.title or 'Untitled roadmap'
            project_context = project_context.replace(
                '# Project context\n', f'# Project context\nRoadmap: "{title}"\n', 1
            )
        blocks.append(project_context)

    # 5. Earlier conversation summary
    conversation_summary = session_context.get('conversation_summary')
    if isinstance(conversation_summary, str) and conversation_summary.strip():
        blocks.append(
            '# Earlier conversation summary\n'
            '(Older turns were compacted. Treat this as ground truth for '
            'earlier context.)\n' + conversation_summary.strip()
        )

    # 6. Memory notes
    memory_block = _memory_notes_block(session, session_context)
    if memory_block:
        blocks.append(memory_block)

    # 7. Pending proposal
    pending_plan = session_context.get('pending_plan')
    if isinstance(pending_plan, dict):
        pending_block = _pending_plan_block(session, pending_plan)
        if pending_block:
            blocks.append(pending_block)

    # 8. Recently resolved items
    recent = _recent_targets(session_context, session)
    if recent:
        blocks.append('# Recently resolved items (you may reference these)\n' + recent)

    # 9. Recent changes
    change_history = _change_history(session_context, session)
    if change_history:
        blocks.append(
            '# Recent changes (revertible — newest first)\n'
            '(Call revert_changes to undo the latest change, or '
            'revert_changes with a change_id below to undo back to that point — '
            'that change and every newer one are undone.)\n' + change_history
        )

    # 10. Actor — the last stable block.
    actor_block = _actor_block(session, session_context)
    if actor_block:
        blocks.append(actor_block)

    # TAIL — per-turn blocks MUST stay last so churn only costs the prompt
    # suffix (the prefix through # Actor stays byte-stable for the cache).
    tail = render_tail(
        session,
        run,
        session_context,
        phase or 'investigate',
        resumed=resumed,
        extra_tail=extra_tail,
    )
    if tail:
        blocks.append(tail)

    return '\n\n'.join(blocks)


def render_tail(
    session: AgentSession,
    run: Any,
    session_context: dict[str, Any],
    phase: str,
    *,
    resumed: bool = False,
    extra_tail: str | None = None,
) -> str:
    """``# Referenced items`` → ``# Relevant memories`` → ``# Run``."""
    blocks: list[str] = []
    referenced = render_referenced_items(session, run) if run is not None else ''
    if referenced:
        blocks.append(referenced)
    if session_context.get('memory_notes_semantic'):
        relevant = session_context.get('relevant_memory_notes')
        if isinstance(relevant, list) and relevant:
            relevant_lines = _memory_note_lines(relevant[:8])
            if relevant_lines:
                blocks.append(
                    '# Relevant memories (semantically matched to this '
                    'message)\n(Apply these as standing conventions; use '
                    'forget_memory with the memory_id to remove one.)\n'
                    + relevant_lines
                )
    phase_block = render_phase_tail(phase, resumed=resumed)
    if phase_block:
        blocks.append(phase_block)
    if isinstance(extra_tail, str) and extra_tail.strip():
        blocks.append(extra_tail.strip())
    return '\n\n'.join(blocks)


def render_phase_tail(phase: str, *, resumed: bool = False, **fields: Any) -> str:
    """The ``# Run`` block for a phase: ``phase_investigate.md`` only when the
    loop resumed a paused investigation; ``phase_execute.md`` (with its
    ``{roadmap_*}`` fields filled) and ``phase_verify.md`` always."""
    if phase == 'investigate' and not resumed:
        return ''
    name = _PHASE_FILES.get(phase)
    if name is None:
        return ''
    template = _prompt_file(name)
    if not fields:
        return template
    rendered = template
    for key, value in fields.items():
        rendered = rendered.replace('{' + key + '}', str(value if value is not None else ''))
    return rendered


# ---------------------------------------------------------------------------
# Block renderers
# ---------------------------------------------------------------------------


def _clean(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _prefix_index(context: RoadmapContext) -> int:
    prefix = context.handle_prefix or ''
    digits = ''.join(ch for ch in prefix if ch.isdigit())
    return int(digits) if digits else 0


def _loaded_roadmaps_block(session: AgentSession, focus_id: str | None) -> str:
    contexts = [
        context
        for roadmap_id, context in session.metadata.roadmaps.items()
        if roadmap_id != focus_id and context.overview_fetched_at is not None
    ]
    if not contexts:
        return ''
    contexts.sort(key=_prefix_index)
    parts: list[str] = []
    for context in contexts:
        title = context.title or 'Untitled roadmap'
        header = f'## {context.handle_prefix or "?"} — "{title}"'
        project_title = _project_title(context)
        if project_title:
            header += f' (project "{project_title}")'
        outline = (context.overview_summary or '').strip() or '(empty — no epics yet)'
        parts.append(header + '\n' + outline)
    return '# Loaded roadmaps\n' + '\n\n'.join(parts)


def _project_title(context: RoadmapContext) -> str | None:
    pack = context.project_context
    project = pack.get('project') if isinstance(pack, dict) else None
    return _clean(project.get('title')) if isinstance(project, dict) else None


def _workspace_overview_block(payload: Any, actor_id: str | None = None) -> str:
    """Compact ``# Workspace overview`` (<= 40 lines): counts + names of the
    projects, roadmaps and teams in reach. Items from OTHER workspaces the
    user belongs to are summarized by count only.

    Every roadmap line names its project (or says it is standalone) and every
    project line names its linked roadmap, so the model never has to pair the
    two lists by guesswork — a summary once invented a project to hold the
    user's standalone roadmaps. The backend's ``lane: shared`` only means
    "outside the workspaces you belong to"; an item the actor owns is
    rendered as ``yours`` and everything else in that lane as ``shared with
    you``."""
    if not isinstance(payload, dict):
        return ''
    lines: list[str] = ['# Workspace overview']
    workspace = payload.get('workspace')
    if isinstance(workspace, dict):
        name = _clean(workspace.get('name') or workspace.get('title'))
        if name:
            lines.append(f'Workspace: "{name}"')
    lines.append(_WORKSPACE_OVERVIEW_LEGEND)

    def _lane(item: dict[str, Any]) -> str:
        return str(item.get('lane') or 'current')

    def _visible(items: Any) -> tuple[list[dict[str, Any]], int]:
        entries = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        shown = [item for item in entries if _lane(item) != 'other_workspace']
        return shown, len(entries) - len(shown)

    projects, other_projects = _visible(payload.get('projects'))
    roadmaps, other_roadmaps = _visible(payload.get('roadmaps'))
    teams, other_teams = _visible(payload.get('teams'))
    roadmap_by_project: dict[str, dict[str, Any]] = {}
    roadmap_by_id: dict[str, dict[str, Any]] = {}
    for roadmap in roadmaps:
        roadmap_id = _clean(roadmap.get('id'))
        if roadmap_id:
            roadmap_by_id[roadmap_id] = roadmap
        project_id = _clean(roadmap.get('project_id'))
        if project_id and project_id not in roadmap_by_project:
            roadmap_by_project[project_id] = roadmap
    project_title_by_id: dict[str, str] = {}
    for project in projects:
        project_id = _clean(project.get('id'))
        title = _clean(project.get('title') or project.get('name'))
        if project_id and title:
            project_title_by_id[project_id] = title

    def _access(item: dict[str, Any]) -> str | None:
        owner_id = _clean(item.get('owner_id'))
        if actor_id and owner_id == actor_id:
            return 'yours'
        if _lane(item) == 'shared':
            return 'shared with you'
        return None

    budget = _WORKSPACE_OVERVIEW_MAX_LINES - (len(lines) - 1) - 1
    per_section = max(3, budget // 3)

    def _section(label: str, items: list[dict[str, Any]], other: int, render: Callable[[dict[str, Any]], str]) -> None:
        if not items and not other:
            return
        suffix = f'; {other} more in other workspaces' if other else ''
        lines.append(f'{label} ({len(items)}{suffix}):')
        for item in items[: per_section - 1]:
            lines.append(render(item))
        if len(items) > per_section - 1:
            lines.append(f'- …and {len(items) - (per_section - 1)} more')

    def _render_project(item: dict[str, Any]) -> str:
        title = _clean(item.get('title') or item.get('name')) or 'Untitled project'
        bits: list[str] = []
        project_id = _clean(item.get('id'))
        if project_id:
            bits.append(f'id {project_id}')
        roadmap = roadmap_by_project.get(project_id or '')
        roadmap_id = _clean(item.get('roadmap_id')) or (_clean(roadmap.get('id')) if roadmap else None)
        if roadmap_id:
            linked = roadmap_by_id.get(roadmap_id) or roadmap
            roadmap_name = _clean(linked.get('name') or linked.get('title')) if linked else None
            bits.append(f'roadmap "{roadmap_name}" (id {roadmap_id})' if roadmap_name else f'roadmap {roadmap_id}')
        else:
            bits.append('no roadmap yet')
        access = _access(item)
        if access:
            bits.append(access)
        return f'- {title}' + (f' ({", ".join(bits)})' if bits else '')

    def _render_roadmap(item: dict[str, Any]) -> str:
        title = _clean(item.get('name') or item.get('title')) or 'Untitled roadmap'
        bits: list[str] = []
        roadmap_id = _clean(item.get('id'))
        if roadmap_id:
            bits.append(f'id {roadmap_id}')
        project_id = _clean(item.get('project_id'))
        if project_id:
            project_title = _clean(item.get('project_title')) or project_title_by_id.get(project_id)
            bits.append(f'project "{project_title}"' if project_title else f'project {project_id}')
        else:
            bits.append('standalone, no project')
        counts = item.get('counts') if isinstance(item.get('counts'), dict) else item
        count_bits: list[str] = []
        for key, label in (('epics', 'epics'), ('features', 'features'), ('tasks', 'tasks'), ('open_tasks', 'open'), ('overdue_tasks', 'overdue')):
            value = counts.get(key) if isinstance(counts, dict) else None
            if isinstance(value, int) and not isinstance(value, bool):
                count_bits.append(f'{value} {label}')
        if count_bits:
            bits.append(', '.join(count_bits))
        status = _clean(item.get('status'))
        if status:
            bits.append(f'status: {status}')
        access = _access(item)
        if access:
            bits.append(access)
        return f'- {title}' + (f' ({"; ".join(bits)})' if bits else '')

    def _render_team(item: dict[str, Any]) -> str:
        title = _clean(item.get('name') or item.get('title')) or 'Untitled team'
        bits: list[str] = []
        team_id = _clean(item.get('id'))
        if team_id:
            bits.append(f'id {team_id}')
        member_count = item.get('member_count')
        if isinstance(member_count, int) and not isinstance(member_count, bool):
            bits.append(f'{member_count} members')
        return f'- {title}' + (f' ({", ".join(bits)})' if bits else '')

    _section('Projects', projects, other_projects, _render_project)
    _section('Roadmaps', roadmaps, other_roadmaps, _render_roadmap)
    _section('Teams', teams, other_teams, _render_team)
    if len(lines) == 1:
        return ''
    return '\n'.join(lines[:_WORKSPACE_OVERVIEW_MAX_LINES])


def _memory_notes_block(session: AgentSession, session_context: dict[str, Any]) -> str:
    memory_notes = session_context.get('memory_notes')
    memory_semantic = bool(session_context.get('memory_notes_semantic'))
    by_roadmap = session_context.get('memory_notes_by_roadmap')
    grouped: dict[str, list[Any]] = (
        {rid: notes for rid, notes in by_roadmap.items() if isinstance(notes, list) and notes}
        if isinstance(by_roadmap, dict)
        else {}
    )
    if not isinstance(memory_notes, list) or not memory_notes:
        if len(grouped) <= (1 if session.scope.focus_roadmap_id in grouped else 0):
            # Nothing for the focus roadmap and no other roadmap's notes.
            if not grouped:
                return ''
        memory_notes = []
    if memory_semantic and memory_notes:
        # Semantic mode: a stable one-line stub here (preserves the
        # cached prompt prefix) — the matched notes render at the tail.
        return (
            '# Memory notes\n'
            f'({len(memory_notes)} stored; the most relevant are listed '
            'at the end of this header under "# Relevant memories".)'
        )
    focus_id = session.scope.focus_roadmap_id
    other_groups = {rid: notes for rid, notes in grouped.items() if rid != focus_id}
    if not other_groups:
        note_lines = _memory_note_lines(memory_notes[:30]) if memory_notes else ''
        if not note_lines:
            return ''
        return (
            '# Memory notes (durable preferences for this roadmap)\n'
            '(Shared by all collaborators. Apply these as standing '
            'conventions. Use forget_memory with the memory_id to '
            'remove one.)\n' + note_lines
        )
    sections: list[str] = []
    ordered: list[tuple[str, list[Any]]] = []
    if focus_id and memory_notes:
        ordered.append((focus_id, memory_notes))
    ordered.extend(other_groups.items())
    for roadmap_id, notes in ordered:
        lines = _memory_note_lines(list(notes)[:30])
        if not lines:
            continue
        context = session.metadata.roadmaps.get(roadmap_id)
        title = (context.title if context is not None else None) or roadmap_id
        prefix = context.handle_prefix if context is not None else None
        label = f'Roadmap "{title}" ({prefix})' if prefix else f'Roadmap "{title}" (focus)'
        sections.append(f'{label}:\n{lines}')
    if not sections:
        return ''
    return (
        '# Memory notes (durable preferences, per roadmap)\n'
        '(Shared by all collaborators. Apply these as standing '
        'conventions. Use forget_memory with the memory_id — and the '
        'roadmap_id — to remove one.)\n' + '\n'.join(sections)
    )


def _memory_note_lines(notes: list[Any]) -> str:
    """Render memory notes grouped by scope, category-tagged.

    `Project-wide:` notes apply to every roadmap of the project;
    `This roadmap:` notes are local. `[decision]`/`[fact]` prefixes mark the
    non-default categories (plain `preference` stays untagged to save tokens).
    """
    project_lines: list[str] = []
    roadmap_lines: list[str] = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        content = str(note.get('content') or '').strip()[:300]
        if not content:
            continue
        category = str(note.get('category') or 'preference')
        tag = f'[{category}] ' if category in {'fact', 'decision'} else ''
        line = (
            f'- {tag}"{content}" (memory_id: {note.get("id")}, '
            f'source: {note.get("source")})'
        )
        if str(note.get('scope') or 'roadmap') == 'project':
            project_lines.append(line)
        else:
            roadmap_lines.append(line)

    sections: list[str] = []
    if project_lines:
        sections.append('Project-wide:\n' + '\n'.join(project_lines))
    if roadmap_lines:
        sections.append('This roadmap:\n' + '\n'.join(roadmap_lines))
    if not sections:
        return ''
    if not project_lines:
        # Single-scope roadmaps keep the flat list (no pointless header).
        return '\n'.join(roadmap_lines)
    return '\n'.join(sections)


def _project_context_text(value: Any, max_chars: int) -> str:
    """Normalize one untrusted project-context value for a compact line."""
    if value is None:
        return ''
    normalized = ' '.join(str(value).split())
    if len(normalized) <= max_chars:
        return normalized
    if max_chars <= 3:
        return normalized[:max_chars]
    return normalized[: max_chars - 3].rstrip() + '...'


def _project_context_list(
    value: Any,
    *,
    max_items: int,
    item_chars: int,
    line_chars: int,
) -> str:
    if not isinstance(value, list):
        return ''
    items = [
        _project_context_text(item, item_chars)
        for item in value[:max_items]
        if isinstance(item, (str, int, float))
    ]
    return _project_context_text(', '.join(item for item in items if item), line_chars)


def _project_context_block(value: Any) -> str:
    """Render the TTL-cached linked-project pack with defensive hard caps."""
    if not isinstance(value, dict):
        return ''
    project = value.get('project')
    if not isinstance(project, dict):
        return ''

    title = _project_context_text(project.get('title'), 180) or '(untitled project)'
    lines = ['# Project context', f'Project: {title}']

    attributes: list[str] = []
    for label, key in (
        ('status', 'status'),
        ('category', 'category'),
        ('state', 'project_state'),
        ('duration', 'duration'),
        ('budget', 'budget_range'),
        ('funding', 'funding_status'),
        ('start', 'start_date'),
    ):
        attribute = _project_context_text(project.get(key), 100)
        if attribute:
            attributes.append(f'{label}: {attribute}')
    if attributes:
        lines.append('Details: ' + _project_context_text(' | '.join(attributes), 760))

    skills = _project_context_list(
        project.get('skills'), max_items=15, item_chars=80, line_chars=700
    )
    if skills:
        lines.append('Skills: ' + skills)

    brief_excerpt = _project_context_text(value.get('brief_excerpt'), 1200)
    if brief_excerpt:
        lines.append('Brief excerpt: ' + brief_excerpt)

    custom_field_keys = _project_context_list(
        value.get('custom_field_keys'), max_items=20, item_chars=80, line_chars=600
    )
    if custom_field_keys:
        lines.append('Custom brief fields: ' + custom_field_keys)

    members_raw = value.get('members')
    member_entries: list[str] = []
    if isinstance(members_raw, list):
        for member in members_raw[:15]:
            if not isinstance(member, dict):
                continue
            name = _project_context_text(member.get('display_name'), 100)
            member_id = _project_context_text(member.get('id'), 80)
            if not name:
                continue
            metadata: list[str] = []
            role = _project_context_text(member.get('role'), 60)
            if role:
                metadata.append(role)
            if member_id:
                metadata.append(f'id: {member_id}')
            suffix = f' ({"; ".join(metadata)})' if metadata else ''
            member_entries.append(name + suffix)
    if member_entries:
        lines.append(
            'Members: ' + _project_context_text(', '.join(member_entries), 1200)
        )

    teams = _project_context_list(
        value.get('teams'), max_items=8, item_chars=100, line_chars=600
    )
    if teams:
        lines.append('Teams: ' + teams)

    resource_summary = value.get('resource_summary')
    if isinstance(resource_summary, dict):
        resource_parts: list[str] = []
        count = resource_summary.get('count')
        if isinstance(count, int):
            resource_parts.append(f'{max(0, count)} link(s)')
        top_titles = _project_context_list(
            resource_summary.get('top_titles'),
            max_items=10,
            item_chars=100,
            line_chars=700,
        )
        if top_titles:
            resource_parts.append('top: ' + top_titles)
        if resource_parts:
            lines.append(
                'Resources: ' + _project_context_text(' | '.join(resource_parts), 850)
            )

    meeting_summary = value.get('meeting_summary')
    if isinstance(meeting_summary, dict):
        meeting_parts: list[str] = []
        upcoming_count = meeting_summary.get('upcoming_count')
        if isinstance(upcoming_count, int):
            meeting_parts.append(f'{max(0, upcoming_count)} upcoming')
        next_meeting = meeting_summary.get('next')
        if isinstance(next_meeting, dict):
            next_title = _project_context_text(next_meeting.get('title'), 160)
            scheduled_at = _project_context_text(
                next_meeting.get('scheduled_at'), 80
            )
            if next_title:
                next_text = f'next: {next_title}'
                if scheduled_at:
                    next_text += f' at {scheduled_at}'
                meeting_parts.append(next_text)
        if meeting_parts:
            lines.append(
                'Meetings: ' + _project_context_text(' | '.join(meeting_parts), 500)
            )

    body = '\n'.join(lines)
    body_max_chars = (
        _PROJECT_CONTEXT_BLOCK_MAX_CHARS - len(_PROJECT_CONTEXT_TOOL_HINT) - 1
    )
    if len(body) > body_max_chars:
        body = body[: body_max_chars - 3].rstrip() + '...'
    return body + '\n' + _PROJECT_CONTEXT_TOOL_HINT


def _pending_plan_block(session: AgentSession, plan: dict[str, Any]) -> str:
    summary = str(plan.get('summary') or plan.get('goal') or '').strip()
    kind = str(plan.get('kind') or 'plan')
    targets = [t for t in (plan.get('targets') or []) if isinstance(t, dict)]
    body_parts: list[str] = []
    if targets:
        for target in targets:
            roadmap_id = str(target.get('roadmap_id') or '')
            context = session.metadata.roadmaps.get(roadmap_id)
            title = (
                str(target.get('roadmap_title') or '').strip()
                or (context.title if context is not None else None)
                or roadmap_id
            )
            prefix = context.handle_prefix if context is not None else None
            marker = f'({prefix})' if prefix else '(focus)'
            committed = ' — already applied' if target.get('committed') else ''
            header = f'Target roadmap "{title}" {marker}{committed}:'
            outline = _pending_plan_outline(target)
            summary_lines = [
                str(line).strip()
                for line in (target.get('summary_lines') or [])
                if str(line).strip()
            ]
            detail = outline or '\n'.join(f'- {line}' for line in summary_lines)
            body_parts.append(header + ('\n' + detail if detail else ''))
    else:
        outline = _pending_plan_outline(plan)
        if outline:
            body_parts.append(outline)
    if not summary and not body_parts:
        return ''
    block = '# Pending proposal awaiting user confirmation\n' + summary
    if body_parts:
        block += '\n' + '\n'.join(body_parts)
    if kind == 'edits':
        block += (
            '\n(The user is deciding whether to apply these edits. They are '
            'applied exactly as listed when confirmed — do not re-stage them. '
            'Use revise_proposal only if the user asks to change the proposal.)'
        )
    else:
        block += (
            '\n(The user is deciding whether to apply this plan. If they '
            'confirm, the system stages operations that create EVERY item listed above '
            '— do not drop tasks or features. Items placed under an epic '
            'or feature that already exists on the roadmap go under that '
            'existing node via its handle; never re-create it.)'
        )
    return block


def _pending_plan_outline(plan: dict[str, Any]) -> str:
    """Render a proposal's full hierarchy (epic → feature → task titles).

    The materialize turn re-stages operations from this block — showing only
    the one-line summary made the model silently drop the plan's tasks.
    """
    lines: list[str] = []
    for epic in plan.get('proposed_hierarchy') or []:
        if not isinstance(epic, dict):
            continue
        epic_title = str(epic.get('title') or '').strip()
        if not epic_title:
            continue
        lines.append(f'- Epic: {epic_title}')
        for feature in epic.get('features') or []:
            if not isinstance(feature, dict):
                continue
            feature_title = str(feature.get('title') or '').strip()
            if not feature_title:
                continue
            target_epic = str(feature.get('target_epic_title') or '').strip()
            placement = f' (under existing epic: {target_epic})' if target_epic else ''
            lines.append(f'  - Feature: {feature_title}{placement}')
            for task in feature.get('tasks') or []:
                if not isinstance(task, dict):
                    continue
                task_title = str(task.get('title') or '').strip()
                if not task_title:
                    continue
                labels = _task_assignee_labels(task)
                assignees = f' (assignees: {", ".join(labels)})' if labels else ''
                lines.append(f'    - Task: {task_title}{assignees}')
    return '\n'.join(lines)


def _task_assignee_labels(task: dict[str, Any]) -> list[str]:
    """`assignee_labels` (every assignee) falling back to the legacy
    `assignee_label`; stripped, deduped, order preserved (first = primary)."""
    raw = task.get('assignee_labels')
    candidates: list[Any] = list(raw) if isinstance(raw, list) else []
    if not candidates:
        candidates = [task.get('assignee_label')]
    labels: list[str] = []
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        label = candidate.strip()
        if label and label not in labels:
            labels.append(label)
    return labels


def _roadmap_label(session: AgentSession, roadmap_id: Any) -> str | None:
    if not isinstance(roadmap_id, str) or not roadmap_id:
        return None
    context = session.metadata.roadmaps.get(roadmap_id)
    title = (context.title if context is not None else None) or roadmap_id
    return f'roadmap "{title}"'


def _change_history(session_context: dict[str, Any], session: AgentSession | None = None) -> str:
    """Render the per-commit change history (newest first) so the model can map
    a natural-language reference ("before I did X") to a change_id. The latest
    group also gets a hierarchical node breakdown (parent → child) so the model
    can answer "what did you just change?" precisely. Grouped by roadmap when
    the history spans several."""
    groups = [g for g in (session_context.get('change_history') or [])[:10] if isinstance(g, dict)]
    if not groups:
        return ''
    roadmap_ids = {str(g.get('roadmap_id')) for g in groups if g.get('roadmap_id')}
    multi = len(roadmap_ids) > 1 or (len(roadmap_ids) == 1 and any(not g.get('roadmap_id') for g in groups))

    def _render_group(index: int, group: dict[str, Any], *, breakdown: bool) -> list[str]:
        summary = str(group.get('summary') or '').strip() or 'Changes committed'
        change_id = group.get('change_id')
        committed_at = str(group.get('committed_at') or '').strip()
        header = f'{index + 1}. {summary}'
        meta: list[str] = []
        if change_id:
            meta.append(f'change_id: {change_id}')
        if committed_at:
            meta.append(committed_at)
        if meta:
            header += f' ({"; ".join(meta)})'
        out = [header]
        if breakdown:
            out.extend('   ' + detail for detail in _change_group_node_lines(group))
        return out

    if not multi:
        lines: list[str] = []
        for index, group in enumerate(groups):
            lines.extend(_render_group(index, group, breakdown=index == 0))
        return '\n'.join(lines)

    lines = []
    ordered_roadmaps: list[str | None] = []
    for group in groups:
        rid = group.get('roadmap_id') if isinstance(group.get('roadmap_id'), str) else None
        if rid not in ordered_roadmaps:
            ordered_roadmaps.append(rid)
    for rid in ordered_roadmaps:
        label = (_roadmap_label(session, rid) if session is not None else None) or (
            f'roadmap {rid}' if rid else 'roadmap (unknown)'
        )
        lines.append(f'{label[0].upper()}{label[1:]}:')
        for index, group in enumerate(groups):
            group_rid = group.get('roadmap_id') if isinstance(group.get('roadmap_id'), str) else None
            if group_rid != rid:
                continue
            lines.extend(_render_group(index, group, breakdown=index == 0))
    return '\n'.join(lines)


def _change_group_node_lines(group: dict[str, Any]) -> list[str]:
    changes = group.get('changes') or []
    out: list[str] = []
    for change in changes[:25]:
        if not isinstance(change, dict):
            continue
        change_type = str(change.get('change_type') or '').upper()
        node_type = str(change.get('node_type') or 'item')
        title = str(change.get('title') or '(untitled)')
        verb = {
            'NODE_ADDED': 'created',
            'NODE_REMOVED': 'deleted',
            'NODE_MOVED': 'moved',
        }.get(change_type, 'edited')
        out.append(f'- {verb} {node_type} "{title}"')
    return out


def _recent_targets(session_context: dict[str, Any], session: AgentSession | None = None) -> str:
    targets = session_context.get('recent_resolved_targets') or []
    lines: list[str] = []
    for target in targets[:8]:
        if not isinstance(target, dict):
            continue
        title = target.get('title') or target.get('label')
        node_type = target.get('node_type')
        node_id = target.get('node_id')
        if not title or not node_id:
            continue
        line = f'- {title} ({node_type}) — id {node_id}'
        label = _roadmap_label(session, target.get('roadmap_id')) if session is not None else None
        if label:
            line += f' — {label}'
        lines.append(line)
    return '\n'.join(lines)


def _actor_block(session: AgentSession, session_context: dict[str, Any]) -> str:
    """Always rendered: it is the last stable block, so it doubles as the
    boundary between the cacheable prefix and the per-turn tail."""
    actor = session_context.get('actor_context')
    role = session_context.get('roadmap_role')
    display_name = None
    if isinstance(actor, dict):
        display_name = _clean(actor.get('display_name'))
    who = display_name or 'the user'
    if session.scope.kind == 'workspace':
        return f'{_ACTOR_HEADER}\nYou are assisting {who} (workspace member).'
    if isinstance(role, str) and role:
        return f'{_ACTOR_HEADER}\nYou are assisting {who} ({role} of the focus roadmap).'
    return f'{_ACTOR_HEADER}\nYou are assisting {who}.'
