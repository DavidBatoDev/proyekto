from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel

from app.core.config import Settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType
from app.core.llm.providers.base import LLMProviderAdapter, ProviderAdapterError
from app.core.tools.registry import get_operation_tools

try:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI
except Exception:  # pragma: no cover
    HumanMessage = None  # type: ignore[assignment]
    SystemMessage = None  # type: ignore[assignment]
    ChatOpenAI = None  # type: ignore[assignment]


class _IntentClassification(BaseModel):
    intent_type: IntentType
    rationale: str


class OpenAILangChainAdapter(LLMProviderAdapter):
    provider_name = 'openai'

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def is_available(self) -> bool:
        return bool(
            self._settings.openai_api_key
            and ChatOpenAI is not None
            and HumanMessage is not None
            and SystemMessage is not None
        )

    def classify_intent(
        self,
        classifier_prompt: str,
        classifier_input: str,
    ) -> IntentType:
        try:
            model = self._chat_model().with_structured_output(_IntentClassification)
            classification: _IntentClassification = model.invoke(
                [
                    SystemMessage(content=classifier_prompt),
                    HumanMessage(content=classifier_input),
                ]
            )
            return classification.intent_type
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def generate_chat_reply(
        self,
        system_prompt: str,
        user_message: str,
        history_messages: list[Any],
    ) -> str:
        try:
            model = self._chat_model()
            ai_message = model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    *history_messages,
                    HumanMessage(content=user_message),
                ]
            )
            content = self._extract_text(ai_message.content)
            if not content:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='empty_response',
                    message='OpenAI returned an empty chat response.',
                )
            return content
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def plan_operations_with_tools(
        self,
        system_prompt: str,
        planner_prompt: str,
        history_messages: list[Any],
    ) -> tuple[str, list[RoadmapOperation]]:
        try:
            tool_model = self._chat_model().bind_tools(
                get_operation_tools(),
                tool_choice={'type': 'function', 'function': {'name': 'plan_roadmap_operations'}},
            )
            ai_message = tool_model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    *history_messages,
                    HumanMessage(content=planner_prompt),
                ]
            )
            tool_calls = getattr(ai_message, 'tool_calls', []) or []
            tool_call = next((call for call in tool_calls if call.get('name') == 'plan_roadmap_operations'), None)
            if tool_call is None:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='missing_tool_call',
                    message='OpenAI did not return the required plan_roadmap_operations tool call.',
                )

            args = tool_call.get('args', {})
            if isinstance(args, str):
                args = json.loads(args)

            raw_operations = args.get('operations', [])
            operations = [RoadmapOperation.model_validate(item) for item in raw_operations]
            assistant_message = str(args.get('assistant_message', 'Prepared roadmap operations.'))
            return assistant_message, operations
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def _chat_model(self) -> Any:
        return ChatOpenAI(
            api_key=self._settings.openai_api_key,
            model=self._settings.openai_model,
            temperature=self._settings.openai_temperature,
            timeout=30,
        )

    def _to_provider_error(self, exc: Exception) -> ProviderAdapterError:
        exc_name = exc.__class__.__name__.lower()
        message = str(exc)
        if 'insufficient_quota' in message or 'quota' in message:
            return ProviderAdapterError(self.provider_name, 'insufficient_quota', message)
        if 'rate' in message or '429' in message or 'ratelimit' in exc_name:
            return ProviderAdapterError(self.provider_name, 'rate_limited', message)
        if 'timeout' in message:
            return ProviderAdapterError(self.provider_name, 'timeout', message)
        return ProviderAdapterError(self.provider_name, 'provider_error', message)

    def _extract_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, str):
                    chunks.append(item)
                elif isinstance(item, dict):
                    text = item.get('text')
                    if isinstance(text, str):
                        chunks.append(text)
            return '\n'.join(part for part in chunks if part).strip()
        return ''
