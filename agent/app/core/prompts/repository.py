from __future__ import annotations

import json
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any


class PromptRepository:
    def __init__(self) -> None:
        self._base_dir = Path(__file__).resolve().parent

    @lru_cache(maxsize=16)
    def load(self, template_name: str) -> str:
        template_path = self._base_dir / template_name
        if not template_path.exists():
            return ''
        return template_path.read_text(encoding='utf-8').strip()

    def build_system_prompt(self, mode: str, context: dict[str, Any]) -> str:
        base_prompt = self.load('base_system.md')
        mode_templates = {
            'chat': 'chat_mode.md',
            'query': 'query_mode.md',
            'plan': 'plan_mode.md',
            'edit': 'edit_mode.md',
        }
        template_name = mode_templates.get(mode, 'chat_mode.md')
        mode_prompt = self.load(template_name)
        context_payload = self._format_context(context)
        return (
            f'{base_prompt}\n\n'
            f'{mode_prompt}\n\n'
            f'Runtime context:\n{context_payload}'
        ).strip()

    def intent_classifier_prompt(self) -> str:
        return self.load('intent_classifier.md')

    def _format_context(self, context: dict[str, Any]) -> str:
        return json.dumps(
            context,
            ensure_ascii=True,
            indent=2,
            default=self._safe_default,
        )

    @staticmethod
    def _safe_default(value: Any) -> str:
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        return str(value)
