import unittest
from unittest.mock import MagicMock, patch

from app.core.config import get_settings
from app.core.llm.providers.base import ProviderAdapterError
from app.core.llm.providers.openai_adapter import (
    OpenAILangChainAdapter,
    _response_finish_reason,
)


class _FakeAIMessage:
    def __init__(self, *, response_metadata=None, tool_calls=None, content=None):
        self.response_metadata = response_metadata or {}
        self.tool_calls = tool_calls or []
        self.content = content


def _build_adapter() -> OpenAILangChainAdapter:
    # Bypass real ChatOpenAI construction; we only exercise helper methods.
    settings = get_settings()
    adapter = OpenAILangChainAdapter.__new__(OpenAILangChainAdapter)
    adapter._settings = settings
    adapter._last_usage = None
    adapter._chat_model_instance = None
    adapter._planner_chat_model_instances = {}
    return adapter


class PlannerMaxTokensProfileTests(unittest.TestCase):
    def test_default_profile_uses_planner_default_max_tokens(self) -> None:
        adapter = _build_adapter()
        self.assertEqual(
            adapter._planner_max_tokens_for_profile(None),
            adapter._settings.openai_planner_default_max_tokens,
        )

    def test_scoped_profile_uses_narrow_edit_max_tokens(self) -> None:
        adapter = _build_adapter()
        self.assertEqual(
            adapter._planner_max_tokens_for_profile('scoped_edit'),
            adapter._settings.openai_planner_narrow_edit_max_tokens,
        )

    def test_repair_profile_uses_repair_max_tokens(self) -> None:
        adapter = _build_adapter()
        self.assertEqual(
            adapter._planner_max_tokens_for_profile('repair_retry'),
            adapter._settings.openai_planner_repair_max_tokens,
        )

    def test_narrow_edit_max_tokens_default_is_800(self) -> None:
        self.assertEqual(get_settings().openai_planner_narrow_edit_max_tokens, 800)

    def test_legacy_planner_max_tokens_env_alias_still_accepted(self) -> None:
        # Renamed OPENAI_PLANNER_MAX_TOKENS -> OPENAI_PLANNER_DEFAULT_MAX_TOKENS
        # in config.py; AliasChoices keeps the old env var working for one
        # release so existing deployments don't break silently.
        from app.core.config import Settings

        settings = Settings(_env_file=None, OPENAI_PLANNER_MAX_TOKENS=1500)  # type: ignore[arg-type]
        self.assertEqual(settings.openai_planner_default_max_tokens, 1500)


class ResponseFinishReasonTests(unittest.TestCase):
    def test_extracts_length_from_metadata(self) -> None:
        msg = _FakeAIMessage(response_metadata={'finish_reason': 'length'})
        self.assertEqual(_response_finish_reason(msg), 'length')

    def test_extracts_stop_from_metadata(self) -> None:
        msg = _FakeAIMessage(response_metadata={'finish_reason': 'stop'})
        self.assertEqual(_response_finish_reason(msg), 'stop')

    def test_returns_none_when_metadata_missing(self) -> None:
        msg = _FakeAIMessage()
        self.assertIsNone(_response_finish_reason(msg))

    def test_returns_none_for_nonstring_value(self) -> None:
        msg = _FakeAIMessage(response_metadata={'finish_reason': 123})
        self.assertIsNone(_response_finish_reason(msg))

    def test_normalizes_case_and_whitespace(self) -> None:
        msg = _FakeAIMessage(response_metadata={'finish_reason': '  LENGTH '})
        self.assertEqual(_response_finish_reason(msg), 'length')


if __name__ == '__main__':
    unittest.main()
