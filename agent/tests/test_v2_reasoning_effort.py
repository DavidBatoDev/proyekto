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
from app.core.v2.brain import _turn_reasoning_effort
from app.core.v2.openai_client import V2LLMClient


def _session():
    return AgentSession(roadmap_id='22222222-2222-2222-2222-222222222222')


def _settings(effort):
    return SimpleNamespace(openai_v2_reasoning_effort=effort)


class TurnReasoningEffortTests(unittest.TestCase):
    def test_direct_turn_uses_configured_base(self):
        self.assertEqual(_turn_reasoning_effort(_session(), _settings('low')), 'low')

    def test_pending_plan_escalates_to_medium(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='do the thing')
        self.assertEqual(_turn_reasoning_effort(session, _settings('low')), 'medium')

    def test_pending_context_resolution_escalates_to_medium(self):
        session = _session()
        session.metadata.pending_context_resolution = PendingContextResolution(
            kind='features_of_epic',
            resolution_id='r1',
            label='Auth',
        )
        self.assertEqual(_turn_reasoning_effort(session, _settings('low')), 'medium')

    def test_minimal_base_also_escalates_on_hard_turn(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        self.assertEqual(_turn_reasoning_effort(session, _settings('minimal')), 'medium')

    def test_higher_base_is_not_downgraded(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        self.assertEqual(_turn_reasoning_effort(session, _settings('high')), 'high')

    def test_none_base_is_respected(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        self.assertIsNone(_turn_reasoning_effort(session, _settings(None)))


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
