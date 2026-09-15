"""GPT-5.6 request parameters on the Responses client.

Covers the knobs added for the 5.6 family: ``text.verbosity`` (and its
self-heal), the ``reasoning.encrypted_content`` include riding with
``reasoning``, a rejected effort VALUE remapping to 'low' without disabling
reasoning, the prompt-cache modes (implicit = today's request, explicit =
breakpoint on the static prefix via extra_body, off = nothing), and the two
new usage counters (cache writes, hidden reasoning tokens) end to end.
"""

import inspect
import unittest
from types import SimpleNamespace

from app.core.engine.llm_client import (
    LLMClient,
    LLMResponse,
    _usage_detail,
    _with_cache_breakpoint,
    adapt_response,
)
from app.core.logging_utils import _format_cache_hit
from app.core.runtime.prompt import _ACTOR_HEADER, prompt_prefix, split_cache_prefix


class _Responses:
    """Records kwargs; ``fail`` maps a request to an exception (or None)."""

    def __init__(self, fail=None):
        self.calls = []
        self._fail = fail

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._fail is not None:
            exc = self._fail(kwargs)
            if exc is not None:
                raise exc
        return SimpleNamespace(output=[], status='completed', usage=None)


def _client(fail=None, *, prompt_cache_key=None, **overrides):
    base = {
        'openai_model_v2': 'gpt-5.6-luna',
        'openai_api_key': 'sk-test',
        'openai_v2_max_output_tokens': None,
        'openai_v2_reasoning_effort': 'low',
        'openai_v2_temperature': None,
    }
    base.update(overrides)
    client = LLMClient(SimpleNamespace(**base), prompt_cache_key=prompt_cache_key)
    fake = _Responses(fail)
    client._client = SimpleNamespace(responses=fake)  # skip real SDK init
    return client, fake


SYSTEM_WITH_ACTOR = (
    'You are the assistant.\n\n# Rules\n- be good\n\n'
    f'{_ACTOR_HEADER}\nActor: user-1 (owner)\n\n'
    '# Focus roadmap\nE1 Growth\n\n# Referenced items\n- none'
)


class VerbosityTests(unittest.TestCase):
    def test_sent_as_text_verbosity_when_configured(self):
        client, fake = _client(openai_v2_verbosity='low')
        client.complete([], [])
        self.assertEqual(fake.calls[0]['text'], {'verbosity': 'low'})

    def test_omitted_when_blank_or_absent(self):
        for value in ('', None):
            client, fake = _client(openai_v2_verbosity=value)
            client.complete([], [])
            self.assertNotIn('text', fake.calls[0], value)
        client, fake = _client()  # settings namespace without the attribute
        client.complete([], [])
        self.assertNotIn('text', fake.calls[0])

    def test_rejected_verbosity_is_dropped_and_stays_dropped(self):
        def fail(kwargs):
            if 'text' in kwargs:
                return RuntimeError("Unknown parameter: 'text.verbosity' is not supported")
            return None

        client, fake = _client(fail, openai_v2_verbosity='low')
        client.complete([], [])
        client.complete([], [])
        self.assertEqual(len(fake.calls), 3)
        self.assertIn('text', fake.calls[0])
        self.assertNotIn('text', fake.calls[1])
        self.assertNotIn('text', fake.calls[2])
        # Reasoning was not collateral damage.
        self.assertEqual(fake.calls[2]['reasoning'], {'effort': 'low'})
        self.assertFalse(client._drop_reasoning)


class EncryptedReasoningIncludeTests(unittest.TestCase):
    def test_include_rides_with_reasoning(self):
        client, fake = _client()
        client.complete([], [])
        self.assertEqual(fake.calls[0]['include'], ['reasoning.encrypted_content'])

    def test_no_include_without_reasoning(self):
        client, fake = _client(openai_v2_reasoning_effort=None)
        client.complete([], [])
        self.assertNotIn('include', fake.calls[0])
        self.assertNotIn('reasoning', fake.calls[0])

    def test_include_dropped_together_with_reasoning(self):
        def fail(kwargs):
            if 'reasoning' in kwargs:
                return RuntimeError('reasoning is not supported for this model')
            return None

        client, fake = _client(fail)
        client.complete([], [])
        self.assertIn('include', fake.calls[0])
        self.assertNotIn('include', fake.calls[1])
        self.assertNotIn('reasoning', fake.calls[1])


class EffortValueFallbackTests(unittest.TestCase):
    _REJECT = (
        "Invalid value: 'minimal'. Supported values are: 'none', 'low', 'medium', "
        "'high', 'xhigh', and 'max' for reasoning.effort."
    )

    def _failing(self):
        def fail(kwargs):
            if (kwargs.get('reasoning') or {}).get('effort') == 'minimal':
                return RuntimeError(self._REJECT)
            return None

        return fail

    def test_rejected_effort_value_retries_at_low_without_dropping_reasoning(self):
        client, fake = _client(self._failing(), openai_v2_reasoning_effort='minimal')
        client.complete([], [])
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(fake.calls[0]['reasoning'], {'effort': 'minimal'})
        self.assertEqual(fake.calls[1]['reasoning'], {'effort': 'low'})
        self.assertFalse(client._drop_reasoning)
        # Remembered: the next call goes straight to 'low'.
        client.complete([], [])
        self.assertEqual(fake.calls[2]['reasoning'], {'effort': 'low'})

    def test_only_the_rejected_value_is_remapped(self):
        client, fake = _client(self._failing(), openai_v2_reasoning_effort='minimal')
        client.complete([], [])
        # A per-turn escalation is still honoured.
        client.complete([], [], reasoning_effort='medium')
        self.assertEqual(fake.calls[-1]['reasoning'], {'effort': 'medium'})

    def test_unrelated_reasoning_rejection_still_drops_reasoning(self):
        def fail(kwargs):
            if 'reasoning' in kwargs:
                return RuntimeError('reasoning is not supported for this model')
            return None

        client, fake = _client(fail)
        client.complete([], [])
        self.assertTrue(client._drop_reasoning)
        self.assertNotIn('reasoning', fake.calls[1])


class PromptCacheModeTests(unittest.TestCase):
    def _messages(self, system=SYSTEM_WITH_ACTOR):
        return [{'role': 'system', 'content': system}, {'role': 'user', 'content': 'hi'}]

    def test_implicit_is_the_plain_request(self):
        client, fake = _client(prompt_cache_key='roadmap:r1', openai_v2_prompt_cache_mode='implicit')
        client.complete(self._messages(), [])
        call = fake.calls[0]
        self.assertEqual(call['prompt_cache_key'], 'roadmap:r1')
        self.assertNotIn('extra_body', call)
        self.assertIsInstance(call['input'][0]['content'], str)

    def test_missing_setting_behaves_as_implicit(self):
        client, fake = _client(prompt_cache_key='roadmap:r1')
        client.complete(self._messages(), [])
        self.assertEqual(fake.calls[0]['prompt_cache_key'], 'roadmap:r1')
        self.assertNotIn('extra_body', fake.calls[0])

    def test_off_sends_no_key_and_no_options(self):
        client, fake = _client(prompt_cache_key='roadmap:r1', openai_v2_prompt_cache_mode='off')
        client.complete(self._messages(), [])
        self.assertNotIn('prompt_cache_key', fake.calls[0])
        self.assertNotIn('extra_body', fake.calls[0])

    def test_explicit_marks_the_static_prefix_and_keeps_the_key(self):
        client, fake = _client(prompt_cache_key='roadmap:r1', openai_v2_prompt_cache_mode='explicit')
        messages = self._messages()
        client.complete(messages, [])
        call = fake.calls[0]
        self.assertEqual(call['prompt_cache_key'], 'roadmap:r1')
        self.assertEqual(
            call['extra_body'], {'prompt_cache_options': {'mode': 'explicit', 'ttl': '30m'}}
        )
        system = call['input'][0]
        self.assertEqual(system['role'], 'system')
        parts = system['content']
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0]['type'], 'input_text')
        self.assertEqual(parts[0]['prompt_cache_breakpoint'], {'mode': 'explicit'})
        self.assertEqual(parts[0]['text'], prompt_prefix(SYSTEM_WITH_ACTOR))
        self.assertNotIn('prompt_cache_breakpoint', parts[1])
        self.assertEqual(parts[0]['text'] + parts[1]['text'], SYSTEM_WITH_ACTOR)
        # The user turn is untouched and the caller's list was not mutated.
        self.assertEqual(call['input'][1], {'role': 'user', 'content': 'hi'})
        self.assertIsInstance(messages[0]['content'], str)

    def test_explicit_leaves_a_prompt_without_an_actor_block_alone(self):
        client, fake = _client(openai_v2_prompt_cache_mode='explicit')
        client.complete(self._messages('short summary prompt'), [])
        self.assertEqual(fake.calls[0]['input'][0]['content'], 'short summary prompt')
        self.assertIn('extra_body', fake.calls[0])

    def test_breakpoint_helper_ignores_non_system_leads(self):
        items = [{'role': 'user', 'content': SYSTEM_WITH_ACTOR}]
        self.assertIs(_with_cache_breakpoint(items), items)
        self.assertEqual(_with_cache_breakpoint([]), [])

    def test_split_cache_prefix_round_trips(self):
        parts = split_cache_prefix(SYSTEM_WITH_ACTOR)
        self.assertIsNotNone(parts)
        self.assertEqual(parts[0] + parts[1], SYSTEM_WITH_ACTOR)
        self.assertTrue(parts[0].endswith('Actor: user-1 (owner)'))
        self.assertIsNone(split_cache_prefix('no actor here'))
        self.assertEqual(split_cache_prefix(f'x\n{_ACTOR_HEADER}\nActor: u'), (f'x\n{_ACTOR_HEADER}\nActor: u', ''))


class UsageCountersTests(unittest.TestCase):
    def _usage(self, cache_write=None, reasoning=None):
        return SimpleNamespace(
            input_tokens=2100,
            output_tokens=400,
            total_tokens=2500,
            input_tokens_details=SimpleNamespace(cached_tokens=1800, cache_write_tokens=cache_write),
            output_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
        )

    def test_reads_from_object_details(self):
        usage = self._usage(cache_write=300, reasoning=120)
        self.assertEqual(_usage_detail(usage, 'input_tokens_details', 'cache_write_tokens'), 300)
        self.assertEqual(_usage_detail(usage, 'output_tokens_details', 'reasoning_tokens'), 120)

    def test_reads_from_dict_usage(self):
        usage = {
            'input_tokens_details': {'cached_tokens': 1, 'cache_write_tokens': 7},
            'output_tokens_details': {'reasoning_tokens': 9},
        }
        self.assertEqual(_usage_detail(usage, 'input_tokens_details', 'cache_write_tokens'), 7)
        self.assertEqual(_usage_detail(usage, 'output_tokens_details', 'reasoning_tokens'), 9)

    def test_missing_is_none(self):
        self.assertIsNone(_usage_detail(self._usage(), 'input_tokens_details', 'cache_write_tokens'))
        self.assertIsNone(_usage_detail(None, 'input_tokens_details', 'cache_write_tokens'))
        self.assertIsNone(_usage_detail(SimpleNamespace(), 'output_tokens_details', 'reasoning_tokens'))

    def test_adapt_response_populates_both_counters(self):
        adapted = adapt_response(
            SimpleNamespace(output=[], status='completed', usage=self._usage(cache_write=300, reasoning=120))
        )
        self.assertIsInstance(adapted, LLMResponse)
        self.assertEqual(adapted.tokens_cached, 1800)
        self.assertEqual(adapted.tokens_cache_write, 300)
        self.assertEqual(adapted.tokens_reasoning, 120)

    def test_cache_line_renders_writes(self):
        self.assertEqual(_format_cache_hit(1000, 900, 100), '900/1000 (90%) write=100')
        self.assertEqual(_format_cache_hit(1000, 0, 1000), '0/1000 (0%) write=1000')
        # No write count → byte-identical to the pre-5.6 rendering.
        self.assertEqual(_format_cache_hit(1000, 900), '900/1000 (90%)')
        self.assertEqual(_format_cache_hit(1000, 900, None), '900/1000 (90%)')

    def test_counters_are_forwarded_loop_to_step_result(self):
        from app.core.runtime import orchestrator, service
        from app.core.runtime.results import StepResult

        for name in ('tokens_cache_write', 'tokens_reasoning'):
            self.assertIn(name, StepResult.__dataclass_fields__)
        source = inspect.getsource(service.StepContext.add_loop_usage)
        self.assertIn("self.tokens['cache_write'] +=", source)
        self.assertIn("self.tokens['reasoning'] +=", source)
        finalize = inspect.getsource(orchestrator.finalize_step)
        self.assertIn("tokens_cache_write=ctx.tokens['cache_write']", finalize)
        self.assertIn("tokens_reasoning=ctx.tokens['reasoning']", finalize)


if __name__ == '__main__':
    unittest.main()
