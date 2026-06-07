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

    staged = _staged_summary(session)
    if staged:
        blocks.append('# Staged changes (not yet committed)\n' + staged)

    pending_plan = session_context.get('pending_plan')
    if isinstance(pending_plan, dict):
        summary = str(pending_plan.get('summary') or pending_plan.get('goal') or '').strip()
        if summary:
            blocks.append(
                '# Pending plan awaiting user confirmation\n' + summary +
                '\n(The user is deciding whether to apply this plan.)'
            )

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
