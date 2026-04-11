import unittest

from app.core.tools.registry import parse_plan_tool_args
from app.core.llm.providers.openai_adapter import _rewrite_assignee_payload_to_actor_id


_ASSIGNEE_SHAPE_ERROR = (
    "Invalid operation payload at index 0 (op=update_node): "
    "[{'type': 'extra_forbidden', 'loc': ('assignee',), "
    "'msg': 'Extra inputs are not permitted', 'input': 'me'}]"
)


class OpenAIAdapterPlanningAutofixTests(unittest.TestCase):
    def test_rewrite_assignee_me_to_patch_assignee_id_when_actor_present(self) -> None:
        actor_id = '6d1ecded-ef9d-4f11-a6d1-43dbf89b0af8'
        args = {
            'assistant_message': 'Assign to me',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'node_id': '0f15f790-0f5e-4b4f-9ac1-198a9e2ba0fd',
                    'assignee': 'me',
                }
            ],
        }

        rewritten_args, reason = _rewrite_assignee_payload_to_actor_id(
            args=args,
            error_message=_ASSIGNEE_SHAPE_ERROR,
            actor_id=actor_id,
        )

        self.assertIsNone(reason)
        self.assertIsNotNone(rewritten_args)
        assert rewritten_args is not None
        _, operations = parse_plan_tool_args(rewritten_args)
        self.assertEqual(len(operations), 1)
        patch = operations[0].patch or {}
        self.assertEqual(patch.get('assignee_id'), actor_id)
        rewritten_operation = rewritten_args['operations'][0]
        self.assertNotIn('assignee', rewritten_operation)

    def test_rewrite_does_not_apply_without_actor_context(self) -> None:
        args = {
            'assistant_message': 'Assign to me',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'node_id': '0f15f790-0f5e-4b4f-9ac1-198a9e2ba0fd',
                    'assignee': 'me',
                }
            ],
        }

        rewritten_args, reason = _rewrite_assignee_payload_to_actor_id(
            args=args,
            error_message=_ASSIGNEE_SHAPE_ERROR,
            actor_id='',
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(reason, 'actor_context_missing')

    def test_rewrite_does_not_apply_for_non_assignee_schema_error(self) -> None:
        args = {
            'assistant_message': 'Update task title',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'node_id': '0f15f790-0f5e-4b4f-9ac1-198a9e2ba0fd',
                    'foo': 'bar',
                }
            ],
        }
        non_assignee_error = (
            "Invalid operation payload at index 0 (op=update_node): "
            "[{'type': 'extra_forbidden', 'loc': ('foo',), "
            "'msg': 'Extra inputs are not permitted', 'input': 'bar'}]"
        )

        rewritten_args, reason = _rewrite_assignee_payload_to_actor_id(
            args=args,
            error_message=non_assignee_error,
            actor_id='6d1ecded-ef9d-4f11-a6d1-43dbf89b0af8',
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(reason, 'not_assignee_validation_failure')


if __name__ == '__main__':
    unittest.main()
