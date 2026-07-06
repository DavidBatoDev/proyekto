"""Prompt-caching observability + routing.

OpenAI's Responses API auto-caches the stable system-prompt + state prefix; the
message assembly already puts static content at the front. These tests cover the
two additions that make that measurable and better-routed:
  (a) cached_tokens is parsed from usage.input_tokens_details onto LLMResponse
  (b) a prompt_cache_key is sent on the request when configured
"""

import unittest
from types import SimpleNamespace

from app.core.v2.openai_client import (
    LLMResponse,
    V2LLMClient,
    _cached_tokens,
    adapt_response,
)


def _usage(input_tokens, output_tokens, total_tokens, cached=None):
    details = None
    if cached is not None:
        details = SimpleNamespace(cached_tokens=cached)
    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        input_tokens_details=details,
    )


class CachedTokenExtractionTests(unittest.TestCase):
    def test_reads_cached_tokens_from_object_details(self):
        self.assertEqual(_cached_tokens(_usage(2100, 40, 2140, cached=1830)), 1830)

    def test_reads_cached_tokens_from_dict_usage(self):
        usage = {'input_tokens_details': {'cached_tokens': 512}}
        self.assertEqual(_cached_tokens(usage), 512)

    def test_missing_details_returns_none(self):
        self.assertIsNone(_cached_tokens(_usage(2100, 40, 2140, cached=None)))

    def test_none_usage_returns_none(self):
        self.assertIsNone(_cached_tokens(None))

    def test_adapt_response_populates_tokens_cached(self):
        response = SimpleNamespace(
            output=[], status='completed', usage=_usage(2100, 40, 2140, cached=1830)
        )
        adapted = adapt_response(response)
        self.assertIsInstance(adapted, LLMResponse)
        self.assertEqual(adapted.tokens_input, 2100)
        self.assertEqual(adapted.tokens_cached, 1830)


class _CapturingResponses:
    def __init__(self):
        self.last_kwargs = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        return SimpleNamespace(output=[], status='completed', usage=None)


class _CapturingOpenAIClient:
    def __init__(self):
        self.responses = _CapturingResponses()


class PromptCacheKeyTests(unittest.TestCase):
    def _client(self, cache_key):
        settings = SimpleNamespace(
            openai_model_v2='gpt-5.4-mini',
            openai_api_key='sk-test',
            openai_v2_max_output_tokens=None,
            openai_v2_reasoning_effort=None,
            openai_v2_temperature=None,
        )
        client = V2LLMClient(settings, prompt_cache_key=cache_key)
        fake = _CapturingOpenAIClient()
        client._client = fake  # skip real SDK init
        return client, fake

    def test_cache_key_sent_when_configured(self):
        client, fake = self._client('roadmap:abc-123')
        client.complete([], [])
        self.assertEqual(fake.responses.last_kwargs['prompt_cache_key'], 'roadmap:abc-123')

    def test_cache_key_omitted_when_absent(self):
        client, fake = self._client(None)
        client.complete([], [])
        self.assertNotIn('prompt_cache_key', fake.responses.last_kwargs)


if __name__ == '__main__':
    unittest.main()
