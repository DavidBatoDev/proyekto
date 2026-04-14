from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from pydantic import BaseModel

from app.core.config import Settings
from app.core.contracts.operations import RoadmapOperation
from app.core.llm.react.react_executor import BoundedToolLoopOutcome, run_bounded_tool_loop
from app.core.contracts.sessions import IntentType
from app.core.logging_utils import log_event
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


logger = logging.getLogger(__name__)


class _IntentClassification(BaseModel):
    intent_type: IntentType
    rationale: str


class OpenAILangChainAdapter(LLMProviderAdapter):
    provider_name = 'openai'

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._last_usage: dict[str, int] | None = None
        self._chat_model_instance: Any | None = None
        self._planner_chat_model_instances: dict[str, Any] = {}

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
        planner_profile: str | None = None,
        actor_context: dict[str, Any] | None = None,
    ) -> tuple[str, list[RoadmapOperation]]:
        try:
            self._last_usage = None
            actor_id = _extract_actor_id(actor_context)
            if ToolMessage is None:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='tooling_not_supported',
                    message='ToolMessage is unavailable in this runtime; tool loop cannot execute.',
                )
            tool_model = self._bind_tools_for_planning(
                self._planner_chat_model(planner_profile=planner_profile),
                tools,
                planner_profile=planner_profile,
            )
            initial_messages: list[Any] = [
                SystemMessage(content=system_prompt),
                *history_messages,
                HumanMessage(content=planner_prompt),
            ]

            def _on_no_tool_calls(
                _ai_message: Any,
                usage_totals: dict[str, int],
            ) -> BoundedToolLoopOutcome:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='missing_tool_call',
                    message='OpenAI did not return any tool call while planning operations.',
                    tokens_input=usage_totals['tokens_input'],
                    tokens_output=usage_totals['tokens_output'],
                    tokens_total=usage_totals['tokens_total'],
                )

            def _on_tool_call(
                name: str,
                args: dict[str, Any],
                _tool_call: dict[str, Any],
                _turn: int,
                _index: int,
                usage_totals: dict[str, int],
            ) -> BoundedToolLoopOutcome | None:
                if name != PLANNING_TOOL_NAME:
                    return None
                try:
                    assistant_message, operations = parse_plan_tool_args(args)
                except ValueError as exc:
                    error_message = str(exc)
                    autofix_attempted = True
                    autofix_applied = False
                    autofix_failure_reason: str | None = None
                    rewritten_args, autofix_failure_reason = _rewrite_assignee_payload_to_actor_id(
                        args=args,
                        error_message=error_message,
                        actor_id=actor_id,
                    )
                    if rewritten_args is not None:
                        try:
                            assistant_message, operations = parse_plan_tool_args(rewritten_args)
                        except ValueError as autofix_exc:
                            autofix_failure_reason = 'autofix_reparse_failed'
                            error_message = str(autofix_exc)
                        else:
                            autofix_applied = True
                            log_event(
                                logger,
                                'planner_assignee_autofix',
                                settings=self._settings,
                                provider=self.provider_name,
                                autofix_attempted=True,
                                autofix_applied=True,
                                autofix_failure_reason=None,
                                actor_present=bool(actor_id),
                            )
                            if not assistant_message.strip():
                                assistant_message = 'Prepared roadmap operations.'
                            return BoundedToolLoopOutcome(
                                value=(assistant_message, operations),
                                usage_totals=usage_totals,
                            )
                    log_event(
                        logger,
                        'planner_assignee_autofix',
                        settings=self._settings,
                        provider=self.provider_name,
                        autofix_attempted=autofix_attempted,
                        autofix_applied=autofix_applied,
                        autofix_failure_reason=autofix_failure_reason,
                        actor_present=bool(actor_id),
                    )
                    offending_op = _extract_offending_operation_value(args=args, error_message=error_message)
                    if offending_op:
                        logger.warning(
                            'Invalid plan payload for %s: offending_op=%s detail=%s',
                            PLANNING_TOOL_NAME,
                            offending_op,
                            error_message,
                        )
                    else:
                        logger.warning(
                            'Invalid plan payload for %s: detail=%s',
                            PLANNING_TOOL_NAME,
                            error_message,
                        )
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='invalid_operation_payload',
                        message=error_message,
                        tokens_input=usage_totals['tokens_input'],
                        tokens_output=usage_totals['tokens_output'],
                        tokens_total=usage_totals['tokens_total'],
                    ) from exc
                if not assistant_message.strip():
                    assistant_message = 'Prepared roadmap operations.'
                return BoundedToolLoopOutcome(
                    value=(assistant_message, operations),
                    usage_totals=usage_totals,
                )

            outcome = run_bounded_tool_loop(
                provider=self.provider_name,
                initial_messages=initial_messages,
                invoke=lambda messages: tool_model.invoke(messages),
                tool_executor=tool_executor,
                normalize_tool_args=self._normalize_tool_args,
                extract_usage=self._extract_usage,
                build_tool_message=lambda content, tool_call_id: ToolMessage(
                    content=content,
                    tool_call_id=tool_call_id,
                ),
                on_no_tool_calls=_on_no_tool_calls,
                on_tool_call=_on_tool_call,
                max_tool_turns=max_tool_turns,
                max_turns_error_code='max_tool_turns_exceeded',
                max_turns_error_message=(
                    'OpenAI planning loop reached max tool turns before returning a final operation plan.'
                ),
            )
            self._last_usage = outcome.usage_totals
            return outcome.value
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
            initial_messages: list[Any] = [
                SystemMessage(content=system_prompt),
                *history_messages,
                HumanMessage(content=question_prompt),
            ]

            def _on_no_tool_calls(
                ai_message: Any,
                usage_totals: dict[str, int],
            ) -> BoundedToolLoopOutcome:
                content = self._extract_text(ai_message.content)
                if content:
                    return BoundedToolLoopOutcome(value=content, usage_totals=usage_totals)
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='empty_response',
                    message='OpenAI returned an empty context answer.',
                    tokens_input=usage_totals['tokens_input'],
                    tokens_output=usage_totals['tokens_output'],
                    tokens_total=usage_totals['tokens_total'],
                )

            def _on_tool_call(
                _name: str,
                _args: dict[str, Any],
                _tool_call: dict[str, Any],
                _turn: int,
                _index: int,
                _usage_totals: dict[str, int],
            ) -> BoundedToolLoopOutcome | None:
                return None

            outcome = run_bounded_tool_loop(
                provider=self.provider_name,
                initial_messages=initial_messages,
                invoke=lambda messages: tool_model.invoke(messages),
                tool_executor=tool_executor,
                normalize_tool_args=self._normalize_tool_args,
                extract_usage=self._extract_usage,
                build_tool_message=lambda content, tool_call_id: ToolMessage(
                    content=content,
                    tool_call_id=tool_call_id,
                ),
                on_no_tool_calls=_on_no_tool_calls,
                on_tool_call=_on_tool_call,
                max_tool_turns=max_tool_turns,
                max_turns_error_code='max_tool_turns_exceeded',
                max_turns_error_message='OpenAI context answer loop reached max tool turns.',
            )
            self._last_usage = outcome.usage_totals
            return outcome.value
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def _chat_model(self) -> Any:
        if self._chat_model_instance is None:
            self._chat_model_instance = ChatOpenAI(
                **self._base_model_kwargs(max_tokens=self._settings.openai_max_tokens),
            )
        return self._chat_model_instance

    def _planner_chat_model(self, *, planner_profile: str | None = None) -> Any:
        planner_max_tokens = self._planner_max_tokens_for_profile(planner_profile)
        if planner_max_tokens is None or planner_max_tokens == self._settings.openai_max_tokens:
            return self._chat_model()
        cache_key = str(planner_max_tokens)
        model_instance = self._planner_chat_model_instances.get(cache_key)
        if model_instance is None:
            model_instance = ChatOpenAI(
                **self._base_model_kwargs(max_tokens=planner_max_tokens),
            )
            self._planner_chat_model_instances[cache_key] = model_instance
        return model_instance

    def _planner_max_tokens_for_profile(self, planner_profile: str | None) -> int | None:
        normalized_profile = str(planner_profile or '').strip().lower()
        if normalized_profile == 'repair_retry':
            profile_tokens = self._settings.openai_planner_retry_max_tokens
            if profile_tokens is not None:
                return profile_tokens
            return self._settings.openai_planner_max_tokens
        if normalized_profile == 'simple_edit':
            profile_tokens = self._settings.openai_simple_edit_max_tokens
            if profile_tokens is not None:
                return profile_tokens
        return self._settings.openai_planner_max_tokens

    def _bind_tools_for_planning(
        self,
        model: Any,
        tools: list[dict[str, Any]],
        *,
        planner_profile: str | None = None,
    ) -> Any:
        normalized_profile = str(planner_profile or '').strip() or 'default'
        try:
            bound_model = model.bind_tools(tools, tool_choice='required')
            log_event(
                logger,
                'planner_tool_choice_binding',
                settings=self._settings,
                provider=self.provider_name,
                planner_profile=normalized_profile,
                tool_choice_requested='required',
                tool_choice_mode='required',
                tool_choice_supported=True,
                tools_count=len(tools),
            )
            return bound_model
        except TypeError:
            # Backward compatibility for runtimes that do not support tool_choice.
            log_event(
                logger,
                'planner_tool_choice_binding',
                settings=self._settings,
                provider=self.provider_name,
                planner_profile=normalized_profile,
                tool_choice_requested='required',
                tool_choice_mode='fallback_legacy',
                tool_choice_supported=False,
                tools_count=len(tools),
            )
            return model.bind_tools(tools)

    def _base_model_kwargs(self, *, max_tokens: int | None) -> dict[str, Any]:
        model_kwargs: dict[str, Any] = {
            'api_key': self._settings.openai_api_key,
            'model': self._settings.openai_model,
            'temperature': self._settings.openai_temperature,
            'timeout': 30,
        }
        if self._settings.openai_reasoning_effort is not None:
            model_kwargs['reasoning_effort'] = self._settings.openai_reasoning_effort
        if max_tokens is not None:
            model_kwargs['max_tokens'] = max_tokens
        return model_kwargs

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


def _extract_offending_operation_value(*, args: dict[str, Any], error_message: str) -> str:
    detail = str(error_message or '')
    index_match = re.search(r'index\s+(\d+)', detail)
    if index_match is None:
        return ''
    try:
        index = int(index_match.group(1))
    except (TypeError, ValueError):
        return ''

    operations = args.get('operations')
    if not isinstance(operations, list) or index < 0 or index >= len(operations):
        return ''
    item = operations[index]
    if not isinstance(item, dict):
        return ''
    op_value = item.get('op')
    if not isinstance(op_value, str):
        return ''
    sanitized = ''.join(ch for ch in op_value.strip() if 31 < ord(ch) < 127)
    if not sanitized:
        return ''
    return sanitized[:48]


def _extract_actor_id(actor_context: dict[str, Any] | None) -> str:
    if not isinstance(actor_context, dict):
        return ''
    actor_id = actor_context.get('actor_id')
    if not isinstance(actor_id, str):
        return ''
    return actor_id.strip()


def _rewrite_assignee_payload_to_actor_id(
    *,
    args: dict[str, Any],
    error_message: str,
    actor_id: str,
) -> tuple[dict[str, Any] | None, str | None]:
    if not _is_assignee_validation_failure(error_message):
        return None, 'not_assignee_validation_failure'
    normalized_actor_id = str(actor_id or '').strip()
    if not normalized_actor_id:
        return None, 'actor_context_missing'

    raw_operations = args.get('operations')
    if not isinstance(raw_operations, list):
        return None, 'operations_not_list'

    rewritten_operations: list[Any] = []
    rewrites_applied = 0
    for operation in raw_operations:
        if not isinstance(operation, dict):
            rewritten_operations.append(operation)
            continue
        rewritten = dict(operation)
        op_name = str(rewritten.get('op') or '').strip().lower()
        assignee_value = rewritten.get('assignee')
        if op_name == 'update_node' and _is_first_person_token(assignee_value):
            patch = rewritten.get('patch')
            patch_dict = dict(patch) if isinstance(patch, dict) else {}
            patch_dict['assignee_id'] = normalized_actor_id
            rewritten['patch'] = patch_dict
            rewritten.pop('assignee', None)
            rewrites_applied += 1
        rewritten_operations.append(rewritten)

    if rewrites_applied <= 0:
        return None, 'no_conservative_rewrite_match'

    rewritten_args = dict(args)
    rewritten_args['operations'] = rewritten_operations
    return rewritten_args, None


def _is_assignee_validation_failure(error_message: str | None) -> bool:
    detail = str(error_message or '').strip().lower()
    if not detail:
        return False
    if "('assignee',)" in detail and 'extra' in detail and ('forbidden' in detail or 'not permitted' in detail):
        return True
    return bool(
        'assignee' in detail
        and 'extra' in detail
        and ('forbidden' in detail or 'not permitted' in detail)
    )


def _is_first_person_token(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    normalized = ' '.join(
        re.sub(r'[^a-z0-9]+', ' ', value.lower()).split()
    )
    return normalized in {
        'me',
        'myself',
        'self',
        'current user',
        'the current user',
        'i',
    }
