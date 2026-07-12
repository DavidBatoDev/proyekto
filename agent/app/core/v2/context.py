"""Context assembly for the v2 loop.

Builds the OpenAI ``messages`` array: a system prompt + a COMPACT state header
(handle-map outline, staged-ops summary, pending plan, recently resolved
items, actor) + trimmed conversation history + the current user turn. The full
roadmap is never re-stuffed — the model fetches detail on demand via read
tools, referencing the handle outline (E1 / E1.F2).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.contracts.sessions import AgentSession

_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parent / 'prompts' / 'system_v2.md'
_PROJECT_CONTEXT_BLOCK_MAX_CHARS = 3600
_PROJECT_CONTEXT_TOOL_HINT = (
    '(For more detail, use get_project_brief, list_project_resources, '
    'list_project_meetings, or get_member_details.)'
)


@lru_cache(maxsize=1)
def _system_prompt_template() -> str:
    return _SYSTEM_PROMPT_PATH.read_text(encoding='utf-8').strip()


def build_messages(
    session: AgentSession,
    session_context: dict[str, Any],
    user_message: str,
) -> list[dict[str, Any]]:
    system = _system_prompt_template() + '\n\n' + compact_state(session, session_context)
    messages: list[dict[str, Any]] = [{'role': 'system', 'content': system}]
    messages.extend(_trimmed_history(session_context))
    messages.append({'role': 'user', 'content': user_message})
    return messages


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


def compact_state(session: AgentSession, session_context: dict[str, Any]) -> str:
    blocks: list[str] = []

    overview = session_context.get('roadmap_overview_summary')
    if isinstance(overview, str) and overview.strip():
        blocks.append('# Current roadmap\n' + overview.strip())
    else:
        blocks.append('# Current roadmap\n(empty — no epics yet)')

    project_context = _project_context_block(session_context.get('project_context'))
    if project_context:
        blocks.append(project_context)

    conversation_summary = session_context.get('conversation_summary')
    if isinstance(conversation_summary, str) and conversation_summary.strip():
        blocks.append(
            '# Earlier conversation summary\n'
            '(Older turns were compacted. Treat this as ground truth for '
            'earlier context.)\n' + conversation_summary.strip()
        )

    memory_notes = session_context.get('memory_notes')
    memory_semantic = bool(session_context.get('memory_notes_semantic'))
    if isinstance(memory_notes, list) and memory_notes:
        if memory_semantic:
            # Semantic mode: a stable one-line stub here (preserves the
            # cached prompt prefix) — the matched notes render at the tail.
            blocks.append(
                '# Memory notes\n'
                f'({len(memory_notes)} stored; the most relevant are listed '
                'at the end of this header under "# Relevant memories".)'
            )
        else:
            note_lines = _memory_note_lines(memory_notes[:30])
            if note_lines:
                blocks.append(
                    '# Memory notes (durable preferences for this roadmap)\n'
                    '(Shared by all collaborators. Apply these as standing '
                    'conventions. Use forget_memory with the memory_id to '
                    'remove one.)\n' + note_lines
                )

    staged = _staged_summary(session)
    if staged:
        blocks.append('# Staged changes (not yet committed)\n' + staged)

    pending_plan = session_context.get('pending_plan')
    if isinstance(pending_plan, dict):
        summary = str(pending_plan.get('summary') or pending_plan.get('goal') or '').strip()
        outline = _pending_plan_outline(pending_plan)
        if summary or outline:
            block = '# Pending plan awaiting user confirmation\n' + summary
            if outline:
                block += '\n' + outline
            block += (
                '\n(The user is deciding whether to apply this plan. If they '
                'confirm, stage operations that create EVERY item listed above '
                '— do not drop tasks or features. Items placed under an epic '
                'or feature that already exists on the roadmap go under that '
                'existing node via its handle; never re-create it.)'
            )
            blocks.append(block)

    pending_edit = session_context.get('pending_edit_context')
    if isinstance(pending_edit, dict):
        hint = str(pending_edit.get('source_user_message') or '').strip()
        if hint:
            blocks.append(
                '# Pending edit awaiting your follow-through\nOriginal request: ' + hint
            )

    recent = _recent_targets(session_context)
    if recent:
        blocks.append('# Recently resolved items (you may reference these)\n' + recent)

    change_history = _change_history(session_context)
    if change_history:
        blocks.append(
            '# Recent changes (revertible — newest first)\n'
            '(Call revert_changes to undo the latest change, or '
            'revert_changes with a change_id below to undo back to that point — '
            'that change and every newer one are undone.)\n' + change_history
        )

    role = session_context.get('roadmap_role')
    if isinstance(role, str) and role:
        blocks.append(f'# Actor\nYou are assisting a roadmap {role}.')

    # Per-turn block — MUST stay last so churn only costs the prompt suffix
    # (the prefix through # Actor stays byte-stable for the prompt cache).
    if memory_semantic:
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

    return '\n\n'.join(blocks)


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
            persona = _project_context_text(member.get('persona'), 60)
            if role:
                metadata.append(role)
            if persona:
                metadata.append(persona)
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


def _staged_summary(session: AgentSession) -> str:
    operations = session.operations or []
    if not operations:
        return ''
    lines: list[str] = [f'{len(operations)} operation(s) staged:']
    for op in operations[:12]:
        op_name = getattr(op.op, 'value', None) or str(op.op)
        title = None
        if isinstance(op.data, dict):
            title = op.data.get('title')
        if not title and isinstance(op.patch, dict):
            title = op.patch.get('title')
        suffix = f' "{title}"' if isinstance(title, str) and title else ''
        lines.append(f'- {op_name}{suffix}')
    if len(operations) > 12:
        lines.append(f'- …and {len(operations) - 12} more')
    return '\n'.join(lines)


def _pending_plan_outline(plan: dict[str, Any]) -> str:
    """Render the plan's full proposed hierarchy (epic → feature → task titles).

    The confirm turn re-stages operations from this block — showing only the
    one-line summary made the model silently drop the plan's tasks/features.
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
                lines.append(f'    - Task: {task_title}')
    return '\n'.join(lines)


def _change_history(session_context: dict[str, Any]) -> str:
    """Render the per-commit change history (newest first) so the model can map
    a natural-language reference ("before I did X") to a change_id. The latest
    group also gets a hierarchical node breakdown (parent → child) so the model
    can answer "what did you just change?" precisely."""
    groups = session_context.get('change_history') or []
    lines: list[str] = []
    for index, group in enumerate(groups[:10]):
        if not isinstance(group, dict):
            continue
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
        lines.append(header)
        # Node breakdown for the most recent group only — enough for "what did
        # you just change?" without bloating the prompt for older groups.
        if index == 0:
            for detail in _change_group_node_lines(group):
                lines.append('   ' + detail)
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


def _recent_targets(session_context: dict[str, Any]) -> str:
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
        lines.append(f'- {title} ({node_type}) — id {node_id}')
    return '\n'.join(lines)
