import unittest
from unittest.mock import patch

from app.core.config import get_settings
from app.core.tools.registry import parse_plan_tool_args
from app.core.llm.providers.openai_adapter import (
    OpenAILangChainAdapter,
    _rewrite_assignee_payload_to_actor_id,
)


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

    def test_bind_tools_for_planning_uses_required_tool_choice_when_supported(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_planner_default_max_tokens': 1200,
                'openai_planner_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        class _Model:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def bind_tools(self, tools, tool_choice=None):  # noqa: ANN001
                self.calls.append(
                    {
                        'tools': tools,
                        'tool_choice': tool_choice,
                    }
                )
                return self

        model = _Model()
        tool_definitions = [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}]
        bound = adapter._bind_tools_for_planning(model, tool_definitions)

        self.assertIs(bound, model)
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(model.calls[0].get('tool_choice'), 'required')

    def test_bind_tools_for_planning_falls_back_when_tool_choice_unsupported(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_planner_default_max_tokens': 1200,
                'openai_planner_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        class _Model:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def bind_tools(self, tools, tool_choice=None):  # noqa: ANN001
                if tool_choice is not None:
                    raise TypeError('tool_choice is not supported')
                self.calls.append(
                    {
                        'tools': tools,
                        'tool_choice': tool_choice,
                    }
                )
                return self

        model = _Model()
        tool_definitions = [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}]
        bound = adapter._bind_tools_for_planning(model, tool_definitions)

        self.assertIs(bound, model)
        self.assertEqual(len(model.calls), 1)
        self.assertIsNone(model.calls[0].get('tool_choice'))

    def test_planner_max_tokens_uses_retry_profile_override(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_planner_default_max_tokens': 1200,
                'openai_planner_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        self.assertEqual(adapter._planner_max_tokens_for_profile('repair_retry'), 1600)
        self.assertEqual(adapter._planner_max_tokens_for_profile(None), 1200)

    def test_bind_tools_for_planning_logs_required_binding_mode(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_planner_default_max_tokens': 1200,
                'openai_planner_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        class _Model:
            def bind_tools(self, tools, tool_choice=None):  # noqa: ANN001
                return self

        with patch('app.core.llm.providers.openai_adapter.log_event') as mocked_log_event:
            adapter._bind_tools_for_planning(
                _Model(),
                [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}],
                planner_profile='repair_retry',
            )

        self.assertTrue(mocked_log_event.called)
        call_args = mocked_log_event.call_args.kwargs
        self.assertEqual(call_args.get('provider'), 'openai')
        self.assertEqual(call_args.get('planner_profile'), 'repair_retry')
        self.assertEqual(call_args.get('tool_choice_mode'), 'required')
        self.assertTrue(call_args.get('tool_choice_supported'))
        self.assertEqual(call_args.get('tools_count'), 1)

    def test_bind_tools_for_planning_logs_fallback_binding_mode(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_planner_default_max_tokens': 1200,
                'openai_planner_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        class _Model:
            def bind_tools(self, tools, tool_choice=None):  # noqa: ANN001
                if tool_choice is not None:
                    raise TypeError('tool_choice is not supported')
                return self

        with patch('app.core.llm.providers.openai_adapter.log_event') as mocked_log_event:
            adapter._bind_tools_for_planning(
                _Model(),
                [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}],
                planner_profile='repair_retry',
            )

        self.assertTrue(mocked_log_event.called)
        call_args = mocked_log_event.call_args.kwargs
        self.assertEqual(call_args.get('provider'), 'openai')
        self.assertEqual(call_args.get('planner_profile'), 'repair_retry')
        self.assertEqual(call_args.get('tool_choice_mode'), 'fallback_legacy')
        self.assertFalse(call_args.get('tool_choice_supported'))
        self.assertEqual(call_args.get('tools_count'), 1)


if __name__ == '__main__':
    unittest.main()
