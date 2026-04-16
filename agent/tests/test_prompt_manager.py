from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.core.prompts.manager import (
    DEFAULT_VERSION,
    PromptManager,
    PromptNotFoundError,
    _cached_env_overrides,
    _parse_env_overrides,
    choose_version,
)
from app.core.prompts.repository import PromptRepository


def _clear_env_override_cache() -> None:
    _cached_env_overrides.cache_clear()


class PromptManagerRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_env_override_cache()
        self.manager = PromptManager()
        # Clear per-instance render cache so tests don't leak results
        # when we patch env overrides mid-run.
        self.manager.render.cache_clear()

    def test_render_default_version_returns_non_empty(self) -> None:
        text = self.manager.render('chat_mode')
        self.assertTrue(text)
        self.assertIsInstance(text, str)

    def test_render_explicit_version_matches_default(self) -> None:
        default_text = self.manager.render('chat_mode')
        explicit_text = self.manager.render('chat_mode', version='v1')
        self.assertEqual(default_text, explicit_text)

    def test_render_missing_template_raises(self) -> None:
        with self.assertRaises(PromptNotFoundError) as ctx:
            self.manager.render('nonexistent_template')
        self.assertEqual(ctx.exception.template_id, 'nonexistent_template')
        self.assertEqual(ctx.exception.version, DEFAULT_VERSION)

    def test_render_missing_version_raises(self) -> None:
        with self.assertRaises(PromptNotFoundError) as ctx:
            self.manager.render('chat_mode', version='v99')
        self.assertEqual(ctx.exception.version, 'v99')

    def test_build_system_prompt_contains_base_and_mode_and_context(self) -> None:
        prompt = self.manager.build_system_prompt('chat', {'foo': 'bar'})
        # Must include runtime-context JSON section
        self.assertIn('Runtime context:', prompt)
        self.assertIn('"foo":"bar"', prompt)
        # Base prompt shouldn't be empty
        self.assertTrue(len(prompt) > 50)

    def test_build_system_prompt_injects_roadmap_overview_as_prose_section(self) -> None:
        overview = 'Roadmap: "Demo"\n1 epic\n1. Alpha — 1 feature'
        prompt = self.manager.build_system_prompt(
            'chat',
            {'foo': 'bar', 'roadmap_overview_summary': overview},
        )
        # Prose section is rendered before the JSON blob, not inside it.
        self.assertIn(
            'Current roadmap (reference this when advising or planning next steps):',
            prompt,
        )
        self.assertIn('Roadmap: "Demo"', prompt)
        self.assertIn('1. Alpha — 1 feature', prompt)
        # JSON blob must NOT carry the overview (keeps the cacheable prefix stable
        # and avoids stringified multi-line prose inside JSON).
        self.assertNotIn('roadmap_overview_summary', prompt.split('Runtime context:')[1])
        overview_index = prompt.find('Current roadmap')
        runtime_index = prompt.find('Runtime context:')
        self.assertLess(overview_index, runtime_index)

    def test_build_system_prompt_omits_overview_section_when_missing(self) -> None:
        prompt = self.manager.build_system_prompt('chat', {'foo': 'bar'})
        # The full injected header must not appear when no overview is provided.
        self.assertNotIn(
            'Current roadmap (reference this when advising or planning next steps):',
            prompt,
        )

    def test_build_system_prompt_omits_overview_section_when_empty_string(self) -> None:
        prompt = self.manager.build_system_prompt(
            'chat',
            {'foo': 'bar', 'roadmap_overview_summary': '   '},
        )
        self.assertNotIn(
            'Current roadmap (reference this when advising or planning next steps):',
            prompt,
        )


class ChooseVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_env_override_cache()

    def tearDown(self) -> None:
        _clear_env_override_cache()

    def test_default_version_when_no_override(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('AGENT_PROMPT_VERSION_OVERRIDE', None)
            _clear_env_override_cache()
            self.assertEqual(choose_version('chat_mode'), 'v1')

    def test_env_override_applied(self) -> None:
        with patch.dict(
            os.environ,
            {'AGENT_PROMPT_VERSION_OVERRIDE': 'chat_mode=v1,edit_mode=v1'},
        ):
            _clear_env_override_cache()
            self.assertEqual(choose_version('chat_mode'), 'v1')
            self.assertEqual(choose_version('edit_mode'), 'v1')
            # Non-overridden template falls back to default
            self.assertEqual(choose_version('plan_mode'), 'v1')

    def test_malformed_env_entries_ignored(self) -> None:
        parsed = _parse_env_overrides('good=v2,=broken,alsobroken,trailing=')
        self.assertEqual(parsed, {'good': 'v2'})


class PromptRepositoryShimTests(unittest.TestCase):
    """Ensure existing callers of PromptRepository still work after the
    PromptManager migration. The shim must preserve signatures and output
    shapes exactly.
    """

    def setUp(self) -> None:
        _clear_env_override_cache()
        self.repo = PromptRepository()

    def test_load_with_md_suffix(self) -> None:
        self.assertTrue(self.repo.load('chat_mode.md'))

    def test_load_without_md_suffix(self) -> None:
        self.assertTrue(self.repo.load('chat_mode'))

    def test_load_missing_returns_empty_string(self) -> None:
        # Backcompat: pre-refactor behavior returned '' on missing file.
        self.assertEqual(self.repo.load('nonexistent_template'), '')

    def test_build_system_prompt_matches_expected_shape(self) -> None:
        prompt = self.repo.build_system_prompt('edit', {'roadmap_id': 'r1'})
        self.assertIn('Runtime context:', prompt)
        self.assertIn('"roadmap_id":"r1"', prompt)

    def test_intent_classifier_prompt_non_empty(self) -> None:
        self.assertTrue(self.repo.intent_classifier_prompt())


if __name__ == '__main__':
    unittest.main()
