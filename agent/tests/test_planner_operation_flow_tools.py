from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace

from app.core.llm.providers import ProviderAdapterError
from app.core.llm.planning.planner_operation_flow import plan_operations


class _FakeOrchestrator:
    def __init__(self, captured: dict[str, object]) -> None:
        self._captured = captured

    def call(self, operation, trace_context=None):  # noqa: ANN001
        class _Adapter:
            def __init__(self, captured: dict[str, object]) -> None:
                self._captured = captured

            def plan_operations_with_tools(
                self,
                *,
                system_prompt,
                planner_prompt,
                history_messages,
                tools,
                tool_executor,
                max_tool_turns,
                planner_profile=None,
            ):
                self._captured['tool_names'] = [
                    str(tool.get('function', {}).get('name') or '')
                    for tool in tools
                    if isinstance(tool, dict)
                ]
                return (
                    'Prepared operation.',
                    [{'op': 'add_epic', 'data': {'title': 'AI Module'}}],
                )

        value = operation(_Adapter(self._captured))
        return SimpleNamespace(
            value=value,
            provider_used='openai',
            fallback_used=False,
            provider_error_code=None,
            tokens_input=1,
            tokens_output=1,
            tokens_total=2,
        )


class _FakePlanner:
    def __init__(self, captured: dict[str, object]) -> None:
        self._captured = captured
        self._settings = SimpleNamespace(
            max_edit_history_messages=4,
            max_edit_tool_turns=4,
            agent_react_max_attempts=1,
            agent_react_repair_retries=0,
            agent_simple_edit_planner_profile_enabled=False,
            agent_log_include_content=False,
            agent_log_json=True,
            agent_log_color='off',
        )
        self._logger = logging.getLogger('planner-operation-flow-tools-tests')
        self._provider_orchestrator = _FakeOrchestrator(captured)

    def _build_history_messages(self, session_context, max_messages):  # noqa: ANN001
        return []

    def _execute_context_tool(self, name, args, session_context):  # noqa: ANN001
        return {'tool': name, 'args': args}

    def _record_react_tool_observation(
        self,
        observations,
        summary,
        tool_name,
        args,
        result,
    ):
        observations.append({'tool_name': tool_name, 'args': args, 'result': result})
        summary.append({'tool_name': tool_name})

    def _is_simple_edit_planner_request(self, user_message):  # noqa: ANN001
        return False

    def _augment_repair_planner_prompt(
        self,
        planner_prompt,
        error_code,
        error_message=None,
    ):  # noqa: ANN001
        return planner_prompt

    def _augment_missing_tool_call_retry_prompt(self, planner_prompt, user_message, tool_observations):  # noqa: ANN001
        return planner_prompt

    def _augment_parent_uuid_retry_prompt(self, planner_prompt, parent_uuid_violations, deictic_parent_hint):  # noqa: ANN001
        return planner_prompt

    def _maybe_synthesize_react_closure_operations(  # noqa: ANN001
        self,
        user_message,
        tool_observations,
        session_context=None,
    ):
        return None

    def _build_edit_clarifier_state(self, **kwargs):  # noqa: ANN003
        return {
            'assistant_message': 'clarifier',
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'clarifier',
            'provider_used': 'rule_based',
            'fallback_used': True,
        }

    def _coerce_parent_hint_for_operations(self, operations, deictic_parent_hint):  # noqa: ANN001
        return operations, False, []

    def _build_synthesized_react_closure_state(self, **kwargs):  # noqa: ANN003
        return {
            'assistant_message': 'synth',
            'planned_operations': kwargs.get('operations', []),
            'response_mode': 'edit_plan',
            'preview_recommended': True,
            'parse_mode': 'synth',
            'provider_used': 'rule_based',
            'fallback_used': True,
        }

    def _neutral_edit_clarifier_state(self, **kwargs):  # noqa: ANN003
        return {
            'assistant_message': 'neutral',
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'neutral',
            'provider_used': 'rule_based',
            'fallback_used': True,
        }


class PlannerOperationFlowToolsTests(unittest.TestCase):
    def test_edit_mode_tools_include_helpers_and_plan_tool(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'create epic AI Module',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-edit-tools',
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertIn('create_epic', tool_names)
        self.assertIn('bulk_update_task_status', tool_names)
        self.assertIn('bulk_update_tasks_by_parent', tool_names)
        self.assertIn('bulk_update_tasks_by_filter', tool_names)
        self.assertIn('get_roadmap_overview', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertNotIn('get_children', tool_names)
        self.assertNotIn('get_tasks_by_feature', tool_names)
        self.assertNotIn('get_tasks_by_epic', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_task_update_with_resolved_parent_uses_helper_and_plan_only(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-helper-guard',
                    'deictic_parent_hint': {
                        'node_type': 'feature',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                    },
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertIn('bulk_update_tasks_by_parent', tool_names)
        self.assertNotIn('bulk_update_tasks_by_filter', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertNotIn('get_roadmap_overview', tool_names)
        self.assertNotIn('resolve_node_reference', tool_names)
        self.assertNotIn('get_tasks_by_feature', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_task_update_with_filter_hint_keeps_filter_helper_available(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'Update all tasks in Authentication System assigned to me to high priority',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-filter-guard',
                    'deictic_parent_hint': {
                        'node_type': 'feature',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                    },
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertIn('bulk_update_tasks_by_parent', tool_names)
        self.assertIn('bulk_update_tasks_by_filter', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertNotIn('get_roadmap_overview', tool_names)
        self.assertNotIn('resolve_node_reference', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_move_intent_does_not_force_helper_only_allowlist(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'Move all tasks in Authentication System to Payments feature',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-move-general-tools',
                    'deictic_parent_hint': {
                        'node_type': 'feature',
                        'node_id': '123e4567-e89b-12d3-a456-426614174000',
                    },
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertIn('get_roadmap_overview', tool_names)
        self.assertIn('resolve_node_reference', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_roadmap_plan_mode_uses_plan_tool_only(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'expand roadmap',
                'intent_type': 'roadmap_plan',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-plan-tools',
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertEqual(tool_names, ['plan_roadmap_operations'])
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_followup_closed_world_turn_uses_plan_tool_only(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'continue',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-followup-tools',
                    '_react_loop_turn': 2,
                    '_react_loop_observation': {
                        'provider_error_code': 'max_tool_turns_exceeded',
                        'resolved_node_ids': ['123e4567-e89b-12d3-a456-426614174000'],
                    },
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertEqual(tool_names, ['plan_roadmap_operations'])
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_duplicate_discovery_calls_are_deduped_within_turn(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        tool_calls: list[tuple[str, dict[str, object]]] = []

        def fake_execute(name, args, session_context):  # noqa: ANN001
            tool_calls.append((name, dict(args)))
            return {'tool': name, 'args': dict(args), 'ok': True}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]

        class _DedupOrchestrator:
            def call(self, operation, trace_context=None):  # noqa: ANN001
                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                        planner_profile=None,
                    ):
                        search_args = {'roadmap_id': 'r1', 'query': 'Authentication'}
                        resolve_args = {
                            'roadmap_id': 'r1',
                            'label': 'Authentication System',
                            'node_type': 'epic',
                            'limit': 5,
                        }
                        tool_executor('search_nodes', search_args)
                        tool_executor('search_nodes', search_args)
                        tool_executor('resolve_node_reference', resolve_args)
                        tool_executor('resolve_node_reference', resolve_args)
                        return (
                            'Prepared operation.',
                            [{'op': 'add_epic', 'data': {'title': 'AI Module'}}],
                        )

                value = operation(_Adapter())
                return SimpleNamespace(
                    value=value,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _DedupOrchestrator()
        session_context = {
            'roadmap_id': 'r1',
            'trace_id': 'trace-tool-dedupe',
        }

        result = plan_operations(
            planner,
            {
                'user_message': 'mark auth tasks in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': session_context,
            },
        )

        self.assertEqual(len(tool_calls), 2)
        self.assertEqual(tool_calls[0][0], 'search_nodes')
        self.assertEqual(tool_calls[1][0], 'resolve_node_reference')
        phase_metrics = session_context.get('_phase_metrics')
        self.assertIsInstance(phase_metrics, dict)
        assert isinstance(phase_metrics, dict)
        self.assertEqual(int(phase_metrics.get('resolve_dedup_hits') or 0), 2)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_scope_resolve_strips_implicit_parent_type_guess(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        observed_args: list[dict[str, object]] = []

        def fake_execute(name, args, session_context):  # noqa: ANN001
            if name == 'resolve_node_reference':
                observed_args.append(dict(args))
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '123e4567-e89b-12d3-a456-426614174000',
                        'type': 'feature',
                        'title': 'Authentication System',
                    },
                }
            return {'tool': name, 'args': dict(args), 'ok': True}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]

        class _ResolveOrchestrator:
            def call(self, operation, trace_context=None):  # noqa: ANN001
                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                        planner_profile=None,
                    ):
                        tool_executor(
                            'resolve_node_reference',
                            {
                                'roadmap_id': 'r1',
                                'label': 'Autenthication System',
                                'node_type': 'epic',
                                'limit': 5,
                            },
                        )
                        return (
                            'Prepared operation.',
                            [{'op': 'add_epic', 'data': {'title': 'AI Module'}}],
                        )

                value = operation(_Adapter())
                return SimpleNamespace(
                    value=value,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _ResolveOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in the Autenthication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-resolve-sanitize',
                },
            },
        )

        self.assertEqual(len(observed_args), 1)
        self.assertNotIn('node_type', observed_args[0])
        self.assertEqual(observed_args[0].get('allowed_node_types'), ['feature', 'epic'])
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_scope_resolve_keeps_explicit_parent_type(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        observed_args: list[dict[str, object]] = []

        def fake_execute(name, args, session_context):  # noqa: ANN001
            if name == 'resolve_node_reference':
                observed_args.append(dict(args))
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '123e4567-e89b-12d3-a456-426614174000',
                        'type': 'epic',
                        'title': 'Authentication System',
                    },
                }
            return {'tool': name, 'args': dict(args), 'ok': True}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]

        class _ResolveOrchestrator:
            def call(self, operation, trace_context=None):  # noqa: ANN001
                class _Adapter:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                        planner_profile=None,
                    ):
                        tool_executor(
                            'resolve_node_reference',
                            {
                                'roadmap_id': 'r1',
                                'label': 'Authentication System',
                                'node_type': 'feature',
                                'limit': 5,
                            },
                        )
                        return (
                            'Prepared operation.',
                            [{'op': 'add_epic', 'data': {'title': 'AI Module'}}],
                        )

                value = operation(_Adapter())
                return SimpleNamespace(
                    value=value,
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _ResolveOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks under epic Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-resolve-keep-explicit-type',
                },
            },
        )

        self.assertEqual(len(observed_args), 1)
        self.assertNotIn('node_type', observed_args[0])
        self.assertEqual(observed_args[0].get('allowed_node_types'), ['epic'])
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_missing_tool_call_retry_keeps_resolve_sanitized_for_bulk_scope(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_react_max_attempts = 2
        planner._settings.agent_react_repair_retries = 1
        observed_args: list[dict[str, object]] = []
        call_count = {'value': 0}

        def fake_execute(name, args, session_context):  # noqa: ANN001
            if name == 'resolve_node_reference':
                observed_args.append(dict(args))
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '123e4567-e89b-12d3-a456-426614174000',
                        'type': 'feature',
                        'title': 'Authentication System',
                    },
                }
            return {'tool': name, 'args': dict(args), 'ok': True}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]

        class _RetryOrchestrator:
            def call(self, operation, trace_context=None):  # noqa: ANN001
                call_count['value'] += 1
                if call_count['value'] == 1:
                    class _AdapterFirst:
                        def plan_operations_with_tools(
                            self,
                            *,
                            system_prompt,
                            planner_prompt,
                            history_messages,
                            tools,
                            tool_executor,
                            max_tool_turns,
                            planner_profile=None,
                        ):
                            tool_executor(
                                'resolve_node_reference',
                                {
                                    'roadmap_id': 'r1',
                                    'label': 'Autenthication System',
                                    'node_type': 'epic',
                                    'limit': 5,
                                },
                            )
                            raise ProviderAdapterError(
                                provider='openai',
                                code='missing_tool_call',
                                message='OpenAI did not return any tool call while planning operations.',
                            )

                    return SimpleNamespace(
                        value=operation(_AdapterFirst()),
                        provider_used='openai',
                        fallback_used=False,
                        provider_error_code=None,
                        tokens_input=1,
                        tokens_output=1,
                        tokens_total=2,
                    )

                class _AdapterSecond:
                    def plan_operations_with_tools(
                        self,
                        *,
                        system_prompt,
                        planner_prompt,
                        history_messages,
                        tools,
                        tool_executor,
                        max_tool_turns,
                        planner_profile=None,
                    ):
                        tool_executor(
                            'resolve_node_reference',
                            {
                                'roadmap_id': 'r1',
                                'label': 'Authentication System',
                                'node_type': 'epic',
                                'limit': 5,
                            },
                        )
                        return (
                            'Prepared operation.',
                            [{'op': 'add_epic', 'data': {'title': 'AI Module'}}],
                        )

                return SimpleNamespace(
                    value=operation(_AdapterSecond()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _RetryOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in the Autenthication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-resolve-sanitize-retry',
                },
            },
        )

        self.assertEqual(call_count['value'], 2)
        self.assertEqual(len(observed_args), 2)
        self.assertTrue(all('node_type' not in args for args in observed_args))
        self.assertTrue(
            all(args.get('allowed_node_types') == ['feature', 'epic'] for args in observed_args)
        )
        self.assertEqual(result.get('response_mode'), 'edit_plan')


if __name__ == '__main__':
    unittest.main()
