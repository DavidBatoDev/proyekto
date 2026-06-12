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

    conversation_summary = session_context.get('conversation_summary')
    if isinstance(conversation_summary, str) and conversation_summary.strip():
        blocks.append(
            '# Earlier conversation summary\n'
            '(Older turns were compacted. Treat this as ground truth for '
            'earlier context.)\n' + conversation_summary.strip()
        )

    memory_notes = session_context.get('memory_notes')
    if isinstance(memory_notes, list) and memory_notes:
        note_lines: list[str] = []
        for note in memory_notes[:30]:
            if not isinstance(note, dict):
                continue
            content = str(note.get('content') or '').strip()[:300]
            if not content:
                continue
            note_lines.append(
                f'- "{content}" (memory_id: {note.get("id")}, '
                f'source: {note.get("source")})'
            )
        if note_lines:
            blocks.append(
                '# Memory notes (durable preferences for this roadmap)\n'
                '(Shared by all collaborators. Apply these as standing '
                'conventions. Use forget_memory with the memory_id to remove '
                'one.)\n' + '\n'.join(note_lines)
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

    role = session_context.get('roadmap_role')
    if isinstance(role, str) and role:
        blocks.append(f'# Actor\nYou are assisting a roadmap {role}.')

    return '\n\n'.join(blocks)


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
