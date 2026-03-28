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
    from langchain_openai import ChatOpenAI
except Exception:  # pragma: no cover
    ChatOpenAI = None  # type: ignore[assignment]


class _IntentClassification(BaseModel):
    intent_type: IntentType
    rationale: str


class OpenAILangChainAdapter(LLMProviderAdapter):
    provider_name = 'openai'

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._last_usage: dict[str, int] | None = None

    def is_available(self) -> bool:
        return bool(
            self._settings.openai_api_key
            and ChatOpenAI is not None
            and HumanMessage is not None
            and SystemMessage is not None
        )

    def availability_reason(self) -> str:
        if not self._settings.openai_api_key:
            return 'missing_api_key'
        if ChatOpenAI is None:
            return 'missing_langchain_openai'
        if HumanMessage is None or SystemMessage is None:
            return 'missing_langchain_core_messages'
        return 'available'

    def classify_intent(
        self,
        classifier_prompt: str,
        classifier_input: str,
    ) -> IntentType:
        try:
            self._last_usage = None
            model = self._chat_model().with_structured_output(_IntentClassification)
            classification: _IntentClassification = model.invoke(
                [
                    SystemMessage(content=classifier_prompt),
                    HumanMessage(content=classifier_input),
                ]
            )
            self._last_usage = self._extract_usage(classification)
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
            self._last_usage = None
            model = self._chat_model()
            ai_message = model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    *history_messages,
                    HumanMessage(content=user_message),
                ]
            )
            self._last_usage = self._extract_usage(ai_message)
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
        tools: list[dict[str, Any]],
        tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]],
        max_tool_turns: int,
    ) -> tuple[str, list[RoadmapOperation]]:
        try:
            self._last_usage = None
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
            usage_totals = {'tokens_input': 0, 'tokens_output': 0, 'tokens_total': 0}

            for turn in range(max_tool_turns):
                ai_message = tool_model.invoke(messages)
                self._add_usage(usage_totals, self._extract_usage(ai_message))
                messages.append(ai_message)
                tool_calls = getattr(ai_message, 'tool_calls', []) or []
                if not tool_calls:
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='missing_tool_call',
                        message='OpenAI did not return any tool call while planning operations.',
                    )

                for index, tool_call in enumerate(tool_calls):
                    name = str(tool_call.get('name', '')).strip()
                    args = self._normalize_tool_args(tool_call.get('args'))
                    if name == PLANNING_TOOL_NAME:
                        try:
                            assistant_message, operations = parse_plan_tool_args(args)
                        except ValueError as exc:
                            self._last_usage = usage_totals
                            raise ProviderAdapterError(
                                provider=self.provider_name,
                                code='invalid_operation_payload',
                                message=str(exc),
                                tokens_input=usage_totals['tokens_input'],
                                tokens_output=usage_totals['tokens_output'],
                                tokens_total=usage_totals['tokens_total'],
                            ) from exc
                        if not assistant_message.strip():
                            assistant_message = 'Prepared roadmap operations.'
                        self._last_usage = usage_totals
                        return assistant_message, operations

                    tool_result = tool_executor(name, args)
                    tool_call_id = str(tool_call.get('id') or f'{name}-{turn}-{index}')
                    messages.append(
                        ToolMessage(
                            content=json.dumps(tool_result, ensure_ascii=True),
                            tool_call_id=tool_call_id,
                        )
                    )

            self._last_usage = usage_totals
            raise ProviderAdapterError(
                provider=self.provider_name,
                code='max_tool_turns_exceeded',
                message='OpenAI planning loop reached max tool turns before returning a final operation plan.',
                tokens_input=usage_totals['tokens_input'],
                tokens_output=usage_totals['tokens_output'],
                tokens_total=usage_totals['tokens_total'],
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
            self._last_usage = None
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
            usage_totals = {'tokens_input': 0, 'tokens_output': 0, 'tokens_total': 0}

            for turn in range(max_tool_turns):
                ai_message = tool_model.invoke(messages)
                self._add_usage(usage_totals, self._extract_usage(ai_message))
                messages.append(ai_message)
                tool_calls = getattr(ai_message, 'tool_calls', []) or []
                if not tool_calls:
                    content = self._extract_text(ai_message.content)
                    if content:
                        self._last_usage = usage_totals
                        return content
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='empty_response',
                        message='OpenAI returned an empty context answer.',
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

            self._last_usage = usage_totals
            raise ProviderAdapterError(
                provider=self.provider_name,
                code='max_tool_turns_exceeded',
                message='OpenAI context answer loop reached max tool turns.',
                tokens_input=usage_totals['tokens_input'],
                tokens_output=usage_totals['tokens_output'],
                tokens_total=usage_totals['tokens_total'],
            )
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
        usage = self.get_last_usage() or {}
        kwargs = {
            'tokens_input': usage.get('tokens_input'),
            'tokens_output': usage.get('tokens_output'),
            'tokens_total': usage.get('tokens_total'),
        }
        if 'insufficient_quota' in message or 'quota' in message:
            return ProviderAdapterError(
                self.provider_name,
                'insufficient_quota',
                message,
                **kwargs,
            )
        if 'rate' in message or '429' in message or 'ratelimit' in exc_name:
            return ProviderAdapterError(
                self.provider_name,
                'rate_limited',
                message,
                **kwargs,
            )
        if 'timeout' in message:
            return ProviderAdapterError(
                self.provider_name,
                'timeout',
                message,
                **kwargs,
            )
        return ProviderAdapterError(
            self.provider_name,
            'provider_error',
            message,
            **kwargs,
        )

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

    def get_last_usage(self) -> dict[str, int] | None:
        return self._last_usage

    def _extract_usage(self, message: Any) -> dict[str, int] | None:
        usage_metadata = getattr(message, 'usage_metadata', None)
        if isinstance(usage_metadata, dict):
            input_tokens = int(usage_metadata.get('input_tokens') or 0)
            output_tokens = int(usage_metadata.get('output_tokens') or 0)
            total_tokens = int(
                usage_metadata.get('total_tokens') or input_tokens + output_tokens
            )
            return {
                'tokens_input': input_tokens,
                'tokens_output': output_tokens,
                'tokens_total': total_tokens,
            }

        response_metadata = getattr(message, 'response_metadata', None)
        if isinstance(response_metadata, dict):
            token_usage = response_metadata.get('token_usage')
            if isinstance(token_usage, dict):
                input_tokens = int(token_usage.get('prompt_tokens') or 0)
                output_tokens = int(token_usage.get('completion_tokens') or 0)
                total_tokens = int(
                    token_usage.get('total_tokens') or input_tokens + output_tokens
                )
                return {
                    'tokens_input': input_tokens,
                    'tokens_output': output_tokens,
                    'tokens_total': total_tokens,
                }
        return None

    def _add_usage(
        self,
        totals: dict[str, int],
        usage: dict[str, int] | None,
    ) -> None:
        if not usage:
            return
        totals['tokens_input'] += int(usage.get('tokens_input') or 0)
        totals['tokens_output'] += int(usage.get('tokens_output') or 0)
        totals['tokens_total'] += int(usage.get('tokens_total') or 0)
