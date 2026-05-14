from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from app.core.logging_utils import log_event, summarize_tool_result

from .base import ToolHandlerBase


class EditHelperHandler(ToolHandlerBase):
    async def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        trace_id = session_context.get('trace_id')
        roadmap_id = str(session_context.get('roadmap_id') or '').strip()
        auth_value = session_context.get('auth_header')
        if not (isinstance(auth_value, str) and auth_value):
            auth_value = None
        context_selector = session_context.get('context_change_selector')
        if not (isinstance(context_selector, str) and context_selector.strip()):
            context_selector = None

        if tool_name == 'create_epic':
            title = str(args.get('title') or '').strip()
            if not title:
                return self._invalid_argument_result(
                    arg_name='title',
                    arg_value=args.get('title'),
                    message='title is required for create_epic.',
                )
            data: dict[str, Any] = {'title': title}
            for key in ('description', 'status'):
                value = args.get(key)
                if isinstance(value, str) and value.strip():
                    data[key] = value.strip()
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[{'op': 'add_epic', 'node_type': 'epic', 'data': data}],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'create_feature':
            epic_id = str(args.get('epic_id') or '').strip()
            title = str(args.get('title') or '').strip()
            if not epic_id:
                return self._invalid_argument_result(
                    arg_name='epic_id',
                    arg_value=args.get('epic_id'),
                    message='epic_id is required for create_feature.',
                )
            if not title:
                return self._invalid_argument_result(
                    arg_name='title',
                    arg_value=args.get('title'),
                    message='title is required for create_feature.',
                )
            data = {'title': title}
            for key in ('description', 'status'):
                value = args.get(key)
                if isinstance(value, str) and value.strip():
                    data[key] = value.strip()
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'add_feature',
                        'node_type': 'feature',
                        'parent_id': epic_id,
                        'data': data,
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'create_task':
            feature_id = str(args.get('feature_id') or '').strip()
            title = str(args.get('title') or '').strip()
            if not feature_id:
                return self._invalid_argument_result(
                    arg_name='feature_id',
                    arg_value=args.get('feature_id'),
                    message='feature_id is required for create_task.',
                )
            if not title:
                return self._invalid_argument_result(
                    arg_name='title',
                    arg_value=args.get('title'),
                    message='title is required for create_task.',
                )
            data = {'title': title}
            for key in (
                'description',
                'status',
                'priority',
                'assignee_id',
                'due_date',
            ):
                value = args.get(key)
                if isinstance(value, str) and value.strip():
                    data[key] = value.strip()
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'add_task',
                        'node_type': 'task',
                        'parent_id': feature_id,
                        'data': data,
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'update_task_status':
            task_id = str(args.get('task_id') or '').strip()
            if not task_id:
                return self._invalid_argument_result(
                    arg_name='task_id',
                    arg_value=args.get('task_id'),
                    message='task_id is required for update_task_status.',
                )
            status = self._normalize_task_status_input(args.get('status'))
            if status is None:
                return self._invalid_argument_result(
                    arg_name='status',
                    arg_value=args.get('status'),
                    message=self._task_status_validation_message(),
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'node_id': task_id,
                        'status': status,
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'update_task_priority':
            task_id = str(args.get('task_id') or '').strip()
            priority = str(args.get('priority') or '').strip()
            if not task_id or not priority:
                return self._invalid_argument_result(
                    arg_name='task_id/priority',
                    arg_value=args,
                    message='task_id and priority are required for update_task_priority.',
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'node_id': task_id,
                        'patch': {'priority': priority},
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'update_task_assignee':
            task_id = str(args.get('task_id') or '').strip()
            has_assignee_id = 'assignee_id' in args
            is_valid_assignee, assignee_id = self._normalize_assignee_update_input(
                args.get('assignee_id')
            )
            if not task_id or not has_assignee_id:
                return self._invalid_argument_result(
                    arg_name='task_id/assignee_id',
                    arg_value=args,
                    message='task_id and assignee_id are required for update_task_assignee.',
                )
            if not is_valid_assignee:
                return self._invalid_argument_result(
                    arg_name='assignee_id',
                    arg_value=args.get('assignee_id'),
                    message=(
                        'assignee_id must be a non-empty string or null '
                        '(use null/unassign/unassigned/none/null to clear assignment).'
                    ),
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'node_id': task_id,
                        'patch': {'assignee_id': assignee_id},
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name in {'update_feature_status', 'update_epic_status'}:
            id_key = 'feature_id' if tool_name == 'update_feature_status' else 'epic_id'
            node_type = 'feature' if tool_name == 'update_feature_status' else 'epic'
            node_id = str(args.get(id_key) or '').strip()
            status = str(args.get('status') or '').strip()
            if not node_id or not status:
                return self._invalid_argument_result(
                    arg_name=f'{id_key}/status',
                    arg_value=args,
                    message=f'{id_key} and status are required for {tool_name}.',
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'mark_status',
                        'node_type': node_type,
                        'node_id': node_id,
                        'status': status,
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'update_titles':
            node_type = str(args.get('node_type') or '').strip().lower()
            node_id = str(args.get('node_id') or '').strip()
            title = str(args.get('title') or '').strip()
            if node_type not in {'epic', 'feature', 'task'} or not node_id or not title:
                return self._invalid_argument_result(
                    arg_name='node_type/node_id/title',
                    arg_value=args,
                    message='node_type, node_id, and title are required for update_titles.',
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'update_node',
                        'node_type': node_type,
                        'node_id': node_id,
                        'patch': {'title': title},
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name in {'delete_task', 'delete_feature', 'delete_epic'}:
            key_by_tool = {
                'delete_task': ('task_id', 'task'),
                'delete_feature': ('feature_id', 'feature'),
                'delete_epic': ('epic_id', 'epic'),
            }
            id_key, node_type = key_by_tool[tool_name]
            node_id = str(args.get(id_key) or '').strip()
            if not node_id:
                return self._invalid_argument_result(
                    arg_name=id_key,
                    arg_value=args.get(id_key),
                    message=f'{id_key} is required for {tool_name}.',
                )
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[
                    {
                        'op': 'delete_node',
                        'node_type': node_type,
                        'node_id': node_id,
                    }
                ],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name in {'move_task_to_feature', 'move_feature_to_epic'}:
            if tool_name == 'move_task_to_feature':
                node_id = str(args.get('task_id') or '').strip()
                new_parent_id = str(args.get('feature_id') or '').strip()
                node_type = 'task'
                arg_label = 'task_id/feature_id'
            else:
                node_id = str(args.get('feature_id') or '').strip()
                new_parent_id = str(args.get('epic_id') or '').strip()
                node_type = 'feature'
                arg_label = 'feature_id/epic_id'
            if not node_id or not new_parent_id:
                return self._invalid_argument_result(
                    arg_name=arg_label,
                    arg_value=args,
                    message=f'{arg_label} are required for {tool_name}.',
                )
            operation: dict[str, Any] = {
                'op': 'move_node',
                'node_type': node_type,
                'node_id': node_id,
                'new_parent_id': new_parent_id,
            }
            position = args.get('position')
            if isinstance(position, int) and position >= 0:
                operation['position'] = position
            result = self._build_operation_result(
                tool_name=tool_name,
                operations=[operation],
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name in {'reorder_tasks', 'reorder_features', 'reorder_epics'}:
            if tool_name == 'reorder_tasks':
                ids = self._string_list(args.get('task_ids'))
                parent_id = str(args.get('feature_id') or '').strip()
                node_type = 'task'
                id_label = 'task_ids'
                parent_label = 'feature_id'
            elif tool_name == 'reorder_features':
                ids = self._string_list(args.get('feature_ids'))
                parent_id = str(args.get('epic_id') or '').strip()
                node_type = 'feature'
                id_label = 'feature_ids'
                parent_label = 'epic_id'
            else:
                ids = self._string_list(args.get('epic_ids'))
                parent_id = ''
                node_type = 'epic'
                id_label = 'epic_ids'
                parent_label = ''
            if not ids:
                return self._invalid_argument_result(
                    arg_name=id_label,
                    arg_value=args.get(id_label),
                    message=f'{id_label} is required for {tool_name}.',
                )
            if parent_label and not parent_id:
                return self._invalid_argument_result(
                    arg_name=parent_label,
                    arg_value=args.get(parent_label),
                    message=f'{parent_label} is required for {tool_name}.',
                )
            operations: list[dict[str, Any]] = []
            for index, node_id in enumerate(ids):
                op: dict[str, Any] = {
                    'op': 'move_node',
                    'node_type': node_type,
                    'node_id': node_id,
                    'position': index,
                }
                if parent_id:
                    op['new_parent_id'] = parent_id
                operations.append(op)
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_update_task_status':
            task_ids = self._string_list(args.get('task_ids'))
            if not task_ids:
                return self._invalid_argument_result(
                    arg_name='task_ids',
                    arg_value=args.get('task_ids'),
                    message='task_ids is required for bulk_update_task_status.',
                )
            status = self._normalize_task_status_input(args.get('status'))
            if status is None:
                return self._invalid_argument_result(
                    arg_name='status',
                    arg_value=args.get('status'),
                    message=self._task_status_validation_message(),
                )
            operations = [
                {
                    'op': 'mark_status',
                    'node_type': 'task',
                    'targets': list(task_ids),
                    'status': status,
                }
            ]
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_update_tasks_by_parent':
            parent_type = str(args.get('parent_type') or '').strip().lower()
            parent_id = str(args.get('parent_id') or '').strip()
            include_completed = bool(args.get('include_completed', False))
            if not parent_type:
                feature_parent_id = str(args.get('feature_id') or '').strip()
                epic_parent_id = str(args.get('epic_id') or '').strip()
                if feature_parent_id and not epic_parent_id:
                    parent_type = 'feature'
                    parent_id = parent_id or feature_parent_id
                elif epic_parent_id and not feature_parent_id:
                    parent_type = 'epic'
                    parent_id = parent_id or epic_parent_id

            if parent_type not in {'feature', 'epic'}:
                result = self._invalid_argument_result(
                    arg_name='parent_type',
                    arg_value=args.get('parent_type'),
                    message='parent_type must be one of: feature, epic.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result
            if not parent_id:
                result = self._invalid_argument_result(
                    arg_name='parent_id',
                    arg_value=args.get('parent_id'),
                    message='parent_id is required for bulk_update_tasks_by_parent.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            target_status = self._normalize_task_status_input(args.get('status'))
            if target_status is None:
                result = self._invalid_argument_result(
                    arg_name='status',
                    arg_value=args.get('status'),
                    message=self._task_status_validation_message(),
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else 500
            limit = max(1, min(limit, 2000))

            tasks: list[dict[str, Any]] = []
            if parent_type == 'feature':
                feature_children_result = await self._run_context_call(
                    session_context,
                    self._nest_client.context_children(
                        roadmap_id=roadmap_id,
                        node_id=parent_id,
                        limit=min(limit, 500),
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                if isinstance(feature_children_result.get('error'), dict):
                    result = feature_children_result
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                tasks = self._filtered_tasks(
                    tasks=self._children_from_result(feature_children_result),
                    status_filter=None,
                    limit=limit,
                )
            else:
                epic_tasks_result = await self._collect_tasks_for_epic(
                    roadmap_id=roadmap_id,
                    epic_id=parent_id,
                    status_filter=None,
                    limit=limit,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                )
                if isinstance(epic_tasks_result.get('error'), dict):
                    result = epic_tasks_result
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                tasks_payload = epic_tasks_result.get('tasks')
                tasks = [item for item in tasks_payload if isinstance(item, dict)] if isinstance(tasks_payload, list) else []

            seen_task_ids: set[str] = set()
            matched_task_ids: list[str] = []
            matched_tasks: list[dict[str, Any]] = []
            status_change_ids: list[str] = []
            total_child_task_count = 0
            excluded_completed_count = 0
            already_target_status_count = 0
            eligible_task_count = 0

            for task in tasks:
                task_id = str(task.get('id') or '').strip()
                if not task_id or task_id in seen_task_ids:
                    continue
                seen_task_ids.add(task_id)
                total_child_task_count += 1
                current_status = self._normalize_task_status_input(task.get('status'))
                if not include_completed and self._is_done_status(current_status):
                    excluded_completed_count += 1
                    continue
                eligible_task_count += 1
                matched_task_ids.append(task_id)
                matched_tasks.append(
                    {
                        'id': task_id,
                        'title': str(task.get('title') or '').strip()[:120],
                        'status': current_status
                        or str(task.get('status') or '').strip().lower()
                        or 'unknown',
                    }
                )
                if current_status == target_status:
                    already_target_status_count += 1
                    continue
                status_change_ids.append(task_id)

            operations: list[dict[str, Any]] = []
            if status_change_ids:
                operations.append(
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'targets': status_change_ids,
                        'status': target_status,
                    }
                )

            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            result['parent_type'] = parent_type
            result['parent_id'] = parent_id
            result['target_status'] = target_status
            result['include_completed'] = include_completed
            result['task_ids'] = matched_task_ids
            result['tasks'] = matched_tasks
            result['matched_task_count'] = len(matched_task_ids)
            result['updated_task_count'] = len(status_change_ids)
            result['total_child_task_count'] = total_child_task_count
            result['excluded_completed_count'] = excluded_completed_count
            result['already_target_status_count'] = already_target_status_count
            result['eligible_task_count'] = eligible_task_count
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_update_tasks_by_filter':
            filters_raw = args.get('filters')
            update_raw = args.get('update')
            if not isinstance(filters_raw, dict):
                result = self._invalid_argument_result(
                    arg_name='filters',
                    arg_value=filters_raw,
                    message='filters must be an object for bulk_update_tasks_by_filter.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result
            if not isinstance(update_raw, dict):
                result = self._invalid_argument_result(
                    arg_name='update',
                    arg_value=update_raw,
                    message='update must be an object for bulk_update_tasks_by_filter.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            update_status_raw = update_raw.get('status')
            update_status: str | None = None
            if update_status_raw is not None:
                update_status = self._normalize_task_status_input(update_status_raw)
                if update_status is None:
                    result = self._invalid_argument_result(
                        arg_name='update.status',
                        arg_value=update_status_raw,
                        message=self._task_status_validation_message(),
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result

            update_priority_raw = update_raw.get('priority')
            update_priority = (
                str(update_priority_raw).strip().lower()
                if isinstance(update_priority_raw, str) and update_priority_raw.strip()
                else ''
            )
            has_update_assignee = 'assignee_id' in update_raw
            is_valid_update_assignee, update_assignee_id = self._normalize_assignee_update_input(
                update_raw.get('assignee_id') if has_update_assignee else None
            )
            if has_update_assignee and not is_valid_update_assignee:
                result = self._invalid_argument_result(
                    arg_name='update.assignee_id',
                    arg_value=update_raw.get('assignee_id'),
                    message=(
                        'update.assignee_id must be a non-empty string or null '
                        '(use null/unassign/unassigned/none/null to clear assignment).'
                    ),
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if update_status is None and not update_priority and not has_update_assignee:
                result = self._invalid_argument_result(
                    arg_name='update',
                    arg_value=update_raw,
                    message='update must include at least one of: status, priority, assignee_id.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            parent_id = str(filters_raw.get('parent_id') or '').strip()
            parent_type = str(filters_raw.get('parent_type') or '').strip().lower()
            if parent_type and parent_type not in {'epic', 'feature'}:
                result = self._invalid_argument_result(
                    arg_name='filters.parent_type',
                    arg_value=filters_raw.get('parent_type'),
                    message='filters.parent_type must be one of: epic, feature.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result
            if parent_type and not parent_id:
                result = self._invalid_argument_result(
                    arg_name='filters.parent_id',
                    arg_value=filters_raw.get('parent_id'),
                    message='filters.parent_id is required when filters.parent_type is provided.',
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            assignee_id = str(filters_raw.get('assignee_id') or '').strip()
            status_filter_raw = filters_raw.get('status')
            status_filter: str | None = None
            if status_filter_raw is not None:
                status_filter = self._normalize_task_status_filter(status_filter_raw)
                if status_filter is None:
                    result = self._invalid_argument_result(
                        arg_name='filters.status',
                        arg_value=status_filter_raw,
                        message=self._task_status_filter_validation_message(),
                    )
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
            keyword = str(filters_raw.get('keyword') or '').strip().lower()
            include_completed = bool(filters_raw.get('include_completed', False))
            effective_include_completed = include_completed or bool(
                status_filter is not None and self._is_done_status(status_filter)
            )

            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else 500
            limit = max(1, min(limit, 2000))
            tasks: list[dict[str, Any]] = []
            filtered_endpoint_loaded = False
            context_tasks_filtered = getattr(self._nest_client, 'context_tasks_filtered', None)
            if callable(context_tasks_filtered):
                filtered_result = await self._run_context_call(
                    session_context,
                    context_tasks_filtered(
                        roadmap_id=roadmap_id,
                        status=status_filter,
                        parent_id=parent_id or None,
                        parent_type=parent_type or None,
                        assignee_id=assignee_id or None,
                        keyword=keyword or None,
                        include_completed=include_completed,
                        limit=limit,
                        preview_id=context_selector,
                        auth_header=auth_value,
                        trace_id=trace_id,
                    ),
                )
                if not isinstance(filtered_result.get('error'), dict):
                    tasks_raw = filtered_result.get('tasks')
                    tasks = (
                        [item for item in tasks_raw if isinstance(item, dict)]
                        if isinstance(tasks_raw, list)
                        else []
                    )
                    filtered_endpoint_loaded = True
                else:
                    error_payload = filtered_result.get('error')
                    error_code = str((error_payload or {}).get('code') or '').strip()
                    error_message = str((error_payload or {}).get('message') or '').strip().lower()
                    missing_route = (
                        error_code == 'NODE_NOT_FOUND'
                        and 'cannot get' in error_message
                    )
                    if not missing_route:
                        result = filtered_result
                        log_event(
                            self._logger,
                            'tool_call_result',
                            settings=self._settings,
                            level=logging.WARNING,
                            trace_id=trace_id,
                            tool_name=tool_name,
                            result_summary=summarize_tool_result(result),
                        )
                        return result

            if not filtered_endpoint_loaded:
                collect_status_filter = (
                    status_filter
                    if status_filter not in {None, 'all'}
                    else 'all'
                )
                collect_limit = min(2000, max(limit, 200))
                task_result = await self._collect_tasks_for_roadmap(
                    roadmap_id=roadmap_id,
                    status_filter=collect_status_filter,
                    limit=collect_limit,
                    session_context=session_context,
                    auth_header=auth_value,
                    trace_id=trace_id,
                    context_selector=context_selector,
                )
                if isinstance(task_result.get('error'), dict):
                    result = task_result
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result

                tasks_raw = task_result.get('tasks')
                tasks = [item for item in tasks_raw if isinstance(item, dict)] if isinstance(tasks_raw, list) else []

            if (assignee_id or has_update_assignee) and not filtered_endpoint_loaded:
                task_ids_for_detail: list[str] = []
                for task in tasks:
                    task_id = str(task.get('id') or '').strip()
                    if not task_id:
                        continue
                    if isinstance(task.get('assignee_id'), str) and str(task.get('assignee_id')).strip():
                        continue
                    task_ids_for_detail.append(task_id)

                if task_ids_for_detail:
                    detail_coroutines = [
                        self._nest_client.context_node_details(
                            roadmap_id=roadmap_id,
                            node_id=task_id,
                            auth_header=auth_value,
                            trace_id=trace_id,
                        )
                        for task_id in task_ids_for_detail
                    ]
                    detail_results = await self._run_context_calls_parallel(
                        session_context,
                        detail_coroutines,
                    )
                    detail_assignee_by_id: dict[str, str] = {}
                    for task_id, detail in zip(task_ids_for_detail, detail_results):
                        if not isinstance(detail, dict):
                            continue
                        detail_assignee = str(detail.get('assignee_id') or '').strip()
                        if detail_assignee:
                            detail_assignee_by_id[task_id] = detail_assignee
                    if detail_assignee_by_id:
                        for task in tasks:
                            task_id = str(task.get('id') or '').strip()
                            if not task_id:
                                continue
                            detail_assignee = detail_assignee_by_id.get(task_id)
                            if detail_assignee:
                                task['assignee_id'] = detail_assignee

            matched_task_ids: list[str] = []
            matched_tasks: list[dict[str, Any]] = []
            status_change_ids: list[str] = []
            priority_change_ids: list[str] = []
            assignee_change_ids: list[str] = []

            for task in tasks:
                if len(matched_task_ids) >= limit:
                    break
                task_id = str(task.get('id') or '').strip()
                if not task_id:
                    continue

                task_status = self._normalized_status_filter(task.get('status'))
                if not effective_include_completed and self._is_done_status(task_status):
                    continue
                if status_filter is not None and not self._matches_status_filter(task_status, status_filter):
                    continue

                feature_id = str(task.get('feature_id') or '').strip()
                epic_id = str(task.get('epic_id') or '').strip()
                if parent_id:
                    if parent_type == 'feature' and feature_id != parent_id:
                        continue
                    if parent_type == 'epic' and epic_id != parent_id:
                        continue
                    if not parent_type and parent_id not in {feature_id, epic_id}:
                        continue

                if assignee_id:
                    task_assignee = str(task.get('assignee_id') or '').strip()
                    if task_assignee != assignee_id:
                        continue

                if keyword:
                    searchable_text = ' '.join(
                        [
                            str(task.get('title') or ''),
                            str(task.get('feature_title') or ''),
                            str(task.get('epic_title') or ''),
                        ]
                    ).strip().lower()
                    if keyword not in searchable_text:
                        continue

                matched_task_ids.append(task_id)
                matched_tasks.append(
                    {
                        'id': task_id,
                        'title': str(task.get('title') or '').strip()[:120],
                        'status': task_status or 'unknown',
                        'priority': str(task.get('priority') or '').strip().lower() or 'unknown',
                        'assignee_id': str(task.get('assignee_id') or '').strip() or None,
                        'feature_id': feature_id or None,
                        'epic_id': epic_id or None,
                    }
                )

                if update_status is not None:
                    normalized_current_status = self._normalize_task_status_input(task_status)
                    if normalized_current_status != update_status:
                        status_change_ids.append(task_id)

                if update_priority:
                    priority_change_ids.append(task_id)

                if has_update_assignee:
                    current_assignee = str(task.get('assignee_id') or '').strip() or None
                    if current_assignee != update_assignee_id:
                        assignee_change_ids.append(task_id)

            # Emit at most one op per mutation dimension. Each carries the
            # collected target ids as `targets[]`, so the planner round-trip
            # stays O(1) in op count regardless of N. Without this, a 25-
            # task bulk assign produced 25 ops and blew the planner's
            # output-token budget.
            operations: list[dict[str, Any]] = []
            if status_change_ids:
                operations.append(
                    {
                        'op': 'mark_status',
                        'node_type': 'task',
                        'targets': status_change_ids,
                        'status': update_status,
                    }
                )
            if priority_change_ids:
                operations.append(
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'targets': priority_change_ids,
                        'patch': {'priority': update_priority},
                    }
                )
            if assignee_change_ids:
                operations.append(
                    {
                        'op': 'update_node',
                        'node_type': 'task',
                        'targets': assignee_change_ids,
                        'patch': {'assignee_id': update_assignee_id},
                    }
                )

            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            result['filters'] = {
                'parent_id': parent_id or None,
                'parent_type': parent_type or None,
                'assignee_id': assignee_id or None,
                'status': status_filter,
                'keyword': keyword or None,
                'include_completed': effective_include_completed,
            }
            result['update'] = {
                'status': update_status,
                'priority': update_priority or None,
                'assignee_id': update_assignee_id if has_update_assignee else None,
            }
            result['task_ids'] = matched_task_ids
            result['tasks'] = matched_tasks
            result['matched_task_count'] = len(matched_task_ids)
            result['updated_task_count'] = sum(
                len(ids)
                for ids in (status_change_ids, priority_change_ids, assignee_change_ids)
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_assign_tasks':
            task_ids = self._string_list(args.get('task_ids'))
            has_assignee_id = 'assignee_id' in args
            is_valid_assignee, assignee_id = self._normalize_assignee_update_input(
                args.get('assignee_id')
            )
            if not task_ids or not has_assignee_id:
                return self._invalid_argument_result(
                    arg_name='task_ids/assignee_id',
                    arg_value=args,
                    message='task_ids and assignee_id are required for bulk_assign_tasks.',
                )
            if not is_valid_assignee:
                return self._invalid_argument_result(
                    arg_name='assignee_id',
                    arg_value=args.get('assignee_id'),
                    message=(
                        'assignee_id must be a non-empty string or null '
                        '(use null/unassign/unassigned/none/null to clear assignment).'
                    ),
                )
            operations = [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'targets': list(task_ids),
                    'patch': {'assignee_id': assignee_id},
                }
            ]
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_delete_tasks':
            task_ids = self._string_list(args.get('task_ids'))
            if not task_ids:
                return self._invalid_argument_result(
                    arg_name='task_ids',
                    arg_value=args.get('task_ids'),
                    message='task_ids is required for bulk_delete_tasks.',
                )
            operations = [
                {'op': 'delete_node', 'node_type': 'task', 'targets': list(task_ids)}
            ]
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_move_tasks_to_feature':
            task_ids = self._string_list(args.get('task_ids'))
            feature_id = str(args.get('feature_id') or '').strip()
            if not task_ids or not feature_id:
                return self._invalid_argument_result(
                    arg_name='task_ids/feature_id',
                    arg_value=args,
                    message='task_ids and feature_id are required for bulk_move_tasks_to_feature.',
                )
            start_position_raw = args.get('start_position')
            start_position = (
                start_position_raw if isinstance(start_position_raw, int) and start_position_raw >= 0 else 0
            )
            operations = [
                {
                    'op': 'move_node',
                    'node_type': 'task',
                    'node_id': task_id,
                    'new_parent_id': feature_id,
                    'position': start_position + index,
                }
                for index, task_id in enumerate(task_ids)
            ]
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        if tool_name == 'bulk_update_epic_status':
            ids = self._string_list(args.get('epic_ids'))
            node_type = 'epic'
            id_label = 'epic_ids'
            status = str(args.get('status') or '').strip()
            if not ids or not status:
                return self._invalid_argument_result(
                    arg_name=f'{id_label}/status',
                    arg_value=args,
                    message=f'{id_label} and status are required for {tool_name}.',
                )
            operations = [
                {
                    'op': 'mark_status',
                    'node_type': node_type,
                    'targets': list(ids),
                    'status': status,
                }
            ]
            result = self._build_operation_result(tool_name=tool_name, operations=operations)
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        return {
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f'Tool {tool_name} is not available in edit mode.',
            }
        }
