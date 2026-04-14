from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.contracts.operations import RoadmapOperation
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
                    [
                        {
                            'op': 'mark_status',
                            'node_type': 'task',
                            'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'status': 'in_review',
                        }
                    ],
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
            agent_edit_actionable_failure_clarifier_enabled=False,
            agent_strict_mutation_authority_enabled=False,
            agent_log_include_content=False,
            agent_log_json=True,
            agent_log_color='off',
            agent_progress_events_enabled=False,
            agent_progress_events_allow_verbose=False,
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

    def _is_invalid_operation_enum_payload(self, error_message):  # noqa: ANN001
        return False

    def _augment_missing_tool_call_retry_prompt(self, planner_prompt, user_message, tool_observations):  # noqa: ANN001
        return planner_prompt

    def _augment_parent_uuid_retry_prompt(self, planner_prompt, parent_uuid_violations, deictic_parent_hint):  # noqa: ANN001
        return planner_prompt

    def _maybe_synthesize_react_closure_operations(  # noqa: ANN001
        self,
        user_message,
        tool_observations,
        session_context=None,
        force_include_completed=None,
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

    def test_emits_planner_summary_before_plan_generated(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        with patch('app.core.llm.planning.planner_operation_flow.log_event') as mocked_log_event:
            result = plan_operations(
                planner,
                {
                    'user_message': 'mark auth tasks in review',
                    'intent_type': 'roadmap_edit',
                    'existing_operations': [],
                    'system_prompt': 'system',
                    'session_context': {
                        'roadmap_id': 'r1',
                        'trace_id': 'trace-planner-summary-order',
                    },
                },
            )

        self.assertEqual(result.get('response_mode'), 'edit_plan')

        event_names = [
            str(call.args[1])
            for call in mocked_log_event.call_args_list
            if len(call.args) >= 2
        ]
        self.assertIn('planner_summary', event_names)
        self.assertIn('plan_generated', event_names)
        self.assertLess(
            event_names.index('planner_summary'),
            event_names.index('plan_generated'),
        )

        planner_summary_calls = [
            call
            for call in mocked_log_event.call_args_list
            if len(call.args) >= 2 and str(call.args[1]) == 'planner_summary'
        ]
        self.assertTrue(planner_summary_calls)
        planner_summary_kwargs = planner_summary_calls[-1].kwargs
        self.assertEqual(
            planner_summary_kwargs.get('summary_source'),
            'model_assistant_message',
        )
        self.assertEqual(planner_summary_kwargs.get('response_mode'), 'edit_plan')
        self.assertEqual(planner_summary_kwargs.get('operations_count'), 1)

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

    def test_global_bulk_filter_update_uses_filter_helper_only(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'Assign all tasks assigned to me that are done to in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-global-bulk-filter-guard',
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertNotIn('bulk_update_tasks_by_parent', tool_names)
        self.assertIn('bulk_update_tasks_by_filter', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertNotIn('get_roadmap_overview', tool_names)
        self.assertNotIn('resolve_node_reference', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_global_bulk_filter_update_with_quoted_status_and_followup_clause_uses_filter_helper_only(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        result = plan_operations(
            planner,
            {
                'user_message': 'Assign me to all tasks that are "done" after that mark them as todo',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-global-bulk-filter-quoted-status',
                },
            },
        )

        tool_names = captured.get('tool_names')
        self.assertIsInstance(tool_names, list)
        assert isinstance(tool_names, list)
        self.assertNotIn('bulk_update_tasks_by_parent', tool_names)
        self.assertIn('bulk_update_tasks_by_filter', tool_names)
        self.assertIn('plan_roadmap_operations', tool_names)
        self.assertNotIn('get_roadmap_overview', tool_names)
        self.assertNotIn('get_tasks_by_status', tool_names)
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_global_bulk_filter_assign_me_injects_actor_assignee_into_helper_update(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        observed_filter_updates: list[dict[str, object]] = []

        def fake_execute(name, args, session_context):  # noqa: ANN001
            if name == 'bulk_update_tasks_by_filter':
                observed_filter_updates.append(dict(args))
                return {
                    'operations': [
                        {
                            'op': 'mark_status',
                            'node_type': 'task',
                            'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'status': 'todo',
                        },
                        {
                            'op': 'update_node',
                            'node_type': 'task',
                            'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'patch': {'assignee_id': 'u1'},
                        },
                    ],
                    'matched_task_count': 1,
                    'updated_task_count': 2,
                }
            return {'tool': name, 'args': dict(args), 'ok': True}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]

        class _AssignMeFilterOrchestrator:
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
                            'bulk_update_tasks_by_filter',
                            {
                                'roadmap_id': 'r1',
                                'filters': {'status': 'done', 'include_completed': True},
                                'update': {'status': 'todo'},
                                'limit': 2000,
                            },
                        )
                        return (
                            'Prepared operation.',
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'todo',
                                }
                            ],
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _AssignMeFilterOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign me to all tasks that are done after that mark them as todo',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-global-bulk-filter-assign-me-injection',
                    'actor_context': {'actor_id': 'u1'},
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(len(observed_filter_updates), 1)
        update_payload = observed_filter_updates[0].get('update')
        self.assertIsInstance(update_payload, dict)
        assert isinstance(update_payload, dict)
        self.assertEqual(update_payload.get('status'), 'todo')
        self.assertEqual(update_payload.get('assignee_id'), 'u1')

    def test_actor_context_is_forwarded_to_planner_adapter(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        class _ActorCaptureOrchestrator:
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
                        actor_context=None,
                    ):
                        captured['actor_context'] = actor_context
                        return ('Prepared operation.', [])

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _ActorCaptureOrchestrator()

        result = plan_operations(
            planner,
            {
                'user_message': 'Assign all tasks to me inside Agent Module',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-forward-actor-context',
                    'actor_context': {
                        'actor_id': '09f2e875-bd56-4f95-9bde-d6bbca2fa4e3',
                        'display_name': 'Test User',
                    },
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertIsInstance(captured.get('actor_context'), dict)
        assert isinstance(captured.get('actor_context'), dict)
        self.assertEqual(
            captured['actor_context'].get('actor_id'),
            '09f2e875-bd56-4f95-9bde-d6bbca2fa4e3',
        )

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
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
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
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
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

    def test_provider_roadmap_operation_objects_do_not_trigger_invalid_payload(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        class _ObjectOperationsOrchestrator:
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
                        return (
                            'Prepared operation.',
                            [
                                RoadmapOperation(
                                    op='mark_status',
                                    node_type='task',
                                    node_id='b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    status='in_review',
                                )
                            ],
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

        planner._provider_orchestrator = _ObjectOperationsOrchestrator()

        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in the Database Schema Setup as todo',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-roadmap-operation-objects',
                },
            },
        )

        planned_operations = result.get('planned_operations')
        self.assertIsInstance(planned_operations, list)
        assert isinstance(planned_operations, list)
        self.assertEqual(len(planned_operations), 1)
        self.assertEqual(planned_operations[0].op.value, 'mark_status')
        self.assertEqual(planned_operations[0].node_type.value, 'task')
        self.assertEqual(planned_operations[0].status, 'in_review')
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
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
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
        observed_profiles: list[str | None] = []
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
                            observed_profiles.append(planner_profile)
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
                        observed_profiles.append(planner_profile)
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
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'status': 'in_review',
                                }
                            ],
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
        self.assertEqual(observed_profiles, [None, 'repair_retry'])
        self.assertEqual(len(observed_args), 2)
        self.assertTrue(all('node_type' not in args for args in observed_args))
        self.assertTrue(
            all(args.get('allowed_node_types') == ['feature', 'epic'] for args in observed_args)
        )
        self.assertEqual(result.get('response_mode'), 'edit_plan')

    def test_bulk_task_status_coerces_missing_node_type_and_status_alias(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)

        class _RepairOrchestrator:
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
                        return (
                            'Prepared operation.',
                            [
                                {
                                    'op': 'mark_status',
                                    'node_id': 'decf459b-c0d2-46b0-89ad-2c224d247c0b',
                                    'status': 'in review',
                                },
                                {
                                    'op': 'mark_status',
                                    'node_id': '5bc7047c-0b9e-4b07-bd86-b7b3145d3151',
                                    'status': 'in review',
                                },
                            ],
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _RepairOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-bulk-task-missing-node-type-repair',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'edit_plan')
        planned_operations = result.get('planned_operations')
        self.assertIsInstance(planned_operations, list)
        assert isinstance(planned_operations, list)
        self.assertEqual(len(planned_operations), 2)
        self.assertTrue(
            all(getattr(op.node_type, 'value', '') == 'task' for op in planned_operations)
        )
        self.assertTrue(all(op.status == 'in_review' for op in planned_operations))

    def test_strict_mutation_authority_skips_synthesis_for_empty_plan_without_provider_error(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_strict_mutation_authority_enabled = True
        synth_calls = {'count': 0}

        def fake_synthesize(**kwargs):  # noqa: ANN003
            synth_calls['count'] += 1
            return [
                {
                    'op': 'mark_status',
                    'node_type': 'task',
                    'node_id': '9d40bb32-0768-4e5a-bb6f-1ccf0ce43721',
                    'status': 'in_review',
                }
            ]

        planner._maybe_synthesize_react_closure_operations = fake_synthesize  # type: ignore[method-assign]

        class _EmptyOperationsOrchestrator:
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
                        return ('No staged operations.', [])

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _EmptyOperationsOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Update task status',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-strict-empty-no-synth',
                },
            },
        )

        self.assertEqual(synth_calls['count'], 0)
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'openai_tool_calling_clarifier')

    def test_compound_epic_feature_missing_tool_call_uses_parent_first_clarifier(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _MissingToolCallOrchestrator:
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
                            'create_epic',
                            {
                                'title': 'Agile',
                                'status': 'not_started',
                                'description': '',
                            },
                        )
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Add new epic called "Agile" and inside that add feature called "Jira"',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-compound-parent-first-clarifier',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'deterministic_compound_create_parent_first_clarifier')
        self.assertEqual(result.get('provider_error_code'), 'missing_tool_call')
        self.assertEqual(result.get('clarifier_action'), 'propose_safe_default')
        self.assertIn('two steps', str(result.get('assistant_message')))
        self.assertIn('Agile', str(result.get('assistant_message')))
        self.assertIn('Jira', str(result.get('assistant_message')))

    def test_strict_mutation_authority_allows_synthesis_for_missing_tool_call_fallback(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_strict_mutation_authority_enabled = True
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0
        synth_calls = {'count': 0}

        def fake_synthesize(**kwargs):  # noqa: ANN003
            synth_calls['count'] += 1
            return [
                {
                    'op': 'mark_status',
                    'node_type': 'task',
                    'node_id': '8f58ac65-2f95-4571-b8c1-cc9fd80e95db',
                    'status': 'in_review',
                }
            ]

        planner._maybe_synthesize_react_closure_operations = fake_synthesize  # type: ignore[method-assign]

        class _MissingToolCallOrchestrator:
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
                            'bulk_update_tasks_by_parent',
                            {
                                'roadmap_id': 'r1',
                                'parent_id': '123e4567-e89b-12d3-a456-426614174000',
                                'status': 'in_review',
                                'include_completed': True,
                            },
                        )
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-strict-missing-tool-call-synth',
                },
            },
        )

        self.assertEqual(synth_calls['count'], 1)
        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('parse_mode'), 'synth')

    def test_strict_mutation_authority_blocks_mismatch_synthesis_without_provider_error(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_strict_mutation_authority_enabled = True
        synth_calls = {'count': 0}

        def fake_synthesize(**kwargs):  # noqa: ANN003
            synth_calls['count'] += 1
            return [
                {
                    'op': 'mark_status',
                    'node_type': 'task',
                    'node_id': '5d53db15-0f2f-4ec8-90b2-c995f72cae30',
                    'status': 'in_review',
                }
            ]

        planner._maybe_synthesize_react_closure_operations = fake_synthesize  # type: ignore[method-assign]

        class _MismatchOrchestrator:
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
                        return (
                            'Prepared operation.',
                            [
                                {
                                    'op': 'mark_status',
                                    'node_type': 'feature',
                                    'node_id': '123e4567-e89b-12d3-a456-426614174000',
                                    'status': 'in_review',
                                }
                            ],
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MismatchOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-strict-mismatch-no-synth',
                },
            },
        )

        self.assertEqual(synth_calls['count'], 0)
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(
            result.get('parse_mode'),
            'deterministic_bulk_task_scope_mismatch_clarifier',
        )

    def test_llm_first_mode_skips_deterministic_parent_first_clarifier(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _MissingToolCallOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Add new epic called "Agile" and inside that add feature called "Jira"',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-parent-first-skip',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_edit_outage')
        self.assertEqual(result.get('provider_error_code'), 'missing_tool_call')
        self.assertIn('Temporary AI provider issue', str(result.get('assistant_message')))

    def test_llm_first_mode_skips_deterministic_synthesized_closure(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        synth_calls = {'count': 0}

        def fake_synthesize(**kwargs):  # noqa: ANN003
            synth_calls['count'] += 1
            return [
                {
                    'op': 'mark_status',
                    'node_type': 'task',
                    'node_id': '8f58ac65-2f95-4571-b8c1-cc9fd80e95db',
                    'status': 'in_review',
                }
            ]

        planner._maybe_synthesize_react_closure_operations = fake_synthesize  # type: ignore[method-assign]

        class _MissingToolCallOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Mark all tasks in Authentication System as in review',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-no-synth',
                },
            },
        )

        self.assertEqual(synth_calls['count'], 0)
        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_edit_outage')

    def test_llm_first_missing_tool_call_returns_actionable_clarifier_when_flag_enabled(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_edit_actionable_failure_clarifier_enabled = True
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _MissingToolCallOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign all tasks to me inside Agent Module',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-actionable-missing-tool',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_planner_contract_failure')
        self.assertEqual(result.get('stop_reason'), 'awaiting_user_input')
        self.assertEqual(result.get('clarifier_reason'), 'planner_missing_tool_call')
        self.assertEqual(result.get('provider_error_code'), 'missing_tool_call')

    def test_llm_first_global_bulk_filter_missing_tool_call_uses_filter_narrow_option(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_edit_actionable_failure_clarifier_enabled = True
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _MissingToolCallOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _MissingToolCallOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign me to all tasks that are done',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-actionable-missing-tool-global-filter',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_planner_contract_failure')
        self.assertEqual(result.get('stop_reason'), 'awaiting_user_input')
        self.assertEqual(result.get('clarifier_reason'), 'planner_missing_tool_call')
        self.assertEqual(result.get('provider_error_code'), 'missing_tool_call')
        clarifier_options = result.get('clarifier_options')
        self.assertIsInstance(clarifier_options, list)
        assert isinstance(clarifier_options, list)
        self.assertTrue(
            any('Narrow to one filter' in str(option) for option in clarifier_options)
        )

    def test_llm_first_missing_tool_call_with_bulk_filter_helper_synthesizes(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_edit_actionable_failure_clarifier_enabled = True
        planner._settings.agent_react_max_attempts = 2
        planner._settings.agent_react_repair_retries = 1
        call_count = {'value': 0}

        def fake_execute(name, args, session_context):  # noqa: ANN001
            if name == 'bulk_update_tasks_by_filter':
                return {
                    'operations': [
                        {
                            'op': 'mark_status',
                            'node_type': 'task',
                            'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                            'status': 'todo',
                        }
                    ],
                    'matched_task_count': 1,
                    'updated_task_count': 1,
                    'task_ids': ['b026e967-54c3-4f11-9c49-b95a680aa2a7'],
                }
            return {'tool': name, 'args': dict(args), 'ok': True}

        def fake_synthesize(  # noqa: ANN001
            user_message,
            tool_observations,
            session_context=None,
            force_include_completed=None,
        ):
            for observation in reversed(tool_observations):
                if str(observation.get('tool_name') or '').strip() != 'bulk_update_tasks_by_filter':
                    continue
                helper_result = observation.get('result')
                if not isinstance(helper_result, dict):
                    continue
                raw_operations = helper_result.get('operations')
                if not isinstance(raw_operations, list) or not raw_operations:
                    continue
                synthesized: list[RoadmapOperation] = []
                for item in raw_operations:
                    if not isinstance(item, dict):
                        continue
                    try:
                        synthesized.append(RoadmapOperation.model_validate(item))
                    except Exception:
                        continue
                if synthesized:
                    return synthesized
            return None

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        planner._maybe_synthesize_react_closure_operations = fake_synthesize  # type: ignore[method-assign]

        class _MissingToolCallWithHelperOrchestrator:
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
                                'bulk_update_tasks_by_filter',
                                {
                                    'roadmap_id': 'r1',
                                    'filters': {'status': 'done', 'include_completed': True},
                                    'update': {'status': 'todo'},
                                    'limit': 2000,
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='missing_tool_call',
                            message='OpenAI did not return any tool call while planning operations.',
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

        planner._provider_orchestrator = _MissingToolCallWithHelperOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign me to all tasks that are done after that mark them as todo',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-bulk-filter-synth',
                },
            },
        )

        self.assertEqual(call_count['value'], 1)
        self.assertEqual(result.get('response_mode'), 'edit_plan')
        self.assertEqual(result.get('parse_mode'), 'synth')
        planned_operations = result.get('planned_operations') or []
        self.assertEqual(len(planned_operations), 1)
        self.assertEqual(planned_operations[0].op.value, 'mark_status')
        self.assertEqual(planned_operations[0].status, 'todo')

    def test_llm_first_invalid_assignee_payload_returns_actionable_clarifier_when_flag_enabled(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_edit_actionable_failure_clarifier_enabled = True
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _InvalidPayloadOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='invalid_operation_payload',
                            message=(
                                'Invalid operation payload at index 0 (op=update_node): '
                                "[{'type': 'extra_forbidden', 'loc': ('assignee',), "
                                "'msg': 'Extra inputs are not permitted', 'input': 'me'}]"
                            ),
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _InvalidPayloadOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign all tasks to me inside Agent Module',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-actionable-invalid-assignee',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_planner_contract_failure')
        self.assertEqual(result.get('stop_reason'), 'awaiting_user_input')
        self.assertEqual(result.get('clarifier_reason'), 'planner_invalid_assignee_shape')
        self.assertEqual(result.get('provider_error_code'), 'invalid_operation_payload')

    def test_semantic_invalid_update_node_payload_retries_before_staging(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_react_max_attempts = 2
        planner._settings.agent_react_repair_retries = 1
        observed_prompts: list[str] = []
        call_counter = {'count': 0}

        class _SemanticRetryOrchestrator:
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
                        call_counter['count'] += 1
                        observed_prompts.append(str(planner_prompt))
                        if call_counter['count'] == 1:
                            return (
                                'Prepared operation.',
                                [
                                    {
                                        'op': 'update_node',
                                        'node_type': 'task',
                                        'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    }
                                ],
                            )
                        return (
                            'Prepared operation.',
                            [
                                {
                                    'op': 'update_node',
                                    'node_type': 'task',
                                    'node_id': 'b026e967-54c3-4f11-9c49-b95a680aa2a7',
                                    'patch': {'assignee_id': None},
                                }
                            ],
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _SemanticRetryOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'unassign all my tasks',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-semantic-contract-retry',
                },
            },
        )

        self.assertEqual(call_counter['count'], 2)
        self.assertEqual(result.get('response_mode'), 'edit_plan')
        planned_operations = result.get('planned_operations')
        self.assertIsInstance(planned_operations, list)
        assert isinstance(planned_operations, list)
        self.assertEqual(len(planned_operations), 1)
        self.assertEqual((planned_operations[0].patch or {}).get('assignee_id'), None)
        self.assertGreaterEqual(len(observed_prompts), 2)
        self.assertIn('SEMANTIC OPERATION CONTRACT REPAIR:', observed_prompts[1])

    def test_llm_first_provider_timeout_still_uses_outage_clarifier_when_flag_enabled(self) -> None:
        captured: dict[str, object] = {}
        planner = _FakePlanner(captured)
        planner._settings.agent_edit_actionable_failure_clarifier_enabled = True
        planner._settings.agent_react_max_attempts = 1
        planner._settings.agent_react_repair_retries = 0

        class _TimeoutOrchestrator:
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
                        raise ProviderAdapterError(
                            provider='openai',
                            code='timeout',
                            message='request timed out',
                        )

                return SimpleNamespace(
                    value=operation(_Adapter()),
                    provider_used='openai',
                    fallback_used=False,
                    provider_error_code=None,
                    tokens_input=1,
                    tokens_output=1,
                    tokens_total=2,
                )

        planner._provider_orchestrator = _TimeoutOrchestrator()
        result = plan_operations(
            planner,
            {
                'user_message': 'Assign all tasks to me inside Agent Module',
                'intent_type': 'roadmap_edit',
                'existing_operations': [],
                'system_prompt': 'system',
                'session_context': {
                    'roadmap_id': 'r1',
                    'trace_id': 'trace-llm-first-timeout-outage',
                },
            },
        )

        self.assertEqual(result.get('response_mode'), 'chat')
        self.assertEqual(result.get('parse_mode'), 'llm_first_edit_outage')
        self.assertEqual(result.get('stop_reason'), 'provider_outage')
        self.assertIn('Temporary AI provider issue', str(result.get('assistant_message')))


if __name__ == '__main__':
    unittest.main()
