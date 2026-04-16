from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class PromptNotFoundError(LookupError):
    def __init__(self, template_id: str, version: str | None) -> None:
        self.template_id = template_id
        self.version = version
        detail = f'{template_id!r} version={version!r}' if version else f'{template_id!r}'
        super().__init__(f'Prompt template not found: {detail}')


DEFAULT_VERSION = 'v1'
_ENV_OVERRIDE_VAR = 'AGENT_PROMPT_VERSION_OVERRIDE'
_TEMPLATE_SUFFIX = '.md'


def _parse_env_overrides(raw: str | None) -> dict[str, str]:
    """Parse `id=version,id=version,...` pairs. Malformed entries are logged
    once and ignored so a bad env value never crashes startup.
    """
    if not raw:
        return {}
    overrides: dict[str, str] = {}
    for entry in raw.split(','):
        entry = entry.strip()
        if not entry:
            continue
        if '=' not in entry:
            logger.warning('Ignoring malformed prompt version override entry: %r', entry)
            continue
        key, _, value = entry.partition('=')
        key = key.strip()
        value = value.strip()
        if not key or not value:
            logger.warning('Ignoring empty prompt version override entry: %r', entry)
            continue
        overrides[key] = value
    return overrides


@lru_cache(maxsize=1)
def _cached_env_overrides() -> dict[str, str]:
    return _parse_env_overrides(os.environ.get(_ENV_OVERRIDE_VAR))


def choose_version(template_id: str, session_id: str | None = None) -> str:
    """Pick which version of `template_id` to render.

    Precedence:
        1. `AGENT_PROMPT_VERSION_OVERRIDE` env var (`id=version,...`)
        2. Future A/B selection keyed on `session_id` (stub: returns default)
        3. `DEFAULT_VERSION` ('v1')

    Callers should treat this as opaque — the returned string is a filename
    stem under `templates/<template_id>/<version>.md`.
    """
    overrides = _cached_env_overrides()
    if template_id in overrides:
        chosen = overrides[template_id]
        logger.debug(
            'Prompt version override applied. template_id=%s version=%s',
            template_id,
            chosen,
        )
        return chosen
    # A/B hook: `session_id` is intentionally unused today. Keeping the
    # parameter in the signature lets future A/B logic slot in without a
    # breaking caller change.
    del session_id
    return DEFAULT_VERSION


class PromptManager:
    """Single owner for prompt templates with versioned storage.

    Layout:
        templates/
          <template_id>/
            <version>.md

    `render(template_id)` picks the version via `choose_version` and returns
    the file contents. `build_system_prompt(mode, context)` composes base +
    mode + runtime-context JSON (backcompat with the prior PromptRepository
    shape).
    """

    def __init__(self, templates_dir: Path | None = None) -> None:
        if templates_dir is None:
            templates_dir = Path(__file__).resolve().parent / 'templates'
        self._templates_dir = templates_dir

    @lru_cache(maxsize=64)
    def render(
        self,
        template_id: str,
        *,
        version: str | None = None,
        session_id: str | None = None,
    ) -> str:
        resolved_version = version or choose_version(template_id, session_id=session_id)
        template_path = self._templates_dir / template_id / f'{resolved_version}{_TEMPLATE_SUFFIX}'
        if not template_path.is_file():
            raise PromptNotFoundError(template_id, resolved_version)
        return template_path.read_text(encoding='utf-8').strip()

    def build_system_prompt(
        self,
        mode: str,
        context: dict[str, Any],
        *,
        session_id: str | None = None,
    ) -> str:
        mode_templates = {
            'chat': 'chat_mode',
            'query': 'query_mode',
            'plan': 'plan_mode',
            'edit': 'edit_mode',
        }
        template_id = mode_templates.get(mode, 'chat_mode')
        base_prompt = self.render('base_system', session_id=session_id)
        mode_prompt = self.render(template_id, session_id=session_id)

        # Two narrative sections are rendered as prose above the JSON runtime
        # context — "Current roadmap" (shape of the roadmap today) and "Recent
        # committed changes" (undo/revert anchor). JSON-stringified multi-line
        # prose is hard for the model to parse, and keeping these as a stable
        # prefix also maximises OpenAI prompt-cache hits across turns.
        overview = context.get('roadmap_overview_summary')
        overview_section: str | None = None
        if isinstance(overview, str) and overview.strip():
            overview_section = (
                'Current roadmap (reference this when advising or planning next steps):\n'
                + overview.strip()
            )

        recent_changes_section = _format_recent_changes_section(
            context.get('recent_applied_changes'),
        )

        context_for_json = {
            key: value
            for key, value in context.items()
            if key not in {'roadmap_overview_summary', 'recent_applied_changes'}
        }
        context_payload = _format_context(context_for_json)

        parts: list[str] = [base_prompt, mode_prompt]
        if overview_section is not None:
            parts.append(overview_section)
        if recent_changes_section is not None:
            parts.append(recent_changes_section)
        parts.append(f'Runtime context:\n{context_payload}')
        rendered = '\n\n'.join(parts).strip()
        overview_text_for_log = (
            overview.strip() if isinstance(overview, str) else ''
        )
        recent_targets_for_log = context_for_json.get('recent_resolved_targets')
        logger.info(
            'system_prompt_built mode=%s roadmap_overview_included=%s '
            'recent_changes_included=%s overview_chars=%d prompt_chars=%d',
            mode,
            overview_section is not None,
            recent_changes_section is not None,
            len(overview_text_for_log),
            len(rendered),
        )
        if overview_text_for_log:
            logger.info(
                'system_prompt_overview_text\n%s', overview_text_for_log
            )
        if recent_changes_section is not None:
            logger.info(
                'system_prompt_recent_changes_text\n%s', recent_changes_section
            )
        if recent_targets_for_log:
            logger.info(
                'system_prompt_recent_resolved_targets=%s',
                recent_targets_for_log,
            )
        return rendered

    def intent_classifier_prompt(self, *, session_id: str | None = None) -> str:
        return self.render('intent_classifier', session_id=session_id)


def _format_recent_changes_section(value: Any) -> str | None:
    """Render `session_context['recent_applied_changes']` as a prose section
    for the planner. Accepts a list of dumped `AppliedChange` dicts so this
    module stays independent of the contract type.
    """
    if not isinstance(value, list) or not value:
        return None
    from app.core.contracts.sessions import AppliedChange
    from app.core.orchestration.context.applied_changes_log import (
        format_recent_applied_changes,
    )

    entries: list[AppliedChange] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        try:
            entries.append(AppliedChange.model_validate(raw))
        except Exception:
            continue
    rendered = format_recent_applied_changes(entries)
    if not rendered:
        return None
    header = (
        'Recent committed changes (most recent first — consult this for '
        '"undo", "revert", or "change it back" requests; the `id` is stable '
        'across renames, so prefer it over re-resolving by title):'
    )
    return f'{header}\n{rendered}'


def _format_context(context: dict[str, Any]) -> str:
    return json.dumps(
        context,
        ensure_ascii=True,
        separators=(',', ':'),
        default=_safe_default,
    )


def _safe_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)
