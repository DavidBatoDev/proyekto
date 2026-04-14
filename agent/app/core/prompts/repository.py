from __future__ import annotations

from typing import Any

from app.core.prompts.manager import (
    PromptManager,
    PromptNotFoundError,
    _format_context,
    _safe_default,
)


class PromptRepository:
    """Backwards-compatible shim around PromptManager.

    Existing callers (LLMPlanner, ContextAnswerService, etc.) use this API.
    New code should use PromptManager directly. This shim will be removed
    once all call sites are migrated; see
    docs/agent-refactor-06a-prompt-manager.md.
    """

    def __init__(self) -> None:
        self._manager = PromptManager()

    def load(self, template_name: str) -> str:
        """Load a template by name. Accepts both `'chat_mode'` and
        `'chat_mode.md'` forms. Returns empty string on missing template
        (matching the pre-refactor behavior — the strict path is
        `PromptManager.render`, which raises).
        """
        template_id = template_name[:-3] if template_name.endswith('.md') else template_name
        try:
            return self._manager.render(template_id)
        except PromptNotFoundError:
            return ''

    def build_system_prompt(self, mode: str, context: dict[str, Any]) -> str:
        return self._manager.build_system_prompt(mode, context)

    def intent_classifier_prompt(self) -> str:
        return self._manager.intent_classifier_prompt()

    # Private helpers preserved as module-level delegates for backcompat with
    # existing tests that patched them at the class level.
    def _format_context(self, context: dict[str, Any]) -> str:
        return _format_context(context)

    @staticmethod
    def _safe_default(value: Any) -> str:
        return _safe_default(value)
