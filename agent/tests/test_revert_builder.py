"""Deterministic revert builder: cascade-delete restore (temp_id/parent_ref
wiring + field mapping), partial-subtree (parent alive) restore, create/edit/
move inverses, multi-group net cancellation, and range selection."""

import unittest

from app.core.contracts.sessions import AppliedChange, ChangeGroup
from app.core.v2.revert import build_inverse_operations, select_revert_range

ROADMAP = 'roadmap-root'


def _removed(node_id, node_type, parent_id, title, **snapshot):
    snap = {'id': node_id, 'type': node_type, 'title': title}
    if parent_id is not None:
        snap['parentId'] = parent_id
    snap.update(snapshot)  # camelCase keys, mirroring the backend flatten
    return AppliedChange(
        node_id=node_id, node_type=node_type, change_type='NODE_REMOVED',
        change_from=snap, change_to={}, title=title,
    )


def _added(node_id, node_type, parent_id, title):
    snap = {'id': node_id, 'type': node_type, 'title': title}
    if parent_id is not None:
        snap['parentId'] = parent_id
    return AppliedChange(
        node_id=node_id, node_type=node_type, change_type='NODE_ADDED',
        change_from={}, change_to=snap, title=title,
    )


def _field(node_id, node_type, change_type, frm, to, title=None):
    return AppliedChange(
        node_id=node_id, node_type=node_type, change_type=change_type,
        change_from=frm, change_to=to, title=title,
    )


def _group(change_id, changes):
    return ChangeGroup(change_id=change_id, summary='', changes=changes)


def _by_title(ops, op_name, title):
    for op in ops:
        if op['op'] == op_name and op.get('data', {}).get('title') == title:
            return op
    raise AssertionError(f'no {op_name} with title {title!r} in {ops}')


class CascadeDeleteRestoreTests(unittest.TestCase):
    def _tree_group(self):
        return _group('chg-del', [
            _removed('epic-1', 'epic', ROADMAP, 'Epic 1', status='in_progress', position=0),
            _removed('epic-2', 'epic', ROADMAP, 'Epic 2', position=1),
            _removed('feat-1', 'feature', 'epic-1', 'Feature 1'),
            _removed('feat-2', 'feature', 'epic-2', 'Feature 2'),
            _removed('task-1', 'task', 'feat-1', 'Task 1', status='in_progress', dueDate='2026-07-01'),
            _removed('task-2', 'task', 'feat-2', 'Task 2'),
        ])

    def test_full_tree_restored_with_temp_wiring(self) -> None:
        ops = build_inverse_operations([self._tree_group()])
        op_names = [o['op'] for o in ops]
        # 2 epics + 2 features + 2 tasks, parents before children.
        self.assertEqual(op_names.count('add_epic'), 2)
        self.assertEqual(op_names.count('add_feature'), 2)
        self.assertEqual(op_names.count('add_task'), 2)
        last_epic = max(i for i, n in enumerate(op_names) if n == 'add_epic')
        first_feature = min(i for i, n in enumerate(op_names) if n == 'add_feature')
        last_feature = max(i for i, n in enumerate(op_names) if n == 'add_feature')
        first_task = min(i for i, n in enumerate(op_names) if n == 'add_task')
        self.assertLess(last_epic, first_feature)
        self.assertLess(last_feature, first_task)

    def test_parent_refs_chain_to_recreated_parents(self) -> None:
        ops = build_inverse_operations([self._tree_group()])
        epic1 = _by_title(ops, 'add_epic', 'Epic 1')
        feat1 = _by_title(ops, 'add_feature', 'Feature 1')
        task1 = _by_title(ops, 'add_task', 'Task 1')
        # Epics have no parent target.
        self.assertNotIn('parent_id', epic1)
        self.assertNotIn('parent_ref', epic1)
        self.assertIsNotNone(epic1.get('temp_id'))
        # Feature points at its epic's temp_id; task at its feature's temp_id.
        self.assertEqual(feat1['parent_ref'], epic1['temp_id'])
        self.assertEqual(task1['parent_ref'], feat1['temp_id'])

    def test_fields_mapped_camel_to_snake(self) -> None:
        ops = build_inverse_operations([self._tree_group()])
        task1 = _by_title(ops, 'add_task', 'Task 1')
        self.assertEqual(task1['data']['status'], 'in_progress')
        self.assertEqual(task1['data']['due_date'], '2026-07-01')
        epic1 = _by_title(ops, 'add_epic', 'Epic 1')
        self.assertEqual(epic1['data']['status'], 'in_progress')
        self.assertEqual(epic1.get('position'), 0)


class PartialSubtreeRestoreTests(unittest.TestCase):
    def test_feature_under_surviving_epic_uses_parent_id(self) -> None:
        # Only the feature + its task were deleted; epic-1 still exists.
        group = _group('chg-partial', [
            _removed('feat-1', 'feature', 'epic-1', 'Feature 1'),
            _removed('task-1', 'task', 'feat-1', 'Task 1'),
        ])
        ops = build_inverse_operations([group])
        feat1 = _by_title(ops, 'add_feature', 'Feature 1')
        task1 = _by_title(ops, 'add_task', 'Task 1')
        # Epic survived → real parent_id, not a temp parent_ref.
        self.assertEqual(feat1.get('parent_id'), 'epic-1')
        self.assertNotIn('parent_ref', feat1)
        # Task's parent (feature) was recreated → parent_ref to its temp_id.
        self.assertEqual(task1['parent_ref'], feat1['temp_id'])


class CreateAndEditInverseTests(unittest.TestCase):
    def test_created_subtree_inverts_to_root_delete_only(self) -> None:
        group = _group('chg-add', [
            _added('epic-9', 'epic', ROADMAP, 'New Epic'),
            _added('feat-9', 'feature', 'epic-9', 'New Feature'),
        ])
        ops = build_inverse_operations([group])
        # Deleting the epic cascades to the feature — only the root is deleted.
        self.assertEqual(ops, [{'op': 'delete_node', 'node_id': 'epic-9'}])

    def test_field_change_inverts_to_update_node(self) -> None:
        group = _group('chg-edit', [
            _field('epic-1', 'epic', 'STATUS_CHANGED',
                   {'status': 'backlog'}, {'status': 'completed'}),
        ])
        ops = build_inverse_operations([group])
        self.assertEqual(
            ops, [{'op': 'update_node', 'node_id': 'epic-1', 'patch': {'status': 'backlog'}}]
        )

    def test_move_inverts_to_original_parent_and_position(self) -> None:
        group = _group('chg-move', [
            _field('task-1', 'task', 'NODE_MOVED',
                   {'parent_id': 'feat-1', 'position': 0},
                   {'parent_id': 'feat-2', 'position': 3}),
        ])
        ops = build_inverse_operations([group])
        self.assertEqual(len(ops), 1)
        move = ops[0]
        self.assertEqual(move['op'], 'move_node')
        self.assertEqual(move['new_parent_id'], 'feat-1')
        self.assertEqual(move['position'], 0)


class MultiGroupTests(unittest.TestCase):
    def test_create_then_delete_across_groups_cancels(self) -> None:
        # Oldest group adds X; newest removes X. Reverting both = no-op.
        newest = _group('chg-b', [_removed('node-x', 'epic', ROADMAP, 'X')])
        oldest = _group('chg-a', [_added('node-x', 'epic', ROADMAP, 'X')])
        ops = build_inverse_operations([newest, oldest])  # most-recent-first
        self.assertEqual(ops, [])

    def test_range_restores_earliest_pre_range_value(self) -> None:
        # Foo -> Bar (oldest) then Bar -> Baz (newest); revert restores 'Foo'.
        newest = _group('chg-b', [
            _field('epic-1', 'epic', 'TITLE_CHANGED', {'title': 'Bar'}, {'title': 'Baz'}),
        ])
        oldest = _group('chg-a', [
            _field('epic-1', 'epic', 'TITLE_CHANGED', {'title': 'Foo'}, {'title': 'Bar'}),
        ])
        ops = build_inverse_operations([newest, oldest])
        self.assertEqual(
            ops, [{'op': 'update_node', 'node_id': 'epic-1', 'patch': {'title': 'Foo'}}]
        )

    def test_modify_then_delete_restores_pre_range_field(self) -> None:
        # Oldest renames Foo->Bar, newest deletes (snapshot has 'Bar'); the
        # recreate must restore the PRE-range title 'Foo'.
        newest = _group('chg-b', [
            _removed('epic-1', 'epic', ROADMAP, 'Bar'),
        ])
        oldest = _group('chg-a', [
            _field('epic-1', 'epic', 'TITLE_CHANGED', {'title': 'Foo'}, {'title': 'Bar'}),
        ])
        ops = build_inverse_operations([newest, oldest])
        recreated = [o for o in ops if o['op'] == 'add_epic']
        self.assertEqual(len(recreated), 1)
        self.assertEqual(recreated[0]['data']['title'], 'Foo')


class SelectRangeTests(unittest.TestCase):
    def _history(self):
        return [_group('c3', []), _group('c2', []), _group('c1', [])]

    def test_empty_history(self) -> None:
        self.assertEqual(select_revert_range([], None), [])

    def test_default_is_latest_only(self) -> None:
        history = self._history()
        selected = select_revert_range(history, None)
        self.assertEqual([g.change_id for g in selected], ['c3'])

    def test_change_id_selects_inclusive_range(self) -> None:
        history = self._history()
        selected = select_revert_range(history, 'c1')
        self.assertEqual([g.change_id for g in selected], ['c3', 'c2', 'c1'])

    def test_unknown_change_id_returns_empty(self) -> None:
        self.assertEqual(select_revert_range(self._history(), 'nope'), [])


if __name__ == '__main__':
    unittest.main()
