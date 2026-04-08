from __future__ import annotations

from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession
from app.core.llm.client import LLMPlanner, PlanningResult


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
        'deterministic_context_my_tasks_low_confidence',
        'deterministic_context_my_tasks_provider_error',
        'deterministic_context_my_tasks_invalid_payload',
        'deterministic_context_budget_exhausted',
        'deterministic_context_repeat_limit_exhausted',
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
