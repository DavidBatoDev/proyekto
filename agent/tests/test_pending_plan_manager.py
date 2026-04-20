import logging
import unittest

from app.core.contracts.sessions import AgentSession, PendingPlan
from app.core.orchestration.context.pending_plan_manager import (
    clear_pending_plan,
    format_pending_plan_section,
    is_plan_stale,
    record_pending_plan_from_planner_output,
)


def _session(
    *,
    base_revision: int | None = 3,
    overview: str | None = 'Roadmap "X" — 2 epics, 5 features, 12 tasks',
) -> AgentSession:
    session = AgentSession(roadmap_id='roadmap-1', base_revision=base_revision)
    session.metadata.roadmap_overview_summary = overview
    return session


def _valid_payload() -> dict:
    return {
        'summary': 'Ship a travel booking MVP in three epics',
        'goal': 'Plan a travel booking app (flights, hotels, packages)',
        'rationale': 'Split into Search, Booking, Post-booking for clarity.',
        'proposed_hierarchy': [
            {
                'title': 'Search',
                'features': [
                    {
                        'title': 'Flight search',
                        'tasks': [{'title': 'Airport typeahead'}],
                    }
                ],
            },
            {'title': 'Booking'},
        ],
        'risks': ['Payment compliance'],
        'next_steps': ['Review with design'],
        'user_message': 'Plan a travel booking app',
    }


class RecordPendingPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager')

    def test_valid_payload_is_persisted_with_base_revision_and_hash(self) -> None:
        session = _session(base_revision=7, overview='Roadmap overview prose')
        plan = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='Plan a travel booking app',
            trace_id='trace-1',
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None  # for type narrowing
        self.assertIs(session.metadata.pending_plan, plan)
        self.assertEqual(plan.status, 'proposed')
        self.assertEqual(plan.base_revision, 7)
        self.assertIsNotNone(plan.roadmap_overview_hash)
        self.assertEqual(plan.source_user_message, 'Plan a travel booking app')
        # Nested hierarchy round-trips.
        self.assertEqual(len(plan.proposed_hierarchy), 2)
        self.assertEqual(plan.proposed_hierarchy[0].title, 'Search')
        self.assertEqual(plan.proposed_hierarchy[0].features[0].title, 'Flight search')
        self.assertEqual(
            plan.proposed_hierarchy[0].features[0].tasks[0].title,
            'Airport typeahead',
        )

    def test_missing_payload_is_skipped_and_returns_none(self) -> None:
        session = _session()
        plan = record_pending_plan_from_planner_output(
            session,
            payload=None,
            user_message='hi',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNone(plan)
        self.assertIsNone(session.metadata.pending_plan)

    def test_invalid_payload_returns_none_and_leaves_session_untouched(self) -> None:
        session = _session()
        bad_payload = {'proposed_hierarchy': 'not-a-list'}
        plan = record_pending_plan_from_planner_output(
            session,
            payload=bad_payload,
            user_message='bad request',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNone(plan)
        self.assertIsNone(session.metadata.pending_plan)

    def test_unknown_keys_are_tolerated(self) -> None:
        session = _session()
        payload = _valid_payload()
        payload['future_field_the_model_invented'] = 'ignore me'
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='hi',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)

    def test_planning_turn_id_is_stamped_when_provided(self) -> None:
        session = _session()
        plan = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='hi',
            trace_id=None,
            logger=self._logger,
            settings=None,
            planning_turn_id='msg-123',
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.planning_turn_id, 'msg-123')


class ClearPendingPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager')

    def test_clear_removes_plan_and_returns_true(self) -> None:
        session = _session()
        record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='hi',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(session.metadata.pending_plan)
        cleared = clear_pending_plan(
            session,
            reason='user_cancel',
            logger=self._logger,
            settings=None,
        )
        self.assertTrue(cleared)
        self.assertIsNone(session.metadata.pending_plan)

    def test_clear_noop_when_no_plan_exists(self) -> None:
        session = _session()
        cleared = clear_pending_plan(
            session,
            reason='any',
            logger=self._logger,
            settings=None,
        )
        self.assertFalse(cleared)


class StalenessTests(unittest.TestCase):
    def _plan(self, **overrides) -> PendingPlan:
        payload = {
            'summary': 's',
            'goal': 'g',
            'proposed_hierarchy': [],
            'source_user_message': 'u',
            'base_revision': 5,
            'roadmap_overview_hash': 'abc123',
        }
        payload.update(overrides)
        return PendingPlan(**payload)

    def test_plan_is_fresh_when_revision_and_hash_match(self) -> None:
        session = AgentSession(roadmap_id='r', base_revision=5)
        session.metadata.roadmap_overview_summary = 'stable overview'
        plan = self._plan(
            base_revision=5,
            roadmap_overview_hash=None,  # compare only on revision then
        )
        self.assertFalse(is_plan_stale(session, plan))

    def test_plan_is_stale_when_base_revision_moved(self) -> None:
        session = AgentSession(roadmap_id='r', base_revision=9)
        plan = self._plan(base_revision=5, roadmap_overview_hash=None)
        self.assertTrue(is_plan_stale(session, plan))

    def test_plan_is_stale_when_overview_hash_differs(self) -> None:
        session = AgentSession(roadmap_id='r', base_revision=5)
        session.metadata.roadmap_overview_summary = 'different overview now'
        plan = self._plan(base_revision=5, roadmap_overview_hash='abc123')
        self.assertTrue(is_plan_stale(session, plan))


class FormatPlanSectionTests(unittest.TestCase):
    def test_returns_none_when_plan_is_none(self) -> None:
        self.assertIsNone(format_pending_plan_section(None))

    def test_returns_none_when_plan_not_proposed(self) -> None:
        plan = PendingPlan(
            summary='s', goal='g', source_user_message='u', status='confirmed'
        )
        self.assertIsNone(format_pending_plan_section(plan))

    def test_renders_epic_feature_task_tree(self) -> None:
        plan = PendingPlan(
            summary='Ship MVP',
            goal='Do the thing',
            rationale='Because',
            source_user_message='u',
            proposed_hierarchy=[
                {
                    'title': 'Search',
                    'features': [
                        {
                            'title': 'Flight search',
                            'target_epic_title': None,
                            'tasks': [{'title': 'Airport typeahead'}],
                        }
                    ],
                }
            ],
            risks=['payment compliance'],
        )
        rendered = format_pending_plan_section(plan)
        self.assertIsNotNone(rendered)
        assert rendered is not None
        self.assertIn('Ship MVP', rendered)
        self.assertIn('Epic "Search"', rendered)
        self.assertIn('Feature "Flight search"', rendered)
        self.assertIn('Task "Airport typeahead"', rendered)
        self.assertIn('payment compliance', rendered)


class RecordNeedsAnswerEnvelopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager.needs_answer')

    def _envelope(self) -> dict:
        return {
            'status': 'needs_answer',
            'question': {
                'id': 'scope',
                'question': 'MVP only, MVP + 2 phases, or full roadmap?',
                'options': ['MVP only', 'MVP + 2 phases', 'Full roadmap'],
                'allow_custom': True,
            },
        }

    def test_records_question_with_awaiting_answers_status(self) -> None:
        session = _session()
        plan = record_pending_plan_from_planner_output(
            session,
            payload=self._envelope(),
            user_message='Plan the travel app',
            trace_id='trace-q1',
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.status, 'awaiting_answers')
        self.assertEqual(len(plan.current_questions), 1)
        self.assertEqual(plan.current_questions[0].id, 'scope')
        self.assertEqual(len(plan.current_questions[0].options), 3)
        self.assertTrue(plan.current_questions[0].allow_custom)
        self.assertEqual(plan.source_user_message, 'Plan the travel app')
        self.assertEqual(len(plan.answers), 0)

    def test_malformed_question_returns_none(self) -> None:
        session = _session()
        bad = {'status': 'needs_answer', 'question': 'a bare string, not a dict'}
        plan = record_pending_plan_from_planner_output(
            session,
            payload=bad,
            user_message='hi',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNone(plan)
        self.assertIsNone(session.metadata.pending_plan)

    def test_second_needs_answer_preserves_accumulated_answers(self) -> None:
        from app.core.contracts.sessions import PendingPlanAnswer
        from app.core.orchestration.context.pending_plan_manager import append_plan_answer

        session = _session()
        # Turn 1: record the first question.
        record_pending_plan_from_planner_output(
            session,
            payload=self._envelope(),
            user_message='Plan the travel app',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        # User answers — simulate pre-dispatcher's append.
        append_plan_answer(
            session,
            answer=PendingPlanAnswer(
                question_id='scope',
                question_text='scope?',
                selected_option='MVP only',
            ),
            logger=self._logger,
            settings=None,
        )
        self.assertEqual(len(session.metadata.pending_plan.answers), 1)
        # Turn 2: a NEW needs_answer envelope (follow-up question).
        record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'question': {
                    'id': 'payments',
                    'question': 'Which payment flow first?',
                    'options': ['One-click', 'Multi-passenger'],
                    'allow_custom': True,
                },
            },
            user_message='(should be ignored — source_user_message preserved)',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        plan = session.metadata.pending_plan
        self.assertIsNotNone(plan)
        assert plan is not None
        # Original source_user_message preserved.
        self.assertEqual(plan.source_user_message, 'Plan the travel app')
        # Previous answer carried forward.
        self.assertEqual(len(plan.answers), 1)
        self.assertEqual(plan.answers[0].question_id, 'scope')
        # New question set.
        self.assertEqual(len(plan.current_questions), 1)
        self.assertEqual(plan.current_questions[0].id, 'payments')


class MultiQuestionClarifierTests(unittest.TestCase):
    """Multi-question clarifier: 1-4 questions per turn, hard cap 10 total."""

    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager.multi_question')

    def test_questions_plural_list_is_stored(self) -> None:
        session = _session()
        payload = {
            'status': 'needs_answer',
            'questions': [
                {'id': 'scope', 'question': 'MVP?', 'options': ['Yes', 'No'], 'allow_custom': True},
                {'id': 'segment', 'question': 'Consumer or B2B?', 'options': ['Consumer', 'B2B'], 'allow_custom': True},
                {'id': 'flow', 'question': 'Primary flow?', 'options': ['Search', 'Book'], 'allow_custom': True},
            ],
        }
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='Plan the app',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(len(plan.current_questions), 3)
        self.assertEqual([q.id for q in plan.current_questions], ['scope', 'segment', 'flow'])

    def test_legacy_singular_question_is_coerced_to_list(self) -> None:
        session = _session()
        payload = {
            'status': 'needs_answer',
            'question': {'id': 'scope', 'question': 'MVP?', 'options': ['Yes', 'No'], 'allow_custom': True},
        }
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='Plan the app',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(len(plan.current_questions), 1)
        self.assertEqual(plan.current_questions[0].id, 'scope')

    def test_per_turn_batch_truncated_at_four(self) -> None:
        session = _session()
        payload = {
            'status': 'needs_answer',
            'questions': [
                {'id': f'q{i}', 'question': f'Q{i}?', 'options': ['a', 'b'], 'allow_custom': True}
                for i in range(7)
            ],
        }
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='Plan',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(len(plan.current_questions), 4)

    def test_session_cap_of_ten_blocks_overflow(self) -> None:
        from app.core.contracts.sessions import PendingPlanAnswer

        session = _session()
        # Simulate 8 prior answers already stored.
        session.metadata.pending_plan = None
        # First record a small initial batch so answers can accrue.
        record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'questions': [{'id': 'q0', 'question': '?', 'options': ['a', 'b'], 'allow_custom': True}],
            },
            user_message='Plan',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        # Manually seed 8 answers (bypassing append helper for speed).
        session.metadata.pending_plan.answers = [
            PendingPlanAnswer(question_id=f'prior-{i}', selected_option='v')
            for i in range(8)
        ]
        # Now ask 4 more — but cap is 10, so only 2 more are allowed (8 answered + 2 new = 10).
        plan = record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'questions': [
                    {'id': f'new-{i}', 'question': '?', 'options': ['a', 'b'], 'allow_custom': True}
                    for i in range(4)
                ],
            },
            user_message='(preserved)',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        # Only 2 of the 4 new questions accepted (cap = 10 total).
        self.assertEqual(len(plan.current_questions), 2)

    def test_cap_fully_exhausted_returns_none(self) -> None:
        from app.core.contracts.sessions import PendingPlanAnswer

        session = _session()
        record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'questions': [{'id': 'q0', 'question': '?', 'options': ['a', 'b'], 'allow_custom': True}],
            },
            user_message='Plan',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        # Seed exactly 10 answers — no budget left.
        session.metadata.pending_plan.answers = [
            PendingPlanAnswer(question_id=f'prior-{i}', selected_option='v')
            for i in range(10)
        ]
        plan = record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'questions': [{'id': 'overflow', 'question': '?', 'options': ['a'], 'allow_custom': True}],
            },
            user_message='ignored',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        # Record call returned None because cap exhausted.
        self.assertIsNone(plan)
        # Session's prior plan is untouched (cap path doesn't overwrite).
        self.assertEqual(
            session.metadata.pending_plan.current_questions[0].id,
            'q0',
        )


class TerminalEnvelopeRejectionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager.terminal')

    def test_empty_proposed_hierarchy_in_plan_ready_is_rejected(self) -> None:
        session = _session()
        payload = _valid_payload()
        payload['status'] = 'plan_ready'
        payload['proposed_hierarchy'] = []
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='u',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNone(plan)
        self.assertIsNone(session.metadata.pending_plan)

    def test_plan_ready_status_is_normalized_to_proposed(self) -> None:
        session = _session()
        payload = _valid_payload()
        payload['status'] = 'plan_ready'
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='u',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.status, 'proposed')

    def test_plan_ready_after_clarifier_preserves_prior_answers(self) -> None:
        from app.core.contracts.sessions import PendingPlanAnswer
        from app.core.orchestration.context.pending_plan_manager import append_plan_answer

        session = _session()
        # Seed clarifier state.
        record_pending_plan_from_planner_output(
            session,
            payload={
                'status': 'needs_answer',
                'question': {
                    'id': 'scope',
                    'question': '?',
                    'options': ['A', 'B'],
                    'allow_custom': True,
                },
            },
            user_message='plan it',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        append_plan_answer(
            session,
            answer=PendingPlanAnswer(
                question_id='scope',
                question_text='?',
                selected_option='A',
            ),
            logger=self._logger,
            settings=None,
        )
        # Now finalize.
        payload = _valid_payload()
        payload['status'] = 'plan_ready'
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message='plan it',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.status, 'proposed')
        self.assertEqual(len(plan.answers), 1)
        self.assertEqual(plan.answers[0].selected_option, 'A')


class PlanRevisionContinuityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._logger = logging.getLogger('test.pending_plan_manager.revision')

    def _seed_proposed_plan(self, session: AgentSession) -> PendingPlan:
        plan = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='Plan a travel booking app',
            trace_id='trace-revision',
            logger=self._logger,
            settings=None,
        )
        assert plan is not None
        self.assertEqual(plan.revision_count, 0)
        return plan

    def test_plan_revision_preserves_plan_id_and_bumps_revision_count(self) -> None:
        session = _session()
        original = self._seed_proposed_plan(session)

        revised_payload = _valid_payload()
        # Rename an epic to simulate "revise the last epic" instruction.
        revised_payload['proposed_hierarchy'][-1] = {'title': 'Post-booking support'}

        revised = record_pending_plan_from_planner_output(
            session,
            payload=revised_payload,
            user_message='Rename the last epic to Post-booking support',
            trace_id='trace-revision-2',
            logger=self._logger,
            settings=None,
            intent_type='plan_revision',
        )
        self.assertIsNotNone(revised)
        assert revised is not None
        self.assertEqual(revised.plan_id, original.plan_id)
        self.assertEqual(revised.revision_count, 1)
        self.assertEqual(revised.proposed_hierarchy[-1].title, 'Post-booking support')

    def test_plan_revision_bumps_revision_count_monotonically(self) -> None:
        session = _session()
        original = self._seed_proposed_plan(session)
        first_revision = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='revise 1',
            trace_id=None,
            logger=self._logger,
            settings=None,
            intent_type='plan_revision',
        )
        assert first_revision is not None
        second_revision = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='revise 2',
            trace_id=None,
            logger=self._logger,
            settings=None,
            intent_type='plan_revision',
        )
        assert second_revision is not None
        self.assertEqual(first_revision.revision_count, 1)
        self.assertEqual(second_revision.revision_count, 2)
        self.assertEqual(second_revision.plan_id, original.plan_id)

    def test_awaiting_answers_to_proposed_does_not_bump_revision_count(self) -> None:
        """A clarifier finishing is not a revision — preserve plan_id but
        leave revision_count at zero so telemetry does not double-count."""
        session = _session()
        needs_answer_payload = {
            'status': 'needs_answer',
            'questions': [
                {
                    'id': 'scope',
                    'question': 'What scope?',
                    'options': ['A', 'B'],
                }
            ],
        }
        original = record_pending_plan_from_planner_output(
            session,
            payload=needs_answer_payload,
            user_message='Plan a travel booking app',
            trace_id=None,
            logger=self._logger,
            settings=None,
        )
        assert original is not None
        self.assertEqual(original.status, 'awaiting_answers')

        finalized = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='Plan a travel booking app',
            trace_id=None,
            logger=self._logger,
            settings=None,
            intent_type='roadmap_plan',
        )
        assert finalized is not None
        self.assertEqual(finalized.status, 'proposed')
        self.assertEqual(finalized.plan_id, original.plan_id)
        self.assertEqual(finalized.revision_count, 0)

    def test_no_prior_plan_starts_revision_count_at_zero(self) -> None:
        session = _session()
        plan = record_pending_plan_from_planner_output(
            session,
            payload=_valid_payload(),
            user_message='fresh plan',
            trace_id=None,
            logger=self._logger,
            settings=None,
            intent_type='plan_revision',  # user-requested revision, but no prior plan
        )
        assert plan is not None
        self.assertEqual(plan.revision_count, 0)


if __name__ == '__main__':
    unittest.main()
