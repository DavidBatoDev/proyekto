import unittest
from types import SimpleNamespace

from app.core.contracts.sessions import AgentSession, PendingEditContext
from app.core.orchestration.planning_orchestrator import _build_edit_clarifier_card


def _planning(
    *,
    clarifier_action: str | None,
    clarifier_options: list[str] | None,
    clarifier_reason: str | None = None,
    clarifier_question: str | None = None,
    tool_observations: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        clarifier_action=clarifier_action,
        clarifier_options=clarifier_options,
        clarifier_reason=clarifier_reason,
        clarifier_question=clarifier_question,
        tool_observations=tool_observations,
    )


def _session_with_pending_edit() -> AgentSession:
    session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
    session.metadata.pending_edit_context = PendingEditContext(
        intent_family='rename_node',
        source_user_message='rename the payments feature',
        awaiting_field='target_label',
    )
    return session


class BuildEditClarifierCardTests(unittest.TestCase):
    def test_non_ask_clarifier_returns_none(self) -> None:
        session = _session_with_pending_edit()
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='propose_safe_default',
                clarifier_options=['a', 'b'],
            ),
            session=session,
            assistant_message='Use default A',
        )
        self.assertIsNone(card)

    def test_empty_options_with_allow_custom_still_produces_card(self) -> None:
        # Empty options + allow_custom=True is a valid card: user gets a
        # "just type your answer" UI with no radio choices. This covers the
        # rename_title / free-form field case where the planner can't
        # pre-populate options.
        session = _session_with_pending_edit()
        session.metadata.pending_edit_context.awaiting_field = 'rename_title'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[],
                clarifier_reason='missing_field',
            ),
            session=session,
            assistant_message='Which title would you like?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card['options'], [])
        self.assertTrue(card['allow_custom'])

    def test_empty_options_with_no_custom_returns_none(self) -> None:
        # No options + no custom input = nothing for user to do, skip the card.
        session = _session_with_pending_edit()
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[],
                clarifier_reason='pending_rename_target_ambiguous',
            ),
            session=session,
            assistant_message='Which one?',
        )
        self.assertIsNone(card)

    def test_ambiguous_target_disables_custom_input(self) -> None:
        session = _session_with_pending_edit()
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=['Feature A', 'Feature B', 'Feature C'],
                clarifier_reason='pending_rename_target_ambiguous',
            ),
            session=session,
            assistant_message='Which feature did you mean?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card['lane'], 'edit')
        self.assertEqual(card['options'], ['Feature A', 'Feature B', 'Feature C'])
        self.assertFalse(card['allow_custom'])
        self.assertEqual(card['reason'], 'pending_rename_target_ambiguous')
        # Question_id stamped on session for next-turn validation.
        pending = session.metadata.pending_edit_context
        assert pending is not None
        self.assertEqual(pending.pending_clarifier_question_id, card['question_id'])

    def test_rename_title_allows_custom_input(self) -> None:
        session = _session_with_pending_edit()
        session.metadata.pending_edit_context.awaiting_field = 'rename_title'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=['Welcome flow', 'Onboarding'],
                clarifier_reason='missing_field',
            ),
            session=session,
            assistant_message='What should the new title be?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertTrue(card['allow_custom'])

    def test_question_prefers_explicit_clarifier_question_over_assistant_message(self) -> None:
        session = _session_with_pending_edit()
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=['A', 'B'],
                clarifier_reason='missing_field',
                clarifier_question='Which one specifically?',
            ),
            session=session,
            assistant_message='I need more info to proceed — '
                              'please choose one of the options below.',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card['question'], 'Which one specifically?')

    def test_question_falls_back_to_assistant_message(self) -> None:
        session = _session_with_pending_edit()
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=['A', 'B'],
                clarifier_reason='missing_field',
                clarifier_question=None,
            ),
            session=session,
            assistant_message='Which feature did you mean?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card['question'], 'Which feature did you mean?')

class OptionSanitizationTests(unittest.TestCase):
    """Regression: options from `build_clarifier_contract` come prefixed with
    `[<slug>_<hash>] ` — the card should strip those so users see clean labels.
    And when the reason is a generic template but the field needs free-form
    input (rename_title), the template options should be dropped entirely.
    """

    def test_prefixed_options_are_stripped(self) -> None:
        session = _session_with_pending_edit()
        # awaiting_field defaults to 'target_label' here, which is NOT in the
        # free-form set — template options should survive, just cleaned.
        session.metadata.pending_edit_context.awaiting_field = 'target_label'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[
                    '[pending_rename_target_ambiguous_feature_a_abc123] Feature A',
                    '[pending_rename_target_ambiguous_feature_b_def456] Feature B',
                    '[pending_rename_target_ambiguous_cancel_fffaaaa1] Cancel',
                ],
                clarifier_reason='pending_rename_target_ambiguous',
            ),
            session=session,
            assistant_message='Which feature did you mean?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(card['options'], ['Feature A', 'Feature B', 'Cancel'])
        # ambiguous-target reason → no custom input
        self.assertFalse(card['allow_custom'])

    def test_llm_clarifier_options_pass_through_for_rename_title(self) -> None:
        """User asked 'rename last epic to something better'. Planner resolved
        the target (awaiting_field=rename_title) and the LLM supplied 3
        concrete title candidates via the tool call's `clarifier_options`.
        The card must surface them verbatim — no server-side filtering by
        reason/awaiting_field. The old hardcoded fallback triple
        ('Confirm the exact target label' etc.) no longer exists in the
        agent, so the filter that used to strip it was removed too.
        """
        session = _session_with_pending_edit()
        session.metadata.pending_edit_context.awaiting_field = 'rename_title'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[
                    '[discovery_unresolved_option_1_abc] Career Portfolio & Networking',
                    '[discovery_unresolved_option_2_def] Interview Prep & Job Placement',
                    '[discovery_unresolved_option_3_ghi] Job Search & Interview Skills',
                ],
                clarifier_reason='discovery_unresolved',
            ),
            session=session,
            assistant_message="What new title would you like for 'Job readiness & interview prep'?",
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(
            card['options'],
            [
                'Career Portfolio & Networking',
                'Interview Prep & Job Placement',
                'Job Search & Interview Skills',
            ],
        )
        self.assertTrue(card['allow_custom'])
        self.assertEqual(card['reason'], 'discovery_unresolved')

    def test_provider_outage_options_survive_rename_title(self) -> None:
        """Regression: a provider_outage clarifier after a rename_title
        turn should keep its Retry/Narrow/Cancel options — those are flow
        control, not field suggestions. Dropping them left users with just
        "Other..." and nowhere to click Retry (see logs.txt 01:25 AM).
        """
        session = _session_with_pending_edit()
        session.metadata.pending_edit_context.awaiting_field = 'rename_title'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[
                    '[provider_outage_retry_abc123] Retry',
                    '[provider_outage_narrow_def456] Narrow to one target',
                    '[provider_outage_cancel_fffaaaa1] Cancel',
                ],
                clarifier_reason='provider_outage',
            ),
            session=session,
            assistant_message='The planner provider had a temporary issue.',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(
            card['options'],
            ['Retry', 'Narrow to one target', 'Cancel'],
        )

    def test_generic_template_options_kept_when_awaiting_target(self) -> None:
        # Same generic-template reason, but this time the field is target_label
        # — the options "Confirm target" / "Provide exact name" actually do
        # map to the target-picking flow. Keep them (cleaned).
        session = _session_with_pending_edit()
        session.metadata.pending_edit_context.awaiting_field = 'target_label'
        card = _build_edit_clarifier_card(
            planning=_planning(
                clarifier_action='ask_clarifier',
                clarifier_options=[
                    '[discovery_unresolved_confirm_target_abc123] Confirm the exact target label',
                    '[discovery_unresolved_provide_name_def456] Provide the exact name',
                    '[discovery_unresolved_cancel_fffaaaa1] Cancel',
                ],
                clarifier_reason='discovery_unresolved',
            ),
            session=session,
            assistant_message='Which target did you mean?',
        )
        self.assertIsNotNone(card)
        assert card is not None
        self.assertEqual(
            card['options'],
            [
                'Confirm the exact target label',
                'Provide the exact name',
                'Cancel',
            ],
        )


class ParsePlanToolClarifierOptionsTests(unittest.TestCase):
    """Regression for the tool-schema clarifier_options parser."""

    def test_parses_list_of_strings(self) -> None:
        from app.core.tools.registry import parse_plan_tool_clarifier_options

        args = {
            'assistant_message': 'Which new title?',
            'operations': [],
            'clarifier_options': [
                'Career readiness & placement',
                'Interview prep & portfolio',
                'Landing your first dev job',
            ],
        }
        self.assertEqual(
            parse_plan_tool_clarifier_options(args),
            [
                'Career readiness & placement',
                'Interview prep & portfolio',
                'Landing your first dev job',
            ],
        )

    def test_missing_field_returns_empty(self) -> None:
        from app.core.tools.registry import parse_plan_tool_clarifier_options

        self.assertEqual(
            parse_plan_tool_clarifier_options({'assistant_message': 'x', 'operations': []}),
            [],
        )

    def test_trims_whitespace_and_dedups(self) -> None:
        from app.core.tools.registry import parse_plan_tool_clarifier_options

        args = {
            'clarifier_options': ['  A  ', 'B', 'A', '  ', 123, 'C'],
        }
        self.assertEqual(parse_plan_tool_clarifier_options(args), ['A', 'B', 'C'])

    def test_caps_at_five_entries(self) -> None:
        from app.core.tools.registry import parse_plan_tool_clarifier_options

        args = {'clarifier_options': [f'Opt {i}' for i in range(10)]}
        self.assertEqual(
            parse_plan_tool_clarifier_options(args),
            ['Opt 0', 'Opt 1', 'Opt 2', 'Opt 3', 'Opt 4'],
        )

    def test_malformed_shape_returns_empty(self) -> None:
        from app.core.tools.registry import parse_plan_tool_clarifier_options

        self.assertEqual(parse_plan_tool_clarifier_options('not a dict'), [])
        self.assertEqual(parse_plan_tool_clarifier_options({'clarifier_options': 'str'}), [])
        self.assertEqual(parse_plan_tool_clarifier_options({'clarifier_options': {'a': 'b'}}), [])


class PlanningToolSchemaContainsClarifierOptionsTests(unittest.TestCase):
    def test_schema_declares_clarifier_options_field(self) -> None:
        from app.core.tools.registry import get_planning_tool

        schema = get_planning_tool()
        params = schema['function']['parameters']
        self.assertIn('clarifier_options', params['properties'])
        cls_opts = params['properties']['clarifier_options']
        self.assertEqual(cls_opts['type'], 'array')
        self.assertEqual(cls_opts['maxItems'], 5)
        # Not required — it's optional, only used when operations=[].
        self.assertNotIn('clarifier_options', params.get('required', []))


if __name__ == '__main__':
    unittest.main()
