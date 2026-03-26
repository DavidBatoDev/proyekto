from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType


@dataclass
class ProviderCallSuccess:
    provider: str
    value: Any
    fallback_used: bool = False
    provider_error_code: str | None = None


@dataclass
class ProviderCallFailure:
    code: str
    message: str
    provider: str


class ProviderAdapterError(RuntimeError):
    def __init__(self, provider: str, code: str, message: str) -> None:
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.message = message


class LLMProviderAdapter(ABC):
    provider_name: str

    @abstractmethod
    def is_available(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def classify_intent(
        self,
        classifier_prompt: str,
        classifier_input: str,
    ) -> IntentType:
        raise NotImplementedError

    @abstractmethod
    def generate_chat_reply(
        self,
        system_prompt: str,
        user_message: str,
        history_messages: list[Any],
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def plan_operations_with_tools(
        self,
        system_prompt: str,
        planner_prompt: str,
        history_messages: list[Any],
    ) -> tuple[str, list[RoadmapOperation]]:
        raise NotImplementedError
