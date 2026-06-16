"""Deterministic, point-in-time revert for the roadmap AI.

Given a contiguous range of committed change groups (newest back to a chosen
point), compute the NET inverse as a single roadmap-operations batch that
restores the roadmap to the state it had just before that range began. No LLM
reconstruction: the operations are built mechanically from the per-node
snapshots the backend's semantic diff recorded on each commit.

Net semantics per node touched in the range:
- created within the range and still present  -> delete it
- present before the range and now removed     -> recreate it (full subtree,
  temp_id/parent_ref wired, original field values)
- present before and after but modified        -> revert the changed fields
  (and parent/position) to their pre-range values
- created then removed within the range         -> no-op (cancels out)

The single-commit "undo that" case is just a range of length 1.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.sessions import AppliedChange, ChangeGroup

# Full-node snapshot keys (camelCase, as emitted by the backend flattenState in
# NODE_REMOVED.from / NODE_ADDED.to) -> add_* operation `data` keys (snake_case).
_SNAPSHOT_TO_DATA: dict[str, str] = {
    'title': 'title',
    'description': 'description',
    'status': 'status',
    'priority': 'priority',
    'color': 'color',
    'tags': 'tags',
    'isDeliverable': 'is_deliverable',
    'startDate': 'start_date',
    'endDate': 'end_date',
    'dueDate': 'due_date',
    'assigneeId': 'assignee_id',
}

# Which `data` fields each create op accepts (mirrors the backend applyAdd*),
# so a feature never receives a status etc.
_DATA_FIELDS_BY_TYPE: dict[str, set[str]] = {
    'epic': {'title', 'description', 'status', 'priority', 'color', 'tags', 'start_date', 'end_date'},
    'feature': {'title', 'description', 'is_deliverable', 'start_date', 'end_date'},
    'task': {'title', 'description', 'status', 'priority', 'assignee_id', 'due_date'},
}

# Field-change `from`/`to` keys (snake_case) that an update_node patch can carry.
_PATCH_FIELDS: set[str] = {
    'title', 'description', 'status', 'priority', 'assignee_id', 'tags', 'color',
    'is_deliverable', 'start_date', 'end_date', 'due_date', 'dependencies',
}

_TEMP_PREFIX: dict[str, str] = {'epic': 'epic', 'feature': 'feat', 'task': 'task'}
_TYPE_ORDER: dict[str, int] = {'epic': 0, 'feature': 1, 'task': 2}
_ADD_OP: dict[str, str] = {'epic': 'add_epic', 'feature': 'add_feature', 'task': 'add_task'}


def select_revert_range(
    history: list[ChangeGroup], change_id: str | None
) -> list[ChangeGroup]:
    """Pick the contiguous range to undo from ``history`` (most-recent-first).

    ``change_id=None`` -> just the latest group. Otherwise the latest group
    down to (and including) the group with that ``change_id``. Returns [] when
    history is empty or the change_id isn't found.
    """
    if not history:
        return []
    if change_id is None:
        return [history[0]]
    target = change_id.strip()
    for index, group in enumerate(history):
        if (group.change_id or '') == target:
            return history[: index + 1]
    return []


class _NodeAgg:
    """Accumulates every change to one node across the reverted range."""

    __slots__ = (
        'node_id', 'node_type', 'first_type', 'last_type',
        'removal_snapshot', 'added_snapshot', 'move_restore', 'field_restores',
    )

    def __init__(self, node_id: str, node_type: str) -> None:
        self.node_id = node_id
        self.node_type = node_type or 'item'
        self.first_type: str | None = None
        self.last_type: str | None = None
        self.removal_snapshot: dict[str, Any] | None = None
        self.added_snapshot: dict[str, Any] | None = None
        self.move_restore: dict[str, Any] | None = None
        self.field_restores: dict[str, Any] = {}

    def observe(self, change: AppliedChange) -> None:
        change_type = (change.change_type or '').upper()
        if self.first_type is None:
            self.first_type = change_type
        self.last_type = change_type
        if self.node_type in ('', 'item') and change.node_type:
            self.node_type = change.node_type
        change_from = change.change_from if isinstance(change.change_from, dict) else {}
        if change_type == 'NODE_REMOVED':
            if self.removal_snapshot is None:
                self.removal_snapshot = dict(change_from)
        elif change_type == 'NODE_ADDED':
            if self.added_snapshot is None:
                change_to = change.change_to if isinstance(change.change_to, dict) else {}
                self.added_snapshot = dict(change_to)
        elif change_type == 'NODE_MOVED':
            if self.move_restore is None:
                self.move_restore = {
                    'parent_id': change_from.get('parent_id'),
                    'position': change_from.get('position'),
                }
        else:
            # Field change — record the EARLIEST pre-range value per key.
            for key, value in change_from.items():
                if key not in self.field_restores:
                    self.field_restores[key] = value

    @property
    def existed_before(self) -> bool:
        return self.first_type != 'NODE_ADDED'

    @property
    def exists_now(self) -> bool:
        return self.last_type != 'NODE_REMOVED'


def build_inverse_operations(groups: list[ChangeGroup]) -> list[dict[str, Any]]:
    """Build the net-inverse operation batch for the given range of groups.

    ``groups`` is most-recent-first (as stored). Returns operation dicts in the
    shape ``plan_roadmap_operations`` accepts; [] when there is nothing to undo.
    """
    # Flatten chronologically: oldest group first, diff order within a group.
    changes: list[AppliedChange] = []
    for group in reversed(groups):
        changes.extend(group.changes or [])
    if not changes:
        return []

    nodes: dict[str, _NodeAgg] = {}
    seen_order: list[str] = []
    for change in changes:
        node_id = change.node_id
        agg = nodes.get(node_id)
        if agg is None:
            agg = _NodeAgg(node_id, change.node_type or 'item')
            nodes[node_id] = agg
            seen_order.append(node_id)
        agg.observe(change)

    created_ids = {
        nid for nid in seen_order
        if not nodes[nid].existed_before and nodes[nid].exists_now
    }
    removed_ids = {
        nid for nid in seen_order
        if nodes[nid].existed_before and not nodes[nid].exists_now
    }
    # Stable temp_id per recreated node so children can reference parents.
    # Sort by (type, node_id) so assignment is deterministic.
    recreate_order = sorted(
        removed_ids, key=lambda n: (_TYPE_ORDER.get(nodes[n].node_type, 9), n)
    )
    temp_ids = {
        nid: f'{_TEMP_PREFIX.get(nodes[nid].node_type, "tmp")}_r{index + 1}'
        for index, nid in enumerate(recreate_order)
    }

    ops: list[dict[str, Any]] = []

    # 1) Delete net-created nodes — only subtree roots (parent not also created),
    #    since deleting a parent cascades to children.
    for nid in seen_order:
        if nid not in created_ids:
            continue
        parent_id = _snapshot_parent_id(nodes[nid].added_snapshot)
        if parent_id in created_ids:
            continue
        ops.append({'op': 'delete_node', 'node_id': nid})

    # 2) Recreate net-removed nodes, parents before children.
    for nid in recreate_order:
        recreated = _build_recreate_op(nodes[nid], temp_ids, removed_ids)
        if recreated is not None:
            ops.append(recreated)

    # 3) Revert modified-but-still-present nodes.
    for nid in seen_order:
        agg = nodes[nid]
        if nid in created_ids or nid in removed_ids:
            continue
        if not (agg.existed_before and agg.exists_now):
            continue
        ops.extend(_build_revert_field_ops(agg))

    return ops


def _snapshot_parent_id(snapshot: dict[str, Any] | None) -> str | None:
    if not isinstance(snapshot, dict):
        return None
    value = snapshot.get('parentId')
    return value if isinstance(value, str) and value else None


def _build_recreate_op(
    agg: _NodeAgg, temp_ids: dict[str, str], removed_ids: set[str]
) -> dict[str, Any] | None:
    node_type = agg.node_type
    add_op = _ADD_OP.get(node_type)
    snapshot = agg.removal_snapshot or {}
    if add_op is None:
        return None

    allowed = _DATA_FIELDS_BY_TYPE.get(node_type, set())
    data: dict[str, Any] = {}
    for snap_key, data_key in _SNAPSHOT_TO_DATA.items():
        if data_key not in allowed:
            continue
        if snap_key in snapshot and snapshot[snap_key] is not None:
            data[data_key] = snapshot[snap_key]
    # Overlay pre-range field values for fields modified before the removal.
    for key, value in agg.field_restores.items():
        if key in allowed and value is not None:
            data[key] = value
    if not data.get('title'):
        # Title is required by every create op; fall back to the recorded label.
        data['title'] = snapshot.get('title') or 'Restored item'

    op: dict[str, Any] = {'op': add_op, 'data': data, 'temp_id': temp_ids[agg.node_id]}

    position = snapshot.get('position')
    if isinstance(position, int):
        op['position'] = position

    if node_type in ('feature', 'task'):
        parent_id = _snapshot_parent_id(snapshot)
        if parent_id and parent_id in removed_ids:
            op['parent_ref'] = temp_ids[parent_id]
        elif parent_id:
            op['parent_id'] = parent_id
    return op


def _build_revert_field_ops(agg: _NodeAgg) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    if agg.move_restore is not None:
        move: dict[str, Any] = {'op': 'move_node', 'node_id': agg.node_id}
        parent_id = agg.move_restore.get('parent_id')
        # Only reparent features/tasks; epics live under the roadmap root and
        # reorder by position alone.
        if agg.node_type in ('feature', 'task') and isinstance(parent_id, str) and parent_id:
            move['new_parent_id'] = parent_id
        position = agg.move_restore.get('position')
        if isinstance(position, int):
            move['position'] = position
        if 'new_parent_id' in move or 'position' in move:
            ops.append(move)

    patch = {
        key: value
        for key, value in agg.field_restores.items()
        if key in _PATCH_FIELDS
    }
    if patch:
        ops.append({'op': 'update_node', 'node_id': agg.node_id, 'patch': patch})
    return ops
