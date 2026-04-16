from __future__ import annotations

import unittest
from types import MethodType, SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.config import get_settings
from app.core.llm import client as client_module
from app.core.llm.planning import planner_execution_flow
from app.core.llm.providers.base import (
    IntentClassificationResult,
    ProviderAdapterError,
)
from app.core.llm.providers.openai_adapter import OpenAILangChainAdapter


def _build_adapter() -> OpenAILangChainAdapter:
    settings = get_settings()
    adapter = OpenAILangChainAdapter.__new__(OpenAILangChainAdapter)
    adapter._settings = settings
    adapter._last_usage = None
    adapter._chat_model_instance = None
    adapter._planner_chat_model_instances = {}
    adapter._classifier_chat_model_instance = None
    return adapter


class _FakeAIMessage:
    def __init__(
        self,
        *,
        content: str = '',
        usage_metadata: dict | None = None,
    ) -> None:
        self.content = content
        self.usage_metadata = usage_metadata or {
            'input_tokens': 42,
            'output_tokens': 8,
            'total_tokens': 50,
        }
        self.response_metadata = {'finish_reason': 'stop'}


class _FakeChatModel:
    def __init__(self, content: str) -> None:
        self.content = content
        self.last_messages = None

    def invoke(self, messages):
        self.last_messages = messages
        return _FakeAIMessage(content=self.content)


class ClassifyIntentAdapterTests(unittest.TestCase):
    def test_returns_structured_result_for_rename_prompt(self) -> None:
        adapter = _build_adapter()
        json_content = (
            '{"intent_type": "roadmap_edit", '
            '"sub_intent": "rename_only", '
            '"rationale": "rename only"}'
        )
        fake_model = _FakeChatModel(json_content)
        with patch.object(
            OpenAILangChainAdapter,
            '_classifier_chat_model',
            return_value=fake_model,
        ):
            result = adapter.classify_intent(
                classifier_prompt='classify-this',
                classifier_input='rename the epic to Core',
            )
        self.assertIsInstance(result, IntentClassificationResult)
        self.assertEqual(result.intent_type, 'roadmap_edit')
        self.assertEqual(result.sub_intent, 'rename_only')
        self.assertEqual(result.rationale, 'rename only')
        self.assertEqual(result.model, adapter._settings.openai_classifier_model)

    def test_raises_provider_error_on_invalid_json(self) -> None:
        adapter = _build_adapter()
        fake_model = _FakeChatModel('not json at all')
        with patch.object(
            OpenAILangChainAdapter,
            '_classifier_chat_model',
            return_value=fake_model,
        ):
            with self.assertRaises(ProviderAdapterError) as cm:
                adapter.classify_intent(
                    classifier_prompt='prompt',
                    classifier_input='hi',
                )
        self.assertEqual(cm.exception.code, 'invalid_classifier_payload')

    def test_raises_provider_error_on_schema_mismatch(self) -> None:
        adapter = _build_adapter()
        fake_model = _FakeChatModel('{"intent_type": "not_a_valid_intent"}')
        with patch.object(
            OpenAILangChainAdapter,
            '_classifier_chat_model',
            return_value=fake_model,
        ):
            with self.assertRaises(ProviderAdapterError) as cm:
                adapter.classify_intent(
                    classifier_prompt='prompt',
                    classifier_input='hi',
                )
        self.assertEqual(cm.exception.code, 'invalid_classifier_payload')

    def test_raises_provider_error_on_empty_response(self) -> None:
        adapter = _build_adapter()
        fake_model = _FakeChatModel('')
        with patch.object(
            OpenAILangChainAdapter,
            '_classifier_chat_model',
            return_value=fake_model,
        ):
            with self.assertRaises(ProviderAdapterError) as cm:
                adapter.classify_intent(
                    classifier_prompt='prompt',
                    classifier_input='hi',
                )
        self.assertEqual(cm.exception.code, 'empty_classifier_response')


class _FakePlanner:
    """Minimal stand-in for LLMPlanner exposing only the bits we need."""

    def __init__(
        self,
        *,
        llm_enabled: bool = True,
        classifier_payload: dict | None = None,
        classifier_raises: ProviderAdapterError | None = None,
        provider_available: bool = True,
    ) -> None:
        self._settings = SimpleNamespace(
            agent_llm_intent_classifier_enabled=llm_enabled,
        )
        self._logger = MagicMock()
        self._prompt_repository = MagicMock()
        self._prompt_repository.intent_classifier_prompt.return_value = 'prompt-body'
        self._provider_orchestrator = MagicMock()
        self._provider_orchestrator.is_available.return_value = provider_available
        if classifier_raises is not None:
            self._provider_orchestrator.call.side_effect = classifier_raises
        elif classifier_payload is not None:
            self._provider_orchestrator.call.return_value = SimpleNamespace(
                value=IntentClassificationResult(
                    intent_type=classifier_payload['intent_type'],
                    sub_intent=classifier_payload.get('sub_intent'),
                    rationale=classifier_payload.get('rationale', ''),
                    model=classifier_payload.get('model', 'gpt-4o-mini'),
                ),
                provider_used='openai',
                fallback_used=False,
                provider_error_code=None,
                tokens_input=42,
                tokens_output=8,
                tokens_total=50,
            )
        self._classify_intent_llm_first = MethodType(
            client_module.LLMPlanner._classify_intent_llm_first,
            self,
        )

    def _is_roadmap_question(self, *, intent_type, user_message, session_context):
        return False


class PreviewIntentClassificationTests(unittest.TestCase):
    def test_llm_success_path_stashes_payload_in_session_context(self) -> None:
        planner = _FakePlanner(
            classifier_payload={
                'intent_type': 'roadmap_edit',
                'sub_intent': 'rename_only',
                'rationale': 'rename',
                'model': 'gpt-4o-mini',
            },
        )
        session_context: dict = {}
        intent, is_roadmap_question = client_module.LLMPlanner.preview_intent_classification(
            planner,  # type: ignore[arg-type]
            user_message='rename the epic',
            session_context=session_context,
        )
        self.assertEqual(intent, 'roadmap_edit')
        self.assertFalse(is_roadmap_question)
        cached = session_context.get('_classifier_result')
        self.assertIsInstance(cached, dict)
        self.assertEqual(cached['source'], 'llm')
        self.assertEqual(cached['sub_intent'], 'rename_only')
        self.assertEqual(cached['model'], 'gpt-4o-mini')
        self.assertEqual(cached['tokens_input'], 42)

    def test_provider_error_falls_back_to_heuristic(self) -> None:
        planner = _FakePlanner(
            classifier_raises=ProviderAdapterError(
                provider='openai',
                code='timeout',
                message='boom',
            ),
        )
        session_context: dict = {}
        intent, _ = client_module.LLMPlanner.preview_intent_classification(
            planner,  # type: ignore[arg-type]
            user_message='rename the epic',
            session_context=session_context,
        )
        self.assertEqual(intent, 'roadmap_edit')
        cached = session_context['_classifier_result']
        self.assertEqual(cached['source'], 'heuristic_fallback')
        self.assertEqual(cached['fallback_reason'], 'provider_error:timeout')

    def test_feature_flag_disabled_skips_llm(self) -> None:
        planner = _FakePlanner(llm_enabled=False)
        session_context: dict = {}
        intent, _ = client_module.LLMPlanner.preview_intent_classification(
            planner,  # type: ignore[arg-type]
            user_message='hi',
            session_context=session_context,
        )
        self.assertEqual(intent, 'smalltalk')
        cached = session_context['_classifier_result']
        self.assertEqual(cached['source'], 'heuristic_fallback')
        self.assertEqual(cached['fallback_reason'], 'feature_flag_disabled')
        planner._provider_orchestrator.call.assert_not_called()

    def test_provider_unavailable_skips_llm(self) -> None:
        planner = _FakePlanner(provider_available=False)
        session_context: dict = {}
        _ = client_module.LLMPlanner.preview_intent_classification(
            planner,  # type: ignore[arg-type]
            user_message='rename foo',
            session_context=session_context,
        )
        cached = session_context['_classifier_result']
        self.assertEqual(cached['source'], 'heuristic_fallback')
        self.assertEqual(cached['fallback_reason'], 'provider_unavailable')
        planner._provider_orchestrator.call.assert_not_called()


class _LangGraphPlannerStub:
    """Stub with only the hooks the classify_intent node calls."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._logger = MagicMock()
        self._classify_calls = 0

    def _classify_intent_llm_first(self, *, user_message, session_context):
        self._classify_calls += 1
        return {
            'intent_type': 'roadmap_edit',
            'sub_intent': 'rename_only',
            'rationale': '',
            'model': 'gpt-4o-mini',
            'source': 'llm',
            'fallback_reason': None,
            'tokens_input': 10,
            'tokens_output': 2,
            'tokens_total': 12,
            'elapsed_ms': 123,
        }

    def _is_roadmap_question(self, *, intent_type, user_message, session_context):
        return False

    def _is_question_style_edit_request(self, user_message):
        return False


class ClassifyIntentNodeTests(unittest.TestCase):
    def test_uses_cached_classifier_result_from_session_context(self) -> None:
        planner = _LangGraphPlannerStub()
        cached = {
            'intent_type': 'roadmap_edit',
            'sub_intent': 'rename_only',
            'rationale': 'cached',
            'model': 'gpt-4o-mini',
            'source': 'llm',
            'fallback_reason': None,
            'tokens_input': 5,
            'tokens_output': 1,
            'tokens_total': 6,
            'elapsed_ms': 77,
        }
        state = {
            'user_message': 'rename this',
            'session_context': {'_classifier_result': cached},
        }
        result = planner_execution_flow.classify_intent(planner, state)
        self.assertEqual(result['intent_type'], 'roadmap_edit')
        self.assertEqual(result['classifier_sub_intent'], 'rename_only')
        self.assertEqual(result['classifier_source'], 'llm')
        self.assertEqual(result['parse_mode'], 'llm_classifier')
        self.assertEqual(planner._classify_calls, 0)

    def test_classifies_when_no_cache_present(self) -> None:
        planner = _LangGraphPlannerStub()
        state = {'user_message': 'rename this', 'session_context': {}}
        result = planner_execution_flow.classify_intent(planner, state)
        self.assertEqual(result['intent_type'], 'roadmap_edit')
        self.assertEqual(planner._classify_calls, 1)

    def test_clears_sub_intent_for_non_edit_intent(self) -> None:
        planner = _LangGraphPlannerStub()
        cached = {
            'intent_type': 'roadmap_query',
            'sub_intent': 'rename_only',
            'rationale': '',
            'model': 'gpt-4o-mini',
            'source': 'llm',
            'fallback_reason': None,
            'tokens_input': None,
            'tokens_output': None,
            'tokens_total': None,
            'elapsed_ms': 10,
        }
        state = {
            'user_message': 'what tasks are open?',
            'session_context': {'_classifier_result': cached},
        }
        result = planner_execution_flow.classify_intent(planner, state)
        self.assertIsNone(result['classifier_sub_intent'])

    def test_force_edit_continuation_short_circuits_classifier(self) -> None:
        planner = _LangGraphPlannerStub()
        state = {
            'user_message': 'yes',
            'session_context': {
                'force_edit_continuation': True,
                'force_edit_continuation_reason': 'confirm',
            },
        }
        result = planner_execution_flow.classify_intent(planner, state)
        self.assertEqual(result['intent_type'], 'roadmap_edit')
        self.assertEqual(result['parse_mode'], 'deterministic_edit_continuation_override')
        self.assertEqual(planner._classify_calls, 0)


if __name__ == '__main__':
    unittest.main()
