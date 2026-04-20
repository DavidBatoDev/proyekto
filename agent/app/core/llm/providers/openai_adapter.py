from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, field_validator

from app.core.config import Settings
from app.core.contracts.intents import BulkScope, EditSubIntent
from app.core.contracts.operations import (
    PARENT_REQUIRING_OPS,
    RoadmapOperation,
    TARGET_TAKING_OPS,
)
from app.core.llm.react.react_executor import BoundedToolLoopOutcome, run_bounded_tool_loop
from app.core.contracts.sessions import IntentType
from app.core.logging_utils import log_event
from app.core.llm.providers.base import (
    IntentClassificationResult,
    LLMProviderAdapter,
    ProviderAdapterError,
)
from app.core.tools.registry import (
    PLANNING_TOOL_NAME,
    parse_plan_tool_args,
    parse_plan_tool_clarifier_options,
    parse_plan_tool_revision_operations,
)

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
    sub_intent: EditSubIntent | None = Field(default=None)
    bulk_scope: BulkScope = Field(default=BulkScope.NONE)
    rationale: str = Field(default='')

    @field_validator('sub_intent', mode='before')
    @classmethod
    def _coerce_null_sub_intent(cls, value: Any) -> Any:
        # The prompt lists `null` as a valid enum value alongside quoted strings,
        # so LLMs sometimes return the literal string "null" (or "none", or "")
        # instead of JSON null. Coerce those to None so validation succeeds.
        if isinstance(value, str) and value.strip().lower() in {'null', 'none', ''}:
            return None
        return value

    @field_validator('bulk_scope', mode='before')
    @classmethod
    def _coerce_unknown_bulk_scope(cls, value: Any) -> Any:
        # Older classifier builds may omit bulk_scope entirely; treat
        # missing/null/unknown strings as NONE so callers get a stable
        # enum value instead of a ValidationError.
        if value is None:
            return BulkScope.NONE
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {'', 'null', 'none'}:
                return BulkScope.NONE
            if normalized not in {m.value for m in BulkScope}:
                return BulkScope.NONE
        return value


class OpenAILangChainAdapter(LLMProviderAdapter):
    provider_name = 'openai'

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._last_usage: dict[str, int] | None = None
        self._chat_model_instance: Any | None = None
        self._planner_chat_model_instances: dict[str, Any] = {}
        self._classifier_chat_model_instance: Any | None = None

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
    ) -> IntentClassificationResult:
        try:
            self._last_usage = None
            model = self._classifier_chat_model()
            ai_message = model.invoke(
                [
                    SystemMessage(content=classifier_prompt),
                    HumanMessage(content=classifier_input),
                ]
            )
            self._last_usage = self._extract_usage(ai_message)
            raw_text = self._extract_text(ai_message.content)
            if not raw_text:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='empty_classifier_response',
                    message='Classifier returned empty content.',
                )
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='invalid_classifier_payload',
                    message=f'Classifier returned non-JSON content: {exc}',
                )
            try:
                parsed = _IntentClassification.model_validate(payload)
            except Exception as exc:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='invalid_classifier_payload',
                    message=f'Classifier payload failed schema validation: {exc}',
                )
            return IntentClassificationResult(
                intent_type=parsed.intent_type,
                sub_intent=parsed.sub_intent,
                bulk_scope=parsed.bulk_scope,
                rationale=parsed.rationale or '',
                model=self._settings.openai_classifier_model,
            )
        except ProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover
            raise self._to_provider_error(exc)

    def generate_chat_reply(
        self,
        system_prompt: str,
        user_message: str,
        history_messages: list[Any],
        *,
        max_tokens: int | None = None,
    ) -> str:
        try:
            self._last_usage = None
            model = self._chat_model()
            if max_tokens is not None:
                # Per-call override — preserves the cached singleton while
                # giving the plan phase enough budget for reasoning + JSON
                # output. See `openai_plan_max_tokens` in config.
                model = model.bind(max_tokens=max_tokens)
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
                usage = self._last_usage or {}
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='empty_response',
                    message='OpenAI returned an empty chat response.',
                    tokens_input=usage.get('tokens_input'),
                    tokens_output=usage.get('tokens_output'),
                    tokens_total=usage.get('tokens_total'),
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
        parallel_tool_executor: Callable[
            [list[tuple[str, dict[str, Any]]]],
            list[dict[str, Any]],
        ] | None = None,
        parallel_safe_tools: frozenset[str] | set[str] | None = None,
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
                prior_tool_messages: list[dict[str, Any]],
            ) -> BoundedToolLoopOutcome | None:
                if name != PLANNING_TOOL_NAME:
                    return None
                args = _strip_nulls_from_plan_args(args)
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
                            clarifier_options = parse_plan_tool_clarifier_options(rewritten_args)
                            revision_operations = parse_plan_tool_revision_operations(rewritten_args)
                            return BoundedToolLoopOutcome(
                                value=(
                                    assistant_message,
                                    operations,
                                    clarifier_options,
                                    revision_operations,
                                ),
                                usage_totals=usage_totals,
                            )
                    if _is_missing_target_validation_failure(error_message):
                        recovery_args, recovery_report = _rewrite_missing_target_from_resolver(
                            args=args,
                            error_message=error_message,
                            prior_tool_messages=prior_tool_messages,
                        )
                        if recovery_args is not None:
                            try:
                                assistant_message, operations = parse_plan_tool_args(recovery_args)
                            except ValueError as recovery_exc:
                                log_event(
                                    logger,
                                    'planner_target_recovery_autofix',
                                    settings=self._settings,
                                    provider=self.provider_name,
                                    autofix_attempted=True,
                                    autofix_applied=False,
                                    autofix_failure_reason='reparse_failed',
                                    offending_op_count=recovery_report.get('offending_op_count'),
                                    candidates_count=recovery_report.get('candidates_count'),
                                    autofix_strategy=recovery_report.get('autofix_strategy'),
                                    resolver_turn_age=recovery_report.get('resolver_turn_age'),
                                )
                                error_message = str(recovery_exc)
                            else:
                                log_event(
                                    logger,
                                    'planner_target_recovery_autofix',
                                    settings=self._settings,
                                    provider=self.provider_name,
                                    autofix_attempted=True,
                                    autofix_applied=True,
                                    autofix_failure_reason=None,
                                    offending_op_count=recovery_report.get('offending_op_count'),
                                    candidates_count=recovery_report.get('candidates_count'),
                                    autofix_strategy=recovery_report.get('autofix_strategy'),
                                    resolver_turn_age=recovery_report.get('resolver_turn_age'),
                                )
                                if not assistant_message.strip():
                                    assistant_message = 'Prepared roadmap operations.'
                                clarifier_options = parse_plan_tool_clarifier_options(recovery_args)
                                revision_operations = parse_plan_tool_revision_operations(recovery_args)
                                return BoundedToolLoopOutcome(
                                    value=(
                                        assistant_message,
                                        operations,
                                        clarifier_options,
                                        revision_operations,
                                    ),
                                    usage_totals=usage_totals,
                                )
                        else:
                            log_event(
                                logger,
                                'planner_target_recovery_autofix',
                                settings=self._settings,
                                provider=self.provider_name,
                                autofix_attempted=True,
                                autofix_applied=False,
                                autofix_failure_reason=recovery_report.get('failure_reason'),
                                offending_op_count=recovery_report.get('offending_op_count'),
                                candidates_count=recovery_report.get('candidates_count'),
                                autofix_strategy=recovery_report.get('autofix_strategy'),
                                resolver_turn_age=recovery_report.get('resolver_turn_age'),
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
                    raw_args_snapshot = args if isinstance(args, dict) else None
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='invalid_operation_payload',
                        message=error_message,
                        tokens_input=usage_totals['tokens_input'],
                        tokens_output=usage_totals['tokens_output'],
                        tokens_total=usage_totals['tokens_total'],
                        raw_tool_args=raw_args_snapshot,
                    ) from exc
                if not assistant_message.strip():
                    assistant_message = 'Prepared roadmap operations.'
                clarifier_options = parse_plan_tool_clarifier_options(args)
                revision_operations = parse_plan_tool_revision_operations(args)
                return BoundedToolLoopOutcome(
                    value=(
                        assistant_message,
                        operations,
                        clarifier_options,
                        revision_operations,
                    ),
                    usage_totals=usage_totals,
                )

            def _invoke_and_detect_truncation(messages: list[Any]) -> Any:
                ai_message = tool_model.invoke(messages)
                # If the model hit the output-token ceiling we set via the
                # planner profile, its tool-call JSON may be partial or
                # missing — treat this as a dedicated error so the planner
                # retry loop can widen the budget (`repair_retry` profile)
                # on the next attempt rather than surfacing a confusing
                # schema-validation failure downstream.
                if _response_finish_reason(ai_message) == 'length':
                    usage_dict = self._extract_usage(ai_message) or {}
                    raise ProviderAdapterError(
                        provider=self.provider_name,
                        code='planner_output_truncated',
                        message=(
                            'Planner hit the output-token ceiling before completing '
                            'its tool call.'
                        ),
                        tokens_input=usage_dict.get('tokens_input'),
                        tokens_output=usage_dict.get('tokens_output'),
                        tokens_total=usage_dict.get('tokens_total'),
                    )
                return ai_message

            outcome = run_bounded_tool_loop(
                provider=self.provider_name,
                initial_messages=initial_messages,
                invoke=_invoke_and_detect_truncation,
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
                parallel_tool_executor=parallel_tool_executor,
                parallel_safe_tools=parallel_safe_tools,
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
        *,
        max_tokens: int | None = None,
    ) -> str:
        try:
            self._last_usage = None
            if ToolMessage is None:
                raise ProviderAdapterError(
                    provider=self.provider_name,
                    code='tooling_not_supported',
                    message='ToolMessage is unavailable in this runtime; tool loop cannot execute.',
                )
            # Some LangChain-OpenAI versions reject `bind_tools([])`. When the
            # caller passes no tools we just use the raw chat model — the
            # bounded-tool-loop sees no tool_calls on the first response and
            # emits the content via `_on_no_tool_calls`.
            tool_model = (
                self._chat_model().bind_tools(tools) if tools else self._chat_model()
            )
            if max_tokens is not None:
                # Per-call max_tokens override for phases (e.g. plan_proposal)
                # that need more headroom than the provider default.
                tool_model = tool_model.bind(max_tokens=max_tokens)
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
                **self._base_model_kwargs(max_tokens=self._settings.openai_chat_max_tokens),
            )
        return self._chat_model_instance

    def _classifier_chat_model(self) -> Any:
        if self._classifier_chat_model_instance is None:
            # `response_format=json_object` skips the function-calling
            # wrapper that `with_structured_output` imposes. The server
            # streams JSON directly, cutting ~400–800ms of TTFT on
            # gpt-4o-mini compared to tool-call mode. We validate the
            # payload with Pydantic in `classify_intent`, so schema safety
            # is preserved even though the server isn't strictly enforcing
            # the schema.
            constructor_kwargs: dict[str, Any] = {
                'api_key': self._settings.openai_api_key,
                'model': self._settings.openai_classifier_model,
                'temperature': self._settings.openai_classifier_temperature,
                'timeout': 20,
                'model_kwargs': {
                    'response_format': {'type': 'json_object'},
                },
            }
            if self._settings.openai_classifier_max_tokens is not None:
                constructor_kwargs['max_tokens'] = self._settings.openai_classifier_max_tokens
            self._classifier_chat_model_instance = ChatOpenAI(**constructor_kwargs)
        return self._classifier_chat_model_instance

    def _planner_chat_model(self, *, planner_profile: str | None = None) -> Any:
        planner_max_tokens = self._planner_max_tokens_for_profile(planner_profile)
        if planner_max_tokens is None or planner_max_tokens == self._settings.openai_chat_max_tokens:
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
        """Map a planner profile string to an output-token ceiling.

        Profiles are how the planner loop varies the `max_tokens` cap
        across attempts without juggling separate ChatOpenAI instances
        per caller. The seam exists so the retry-on-truncation path can
        widen the budget for one call without widening it forever.

        We retry on `finish_reason='length'` (and `missing_tool_call`)
        specifically — a hard signal that output was cut off — not on
        vibes or quality concerns. This is different from the anti-pattern
        of "call small, blindly retry bigger": our first attempt's budget
        is already sized from empirical data (`openai_planner_default_max_
        tokens` default 2000, covering the observed p95 plan output), and
        the preflight in `planner_operation_flow.estimate_plan_output_
        tokens` escalates to the repair budget *before* the first call
        when the prompt obviously asks for more. Retry here is a last
        resort, not a routine extra round-trip.
        """
        normalized_profile = str(planner_profile or '').strip().lower()
        if normalized_profile == 'repair_retry':
            profile_tokens = self._settings.openai_edit_repair_max_tokens
            if profile_tokens is not None:
                return profile_tokens
            return self._settings.openai_edit_default_max_tokens
        if normalized_profile == 'scoped_edit':
            profile_tokens = self._settings.openai_edit_narrow_max_tokens
            if profile_tokens is not None:
                return profile_tokens
        return self._settings.openai_edit_default_max_tokens

    def _bind_tools_for_planning(
        self,
        model: Any,
        tools: list[dict[str, Any]],
        *,
        planner_profile: str | None = None,
    ) -> Any:
        normalized_profile = str(planner_profile or '').strip() or 'default'
        # Strict structured outputs are the default: LangChain/OpenAI enforce
        # the tool schema at token-sampling when accepted. If the runtime
        # version or the current schema shape triggers validation errors at
        # bind time, we gracefully fall back to non-strict binding — the
        # tool-call layer then catches any residual shape issues via the
        # planner_target_recovery autofix + repair-retry prompt.
        try:
            bound_model = model.bind_tools(
                tools, tool_choice='required', strict=True
            )
            log_event(
                logger,
                'planner_tool_choice_binding',
                settings=self._settings,
                provider=self.provider_name,
                planner_profile=normalized_profile,
                tool_choice_requested='required',
                tool_choice_mode='required_strict',
                tool_choice_supported=True,
                strict_mode_supported=True,
                strict_mode_fallback_reason=None,
                tools_count=len(tools),
            )
            return bound_model
        except TypeError as exc:
            strict_fallback_reason = f'type_error:{exc!s}'[:160]
        except Exception as exc:  # noqa: BLE001 — broad catch is intentional
            strict_fallback_reason = (
                f'{exc.__class__.__name__.lower()}:{exc!s}'[:160]
            )
        # Strict-mode is the load-bearing defense against the planner
        # emitting a helper-tool name as an `op` value — a silent degrade
        # means that defense is gone and we're back to post-hoc Pydantic
        # validation only. Surface at ERROR so it's paged, not buried in an
        # event log.
        logger.error(
            'Strict-mode tool binding failed, degrading to non-strict. '
            'reason=%s tools=%d profile=%s',
            strict_fallback_reason,
            len(tools),
            normalized_profile,
        )
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
                strict_mode_supported=False,
                strict_mode_fallback_reason=strict_fallback_reason,
                tools_count=len(tools),
            )
            return bound_model
        except TypeError:
            log_event(
                logger,
                'planner_tool_choice_binding',
                settings=self._settings,
                provider=self.provider_name,
                planner_profile=normalized_profile,
                tool_choice_requested='required',
                tool_choice_mode='fallback_legacy',
                tool_choice_supported=False,
                strict_mode_supported=False,
                strict_mode_fallback_reason=strict_fallback_reason,
                tools_count=len(tools),
            )
            return model.bind_tools(tools)

    def _base_model_kwargs(self, *, max_tokens: int | None) -> dict[str, Any]:
        model_kwargs: dict[str, Any] = {
            'api_key': self._settings.openai_api_key,
            'model': self._settings.openai_model,
            'temperature': self._settings.openai_temperature,
            # 90s ceiling — reasoning models (GPT-5 family) can take 40-60s
            # for a dense structured-output turn (plan envelope with 5 epics).
            # Previously 30s was too tight and caused premature timeouts.
            'timeout': 90,
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
            cached_tokens = 0
            input_details = usage_metadata.get('input_token_details')
            if isinstance(input_details, dict):
                cached_tokens = int(
                    input_details.get('cache_read')
                    or input_details.get('cached_tokens')
                    or 0
                )
            return {
                'tokens_input': input_tokens,
                'tokens_output': output_tokens,
                'tokens_total': total_tokens,
                'tokens_cached': cached_tokens,
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
                cached_tokens = 0
                prompt_details = token_usage.get('prompt_tokens_details')
                if isinstance(prompt_details, dict):
                    cached_tokens = int(prompt_details.get('cached_tokens') or 0)
                return {
                    'tokens_input': input_tokens,
                    'tokens_output': output_tokens,
                    'tokens_total': total_tokens,
                    'tokens_cached': cached_tokens,
                }
        return None


def _response_finish_reason(ai_message: Any) -> str | None:
    """Pull `finish_reason` out of a LangChain AIMessage's provider metadata.

    OpenAI sets this to `'length'` when the response was cut off by
    `max_tokens`. Other common values: `'stop'` (clean completion),
    `'tool_calls'`, `'content_filter'`. Returns None when the metadata
    isn't present (e.g. test doubles or unsupported providers).
    """
    response_metadata = getattr(ai_message, 'response_metadata', None)
    if isinstance(response_metadata, dict):
        finish_reason = response_metadata.get('finish_reason')
        if isinstance(finish_reason, str):
            return finish_reason.strip().lower() or None
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


_TARGET_TAKING_OPS = TARGET_TAKING_OPS
_PARENT_REQUIRING_OPS = PARENT_REQUIRING_OPS


def _strip_nulls_from_plan_args(args: Any) -> Any:
    # OpenAI strict structured outputs force every schema property to appear
    # in `required`, with optional fields modeled as `["T", "null"]`. The LLM
    # then emits JSON null for absent fields — but the Python
    # `RoadmapOperation` Pydantic model runs with `extra='forbid'` and
    # certain fields (e.g., `patch`) reject null. Strip keys whose value is
    # None at the top level and per-operation level so the downstream parser
    # sees the same shape it saw in non-strict mode.
    if not isinstance(args, dict):
        return args
    cleaned: dict[str, Any] = {}
    for key, value in args.items():
        if value is None:
            continue
        if key == 'operations' and isinstance(value, list):
            cleaned_operations: list[Any] = []
            for operation in value:
                if isinstance(operation, dict):
                    cleaned_op = {k: v for k, v in operation.items() if v is not None}
                    cleaned_operations.append(cleaned_op)
                else:
                    cleaned_operations.append(operation)
            cleaned[key] = cleaned_operations
        else:
            cleaned[key] = value
    return cleaned


def _is_missing_target_validation_failure(error_message: str | None) -> bool:
    detail = str(error_message or '').strip().lower()
    if not detail:
        return False
    return 'target missing' in detail


def _extract_offending_op_and_index(detail: str) -> tuple[str | None, int | None]:
    match = re.search(r'at index (\d+) \(op=([a-zA-Z_]+)\)', detail)
    if match is None:
        return None, None
    try:
        return match.group(2).strip() or None, int(match.group(1))
    except (TypeError, ValueError):
        return match.group(2).strip() or None, None


def _collect_offending_target_ops(
    operations: list[Any],
) -> tuple[list[int], list[int]]:
    target_indices: list[int] = []
    parent_indices: list[int] = []
    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            continue
        op_kind = str(operation.get('op') or '').strip()
        node_id = operation.get('node_id')
        node_ref = operation.get('node_ref')
        has_target = (isinstance(node_id, str) and bool(node_id.strip())) or (
            isinstance(node_ref, str) and bool(node_ref.strip())
        )
        parent_id = operation.get('parent_id')
        parent_ref = operation.get('parent_ref')
        has_parent = (isinstance(parent_id, str) and bool(parent_id.strip())) or (
            isinstance(parent_ref, str) and bool(parent_ref.strip())
        )
        if op_kind in _TARGET_TAKING_OPS and not has_target:
            target_indices.append(index)
        if op_kind in _PARENT_REQUIRING_OPS and not has_parent:
            parent_indices.append(index)
    return target_indices, parent_indices


def _extract_resolver_candidates(
    prior_tool_messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int | None]:
    if not prior_tool_messages:
        return [], None
    for reverse_offset, entry in enumerate(reversed(prior_tool_messages)):
        if not isinstance(entry, dict):
            continue
        if str(entry.get('name') or '').strip() != 'resolve_node_reference':
            continue
        result = entry.get('result')
        if not isinstance(result, dict):
            continue
        candidates: list[dict[str, Any]] = []
        matches = result.get('matches')
        if isinstance(matches, list):
            for match in matches:
                if not isinstance(match, dict):
                    continue
                candidate_id = match.get('id')
                if not isinstance(candidate_id, str) or not candidate_id.strip():
                    continue
                candidates.append(
                    {
                        'id': candidate_id.strip(),
                        'type': str(
                            match.get('type') or match.get('node_type') or ''
                        ).strip().lower(),
                        'parent_id': (
                            match.get('parent_id').strip()
                            if isinstance(match.get('parent_id'), str)
                            else None
                        ),
                    }
                )
        selected = result.get('selected')
        if isinstance(selected, dict):
            selected_id = selected.get('id')
            if isinstance(selected_id, str) and selected_id.strip() and not candidates:
                candidates.append(
                    {
                        'id': selected_id.strip(),
                        'type': str(
                            selected.get('type') or selected.get('node_type') or ''
                        ).strip().lower(),
                        'parent_id': (
                            selected.get('parent_id').strip()
                            if isinstance(selected.get('parent_id'), str)
                            else None
                        ),
                    }
                )
        node_id = result.get('id')
        if isinstance(node_id, str) and node_id.strip() and not candidates:
            candidates.append(
                {
                    'id': node_id.strip(),
                    'type': str(
                        result.get('type') or result.get('node_type') or ''
                    ).strip().lower(),
                    'parent_id': (
                        result.get('parent_id').strip()
                        if isinstance(result.get('parent_id'), str)
                        else None
                    ),
                }
            )
        if candidates:
            return candidates, reverse_offset
    return [], None


def _rewrite_missing_target_from_resolver(
    *,
    args: dict[str, Any],
    error_message: str,
    prior_tool_messages: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    report: dict[str, Any] = {
        'failure_reason': None,
        'offending_op_count': 0,
        'candidates_count': 0,
        'autofix_strategy': None,
        'resolver_turn_age': None,
    }
    detail = str(error_message or '').strip()
    offending_op, _offending_index = _extract_offending_op_and_index(detail)
    if offending_op is None:
        report['failure_reason'] = 'unparseable_error_message'
        return None, report
    raw_operations = args.get('operations')
    if not isinstance(raw_operations, list):
        report['failure_reason'] = 'operations_not_list'
        return None, report
    target_missing_indices, parent_missing_indices = _collect_offending_target_ops(raw_operations)
    is_target_scope = offending_op in _TARGET_TAKING_OPS
    is_parent_scope = offending_op in _PARENT_REQUIRING_OPS
    offending_indices = (
        target_missing_indices
        if is_target_scope
        else (parent_missing_indices if is_parent_scope else [])
    )
    report['offending_op_count'] = len(offending_indices)
    if not offending_indices:
        report['failure_reason'] = 'no_offending_ops_detected'
        return None, report
    offending_ops_kind = {
        str(raw_operations[index].get('op') or '').strip()
        for index in offending_indices
    }
    if len(offending_ops_kind) != 1 or offending_op not in offending_ops_kind:
        report['failure_reason'] = 'op_kind_mismatch'
        return None, report
    if len(offending_indices) != len(
        [
            index
            for index, operation in enumerate(raw_operations)
            if isinstance(operation, dict)
            and str(operation.get('op') or '').strip() == offending_op
        ]
    ):
        report['failure_reason'] = 'mixed_operation_shapes'
        return None, report
    candidates, resolver_turn_age = _extract_resolver_candidates(prior_tool_messages)
    report['candidates_count'] = len(candidates)
    report['resolver_turn_age'] = resolver_turn_age
    if not candidates:
        report['failure_reason'] = 'no_resolver_context'
        return None, report
    target_field = 'node_id' if is_target_scope else 'parent_id'
    expected_type_for_op: dict[str, str] = {
        'add_feature': 'epic',
        'add_task': 'feature',
    }
    expected_type = expected_type_for_op.get(offending_op)
    strategy: str
    filled: list[tuple[int, str]]
    if len(offending_indices) == 1 and (
        len(candidates) == 1
        or (
            expected_type is not None
            and sum(1 for c in candidates if c.get('type') == expected_type) == 1
        )
    ):
        if len(candidates) == 1:
            selected_candidate = candidates[0]
        else:
            selected_candidate = next(
                c for c in candidates if c.get('type') == expected_type
            )
        if is_parent_scope and expected_type is not None:
            candidate_type = selected_candidate.get('type') or ''
            if candidate_type and candidate_type != expected_type:
                report['failure_reason'] = 'op_incompatible'
                return None, report
        filled = [(offending_indices[0], selected_candidate['id'])]
        strategy = 'single_candidate'
    elif len(candidates) == len(offending_indices):
        if is_parent_scope and expected_type is not None:
            for candidate in candidates:
                candidate_type = candidate.get('type') or ''
                if candidate_type and candidate_type != expected_type:
                    report['failure_reason'] = 'op_incompatible'
                    return None, report
        filled = [
            (offending_indices[position], candidates[position]['id'])
            for position in range(len(offending_indices))
        ]
        strategy = 'positional'
    else:
        report['failure_reason'] = 'count_mismatch'
        return None, report
    rewritten_operations = [
        dict(operation) if isinstance(operation, dict) else operation
        for operation in raw_operations
    ]
    for offending_index, candidate_id in filled:
        operation = rewritten_operations[offending_index]
        if not isinstance(operation, dict):
            report['failure_reason'] = 'operation_not_dict'
            return None, report
        operation[target_field] = candidate_id
    rewritten_args = dict(args)
    rewritten_args['operations'] = rewritten_operations
    report['autofix_strategy'] = strategy
    return rewritten_args, report


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
