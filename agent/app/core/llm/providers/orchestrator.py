from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Generic, TypeVar

from app.core.config import Settings
from app.core.llm.providers.base import LLMProviderAdapter, ProviderAdapterError
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
        self._adapters: dict[str, LLMProviderAdapter] = {
            'gemini': GeminiLangChainAdapter(settings),
            'openai': OpenAILangChainAdapter(settings),
        }

    def call(self, operation: Callable[[LLMProviderAdapter], T]) -> ProviderCallOutcome[T]:
        order = self._provider_order()
        first_error: ProviderAdapterError | None = None
        unavailable: list[str] = []

        for index, provider_name in enumerate(order):
            adapter = self._adapters.get(provider_name)
            if adapter is None:
                unavailable.append(f'{provider_name}:adapter_missing')
                continue
            if not adapter.is_available():
                unavailable.append(f'{provider_name}:not_available')
                continue
            try:
                value = operation(adapter)
                return ProviderCallOutcome(
                    value=value,
                    provider_used=provider_name,
                    fallback_used=index > 0,
                    provider_error_code=first_error.code if first_error is not None else None,
                )
            except ProviderAdapterError as exc:
                if first_error is None:
                    first_error = exc
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
