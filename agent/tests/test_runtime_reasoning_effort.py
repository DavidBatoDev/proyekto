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
    PendingPlan,
)
from app.core.contracts.runs import ResolvedRef, RunState
from app.core.runtime.phases.investigate import (
    _hard_turn_trigger,
    _message_references_ambiguous_title,
    _message_requests_plan,
    _turn_reasoning_effort,
    escalated_effort,
)
from app.core.engine.llm_client import LLMClient


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
            'ambiguous_title',
            'plan_request',
            'multi_roadmap_refs',
            'workspace_scope',
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

    def test_ambiguous_title_detected(self):
        self.assertEqual(
            _hard_turn_trigger(
                _session(),
                user_message='rename the feature "Login" to "Auth"',
                handle_map=_handle_map('Login', 'Login', 'Dashboard'),
            ),
            'ambiguous_title',
        )


class ScopeTriggerTests(unittest.TestCase):
    def test_two_accessible_referenced_roadmaps_escalate(self):
        session = _session()
        run = RunState(trace_id='t', scope=session.scope, user_message='x')
        run.resolved_refs = [
            ResolvedRef(kind='roadmap', id='a1', accessible=True),
            ResolvedRef(kind='epic', id='e1', accessible=True, roadmap_id='b2'),
        ]
        self.assertEqual(
            _hard_turn_trigger(session, user_message='compare them', handle_map={}, run=run),
            'multi_roadmap_refs',
        )
        run.resolved_refs[1].accessible = False
        self.assertEqual(
            _hard_turn_trigger(session, user_message='compare them', handle_map={}, run=run),
            'none',
        )

    def test_workspace_scope_escalates(self):
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        self.assertEqual(_hard_turn_trigger(session, user_message='hi', handle_map={}), 'workspace_scope')

    def test_escalated_effort_never_lowers_the_base(self):
        self.assertEqual(escalated_effort(_settings('low'), 'medium'), 'medium')
        self.assertEqual(escalated_effort(_settings('high'), 'medium'), 'high')
        self.assertIsNone(escalated_effort(_settings(None), 'medium'))


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
        client = LLMClient(settings)
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



class ExtendedEffortLadderTests(unittest.TestCase):
    """GPT-5.6 adds none / xhigh / max around the old minimal..high ladder."""

    def test_none_base_escalates_on_a_hard_turn(self):
        self.assertEqual(_turn_reasoning_effort(_settings('none'), 'workspace_scope'), 'medium')
        self.assertEqual(_turn_reasoning_effort(_settings('none'), 'none'), 'none')

    def test_top_efforts_are_never_downgraded(self):
        for base in ('xhigh', 'max'):
            self.assertEqual(_turn_reasoning_effort(_settings(base), 'pending_plan'), base)
            self.assertEqual(escalated_effort(_settings(base)), base)
            self.assertEqual(escalated_effort(_settings(base), 'high'), base)

    def test_unknown_base_counts_as_low(self):
        self.assertEqual(_turn_reasoning_effort(_settings('bogus'), 'plan_request'), 'medium')
        self.assertEqual(escalated_effort(_settings('bogus')), 'medium')


class EffortValidatorTests(unittest.TestCase):
    """Validators run on construction (not on model_copy), so build Settings."""

    def _settings(self, **env):
        from app.core.config import Settings

        return Settings(_env_file=None, **env)  # type: ignore[arg-type]

    def test_every_documented_effort_is_accepted(self):
        for value in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
            self.assertEqual(self._settings(OPENAI_V2_REASONING_EFFORT=value).openai_v2_reasoning_effort, value)
            self.assertEqual(
                self._settings(AGENT_SUMMARY_REASONING_EFFORT=value).agent_summary_reasoning_effort, value
            )

    def test_unknown_effort_falls_back_to_low_and_blank_disables(self):
        self.assertEqual(self._settings(OPENAI_V2_REASONING_EFFORT='turbo').openai_v2_reasoning_effort, 'low')
        self.assertIsNone(self._settings(OPENAI_V2_REASONING_EFFORT='').openai_v2_reasoning_effort)
        self.assertIsNone(self._settings(AGENT_SUMMARY_REASONING_EFFORT='  ').agent_summary_reasoning_effort)

    def test_verbosity_and_cache_mode_are_normalized(self):
        self.assertEqual(self._settings(OPENAI_V2_VERBOSITY='HIGH').openai_v2_verbosity, 'high')
        self.assertEqual(self._settings(OPENAI_V2_VERBOSITY='chatty').openai_v2_verbosity, 'low')
        self.assertIsNone(self._settings(OPENAI_V2_VERBOSITY='').openai_v2_verbosity)
        self.assertEqual(self._settings(OPENAI_V2_PROMPT_CACHE_MODE='Implicit').openai_v2_prompt_cache_mode, 'implicit')
        self.assertEqual(self._settings(OPENAI_V2_PROMPT_CACHE_MODE='nope').openai_v2_prompt_cache_mode, 'explicit')

    def test_output_and_transcript_caps_are_clamped(self):
        self.assertEqual(self._settings(OPENAI_V2_MAX_OUTPUT_TOKENS='10').openai_v2_max_output_tokens, 1000)
        self.assertEqual(self._settings(OPENAI_V2_MAX_OUTPUT_TOKENS='999999').openai_v2_max_output_tokens, 128_000)
        self.assertEqual(self._settings(AGENT_RUN_TRANSCRIPT_MAX_BYTES='1').agent_run_transcript_max_bytes, 50_000)
        self.assertEqual(
            self._settings(AGENT_RUN_TRANSCRIPT_MAX_BYTES='5000000').agent_run_transcript_max_bytes, 900_000
        )

    def test_code_defaults_are_the_luna_policy(self):
        from app.core.config import Settings

        fields = Settings.model_fields
        self.assertEqual(fields['openai_model_v2'].default, 'gpt-5.6-luna')
        self.assertEqual(fields['agent_summary_model'].default, 'gpt-5.6-luna')
        self.assertEqual(fields['openai_v2_reasoning_effort'].default, 'low')
        self.assertEqual(fields['agent_summary_reasoning_effort'].default, 'none')
        self.assertEqual(fields['openai_v2_verbosity'].default, 'low')
        self.assertEqual(fields['openai_v2_prompt_cache_mode'].default, 'explicit')
        self.assertEqual(fields['openai_v2_max_output_tokens'].default, 16000)


if __name__ == '__main__':
    unittest.main()
