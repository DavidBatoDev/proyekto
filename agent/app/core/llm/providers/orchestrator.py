from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any, Callable, Generic, TypeVar

from app.core.config import Settings
from app.core.logging_utils import log_event
from app.core.llm.providers.base import LLMProviderAdapter, ProviderAdapterError
from app.core.llm.providers.openai_adapter import OpenAILangChainAdapter

T = TypeVar('T')


@dataclass
class ProviderCallOutcome(Generic[T]):
    value: T
    provider_used: str
    fallback_used: bool
    provider_error_code: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_total: int | None = None


class ProviderOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._logger = logging.getLogger(__name__)
        self._adapter: LLMProviderAdapter = OpenAILangChainAdapter(settings)

    def call(
        self,
        operation: Callable[[LLMProviderAdapter], T],
        *,
        trace_context: dict[str, Any] | None = None,
    ) -> ProviderCallOutcome[T]:
        provider_name = 'openai'
        if not self._adapter.is_available():
            reason = 'not_available'
            detail_getter = getattr(self._adapter, 'availability_reason', None)
            if callable(detail_getter):
                try:
                    reason = str(detail_getter())
                except Exception:
                    reason = 'not_available'
            log_event(
                self._logger,
                'provider_unavailable',
                settings=self._settings,
                provider=provider_name,
                reason=reason,
                **(trace_context or {}),
            )
            raise ProviderAdapterError(
                provider=provider_name,
                code='no_provider_available',
                message=f'OpenAI provider is unavailable: {reason}.',
            )

        try:
            log_event(
                self._logger,
                'provider_attempt',
                settings=self._settings,
                provider=provider_name,
                **(trace_context or {}),
            )
            value = operation(self._adapter)
            usage = self._adapter.get_last_usage() or {}
            log_event(
                self._logger,
                'provider_success',
                settings=self._settings,
                provider=provider_name,
                fallback_used=False,
                initial_error_code=None,
                tokens_input=usage.get('tokens_input'),
                tokens_output=usage.get('tokens_output'),
                tokens_total=usage.get('tokens_total'),
                **(trace_context or {}),
            )
            return ProviderCallOutcome(
                value=value,
                provider_used=provider_name,
                fallback_used=False,
                provider_error_code=None,
                tokens_input=usage.get('tokens_input'),
                tokens_output=usage.get('tokens_output'),
                tokens_total=usage.get('tokens_total'),
            )
        except ProviderAdapterError as exc:
            if exc.code in {'insufficient_quota', 'rate_limited'}:
                log_event(
                    self._logger,
                    'provider_short_circuit',
                    settings=self._settings,
                    provider=provider_name,
                    reason=exc.code,
                    error_code=exc.code,
                    **(trace_context or {}),
                )
            log_event(
                self._logger,
                'provider_failure',
                settings=self._settings,
                provider=provider_name,
                error_code=exc.code,
                error_message=exc.message,
                tokens_input=exc.tokens_input,
                tokens_output=exc.tokens_output,
                tokens_total=exc.tokens_total,
                **(trace_context or {}),
            )
            raise
