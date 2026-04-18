import logging
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.contracts.sessions import AgentSession, PendingPlan
from app.core.orchestration.planning.planning_pre_dispatcher import (
    _compose_plan_confirmation_prompt,
    dispatch_pre_planning_phase,
)


def _plan(**overrides) -> PendingPlan:
    payload = {
        'summary': 'Ship a travel booking MVP',
        'goal': 'Plan a travel booking app',
        'source_user_message': 'plan the thing',
        'proposed_hierarchy': [
            {
                'title': 'Search',
                'features': [
                    {
                        'title': 'Flight search',
                        'tasks': [{'title': 'Airport typeahead'}],
                    }
                ],
            }
        ],
        'next_steps': ['review with design'],
        'base_revision': 3,
        'roadmap_overview_hash': None,
    }
    payload.update(overrides)
    return PendingPlan(**payload)


def _settings(**overrides) -> SimpleNamespace:
    base = dict(
        agent_plan_proposal_enabled=True,
        agent_log_include_content=False,
        agent_log_json=False,
        agent_progress_events_enabled=False,
        agent_progress_events_allow_verbose=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _build_service_double(
    *,
    edit_continuation_trigger: str | None,
    plan_flag_enabled: bool = True,
) -> MagicMock:
    """Mock AgentService with the handful of methods the pre-dispatcher calls.

    Returning False from deictic + no staged_operations keeps the default
    force-continuation logic inert; the plan-confirmation branch is what we
    want to exercise.
    """
    service = MagicMock()
    service._settings = _settings(agent_plan_proposal_enabled=plan_flag_enabled)
    service._logger = logging.getLogger('test.plan_confirm_bridge')
    service._detect_pending_edit_followup_kind.return_value = None
    service._detect_edit_continuation_trigger.return_value = edit_continuation_trigger
    service._looks_like_deictic_parent_reference.return_value = False
    service._get_recent_resolved_targets.return_value = []
    service._resolve_deictic_parent_reference.return_value = None
    service._should_fetch_actor_context.return_value = (False, 'simple_edit')
    # _build_session_context is called twice — return a fresh dict each time.
    service._build_session_context.side_effect = lambda *a, **kw: {
        'roadmap_id': 'roadmap-1',
        'recent_resolved_targets': [],
    }
    service._planner.preview_intent_classification.return_value = (
        'confirm_action',
        False,
    )
    return service


class ComposePlanConfirmationPromptTests(unittest.TestCase):
    def test_prompt_includes_plan_hierarchy_and_original_user_message(self) -> None:
        plan = _plan()
        prompt = _compose_plan_confirmation_prompt(
            original_user_message='yes, apply it',
            pending_plan=plan,
        )
        self.assertIn('Plan summary: Ship a travel booking MVP', prompt)
        self.assertIn('Goal: Plan a travel booking app', prompt)
        self.assertIn('Epic "Search"', prompt)
        self.assertIn('Feature "Flight search"', prompt)
        self.assertIn('Task "Airport typeahead"', prompt)
        self.assertIn('yes, apply it', prompt)
        # The synthesized prompt must tell the edit planner to stage ops
        # without asking again.
        self.assertIn('Do not ask for further confirmation', prompt)


class PlanConfirmBridgeTests(unittest.TestCase):
    def _session_with_plan(
        self, *, base_revision: int = 3, plan: PendingPlan | None = None
    ) -> AgentSession:
        session = AgentSession(roadmap_id='roadmap-1', base_revision=base_revision)
        session.metadata.pending_plan = plan or _plan(base_revision=base_revision)
        return session

    def test_retry_with_pending_plan_fires_confirm_bridge(self) -> None:
        """Regression: user's previous confirm crashed mid-apply; they send
        "Try again" to re-run it. The retry heuristic detects trigger='retry'
        but the original code required `has_staged_operations` for force-edit.
        With a pending plan present, retry should replay the confirm bridge.
        """
        session = self._session_with_plan()
        service = _build_service_double(edit_continuation_trigger='retry')
        # Classifier might see "Try again" as roadmap_query; bridge should
        # still fire because the retry heuristic + pending_plan is enough.
        service._planner.preview_intent_classification.return_value = (
            'roadmap_query',
            True,
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='Try again',
            auth_header=None,
            trace_id='trace-retry-with-plan',
            staged_operations=[],
            phase_timings={},
        )
        self.assertTrue(result.session_context.get('force_edit_continuation'))
        self.assertEqual(
            result.session_context.get('force_edit_continuation_reason'),
            'pending_plan_confirm',
        )
        self.assertIn('Plan summary: Ship a travel booking MVP', result.planning_user_message)

    def test_confirm_via_classifier_forces_bridge_when_heuristic_misses(self) -> None:
        """Regression: the heuristic regex misses phrasing like "Yes, apply
        this plan." because `fullmatch` doesn't accept the trailing "plan"
        token. The classifier later returns `confirm_action`; we rely on the
        post-classification pass to fire the plan-confirm bridge anyway.
        """
        session = self._session_with_plan()
        service = _build_service_double(edit_continuation_trigger=None)
        # Classifier returns confirm_action.
        service._planner.preview_intent_classification.return_value = (
            'confirm_action',
            False,
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='Yes, apply this plan.',
            auth_header=None,
            trace_id='trace-classifier-confirm',
            staged_operations=[],
            phase_timings={},
        )
        self.assertTrue(result.session_context.get('force_edit_continuation'))
        self.assertEqual(
            result.session_context.get('force_edit_continuation_reason'),
            'pending_plan_confirm',
        )
        # Synthesized prompt must include the plan summary (bridge fired).
        self.assertIn('Plan summary: Ship a travel booking MVP', result.planning_user_message)

    def test_confirm_with_fresh_plan_forces_edit_continuation_and_synthesizes_prompt(
        self,
    ) -> None:
        session = self._session_with_plan()
        service = _build_service_double(edit_continuation_trigger='confirm')
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='yes, apply this plan',
            auth_header=None,
            trace_id='trace-1',
            staged_operations=[],
            phase_timings={},
        )
        self.assertTrue(result.session_context.get('force_edit_continuation'))
        self.assertEqual(
            result.session_context.get('force_edit_continuation_reason'),
            'pending_plan_confirm',
        )
        self.assertIn('Plan summary: Ship a travel booking MVP', result.planning_user_message)
        self.assertIn('yes, apply this plan', result.planning_user_message)
        # Plan is still there — clearing happens on successful commit, not on
        # the confirm dispatch itself.
        self.assertIsNotNone(session.metadata.pending_plan)

    def test_confirm_with_stale_plan_clears_plan_and_does_not_force(self) -> None:
        # Plan was recorded at base_revision=3, session has advanced to 9.
        session = self._session_with_plan(base_revision=9, plan=_plan(base_revision=3))
        service = _build_service_double(edit_continuation_trigger='confirm')
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='yes',
            auth_header=None,
            trace_id='trace-stale',
            staged_operations=[],
            phase_timings={},
        )
        self.assertFalse(result.session_context.get('force_edit_continuation'))
        self.assertIsNone(session.metadata.pending_plan)
        # Original user message is preserved (no synthesis) since the confirm
        # bridge was declined.
        self.assertEqual(result.planning_user_message, 'yes')

    def test_cancel_with_pending_plan_clears_plan(self) -> None:
        session = self._session_with_plan()
        service = _build_service_double(edit_continuation_trigger='cancel')
        dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='nevermind',
            auth_header=None,
            trace_id='trace-cancel',
            staged_operations=[],
            phase_timings={},
        )
        self.assertIsNone(session.metadata.pending_plan)

    def test_flag_off_disables_plan_confirm_bridge_even_with_pending_plan(self) -> None:
        session = self._session_with_plan()
        service = _build_service_double(
            edit_continuation_trigger='confirm',
            plan_flag_enabled=False,
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message='yes',
            auth_header=None,
            trace_id='trace-off',
            staged_operations=[],
            phase_timings={},
        )
        # Flag off: do not synthesize the plan prompt, do not force continuation
        # based on the plan. Plan still lives on the session (operator cleanup
        # is documented as the flag-toggle escape hatch).
        self.assertEqual(result.planning_user_message, 'yes')
        self.assertIsNotNone(session.metadata.pending_plan)


class PlanAnswerSentinelTests(unittest.TestCase):
    """The pre-dispatcher parses a `__plan_answers__\\n{json}` sentinel to
    route plan-mode answer submissions back into the plan lane instead of
    letting them hit the intent classifier as generic text.
    """

    def _session_with_pending_question(self) -> AgentSession:
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        from app.core.contracts.sessions import PendingPlanQuestion

        session.metadata.pending_plan = PendingPlan(
            summary='',
            goal='',
            source_user_message='Plan the travel app',
            status='awaiting_answers',
            current_questions=[PendingPlanQuestion(
                id='scope',
                question='MVP only, MVP + 2 phases, or full roadmap?',
                options=['MVP only', 'MVP + 2 phases', 'Full roadmap'],
                allow_custom=True,
            )],
            base_revision=3,
        )
        return session

    def test_sentinel_triggers_replay_prompt_and_appends_answer(self) -> None:
        session = self._session_with_pending_question()
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__plan_answers__\n'
            '{"question_id": "scope", "selected_option": "MVP only"}'
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id='trace-answer-1',
            staged_operations=[],
            phase_timings={'phase': 'test'},
        )
        plan = session.metadata.pending_plan
        self.assertIsNotNone(plan)
        assert plan is not None
        # Answer was appended.
        self.assertEqual(len(plan.answers), 1)
        self.assertEqual(plan.answers[0].question_id, 'scope')
        self.assertEqual(plan.answers[0].selected_option, 'MVP only')
        # Pre-dispatcher replaced the sentinel with a replay prompt.
        self.assertNotIn('__plan_answers__', result.planning_user_message)
        self.assertIn('Plan the travel app', result.planning_user_message)
        self.assertIn('MVP only', result.planning_user_message)
        # Preview intent forced back to plan lane, not classifier-derived.
        self.assertEqual(result.preview_intent, 'roadmap_plan')

    def test_sentinel_with_custom_answer_is_captured(self) -> None:
        session = self._session_with_pending_question()
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__plan_answers__\n'
            '{"question_id": "scope", "custom_answer": "MVP + internal beta"}'
        )
        dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        plan = session.metadata.pending_plan
        assert plan is not None
        self.assertEqual(plan.answers[0].custom_answer, 'MVP + internal beta')
        self.assertIsNone(plan.answers[0].selected_option)

    def test_sentinel_without_pending_awaiting_plan_is_dropped(self) -> None:
        # Session has no pending plan → sentinel recognized but ignored.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__plan_answers__\n{"question_id": "x", "selected_option": "y"}'
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        # Falls through to normal classification.
        self.assertEqual(result.planning_user_message, sentinel_message)
        self.assertIsNone(session.metadata.pending_plan)

    def test_malformed_sentinel_body_is_not_mistreated_as_answer(self) -> None:
        session = self._session_with_pending_question()
        service = _build_service_double(edit_continuation_trigger=None)
        # Not valid JSON → parser returns None → treated as plain message.
        sentinel_message = '__plan_answers__\nnot json at all'
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        # No answer appended, plan unchanged.
        plan = session.metadata.pending_plan
        assert plan is not None
        self.assertEqual(len(plan.answers), 0)
        self.assertEqual(result.planning_user_message, sentinel_message)


class EditClarifierAnswerSentinelTests(unittest.TestCase):
    """Generic `__clarifier_answer__` sentinel with lane='edit' routes the
    user's answer into PendingEditContext and forces the edit continuation.
    """

    def _session_with_edit_clarifier(
        self,
        *,
        question_id: str = 'qid-1',
        awaiting_field: str = 'target_label',
    ) -> AgentSession:
        from app.core.contracts.sessions import PendingEditContext

        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        session.metadata.pending_edit_context = PendingEditContext(
            intent_family='rename_node',
            source_user_message='rename the payments feature',
            awaiting_field=awaiting_field,
            pending_clarifier_question_id=question_id,
        )
        return session

    def test_selected_option_writes_to_target_hint(self) -> None:
        session = self._session_with_edit_clarifier(awaiting_field='target_label')
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__clarifier_answer__\n'
            '{"lane": "edit", "question_id": "qid-1", '
            '"selected_option": "Payments — Stripe"}'
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id='trace-edit-clarifier-1',
            staged_operations=[],
            phase_timings={},
        )
        pending = session.metadata.pending_edit_context
        self.assertIsNotNone(pending)
        assert pending is not None
        self.assertEqual(pending.target_hint, 'Payments — Stripe')
        self.assertIsNone(pending.pending_clarifier_question_id)
        # Replay prompt carries the original request + the picked answer.
        self.assertIn('Original request: rename the payments feature', result.planning_user_message)
        self.assertIn('Payments — Stripe', result.planning_user_message)
        # Force edit continuation engaged.
        self.assertTrue(result.session_context.get('force_edit_continuation'))
        self.assertEqual(
            result.session_context.get('force_edit_continuation_reason'),
            'edit_clarifier_answer',
        )

    def test_custom_answer_writes_to_default_title_for_rename(self) -> None:
        session = self._session_with_edit_clarifier(awaiting_field='rename_title')
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__clarifier_answer__\n'
            '{"lane": "edit", "question_id": "qid-1", '
            '"custom_answer": "Checkout"}'
        )
        dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        pending = session.metadata.pending_edit_context
        assert pending is not None
        self.assertEqual(pending.default_title, 'Checkout')

    def test_mismatched_question_id_drops_answer(self) -> None:
        session = self._session_with_edit_clarifier(question_id='qid-correct')
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__clarifier_answer__\n'
            '{"lane": "edit", "question_id": "qid-different", '
            '"selected_option": "A"}'
        )
        result = dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        pending = session.metadata.pending_edit_context
        assert pending is not None
        # Nothing was written.
        self.assertIsNone(pending.target_hint)
        self.assertIsNone(pending.default_title)
        # Still has its own question_id (untouched).
        self.assertEqual(pending.pending_clarifier_question_id, 'qid-correct')
        # No force continuation triggered.
        self.assertFalse(result.session_context.get('force_edit_continuation'))

    def test_replay_prompt_reverts_to_pre_bandaid_shape(self) -> None:
        """Prior tool calls now ride on session.messages as structured
        AIMessage(tool_calls=...) + ToolMessage pairs replayed via
        _build_history_messages. The replay prompt no longer injects any
        user-role "Context from the prior turn" hint — that block is gone.
        """
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            _compose_edit_clarifier_replay_prompt,
        )

        session = self._session_with_edit_clarifier(awaiting_field='rename_title')
        pending = session.metadata.pending_edit_context
        assert pending is not None
        prompt = _compose_edit_clarifier_replay_prompt(
            pending=pending,
            user_answer_value='Interview Prep & Career Materials',
        )
        self.assertNotIn('already done', prompt)
        self.assertNotIn('Context from the prior turn', prompt)
        self.assertTrue(prompt.startswith('Continuing the edit clarifier.'))
        self.assertIn('Original request: rename the payments feature', prompt)
        self.assertIn('Interview Prep & Career Materials', prompt)

    def test_lane_plan_still_routes_through_plan_ingest(self) -> None:
        # Sanity: the generic sentinel with lane='plan' should still feed
        # the plan answers path (so we don't regress plan-mode behaviour
        # when the web migrates from __plan_answers__ to __clarifier_answer__).
        from app.core.contracts.sessions import PendingPlanQuestion

        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        session.metadata.pending_plan = PendingPlan(
            summary='',
            goal='',
            source_user_message='Plan the app',
            status='awaiting_answers',
            current_questions=[PendingPlanQuestion(
                id='plan-q1',
                question='MVP or full?',
                options=['MVP', 'Full'],
                allow_custom=True,
            )],
            base_revision=3,
        )
        service = _build_service_double(edit_continuation_trigger=None)
        sentinel_message = (
            '__clarifier_answer__\n'
            '{"lane": "plan", "question_id": "plan-q1", '
            '"selected_option": "MVP"}'
        )
        dispatch_pre_planning_phase(
            service=service,
            session=session,
            user_message=sentinel_message,
            auth_header=None,
            trace_id=None,
            staged_operations=[],
            phase_timings={},
        )
        plan = session.metadata.pending_plan
        assert plan is not None
        self.assertEqual(len(plan.answers), 1)
        self.assertEqual(plan.answers[0].selected_option, 'MVP')


if __name__ == '__main__':
    unittest.main()
