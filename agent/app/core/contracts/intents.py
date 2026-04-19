"""Canonical enums for the intent-classifier output.

Defined in `contracts/` (not in `llm/providers/`) so every consumer —
adapter, estimator, downstream planner — imports from one source and
adding a new sub-intent is a one-line enum extension that the type
checker (and unit tests) catch in every callsite.
"""

from __future__ import annotations

from enum import Enum


class EditSubIntent(str, Enum):
    """Narrow single-dimension edit classes produced by the classifier."""
    RENAME_ONLY = 'rename_only'
    DELETE_ONLY = 'delete_only'
    STATUS_CHANGE_ONLY = 'status_change_only'
    MOVE_ONLY = 'move_only'


EDIT_SUB_INTENT_VALUES: frozenset[str] = frozenset(
    member.value for member in EditSubIntent
)


class BulkScope(str, Enum):
    """Bulk-scope classes produced by the classifier.

    Replaces the four legacy regex helpers in planner_operation_flow.py
    (`_is_bulk_task_scope_update_intent`, `_is_parent_scoped_bulk_status_intent`,
    `_is_parent_scoped_bulk_filter_update_intent`, `_is_global_bulk_filter_update_intent`)
    with a single LLM-derived signal that handles paraphrases and i18n
    variants the regexes miss.

    `NONE` is emitted when the user is targeting a single node (or when
    the classifier can't tell). `TASKS_ALL` / `TASKS_BY_PARENT` /
    `TASKS_BY_FILTER` cover the three task-update variants; the
    remaining values let the classifier flag bulk feature/epic updates
    for completeness.
    """
    NONE = 'none'
    TASKS_ALL = 'tasks_all'
    TASKS_BY_PARENT = 'tasks_by_parent'
    TASKS_BY_FILTER = 'tasks_by_filter'
    FEATURES_ALL = 'features_all'
    EPICS_ALL = 'epics_all'


BULK_SCOPE_VALUES: frozenset[str] = frozenset(
    member.value for member in BulkScope
)
