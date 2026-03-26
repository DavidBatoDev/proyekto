from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any, Callable, Generic, TypeVar

from app.core.config import Settings
from app.core.logging_utils import log_event
from app.core.llm.providers.base import LLMProviderAdapter, ProviderAdapterError
from app.core.llm.providers.budget import DailyRequestBudget
from app.core.llm.providers.gemini_adapter import GeminiLangChainAdapter
from app.core.llm.providers.openai_adapter import OpenAILangChainAdapter

T = TypeVar('T')


@dataclass
class ProviderCallOutcome(Generic[T]):
    value: T
    provider_used: str
    fallback_used: bool
    provider_error_code: str | None = None


class ProviderOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._logger = logging.getLogger(__name__)
        self._budget = DailyRequestBudget(settings.agent_quota_daily_limit)
        self._adapters: dict[str, LLMProviderAdapter] = {
            'gemini': GeminiLangChainAdapter(settings),
            'openai': OpenAILangChainAdapter(settings),
        }

    def call(
        self,
        operation: Callable[[LLMProviderAdapter], T],
        *,
        trace_context: dict[str, Any] | None = None,
    ) -> ProviderCallOutcome[T]:
        order = self._provider_order()
        first_error: ProviderAdapterError | None = None
        unavailable: list[str] = []

        for index, provider_name in enumerate(order):
            if (
                provider_name == 'gemini'
                and self._settings.agent_low_quota_mode
                and self._settings.agent_quota_daily_limit > 0
            ):
                budget_state = self._budget.state(provider_name)
                log_event(
                    self._logger,
                    'budget_check',
                    settings=self._settings,
                    provider=provider_name,
                    budget_limit=budget_state.limit,
                    used=budget_state.used,
                    remaining=budget_state.remaining,
                    **(trace_context or {}),
                )
                if not self._budget.can_consume(provider_name):
                    unavailable.append(f'{provider_name}:budget_exhausted')
                    log_event(
                        self._logger,
                        'provider_short_circuit',
                        settings=self._settings,
                        provider=provider_name,
                        reason='budget_exhausted',
                        error_code='insufficient_quota',
                        **(trace_context or {}),
                    )
                    continue
            adapter = self._adapters.get(provider_name)
            if adapter is None:
                unavailable.append(f'{provider_name}:adapter_missing')
                log_event(
                    self._logger,
                    'provider_unavailable',
                    settings=self._settings,
                    provider=provider_name,
                    reason='adapter_missing',
                    **(trace_context or {}),
                )
                continue
            if not adapter.is_available():
                reason = 'not_available'
                detail_getter = getattr(adapter, 'availability_reason', None)
                if callable(detail_getter):
                    try:
                        reason = str(detail_getter())
                    except Exception:
                        reason = 'not_available'
                unavailable.append(f'{provider_name}:{reason}')
                log_event(
                    self._logger,
                    'provider_unavailable',
                    settings=self._settings,
                    provider=provider_name,
                    reason=reason,
                    **(trace_context or {}),
                )
                continue
            try:
                log_event(
                    self._logger,
                    'provider_attempt',
                    settings=self._settings,
                    provider=provider_name,
                    **(trace_context or {}),
                )
                if (
                    provider_name == 'gemini'
                    and self._settings.agent_low_quota_mode
                    and self._settings.agent_quota_daily_limit > 0
                ):
                    self._budget.consume(provider_name)
                value = operation(adapter)
                if index > 0:
                    log_event(
                        self._logger,
                        'provider_fallback',
                        settings=self._settings,
                        provider=provider_name,
                        fallback_used=True,
                        initial_error_code=first_error.code if first_error is not None else None,
                        **(trace_context or {}),
                    )
                log_event(
                    self._logger,
                    'provider_success',
                    settings=self._settings,
                    provider=provider_name,
                    fallback_used=index > 0,
                    initial_error_code=first_error.code if first_error is not None else None,
                    **(trace_context or {}),
                )
                return ProviderCallOutcome(
                    value=value,
                    provider_used=provider_name,
                    fallback_used=index > 0,
                    provider_error_code=first_error.code if first_error is not None else None,
                )
            except ProviderAdapterError as exc:
                if first_error is None:
                    first_error = exc
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
                    **(trace_context or {}),
                )
                continue

        if first_error is not None:
            raise first_error
        raise ProviderAdapterError(
            provider='none',
            code='no_provider_available',
            message=(
                'No configured LLM provider is available.'
                + (f' Details: {", ".join(unavailable)}' if unavailable else '')
            ),
        )

    def _provider_order(self) -> list[str]:
        primary = self._normalize_provider(self._settings.llm_primary_provider)
        fallback = self._normalize_provider(self._settings.llm_fallback_provider)
        order: list[str] = []
        for name in [primary, fallback]:
            if name in {'gemini', 'openai'} and name not in order:
                order.append(name)
        if not order:
            return ['gemini', 'openai']
        return order

    def _normalize_provider(self, provider: str) -> str:
        return provider.strip().lower()

    def budget_state(self, provider: str) -> dict[str, int | str]:
        normalized = self._normalize_provider(provider)
        state = self._budget.state(normalized)
        return {
            'provider': state.provider,
            'limit': state.limit,
            'used': state.used,
            'remaining_estimate': state.remaining,
        }
