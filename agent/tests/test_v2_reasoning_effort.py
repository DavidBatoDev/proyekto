"""Per-turn reasoning-effort escalation.

Direct edits/chat run at the configured base effort (``low``); turns that
confirm/revise a proposed plan or resolve a previously-raised ambiguity
escalate to at least ``medium``. A higher configured base is never downgraded,
and ``None`` (reasoning disabled) is respected. Also verifies the client
threads a per-call override into the Responses request.
"""

import unittest
from types import SimpleNamespace

from app.core.contracts.sessions import (
    AgentSession,
    PendingContextResolution,
    PendingPlan,
)
from app.core.v2.brain import (
    _hard_turn_trigger,
    _message_references_ambiguous_title,
    _message_requests_plan,
    _turn_reasoning_effort,
)
from app.core.v2.openai_client import V2LLMClient


def _handle_map(*titles):
    """{handle: {'id':.., 'title':..}} — the shape brain reads for duplicates."""
    return {f'H{i}': {'id': f'id{i}', 'title': t} for i, t in enumerate(titles)}


def _session():
    return AgentSession(roadmap_id='22222222-2222-2222-2222-222222222222')


def _settings(effort):
    return SimpleNamespace(openai_v2_reasoning_effort=effort)


class TurnReasoningEffortTests(unittest.TestCase):
    """trigger → effort mapping."""

    def test_direct_turn_uses_configured_base(self):
        self.assertEqual(_turn_reasoning_effort(_settings('low'), 'none'), 'low')

    def test_every_hard_trigger_escalates_to_medium(self):
        for trigger in (
            'pending_plan',
            'pending_context_resolution',
            'ambiguous_title',
            'plan_request',
        ):
            self.assertEqual(
                _turn_reasoning_effort(_settings('low'), trigger), 'medium', trigger
            )

    def test_minimal_base_also_escalates_on_hard_turn(self):
        self.assertEqual(
            _turn_reasoning_effort(_settings('minimal'), 'ambiguous_title'), 'medium'
        )

    def test_higher_base_is_not_downgraded(self):
        self.assertEqual(_turn_reasoning_effort(_settings('high'), 'pending_plan'), 'high')

    def test_none_base_is_respected(self):
        self.assertIsNone(_turn_reasoning_effort(_settings(None), 'pending_plan'))


class HardTurnTriggerTests(unittest.TestCase):
    """Which signal marks a hard turn (priority: plan > ambiguity-resolution > dup title)."""

    def test_plain_edit_is_none(self):
        self.assertEqual(
            _hard_turn_trigger(
                _session(), user_message='rename the Login feature',
                handle_map=_handle_map('Login'),
            ),
            'none',
        )

    def test_pending_plan_wins(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        self.assertEqual(
            _hard_turn_trigger(session, user_message='x', handle_map={}), 'pending_plan'
        )

    def test_pending_context_resolution(self):
        session = _session()
        session.metadata.pending_context_resolution = PendingContextResolution(
            kind='features_of_epic', resolution_id='r1', label='Auth'
        )
        self.assertEqual(
            _hard_turn_trigger(session, user_message='the first one', handle_map={}),
            'pending_context_resolution',
        )

    def test_ambiguous_title_detected(self):
        self.assertEqual(
            _hard_turn_trigger(
                _session(),
                user_message='rename the feature "Login" to "Auth"',
                handle_map=_handle_map('Login', 'Login', 'Dashboard'),
            ),
            'ambiguous_title',
        )


class PlanRequestTests(unittest.TestCase):
    def test_imperative_draft_opener(self):
        # The exact message that announced-and-stopped at low effort.
        self.assertTrue(
            _message_requests_plan(
                'Draft SaaS for Data Scientists Development starting from '
                'problem requirements, then technological requirements.'
            )
        )

    def test_plan_shaped_verb_and_object(self):
        self.assertTrue(_message_requests_plan('Can you create a roadmap for a mobile app?'))
        self.assertTrue(_message_requests_plan('build me a plan with three milestones'))

    def test_direct_edits_and_questions_do_not_match(self):
        self.assertFalse(_message_requests_plan('Rename the feature "Login" to "Auth".'))
        self.assertFalse(_message_requests_plan('how many epics are there?'))
        self.assertFalse(_message_requests_plan('add a task called Setup under alpha'))
        self.assertFalse(_message_requests_plan(''))

    def test_trigger_returns_plan_request(self):
        self.assertEqual(
            _hard_turn_trigger(
                _session(),
                user_message='Draft a SaaS product roadmap',
                handle_map=_handle_map('Login'),
            ),
            'plan_request',
        )

    def test_pending_plan_still_wins_over_plan_request(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        self.assertEqual(
            _hard_turn_trigger(
                session, user_message='Draft another plan', handle_map={}
            ),
            'pending_plan',
        )


class AmbiguousTitleTests(unittest.TestCase):
    def test_duplicate_title_referenced(self):
        self.assertTrue(
            _message_references_ambiguous_title(
                'rename the feature "Login" to "Auth"', _handle_map('Login', 'Login')
            )
        )

    def test_unique_title_is_not_ambiguous(self):
        self.assertFalse(
            _message_references_ambiguous_title(
                'rename Login to Auth', _handle_map('Login', 'Dashboard')
            )
        )

    def test_duplicate_not_mentioned(self):
        self.assertFalse(
            _message_references_ambiguous_title(
                'add a task to the Dashboard', _handle_map('Login', 'Login', 'Dashboard')
            )
        )

    def test_case_insensitive(self):
        self.assertTrue(
            _message_references_ambiguous_title(
                'please rename LOGIN', _handle_map('Login', 'login')
            )
        )

    def test_word_boundary_avoids_substring(self):
        # 'log' appears twice but must not fire on the substring inside 'catalog'
        self.assertFalse(
            _message_references_ambiguous_title(
                'update the catalog', _handle_map('log', 'log')
            )
        )

    def test_empty_inputs(self):
        self.assertFalse(
            _message_references_ambiguous_title('', _handle_map('Login', 'Login'))
        )
        self.assertFalse(_message_references_ambiguous_title('rename Login', {}))


class _CapturingResponses:
    def __init__(self):
        self.last_kwargs = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        return SimpleNamespace(output=[])


class _CapturingOpenAIClient:
    def __init__(self):
        self.responses = _CapturingResponses()


class ClientReasoningOverrideTests(unittest.TestCase):
    def _client(self, configured):
        settings = SimpleNamespace(
            openai_model_v2='gpt-5.4-mini',
            openai_api_key='sk-test',
            openai_v2_max_output_tokens=None,
            openai_v2_reasoning_effort=configured,
            openai_v2_temperature=None,
        )
        client = V2LLMClient(settings)
        fake = _CapturingOpenAIClient()
        client._client = fake  # skip real SDK init
        return client, fake

    def test_override_wins_over_configured(self):
        client, fake = self._client('low')
        client.complete([], [], reasoning_effort='medium')
        self.assertEqual(fake.responses.last_kwargs['reasoning'], {'effort': 'medium'})

    def test_falls_back_to_configured_when_not_overridden(self):
        client, fake = self._client('low')
        client.complete([], [])
        self.assertEqual(fake.responses.last_kwargs['reasoning'], {'effort': 'low'})

    def test_explicit_none_override_disables_reasoning(self):
        client, fake = self._client('low')
        client.complete([], [], reasoning_effort=None)
        self.assertNotIn('reasoning', fake.responses.last_kwargs)


if __name__ == '__main__':
    unittest.main()
