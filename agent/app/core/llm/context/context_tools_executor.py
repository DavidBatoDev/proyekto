from __future__ import annotations

import logging
from typing import Any, Callable

from app.core.config import Settings

from .dispatch import ToolDispatcher
from .handlers.base import (
    EPIC_PRIORITY_SET,
    EPIC_PRIORITY_VALUES,
    FEATURE_STATUS_SET,
    FEATURE_STATUS_VALUES,
    RELAXED_RESOLVE_UNIQUE_MIN_CONFIDENCE,
    TASK_STATUS_SET,
    TASK_STATUS_VALUES,
    UNASSIGN_ASSIGNEE_TOKENS,
)


class ContextToolsExecutor:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        nest_client: Any,
        run_async_context_call: Callable[[Any], dict[str, Any]],
    ) -> None:
        self._dispatcher = ToolDispatcher(
            settings=settings,
            logger=logger,
            nest_client=nest_client,
            run_async_context_call=run_async_context_call,
        )

    def execute(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        return self._dispatcher.execute(tool_name, args, session_context)
