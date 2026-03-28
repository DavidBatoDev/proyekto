from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable

from app.core.config import Settings
from app.core.logging_utils import log_event
from app.core.orchestration.edit_resolver import parse_selection_index

from .deterministic_intents import (
    DeterministicContextIntent,
    get_deterministic_context_intent,
    is_generic_roadmap_label,
)

ToolExecutor = Callable[[str, dict[str, Any], dict[str, Any]], dict[str, Any]]

OVERVIEW_MAX_EPICS_FOR_FEATURES = 3
OVERVIEW_MAX_FEATURES_FOR_TASKS = 8
OVERVIEW_MAX_TOTAL_CALLS = 12


@dataclass
class ContextResolutionOutcome:
    answer: str
    pending_context_resolution: dict[str, Any] | None = None
    clear_pending_context_resolution: bool = False


def try_pending_context_selection(
    *,
    user_message: str,
    session_context: dict[str, Any],
    trace_id: str | None,
    logger: logging.Logger,
    settings: Settings,
    execute_context_tool: ToolExecutor,
) -> ContextResolutionOutcome | None:
    pending = session_context.get('pending_context_resolution')
    if not isinstance(pending, dict):
        return None
    kind = str(pending.get('kind') or '').strip()
    resolution_id = str(pending.get('resolution_id') or '').strip()
    if kind not in {'features_of_epic', 'tasks_of_feature'} or not resolution_id:
        return None

    selection = parse_selection_index(user_message)
    if selection is None:
        return None

    roadmap_id = str(session_context.get('roadmap_id') or '').strip()
    if not roadmap_id:
        return None

    requested_choice = selection
    option_choices = pending.get('option_choices')
    if isinstance(option_choices, list) and 1 <= selection <= len(option_choices):
        mapped_choice = option_choices[selection - 1]
        if isinstance(mapped_choice, int) and mapped_choice >= 1:
            requested_choice = mapped_choice

    result = execute_context_tool(
        'get_children_from_resolution',
        {
            'roadmap_id': roadmap_id,
            'resolution_id': resolution_id,
            'choice': requested_choice,
            'limit': 100,
        },
        session_context,
    )
    if isinstance(result.get('error'), dict):
        error = result.get('error', {})
        log_event(
            logger,
            'context_resolution_selection_invalid',
            settings=settings,
            trace_id=trace_id,
            resolution_id=resolution_id,
            selection_index=selection,
            requested_choice=requested_choice,
            tool_error_code=error.get('code'),
        )
        return ContextResolutionOutcome(
            answer=(
                'That selection is not valid anymore. Please ask again and I will refresh '
                'the options.'
            ),
            clear_pending_context_resolution=True,
        )

    children = result.get('children')
    if not isinstance(children, list):
        return None
    label = str(pending.get('label') or 'the selected epic')
    pending_intent = get_deterministic_context_intent(kind)
    list_label = pending_intent.item_plural if pending_intent is not None else 'items'
    item_label = pending_intent.item_singular if pending_intent is not None else 'item'
    if not children:
        answer = f'I found no {list_label} under "{label}".'
    else:
        titles = [
            str(item.get('title') or f'Untitled {item_label}')
            for item in children
            if isinstance(item, dict)
        ]
        answer = f'{list_label.capitalize()} under "{label}":\n' + '\n'.join(
            f'- {title}' for title in titles[:20]
        )
    log_event(
        logger,
        'context_resolution_selection_applied',
        settings=settings,
        trace_id=trace_id,
        resolution_id=resolution_id,
        selection_index=selection,
        requested_choice=requested_choice,
        items_count=len(children),
    )
    return ContextResolutionOutcome(
        answer=answer,
        clear_pending_context_resolution=True,
    )


def try_deterministic_list_answer(
    *,
    intent: DeterministicContextIntent,
    label: str,
    include_ids: bool,
    user_message: str | None = None,
    session_context: dict[str, Any],
    trace_id: str | None,
    logger: logging.Logger,
    settings: Settings,
    execute_context_tool: ToolExecutor,
) -> ContextResolutionOutcome | None:
    roadmap_id = str(session_context.get('roadmap_id') or '').strip()
    if not roadmap_id:
        return None

    if intent.pending_kind == 'roadmap_overview':
        return _build_deterministic_overview_answer(
            roadmap_id=roadmap_id,
            include_ids=include_ids,
            session_context=session_context,
            trace_id=trace_id,
            parse_mode=intent.parse_mode,
            logger=logger,
            settings=settings,
            execute_context_tool=execute_context_tool,
        )

    if intent.pending_kind == 'my_tasks':
        actor_context = session_context.get('actor_context')
        actor_present = isinstance(actor_context, dict) and bool(
            str(actor_context.get('actor_id') or '').strip()
        )
        roadmap_role = (
            str(actor_context.get('roadmap_role') or '').strip()
            if isinstance(actor_context, dict)
            else None
        )
        actor_context_source = (
            str(actor_context.get('actor_context_source') or '').strip()
            if isinstance(actor_context, dict)
            else None
        )
        if not actor_present:
            log_event(
                logger,
                'deterministic_context_my_tasks',
                settings=settings,
                trace_id=trace_id,
                parse_mode=intent.parse_mode,
                actor_present=False,
                roadmap_role=roadmap_role or None,
                actor_context_source=actor_context_source or None,
                task_count=0,
                status_filter='open',
                actor_missing=True,
            )
            return ContextResolutionOutcome(
                answer=(
                    'I could not confirm your actor context for this roadmap yet. '
                    'Please retry in a moment, and I will fetch tasks assigned to you.'
                ),
                clear_pending_context_resolution=True,
            )

        status_filter = _determine_my_tasks_status(user_message)
        tasks_result = execute_context_tool(
            'get_tasks_assigned_to_me',
            {
                'roadmap_id': roadmap_id,
                'status': status_filter,
                'limit': 100,
            },
            session_context,
        )
        if isinstance(tasks_result.get('error'), dict):
            return None
        tasks = tasks_result.get('tasks')
        if not isinstance(tasks, list):
            return None

        actor_label = (
            str(actor_context.get('display_name') or '').strip()
            if isinstance(actor_context, dict)
            else ''
        )
        assignee_label = actor_label or 'you'
        if not tasks:
            status_text = 'open ' if status_filter == 'open' else ''
            answer = f'I found no {status_text}tasks assigned to {assignee_label} in this roadmap.'
        else:
            lines = [
                f'Tasks assigned to {assignee_label} ({status_filter}):',
            ]
            for task in tasks[:30]:
                if not isinstance(task, dict):
                    continue
                title = str(task.get('title') or 'Untitled task')
                status = str(task.get('status') or 'unknown')
                feature_title = str(task.get('feature_title') or '').strip()
                epic_title = str(task.get('epic_title') or '').strip()
                context_suffix_parts: list[str] = []
                if feature_title:
                    context_suffix_parts.append(feature_title)
                if epic_title:
                    context_suffix_parts.append(epic_title)
                context_suffix = ''
                if context_suffix_parts:
                    context_suffix = f' ({", ".join(context_suffix_parts)})'
                task_line = f'- {title} [status: {status}]{context_suffix}'
                if include_ids:
                    task_id = str(task.get('id') or '').strip()
                    if task_id:
                        task_line += f' [id: {task_id}]'
                lines.append(task_line)
            if len(tasks) > 30:
                lines.append(f'- ...and {len(tasks) - 30} more task(s)')
            answer = '\n'.join(lines)

        log_event(
            logger,
            'deterministic_context_my_tasks',
            settings=settings,
            trace_id=trace_id,
            parse_mode=intent.parse_mode,
            actor_present=True,
            roadmap_role=roadmap_role or None,
            actor_context_source=actor_context_source or None,
            task_count=len(tasks),
            status_filter=status_filter,
            include_ids=include_ids,
        )
        return ContextResolutionOutcome(
            answer=answer,
            clear_pending_context_resolution=True,
        )

    if is_generic_roadmap_label(label):
        overview_intent = get_deterministic_context_intent('roadmap_overview')
        if overview_intent is not None:
            return _build_deterministic_overview_answer(
                roadmap_id=roadmap_id,
                include_ids=include_ids,
                session_context=session_context,
                trace_id=trace_id,
                parse_mode=overview_intent.parse_mode,
                logger=logger,
                settings=settings,
                execute_context_tool=execute_context_tool,
            )

    if intent.pending_kind == 'epics_in_roadmap':
        summary_result = execute_context_tool(
            'get_roadmap_summary',
            {'roadmap_id': roadmap_id},
            session_context,
        )
        if isinstance(summary_result.get('error'), dict):
            return None
        epics = summary_result.get('epics')
        if not isinstance(epics, list):
            return None
        if not epics:
            answer = 'This roadmap has no epics yet.'
        else:
            epic_count = len(epics)
            lines = [f'This roadmap has {epic_count} epic{"s" if epic_count != 1 else ""}:']
            for index, epic in enumerate(epics, start=1):
                if not isinstance(epic, dict):
                    continue
                title = str(epic.get('title') or 'Untitled epic')
                status = str(epic.get('status') or 'unknown')
                feature_count = epic.get('feature_count')
                feature_count_text = str(feature_count) if isinstance(feature_count, int) else '0'
                line = (
                    f'{index}. {title} - status: {status} - {feature_count_text} '
                    f'feature{"s" if feature_count_text != "1" else ""}'
                )
                if include_ids:
                    epic_id = str(epic.get('id') or '').strip()
                    if epic_id:
                        line += f' (id: {epic_id})'
                lines.append(line)
            answer = '\n'.join(lines)
        log_event(
            logger,
            'deterministic_context_epics',
            settings=settings,
            trace_id=trace_id,
            parse_mode=intent.parse_mode,
            epic_count=len(epics),
            include_ids=include_ids,
        )
        return ContextResolutionOutcome(
            answer=answer,
            clear_pending_context_resolution=True,
        )

    resolve_result = execute_context_tool(
        'resolve_node_reference',
        {
            'roadmap_id': roadmap_id,
            'label': label,
            'node_type': intent.resolver_node_type,
            'limit': 10,
        },
        session_context,
    )
    if isinstance(resolve_result.get('error'), dict):
        return None
    if resolve_result.get('status') != 'unique':
        matches = resolve_result.get('matches')
        resolution_id = str(resolve_result.get('resolution_id') or '').strip()
        if isinstance(matches, list) and matches:
            lines = [f'I found multiple {intent.entity_plural} for "{label}". Please choose one:']
            for index, item in enumerate(matches[:5], start=1):
                if isinstance(item, dict):
                    title = str(item.get('title') or 'Untitled')
                    lines.append(f'{index}. {title}')
            lines.append(
                f'Reply with the option number and I can fetch its {intent.item_plural}.'
            )
            pending: dict[str, Any] | None = None
            if resolution_id:
                option_choices: list[int] = []
                for item in matches[:5]:
                    if isinstance(item, dict):
                        choice = item.get('backend_choice')
                        if isinstance(choice, int) and choice >= 1:
                            option_choices.append(choice)
                pending = {
                    'kind': intent.pending_kind,
                    'resolution_id': resolution_id,
                    'label': label,
                    'node_type': intent.resolver_node_type,
                    'option_choices': option_choices or None,
                }
                log_event(
                    logger,
                    'context_resolution_pending_set',
                    settings=settings,
                    trace_id=trace_id,
                    resolution_id=resolution_id,
                    label=label,
                    node_type=intent.resolver_node_type,
                    candidates_count=len(matches),
                )
            return ContextResolutionOutcome(
                answer='\n'.join(lines),
                pending_context_resolution=pending,
                clear_pending_context_resolution=not bool(pending),
            )
        return None

    selected = resolve_result.get('selected')
    if not isinstance(selected, dict):
        return None
    parent_id = str(selected.get('id') or '').strip()
    if not parent_id:
        return None

    if intent.pending_kind == 'features_of_epic':
        list_result = execute_context_tool(
            'get_features',
            {'roadmap_id': roadmap_id, 'epic_id': parent_id, 'limit': 100},
            session_context,
        )
    else:
        list_result = execute_context_tool(
            'get_children',
            {'roadmap_id': roadmap_id, 'parent_id': parent_id, 'limit': 100},
            session_context,
        )
    if isinstance(list_result.get('error'), dict):
        return None
    children = list_result.get('children')
    if not isinstance(children, list):
        return None
    selected_title = str(selected.get('title') or label)
    if not children:
        return ContextResolutionOutcome(
            answer=f'I found no {intent.item_plural} under "{selected_title}".',
            clear_pending_context_resolution=True,
        )
    item_titles = [
        str(item.get('title') or f'Untitled {intent.item_singular}')
        for item in children
        if isinstance(item, dict)
    ]
    bullet_list = '\n'.join(f'- {title}' for title in item_titles[:20])
    return ContextResolutionOutcome(
        answer=f'{intent.item_plural.capitalize()} under "{selected_title}":\n{bullet_list}',
        clear_pending_context_resolution=True,
    )


def _build_deterministic_overview_answer(
    *,
    roadmap_id: str,
    include_ids: bool,
    session_context: dict[str, Any],
    trace_id: str | None,
    parse_mode: str,
    logger: logging.Logger,
    settings: Settings,
    execute_context_tool: ToolExecutor,
) -> ContextResolutionOutcome | None:
    total_calls = 0
    budget_hit = False
    truncated_epics = False
    truncated_features = False
    truncated_tasks = False

    def _consume_call() -> bool:
        nonlocal total_calls
        if total_calls >= OVERVIEW_MAX_TOTAL_CALLS:
            return False
        total_calls += 1
        return True

    if not _consume_call():
        return None
    summary_result = execute_context_tool(
        'get_roadmap_summary',
        {'roadmap_id': roadmap_id},
        session_context,
    )
    if isinstance(summary_result.get('error'), dict):
        return None
    epics = summary_result.get('epics')
    if not isinstance(epics, list):
        return None

    if not epics:
        answer = 'This roadmap has no epics, features, or tasks yet.'
        log_event(
            logger,
            'deterministic_context_overview',
            settings=settings,
            trace_id=trace_id,
            parse_mode=parse_mode,
            epic_count=0,
            feature_count=0,
            task_count=0,
            include_ids=include_ids,
            budget_hit=False,
            truncated=False,
            pending_cleared=True,
        )
        return ContextResolutionOutcome(
            answer=answer,
            clear_pending_context_resolution=True,
        )

    lines: list[str] = ['Roadmap overview:']
    feature_total = 0
    task_total = 0
    features_processed_for_tasks = 0

    epics_to_expand = epics[:OVERVIEW_MAX_EPICS_FOR_FEATURES]
    if len(epics) > len(epics_to_expand):
        truncated_epics = True

    for epic_index, epic in enumerate(epics_to_expand, start=1):
        if not isinstance(epic, dict):
            continue
        epic_title = str(epic.get('title') or 'Untitled epic')
        epic_status = str(epic.get('status') or 'unknown')
        epic_id = str(epic.get('id') or '').strip()
        epic_line = f'{epic_index}. {epic_title} (status: {epic_status})'
        if include_ids and epic_id:
            epic_line += f' [id: {epic_id}]'
        lines.append(epic_line)

        if not epic_id:
            continue
        if not _consume_call():
            budget_hit = True
            break
        feature_result = execute_context_tool(
            'get_features',
            {'roadmap_id': roadmap_id, 'epic_id': epic_id, 'limit': 100},
            session_context,
        )
        if isinstance(feature_result.get('error'), dict):
            return None
        features = feature_result.get('children')
        if not isinstance(features, list):
            continue
        feature_total += len(features)
        if not features:
            lines.append('   Features: none')
            continue

        lines.append('   Features:')
        for feature in features:
            if not isinstance(feature, dict):
                continue
            feature_title = str(feature.get('title') or 'Untitled feature')
            feature_id = str(feature.get('id') or '').strip()
            feature_line = f'   - {feature_title}'
            if include_ids and feature_id:
                feature_line += f' [id: {feature_id}]'
            lines.append(feature_line)

            if features_processed_for_tasks >= OVERVIEW_MAX_FEATURES_FOR_TASKS:
                truncated_features = True
                continue
            if not feature_id:
                continue
            if not _consume_call():
                budget_hit = True
                break
            features_processed_for_tasks += 1
            task_result = execute_context_tool(
                'get_children',
                {'roadmap_id': roadmap_id, 'parent_id': feature_id, 'limit': 100},
                session_context,
            )
            if isinstance(task_result.get('error'), dict):
                return None
            tasks = task_result.get('children')
            if not isinstance(tasks, list):
                continue
            task_total += len(tasks)
            if not tasks:
                lines.append('     Tasks: none')
                continue
            lines.append('     Tasks:')
            for task in tasks[:5]:
                if not isinstance(task, dict):
                    continue
                task_title = str(task.get('title') or 'Untitled task')
                task_id = str(task.get('id') or '').strip()
                task_line = f'     * {task_title}'
                if include_ids and task_id:
                    task_line += f' [id: {task_id}]'
                lines.append(task_line)
            if len(tasks) > 5:
                truncated_tasks = True
                lines.append(f'     * ...and {len(tasks) - 5} more task(s)')
        if budget_hit:
            break

    truncated = truncated_epics or truncated_features or truncated_tasks or budget_hit
    if truncated:
        lines.append(
            'Results were truncated for performance. Ask "show more" or narrow to a specific epic/feature.'
        )

    log_event(
        logger,
        'deterministic_context_overview',
        settings=settings,
        trace_id=trace_id,
        parse_mode=parse_mode,
        epic_count=len(epics_to_expand),
        feature_count=feature_total,
        task_count=task_total,
        include_ids=include_ids,
        budget_hit=budget_hit,
        truncated=truncated,
        pending_cleared=True,
        max_epics_for_features=OVERVIEW_MAX_EPICS_FOR_FEATURES,
        max_features_for_tasks=OVERVIEW_MAX_FEATURES_FOR_TASKS,
        max_total_overview_calls=OVERVIEW_MAX_TOTAL_CALLS,
        total_overview_calls=total_calls,
    )
    return ContextResolutionOutcome(
        answer='\n'.join(lines),
        clear_pending_context_resolution=True,
    )


def _determine_my_tasks_status(user_message: str | None) -> str:
    if not user_message:
        return 'open'
    lowered = user_message.lower()
    if any(
        phrase in lowered
        for phrase in (
            'all tasks',
            'including completed',
            'include completed',
            'completed tasks',
            'done tasks',
            'archived tasks',
        )
    ):
        return 'all'
    return 'open'
