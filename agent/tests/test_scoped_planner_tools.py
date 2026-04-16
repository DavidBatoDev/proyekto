import unittest

from app.core.llm.planning.planner_operation_flow import _classify_edit_sub_intent
from app.core.tools.registry import (
    PLANNING_TOOL_NAME,
    SCOPED_EDIT_TOOL_MANIFESTS,
    get_edit_mode_tools,
    get_scoped_edit_tools,
)


class ClassifyEditSubIntentTests(unittest.TestCase):
    def test_pure_rename_classifies_as_rename_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent(
                'Rename My Project Management Module to PM Module and Agent Module to Agent Core'
            ),
            'rename_only',
        )

    def test_change_title_to_classifies_as_rename_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('change the title of Foo to Bar'),
            'rename_only',
        )

    def test_pure_delete_classifies_as_delete_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('Delete the Onboarding epic'),
            'delete_only',
        )

    def test_create_disqualifies_scoped_path(self) -> None:
        self.assertIsNone(
            _classify_edit_sub_intent('rename Foo to Bar and add a Baz feature'),
        )

    def test_mixed_rename_and_status_disqualifies_scoped_path(self) -> None:
        self.assertIsNone(
            _classify_edit_sub_intent('rename Foo to Bar and mark it done'),
        )

    def test_pure_status_change_classifies_as_status_change_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('Mark the Onboarding tasks as done'),
            'status_change_only',
        )

    def test_set_status_to_classifies_as_status_change_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('Set the status of Auth feature to in_progress'),
            'status_change_only',
        )

    def test_pure_move_classifies_as_move_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('Move the Login task to the Auth feature'),
            'move_only',
        )

    def test_reparent_verb_classifies_as_move_only(self) -> None:
        self.assertEqual(
            _classify_edit_sub_intent('Reparent the Dashboard epic under Roadmap'),
            'move_only',
        )

    def test_mixed_move_and_delete_disqualifies_scoped_path(self) -> None:
        self.assertIsNone(
            _classify_edit_sub_intent('Move the Login task to Auth and delete Onboarding'),
        )

    def test_empty_message_returns_none(self) -> None:
        self.assertIsNone(_classify_edit_sub_intent(''))


class GetScopedEditToolsTests(unittest.TestCase):
    def test_unknown_subintent_returns_none(self) -> None:
        self.assertIsNone(get_scoped_edit_tools('something_else'))
        self.assertIsNone(get_scoped_edit_tools(None))

    def test_rename_only_manifest_is_subset_of_full(self) -> None:
        full_names = {
            t['function']['name']
            for t in get_edit_mode_tools()
            if isinstance(t, dict) and isinstance(t.get('function'), dict)
        }
        rename = get_scoped_edit_tools('rename_only')
        self.assertIsNotNone(rename)
        scoped_names = {
            t['function']['name']
            for t in rename
            if isinstance(t, dict) and isinstance(t.get('function'), dict)
        }
        self.assertTrue(scoped_names.issubset(full_names))
        self.assertIn(PLANNING_TOOL_NAME, scoped_names)
        self.assertIn('resolve_node_reference', scoped_names)
        self.assertLess(len(scoped_names), len(full_names))

    def test_manifests_only_reference_known_tools(self) -> None:
        full_names = {
            t['function']['name']
            for t in get_edit_mode_tools()
            if isinstance(t, dict) and isinstance(t.get('function'), dict)
        }
        for sub_intent, allowed in SCOPED_EDIT_TOOL_MANIFESTS.items():
            unknown = allowed - full_names
            self.assertEqual(
                unknown,
                set(),
                f'{sub_intent} manifest references unknown tools: {unknown}',
            )

    def test_status_change_only_manifest_includes_bulk_and_single_helpers(self) -> None:
        scoped = get_scoped_edit_tools('status_change_only')
        self.assertIsNotNone(scoped)
        names = {t['function']['name'] for t in scoped}  # type: ignore[union-attr]
        for expected in (
            'resolve_node_reference',
            'update_task_status',
            'bulk_update_task_status',
            'bulk_update_tasks_by_parent',
            PLANNING_TOOL_NAME,
        ):
            self.assertIn(expected, names)

    def test_move_only_manifest_is_minimal(self) -> None:
        scoped = get_scoped_edit_tools('move_only')
        self.assertIsNotNone(scoped)
        names = {t['function']['name'] for t in scoped}  # type: ignore[union-attr]
        self.assertIn('resolve_node_reference', names)
        self.assertIn('bulk_move_tasks_to_feature', names)
        self.assertIn(PLANNING_TOOL_NAME, names)
        # Should NOT pull in status or assign helpers.
        self.assertNotIn('update_task_status', names)
        self.assertNotIn('bulk_assign_tasks', names)


if __name__ == '__main__':
    unittest.main()
