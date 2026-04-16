from app.core.llm.providers.base import (
    IntentClassificationResult,
    LLMProviderAdapter,
    ProviderAdapterError,
    ProviderCallFailure,
    ProviderCallSuccess,
)


def __getattr__(name: str):
    if name in {'ProviderCallOutcome', 'ProviderOrchestrator'}:
        from app.core.llm.providers.orchestrator import (
            ProviderCallOutcome,
            ProviderOrchestrator,
        )

        exported = {
            'ProviderCallOutcome': ProviderCallOutcome,
            'ProviderOrchestrator': ProviderOrchestrator,
        }
        return exported[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    'IntentClassificationResult',
    'LLMProviderAdapter',
    'ProviderAdapterError',
    'ProviderCallFailure',
    'ProviderCallOutcome',
    'ProviderCallSuccess',
    'ProviderOrchestrator',
]
