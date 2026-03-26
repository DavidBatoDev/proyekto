from __future__ import annotations

import json
from typing import Any, Callable

from pydantic import BaseModel

from app.core.config import Settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType
from app.core.llm.providers.base import LLMProviderAdapter, ProviderAdapterError
from app.core.tools.registry import PLANNING_TOOL_NAME, parse_plan_tool_args

try:
    from langchain_core.messages import HumanMessage, SystemMessage
except Exception:  # pragma: no cover
    HumanMessage = None  # type: ignore[assignment]
    SystemMessage = None  # type: ignore[assignment]

try:
    from langchain_core.messages import ToolMessage
except Exception:  # pragma: no cover
    ToolMessage = None  # type: ignore[assignment]

try:
    from langchain_google_genai import ChatGoogleGenerativeAI
except Exception:  # pragma: no cover
    ChatGoogleGenerativeAI = None  # type: ignore[assignment]


class _IntentClassification(BaseModel):
    intent_type: IntentType
    rationale: str


class GeminiLangChainAdapter(LLMProviderAdapter):
    provider_name = 'gemini'

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def is_available(self) -> bool:
        return bool(
            self._settings.gemini_api_key
            and ChatGoogleGenerativeAI is not None
            and HumanMessage is not None
            and SystemMessage is not None
        )

    def availability_reason(self) -> str:
        if not self._settings.gemini_api_key:
            return 'missing_api_key'
        if ChatGoogleGenerativeAI is None:
            return 'missing_langchain_google_genai'
        if HumanMessage is None or SystemMessage is None:
            return 'missing_langchain_core_messages'
        return 'available'

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
                    message='Gemini returned an empty chat response.',
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
        tools: list[dict[str, Any]],
        tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]],
        max_tool_turns: int,
    ) -> tuple[str, list[RoadmapOperation]]:
        try:
            if ToolMessage is None:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='tooling_not_supported',
                    message='ToolMessage is unavailable in this runtime; tool loop cannot execute.',
                )
            tool_model = self._chat_model().bind_tools(tools)
            messages: list[Any] = [
                SystemMessage(content=system_prompt),
                *history_messages,
                HumanMessage(content=planner_prompt),
            ]

            for turn in range(max_tool_turns):
                ai_message = tool_model.invoke(messages)
                messages.append(ai_message)
                tool_calls = getattr(ai_message, 'tool_calls', []) or []
                if not tool_calls:
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='missing_tool_call',
                        message='Gemini did not return any tool call while planning operations.',
                    )

                for index, tool_call in enumerate(tool_calls):
                    name = str(tool_call.get('name', '')).strip()
                    args = self._normalize_tool_args(tool_call.get('args'))
                    if name == PLANNING_TOOL_NAME:
                        assistant_message, operations = parse_plan_tool_args(args)
                        if not assistant_message.strip():
                            assistant_message = 'Prepared roadmap operations.'
                        return assistant_message, operations

                    tool_result = tool_executor(name, args)
                    tool_call_id = str(tool_call.get('id') or f'{name}-{turn}-{index}')
                    messages.append(
                        ToolMessage(
                            content=json.dumps(tool_result, ensure_ascii=True),
                            tool_call_id=tool_call_id,
                        )
                    )

            raise ProviderAdapterError(
                provider=self.provider_name,
                code='max_tool_turns_exceeded',
                message='Gemini planning loop reached max tool turns before returning a final operation plan.',
            )
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def answer_with_tools(
        self,
        system_prompt: str,
        question_prompt: str,
        history_messages: list[Any],
        tools: list[dict[str, Any]],
        tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]],
        max_tool_turns: int,
    ) -> str:
        try:
            if ToolMessage is None:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='tooling_not_supported',
                    message='ToolMessage is unavailable in this runtime; tool loop cannot execute.',
                )
            tool_model = self._chat_model().bind_tools(tools)
            messages: list[Any] = [
                SystemMessage(content=system_prompt),
                *history_messages,
                HumanMessage(content=question_prompt),
            ]

            for turn in range(max_tool_turns):
                ai_message = tool_model.invoke(messages)
                messages.append(ai_message)
                tool_calls = getattr(ai_message, 'tool_calls', []) or []
                if not tool_calls:
                    content = self._extract_text(ai_message.content)
                    if content:
                        return content
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='empty_response',
                        message='Gemini returned an empty context answer.',
                    )

                for index, tool_call in enumerate(tool_calls):
                    name = str(tool_call.get('name', '')).strip()
                    args = self._normalize_tool_args(tool_call.get('args'))
                    tool_result = tool_executor(name, args)
                    tool_call_id = str(tool_call.get('id') or f'{name}-{turn}-{index}')
                    messages.append(
                        ToolMessage(
                            content=json.dumps(tool_result, ensure_ascii=True),
                            tool_call_id=tool_call_id,
                        )
                    )

            raise ProviderAdapterError(
                provider=self.provider_name,
                code='max_tool_turns_exceeded',
                message='Gemini context answer loop reached max tool turns.',
            )
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def _chat_model(self) -> Any:
        return ChatGoogleGenerativeAI(
            model=self._settings.gemini_model,
            google_api_key=self._settings.gemini_api_key,
            temperature=self._settings.gemini_temperature,
            max_retries=self._settings.gemini_max_retries,
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

    def _normalize_tool_args(self, raw_args: Any) -> dict[str, Any]:
        args = raw_args
        if isinstance(args, str):
            args = json.loads(args)
        if not isinstance(args, dict):
            raise ProviderAdapterError(
                provider=self.provider_name,
                code='invalid_tool_arguments',
                message='Tool arguments must be a JSON object.',
            )
        return args

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
