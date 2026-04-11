from __future__ import annotations

import re
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession
from app.core.llm.client import LLMPlanner, PlanningResult

_STAGED_CHANGE_QUERY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'\bwhat\s+(?:would|will)\s+(?:you\s+)?change\b', re.IGNORECASE),
    re.compile(r'\bwhat\s+changes?\b', re.IGNORECASE),
    re.compile(r'\btell\s+me\s+what\s+(?:would|will)\s+(?:you\s+)?change\b', re.IGNORECASE),
    re.compile(r'\bshow\s+(?:me\s+)?(?:the\s+)?staged\s+changes?\b', re.IGNORECASE),
    re.compile(r'\bwhat\s+is\s+staged\b', re.IGNORECASE),
)


def _is_staged_change_query(query_message: str) -> bool:
    normalized = ' '.join(str(query_message or '').strip().split())
    if not normalized:
        return False
    for pattern in _STAGED_CHANGE_QUERY_PATTERNS:
        if pattern.search(normalized):
            return True
    return False


def _pluralize(value: int, singular: str, plural: str) -> str:
    return singular if int(value) == 1 else plural


def _build_deterministic_staged_change_summary(
    staged_operations: list[RoadmapOperation],
) -> str:
    if not staged_operations:
        return 'There are no staged operations to summarize.'

    mark_status_ops = [
        operation
        for operation in staged_operations
        if operation.op.value == 'mark_status'
    ]
    if mark_status_ops and len(mark_status_ops) == len(staged_operations):
        status_counts: dict[str, int] = {}
        for operation in mark_status_ops:
            status_value = str(operation.status or '').strip().replace('_', ' ')
            if not status_value:
                status_value = 'the requested status'
            status_counts[status_value] = status_counts.get(status_value, 0) + 1

        status_parts = [
            f'{count} {_pluralize(count, "item", "items")} to "{status}"'
            for status, count in sorted(status_counts.items())
        ]
        status_summary = ', '.join(status_parts)
        total_updates = len(mark_status_ops)
        return (
            'Based on the currently staged operations, '
            f'I would apply {total_updates} status {_pluralize(total_updates, "change", "changes")}: '
            f'{status_summary}.'
        )

    op_counts: dict[str, int] = {}
    for operation in staged_operations:
        op_name = str(operation.op.value or '').strip() or 'unknown'
        op_counts[op_name] = op_counts.get(op_name, 0) + 1
    op_summary = ', '.join(
        f'{count} {op_name}'
        for op_name, count in sorted(op_counts.items())
    )
    total_ops = len(staged_operations)
    return (
        'Based on the currently staged operations, '
        f'I would apply {total_ops} {_pluralize(total_ops, "operation", "operations")}: '
        f'{op_summary}.'
    )


def run_mixed_query_followup(
    *,
    session: AgentSession,
    query_message: str,
    staged_operations: list[RoadmapOperation],
    auth_header: str | None,
    trace_id: str | None,
    planner: LLMPlanner,
    build_session_context: Callable[[AgentSession, str | None, str | None], dict[str, Any]],
    apply_context_answer_output_guard: Callable[..., PlanningResult],
    is_mixed_query_followup_clarifier: Callable[[PlanningResult], bool],
) -> tuple[str | None, str | None]:
    if not staged_operations:
        return None, 'mixed_query_no_staged_operations'
    if _is_staged_change_query(query_message):
        return _build_deterministic_staged_change_summary(staged_operations), None
    followup_trace_id = f'{trace_id}:mixed_query_followup' if trace_id else None
    try:
        query_session_context = build_session_context(
            session,
            auth_header,
            followup_trace_id,
        )
        query_planning = planner.plan(
            user_message=query_message,
            existing_operations=staged_operations,
            session_context=query_session_context,
        )
        query_planning = apply_context_answer_output_guard(
            planning=query_planning,
            pending_edit_context_present=session.metadata.pending_edit_context is not None,
        )
        if query_planning.response_mode != 'chat':
            return None, 'mixed_query_non_chat_response'
        if is_mixed_query_followup_clarifier(query_planning):
            return None, 'mixed_query_followup_needs_clarification'
        normalized_answer = query_planning.assistant_message.strip()
        if not normalized_answer:
            return None, 'mixed_query_empty_answer'
        if 'could not confirm your actor context' in normalized_answer.lower():
            return None, 'mixed_query_followup_actor_context_missing'
        return normalized_answer, None
    except Exception:
        return None, 'mixed_query_followup_failed'


def compose_mixed_query_assistant_message(
    *,
    edit_message: str,
    followup_answer: str | None,
    warning_code: str | None,
    mixed_query_warning_text: Callable[[str | None], str | None],
) -> str:
    sections: list[str] = []
    normalized_edit_message = edit_message.strip() if edit_message else ''
    if normalized_edit_message:
        sections.append(normalized_edit_message)
    if followup_answer:
        sections.append(
            'Draft-view answer after staging these edits:\n'
            f'{followup_answer.strip()}'
        )
    warning_text = mixed_query_warning_text(warning_code)
    if warning_text:
        sections.append(f'Note: {warning_text}')
    if sections:
        return '\n\n'.join(sections)
    return edit_message


def is_mixed_query_followup_clarifier(planning: PlanningResult) -> bool:
    parse_mode = str(planning.parse_mode or '').strip().lower()
    provider_error_code = str(planning.provider_error_code or '').strip().lower()
    if parse_mode in {
        'context_my_tasks_low_confidence',
        'context_my_tasks_provider_error',
        'context_my_tasks_invalid_payload',
        'context_budget_exhausted',
        'context_repeat_limit_exhausted',
    }:
        return True
    if provider_error_code in {
        'low_confidence',
        'provider_error',
        'invalid_payload',
        'max_tool_turns_exceeded',
        'discovery_budget_exhausted',
        'discovery_repeat_limit_exhausted',
    }:
        return True
    return False


def mixed_query_warning_text(warning_code: str | None) -> str | None:
    if not warning_code:
        return None
    if warning_code == 'mixed_query_no_staged_operations':
        return 'I staged no changes, so there was no staged context to answer the follow-up query.'
    if warning_code == 'mixed_query_non_chat_response':
        return (
            'I could not generate a safe staged-context query answer in this turn. '
            'You can ask the question again and I will answer from staged context.'
        )
    if warning_code == 'mixed_query_empty_answer':
        return 'I could not derive a non-empty staged-context answer for the follow-up query.'
    if warning_code == 'mixed_query_followup_actor_context_missing':
        return (
            'I could not answer the follow-up my-tasks question because actor context was missing. '
            'Please retry and I will refresh actor context first.'
        )
    if warning_code == 'mixed_query_followup_needs_clarification':
        return (
            'I staged the edit, but the follow-up query needs clarification '
            '(for example: open tasks vs all tasks).'
        )
    if warning_code == 'mixed_query_followup_failed':
        return 'Staged-context follow-up query execution failed, so only the edit plan was staged.'
    return None
