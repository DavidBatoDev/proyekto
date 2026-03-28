from __future__ import annotations

import logging
from typing import Any, Callable

from app.core.config import Settings

from .deterministic_context import (
    ContextResolutionOutcome,
    try_deterministic_list_answer,
    try_pending_context_selection,
)
from .deterministic_intents import (
    DeterministicContextIntent,
    get_deterministic_context_intent,
    match_deterministic_context_intent,
    match_global_overview_intent,
    normalize_context_label,
    should_include_ids,
)

ToolExecutor = Callable[[str, dict[str, Any], dict[str, Any]], dict[str, Any]]


class DeterministicContextAdapter:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        execute_context_tool: ToolExecutor,
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._execute_context_tool = execute_context_tool

    def try_pending_context_selection(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return try_pending_context_selection(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            execute_context_tool=self._execute_context_tool,
        )

    def try_deterministic_features_answer(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        intent = self.get_deterministic_context_intent('features_of_epic')
        if intent is None or intent.question_pattern is None:
            return None
        match = intent.question_pattern.search(user_message)
        if not match:
            return None
        label = self.normalize_context_label(match.group(1))
        if not label:
            return None
        return self.try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=False,
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def try_deterministic_tasks_answer(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        intent = self.get_deterministic_context_intent('tasks_of_feature')
        if intent is None or intent.question_pattern is None:
            return None
        match = intent.question_pattern.search(user_message)
        if not match:
            return None
        label = self.normalize_context_label(match.group(1))
        if not label:
            return None
        return self.try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=False,
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def match_deterministic_context_intent(
        self,
        user_message: str,
    ) -> tuple[DeterministicContextIntent, str] | None:
        return match_deterministic_context_intent(user_message)

    def get_deterministic_context_intent(
        self,
        pending_kind: str,
    ) -> DeterministicContextIntent | None:
        return get_deterministic_context_intent(pending_kind)

    def match_global_overview_intent(
        self,
        user_message: str,
    ) -> tuple[DeterministicContextIntent, str] | None:
        return match_global_overview_intent(user_message)

    def try_deterministic_list_answer(
        self,
        *,
        intent: DeterministicContextIntent,
        label: str,
        include_ids: bool,
        user_message: str | None = None,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=include_ids,
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            execute_context_tool=self._execute_context_tool,
        )

    def normalize_context_label(self, label: str) -> str:
        return normalize_context_label(label)

    def should_include_ids(self, user_message: str) -> bool:
        return should_include_ids(user_message)
