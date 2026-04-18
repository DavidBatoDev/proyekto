from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Literal

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


@dataclass
class IntentClassificationResult:
    """Structured output of an LLM intent classification call.

    `sub_intent` is only meaningful when `intent_type == 'roadmap_edit'`;
    callers use it to pick a scoped tool manifest. `model` records which
    model produced the result so telemetry can track adoption per SKU.
    """
    intent_type: IntentType
    sub_intent: Literal[
        'rename_only',
        'delete_only',
        'status_change_only',
        'move_only',
        None,
    ]
    rationale: str
    model: str


class ProviderAdapterError(RuntimeError):
    def __init__(
        self,
        provider: str,
        code: str,
        message: str,
        *,
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
        raw_tool_args: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.message = message
        self.tokens_input = tokens_input
        self.tokens_output = tokens_output
        self.tokens_total = tokens_total
        # Raw tool-call arguments captured when the LLM produced an
        # unparseable planning payload. Carried through so the caller can
        # emit a `planner_schema_invalid_raw_output` event and we can finally
        # see what the model is actually sending.
        self.raw_tool_args = raw_tool_args


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
    ) -> IntentClassificationResult:
        raise NotImplementedError

    @abstractmethod
    def generate_chat_reply(
        self,
        system_prompt: str,
        user_message: str,
        history_messages: list[Any],
        *,
        max_tokens: int | None = None,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def get_last_usage(self) -> dict[str, int] | None:
        raise NotImplementedError
