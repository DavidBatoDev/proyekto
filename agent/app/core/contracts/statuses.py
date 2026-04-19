from __future__ import annotations


TASK_STATUS_VALUES = ['todo', 'in_progress', 'in_review', 'done', 'blocked']

FEATURE_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'in_review',
    'completed',
    'blocked',
]

EPIC_STATUS_VALUES = [
    'backlog',
    'planned',
    'in_progress',
    'in_review',
    'completed',
    'on_hold',
]

# Union of every accepted status string across node types. Used when the
# JSON schema cannot cheaply branch on `node_type` (top-level `status` for
# mark_status, and `patch.status` for update_node). The planner's semantic
# validator still enforces the per-type enum on the server side.
ALL_STATUS_VALUES = sorted(
    {*TASK_STATUS_VALUES, *FEATURE_STATUS_VALUES, *EPIC_STATUS_VALUES}
)
