import unittest
from unittest.mock import patch

from app.core.config import get_settings
from app.core.tools.registry import parse_plan_tool_args
from app.core.llm.providers.openai_adapter import (
    OpenAILangChainAdapter,
    _is_missing_target_validation_failure,
    _rewrite_assignee_payload_to_actor_id,
    _rewrite_missing_target_from_resolver,
    _strip_nulls_from_plan_args,
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
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
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
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
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
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
            }
        )
        adapter = OpenAILangChainAdapter(settings)

        self.assertEqual(adapter._planner_max_tokens_for_profile('repair_retry'), 1600)
        self.assertEqual(adapter._planner_max_tokens_for_profile(None), 1200)

    def test_bind_tools_for_planning_logs_required_binding_mode(self) -> None:
        settings = get_settings().model_copy(
            update={
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
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
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
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


_DELETE_TARGET_MISSING_ERROR = (
    'Invalid operation payload at index 0 (op=delete_node): '
    'target missing: operation requires node_id or node_ref.'
)
_PARENT_MISSING_ERROR = (
    'Invalid operation payload at index 0 (op=add_feature): '
    'parent target missing: add_feature/add_task require parent_id or parent_ref.'
)


def _resolver_message(matches: list[dict[str, str]]) -> dict[str, object]:
    return {
        'name': 'resolve_node_reference',
        'args': {'label': 'epics'},
        'result': {'matches': matches},
    }


class OpenAIAdapterTargetRecoveryAutofixTests(unittest.TestCase):
    def test_is_missing_target_validation_failure_detects_both_variants(self) -> None:
        self.assertTrue(_is_missing_target_validation_failure(_DELETE_TARGET_MISSING_ERROR))
        self.assertTrue(_is_missing_target_validation_failure(_PARENT_MISSING_ERROR))
        self.assertFalse(_is_missing_target_validation_failure('assignee extra forbidden'))

    def test_positional_pairing_recovers_three_delete_targets(self) -> None:
        args = {
            'assistant_message': 'delete the 3 epics',
            'operations': [
                {'op': 'delete_node'},
                {'op': 'delete_node'},
                {'op': 'delete_node'},
            ],
        }
        prior = [
            _resolver_message(
                [
                    {'id': '11111111-1111-1111-1111-111111111111', 'type': 'epic'},
                    {'id': '22222222-2222-2222-2222-222222222222', 'type': 'epic'},
                    {'id': '33333333-3333-3333-3333-333333333333', 'type': 'epic'},
                ]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_DELETE_TARGET_MISSING_ERROR,
            prior_tool_messages=prior,
        )

        self.assertIsNotNone(rewritten_args)
        assert rewritten_args is not None
        self.assertEqual(report['autofix_strategy'], 'positional')
        self.assertEqual(report['offending_op_count'], 3)
        self.assertEqual(report['candidates_count'], 3)
        ids = [op['node_id'] for op in rewritten_args['operations']]
        self.assertEqual(
            ids,
            [
                '11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222',
                '33333333-3333-3333-3333-333333333333',
            ],
        )

    def test_single_candidate_recovers_one_target(self) -> None:
        args = {
            'assistant_message': 'delete epic Core Foundations',
            'operations': [{'op': 'delete_node'}],
        }
        prior = [
            _resolver_message(
                [{'id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'type': 'epic'}]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_DELETE_TARGET_MISSING_ERROR,
            prior_tool_messages=prior,
        )

        self.assertIsNotNone(rewritten_args)
        assert rewritten_args is not None
        self.assertEqual(report['autofix_strategy'], 'single_candidate')
        self.assertEqual(
            rewritten_args['operations'][0]['node_id'],
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        )

    def test_count_mismatch_returns_none_with_reason(self) -> None:
        args = {
            'assistant_message': '',
            'operations': [{'op': 'delete_node'}, {'op': 'delete_node'}],
        }
        prior = [
            _resolver_message(
                [
                    {'id': '11111111-1111-1111-1111-111111111111', 'type': 'epic'},
                    {'id': '22222222-2222-2222-2222-222222222222', 'type': 'epic'},
                    {'id': '33333333-3333-3333-3333-333333333333', 'type': 'epic'},
                ]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_DELETE_TARGET_MISSING_ERROR,
            prior_tool_messages=prior,
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(report['failure_reason'], 'count_mismatch')

    def test_no_resolver_context_returns_none(self) -> None:
        args = {
            'assistant_message': '',
            'operations': [{'op': 'delete_node'}],
        }
        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_DELETE_TARGET_MISSING_ERROR,
            prior_tool_messages=[],
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(report['failure_reason'], 'no_resolver_context')

    def test_mixed_operation_shapes_aborts_recovery(self) -> None:
        args = {
            'assistant_message': '',
            'operations': [
                {'op': 'delete_node'},
                {
                    'op': 'delete_node',
                    'node_id': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                },
            ],
        }
        prior = [
            _resolver_message(
                [{'id': '11111111-1111-1111-1111-111111111111', 'type': 'epic'}]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_DELETE_TARGET_MISSING_ERROR,
            prior_tool_messages=prior,
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(report['failure_reason'], 'mixed_operation_shapes')

    def test_parent_recovery_fills_add_feature_parent_id(self) -> None:
        args = {
            'assistant_message': 'create feature under Core Foundations',
            'operations': [
                {'op': 'add_feature', 'data': {'title': 'Telemetry'}},
            ],
        }
        prior = [
            _resolver_message(
                [{'id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'type': 'epic'}]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=_PARENT_MISSING_ERROR,
            prior_tool_messages=prior,
        )

        self.assertIsNotNone(rewritten_args)
        assert rewritten_args is not None
        self.assertEqual(report['autofix_strategy'], 'single_candidate')
        self.assertEqual(
            rewritten_args['operations'][0]['parent_id'],
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        )

    def test_parent_recovery_rejects_incompatible_candidate_type(self) -> None:
        args = {
            'assistant_message': '',
            'operations': [
                {'op': 'add_task', 'data': {'title': 'Do X'}},
            ],
        }
        prior = [
            _resolver_message(
                [{'id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'type': 'epic'}]
            )
        ]

        rewritten_args, report = _rewrite_missing_target_from_resolver(
            args=args,
            error_message=(
                'Invalid operation payload at index 0 (op=add_task): '
                'parent target missing: add_feature/add_task require parent_id or parent_ref.'
            ),
            prior_tool_messages=prior,
        )

        self.assertIsNone(rewritten_args)
        self.assertEqual(report['failure_reason'], 'op_incompatible')


class OpenAIAdapterStrictToolsTests(unittest.TestCase):
    def _adapter(self) -> OpenAILangChainAdapter:
        settings = get_settings().model_copy(
            update={
                'openai_edit_default_max_tokens': 1200,
                'openai_edit_repair_max_tokens': 1600,
            }
        )
        return OpenAILangChainAdapter(settings)

    def test_bind_tools_passes_strict_by_default(self) -> None:
        adapter = self._adapter()

        class _Model:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def bind_tools(self, tools, tool_choice=None, strict=None):  # noqa: ANN001
                self.calls.append(
                    {
                        'tools': tools,
                        'tool_choice': tool_choice,
                        'strict': strict,
                    }
                )
                return self

        model = _Model()
        tool_definitions = [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}]
        bound = adapter._bind_tools_for_planning(model, tool_definitions)

        self.assertIs(bound, model)
        self.assertEqual(model.calls[0].get('tool_choice'), 'required')
        self.assertTrue(model.calls[0].get('strict'))

    def test_bind_tools_falls_back_when_strict_unsupported(self) -> None:
        adapter = self._adapter()

        class _Model:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def bind_tools(self, tools, tool_choice=None, **kwargs):  # noqa: ANN001
                if 'strict' in kwargs:
                    raise TypeError('strict is not supported')
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

    def test_bind_tools_falls_back_when_strict_rejects_schema(self) -> None:
        adapter = self._adapter()

        class _Model:
            def __init__(self) -> None:
                self.calls: list[dict[str, object]] = []

            def bind_tools(self, tools, tool_choice=None, **kwargs):  # noqa: ANN001
                if kwargs.get('strict'):
                    raise ValueError(
                        "Invalid schema for response_format: additionalProperties required"
                    )
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

    def test_bind_tools_strict_binding_logs_strict_mode_supported(self) -> None:
        adapter = self._adapter()

        class _Model:
            def bind_tools(self, tools, tool_choice=None, strict=None):  # noqa: ANN001
                return self

        with patch('app.core.llm.providers.openai_adapter.log_event') as mocked_log_event:
            adapter._bind_tools_for_planning(
                _Model(),
                [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}],
                planner_profile='default',
            )

        call_args = mocked_log_event.call_args.kwargs
        self.assertTrue(call_args.get('strict_mode_supported'))
        self.assertEqual(call_args.get('tool_choice_mode'), 'required_strict')
        self.assertIsNone(call_args.get('strict_mode_fallback_reason'))

    def test_bind_tools_strict_fallback_logs_reason(self) -> None:
        adapter = self._adapter()

        class _Model:
            def bind_tools(self, tools, tool_choice=None, **kwargs):  # noqa: ANN001
                if kwargs.get('strict'):
                    raise ValueError('boom')
                return self

        with patch('app.core.llm.providers.openai_adapter.log_event') as mocked_log_event:
            adapter._bind_tools_for_planning(
                _Model(),
                [{'type': 'function', 'function': {'name': 'plan_roadmap_operations'}}],
                planner_profile='default',
            )

        call_args = mocked_log_event.call_args.kwargs
        self.assertFalse(call_args.get('strict_mode_supported'))
        self.assertEqual(call_args.get('tool_choice_mode'), 'required')
        reason = call_args.get('strict_mode_fallback_reason')
        self.assertIsInstance(reason, str)
        assert isinstance(reason, str)
        self.assertTrue(reason.startswith('valueerror:'))


class StripNullsFromPlanArgsTests(unittest.TestCase):
    def test_drops_top_level_nulls(self) -> None:
        args = {
            'assistant_message': 'hi',
            'clarifier_options': None,
            'operations': [],
        }
        cleaned = _strip_nulls_from_plan_args(args)
        self.assertNotIn('clarifier_options', cleaned)
        self.assertEqual(cleaned['operations'], [])

    def test_drops_per_operation_nulls(self) -> None:
        args = {
            'assistant_message': 'x',
            'operations': [
                {
                    'op': 'delete_node',
                    'node_id': '11111111-1111-1111-1111-111111111111',
                    'node_ref': None,
                    'patch': None,
                    'data': None,
                }
            ],
        }
        cleaned = _strip_nulls_from_plan_args(args)
        self.assertEqual(
            cleaned['operations'][0],
            {
                'op': 'delete_node',
                'node_id': '11111111-1111-1111-1111-111111111111',
            },
        )

    def test_non_dict_args_returned_unchanged(self) -> None:
        self.assertEqual(_strip_nulls_from_plan_args('not-a-dict'), 'not-a-dict')


if __name__ == '__main__':
    unittest.main()
