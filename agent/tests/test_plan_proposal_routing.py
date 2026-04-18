import logging
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.llm.planning.planner_execution_flow import (
    compose_dynamic_system_prompt,
    plan_with_langgraph,
    route_from_intent,
)


def _planner_double(*, plan_proposal_enabled: bool) -> SimpleNamespace:
    settings = SimpleNamespace(
        agent_plan_proposal_enabled=plan_proposal_enabled,
        agent_log_include_content=False,
        agent_log_json=False,
        agent_progress_events_enabled=False,
        agent_progress_events_allow_verbose=False,
    )
    prompt_repository = MagicMock()
    prompt_repository.build_system_prompt.return_value = '<system prompt>'
    return SimpleNamespace(
        _settings=settings,
        _logger=logging.getLogger('test.plan_proposal_routing'),
        _prompt_repository=prompt_repository,
    )


def _base_state(**overrides) -> dict:
    state: dict = {
        'intent_type': 'roadmap_plan',
        'session_context': {'roadmap_id': 'r1', 'recent_resolved_targets': []},
        'existing_operations': [],
    }
    state.update(overrides)
    return state


class ComposeDynamicSystemPromptTests(unittest.TestCase):
    def test_plan_intent_routes_to_plan_proposal_when_flag_on(self) -> None:
        planner = _planner_double(plan_proposal_enabled=True)
        result = compose_dynamic_system_prompt(planner, _base_state())
        self.assertEqual(result['response_mode'], 'plan_proposal')
        self.assertEqual(result['tool_mode'], 'plan_only')

    def test_plan_intent_falls_back_to_edit_plan_when_flag_off(self) -> None:
        planner = _planner_double(plan_proposal_enabled=False)
        result = compose_dynamic_system_prompt(planner, _base_state())
        self.assertEqual(result['response_mode'], 'edit_plan')
        self.assertEqual(result['tool_mode'], 'plan_only')

    def test_edit_intent_still_routes_to_edit_plan_when_flag_on(self) -> None:
        planner = _planner_double(plan_proposal_enabled=True)
        result = compose_dynamic_system_prompt(
            planner,
            _base_state(intent_type='roadmap_edit'),
        )
        self.assertEqual(result['response_mode'], 'edit_plan')
        self.assertEqual(result['tool_mode'], 'edit_plan')


class RouteFromIntentTests(unittest.TestCase):
    def test_plan_proposal_response_mode_routes_to_plan_node(self) -> None:
        self.assertEqual(
            route_from_intent({'response_mode': 'plan_proposal', 'tool_mode': 'plan_only'}),
            'generate_plan_proposal',
        )

    def test_plan_only_tool_mode_with_edit_plan_response_still_stages_ops(self) -> None:
        # Flag-off path: response_mode is edit_plan, tool_mode is plan_only.
        # Must keep routing to plan_operations to preserve legacy behavior.
        self.assertEqual(
            route_from_intent({'response_mode': 'edit_plan', 'tool_mode': 'plan_only'}),
            'plan_operations',
        )

    def test_edit_plan_tool_mode_routes_to_plan_operations(self) -> None:
        self.assertEqual(
            route_from_intent({'response_mode': 'edit_plan', 'tool_mode': 'edit_plan'}),
            'plan_operations',
        )

    def test_context_answer_tool_mode_routes_to_query_lane(self) -> None:
        self.assertEqual(
            route_from_intent({'response_mode': 'chat', 'tool_mode': 'context_answer'}),
            'generate_context_answer',
        )

    def test_default_routes_to_chat(self) -> None:
        self.assertEqual(
            route_from_intent({'response_mode': 'chat', 'tool_mode': 'none'}),
            'generate_chat_reply',
        )


class PlanWithLanggraphDefaultsTests(unittest.TestCase):
    """plan_with_langgraph coerces stop_reason / needs_more_info defaults.
    Plan-proposal turns must NOT set needs_more_info=True (they are already
    terminal — the user reviews the plan card) and stop_reason must be the
    plan-specific value so downstream logs are right.
    """

    def _run(self, state_overrides: dict) -> object:
        planner = SimpleNamespace(
            _langgraph=MagicMock(),
            _logger=logging.getLogger('test.plan_with_langgraph'),
        )
        state_out = {
            'planned_operations': [],
            'intent_type': state_overrides.get('intent_type', 'roadmap_plan'),
            'response_mode': state_overrides.get('response_mode', 'plan_proposal'),
            'assistant_message': 'ok',
            'parse_mode': 'test',
            'plan_proposal_payload': {'summary': 's'},
        }
        planner._langgraph.invoke.return_value = state_out

        class _Result:
            def __init__(self, **kwargs: object) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        return plan_with_langgraph(
            planner,
            user_message='plan a travel app',
            existing_operations=[],
            session_context={},
            planning_result_cls=_Result,
        )

    def test_plan_proposal_defaults_are_terminal(self) -> None:
        result = self._run({'response_mode': 'plan_proposal'})
        self.assertEqual(result.stop_reason, 'plan_ready_for_confirmation')
        self.assertFalse(result.needs_more_info)
        self.assertEqual(result.draft_action, 'none')
        self.assertEqual(result.plan_proposal_payload, {'summary': 's'})

    def test_plan_proposal_payload_survives_state_round_trip(self) -> None:
        """Regression for the bug where the payload was being dropped because
        `plan_proposal_payload` was not declared on PlannerState.

        Simulates the LangGraph state dict that results from the
        `generate_plan_proposal` node returning a payload — plan_with_langgraph
        must surface it on PlanningResult rather than reading None.
        """
        planner = SimpleNamespace(
            _langgraph=MagicMock(),
            _logger=logging.getLogger('test.plan_with_langgraph'),
        )
        expected_payload = {
            'summary': 'Ship MVP',
            'goal': 'Plan a travel booking app',
            'proposed_hierarchy': [
                {'title': 'Search', 'features': []},
                {'title': 'Booking'},
            ],
        }
        planner._langgraph.invoke.return_value = {
            'planned_operations': [],
            'intent_type': 'roadmap_plan',
            'response_mode': 'plan_proposal',
            'assistant_message': 'Here is the plan',
            'parse_mode': 'openai_plan_proposal',
            'plan_proposal_payload': expected_payload,
        }

        class _Result:
            def __init__(self, **kwargs: object) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        result = plan_with_langgraph(
            planner,
            user_message='plan a travel app',
            existing_operations=[],
            session_context={},
            planning_result_cls=_Result,
        )
        self.assertEqual(result.plan_proposal_payload, expected_payload)
        self.assertIsNotNone(result.plan_proposal_payload)

    def test_edit_plan_defaults_unchanged(self) -> None:
        result = self._run(
            {
                'response_mode': 'edit_plan',
                'intent_type': 'roadmap_edit',
            }
        )
        # Edit plan with no ops → awaiting_user_input (legacy behavior).
        self.assertEqual(result.stop_reason, 'awaiting_user_input')


class PlanPhaseMaxTokensTests(unittest.TestCase):
    """Regression: empty-roadmap plan turns were hitting the ~900-token
    default reasoning cap and returning empty content. The plan node must
    thread `openai_plan_max_tokens` (default 4000) into the adapter call so
    the model has headroom for reasoning + JSON envelope.
    """

    def _stub_planner(self, *, plan_max_tokens: int | None) -> SimpleNamespace:
        captured: dict[str, object] = {}

        class _Result:
            value = '{"status": "plan_ready", "summary": "s", "goal": "g", "proposed_hierarchy": [{"title": "E"}]}'
            provider_used = 'openai'
            fallback_used = False
            provider_error_code = None
            tokens_input = 100
            tokens_output = 200
            tokens_total = 300

        class _RecordingAdapter:
            def answer_with_tools(self, **kwargs):
                captured['answer_with_tools_kwargs'] = kwargs
                return _Result()

            def generate_chat_reply(self, **kwargs):
                captured['generate_chat_reply_kwargs'] = kwargs
                return _Result()

        adapter = _RecordingAdapter()

        class _Orchestrator:
            @staticmethod
            def call(fn, trace_context=None):
                captured.setdefault('trace_contexts', []).append(trace_context)
                return fn(adapter)

        settings = SimpleNamespace(
            agent_plan_proposal_enabled=True,
            max_discovery_tool_calls=6,
            max_repeated_tool_calls_per_signature=2,
            openai_plan_max_tokens=plan_max_tokens,
            agent_log_include_content=False,
            agent_log_json=False,
            agent_progress_events_enabled=False,
            agent_progress_events_allow_verbose=False,
        )

        planner = SimpleNamespace(
            _settings=settings,
            _logger=logging.getLogger('test.plan_phase_max_tokens'),
            _provider_orchestrator=_Orchestrator(),
            _build_history_messages=lambda session_context: [],
            _execute_context_tool=lambda *args, **kwargs: {},
            _rule_based_chat_response=lambda message, intent: 'fallback',
        )
        planner._captured = captured  # type: ignore[attr-defined]
        return planner

    def _run_plan_node(self, planner, overview_summary: str | None = None) -> None:
        from app.core.llm.planning.planner_execution_flow import generate_plan_proposal

        state = {
            'user_message': 'plan a travel app',
            'system_prompt': '<system>',
            'session_context': {
                'roadmap_id': 'rm-1',
                'roadmap_overview_summary': overview_summary,
            },
        }
        generate_plan_proposal(planner, state)

    def test_empty_roadmap_plan_call_receives_max_tokens_override(self) -> None:
        planner = self._stub_planner(plan_max_tokens=4000)
        # Overview summary that triggers the empty-roadmap fast path.
        self._run_plan_node(
            planner,
            overview_summary='Roadmap: "X" — 0 epics · 0 features · 0 tasks',
        )
        kwargs = planner._captured['answer_with_tools_kwargs']
        self.assertEqual(kwargs.get('max_tokens'), 4000)
        # Fast path: no discovery tools exposed.
        self.assertEqual(kwargs.get('tools'), [])
        self.assertEqual(kwargs.get('max_tool_turns'), 1)

    def test_plan_with_existing_roadmap_still_gets_max_tokens_override(self) -> None:
        planner = self._stub_planner(plan_max_tokens=4000)
        # Non-empty roadmap → discovery tools exposed; still needs headroom.
        self._run_plan_node(
            planner,
            overview_summary='Roadmap: "X" — 3 epics · 7 features · 12 tasks',
        )
        kwargs = planner._captured['answer_with_tools_kwargs']
        self.assertEqual(kwargs.get('max_tokens'), 4000)
        self.assertTrue(len(kwargs.get('tools', [])) > 0)

    def test_max_tokens_none_passes_through(self) -> None:
        # When the operator explicitly unsets the plan budget (env=''), the
        # node passes None so the adapter falls back to the provider default.
        planner = self._stub_planner(plan_max_tokens=None)
        self._run_plan_node(
            planner,
            overview_summary='Roadmap: "X" — 0 epics · 0 features · 0 tasks',
        )
        kwargs = planner._captured['answer_with_tools_kwargs']
        self.assertIsNone(kwargs.get('max_tokens'))


if __name__ == '__main__':
    unittest.main()
