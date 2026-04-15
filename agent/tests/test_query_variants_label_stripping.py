import logging
import unittest
from unittest.mock import MagicMock

from app.core.config import get_settings
from app.core.llm.context.handlers.base import ToolHandlerBase


def _make_handler() -> ToolHandlerBase:
    return ToolHandlerBase(
        settings=get_settings(),
        logger=logging.getLogger('test'),
        nest_client=MagicMock(),
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=64,
    )


class QueryVariantsLabelStrippingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.handler = _make_handler()

    def test_my_prefix_yields_stripped_variant_first(self) -> None:
        variants = self.handler._query_variants('My PM Module')
        self.assertEqual(variants[0], 'PM Module')
        self.assertIn('My PM Module', variants)

    def test_the_prefix_stripped(self) -> None:
        variants = self.handler._query_variants('the Onboarding epic')
        self.assertEqual(variants[0], 'Onboarding epic')

    def test_our_prefix_stripped(self) -> None:
        variants = self.handler._query_variants('our Agent Core')
        self.assertIn('Agent Core', variants)

    def test_article_prefix_stripped(self) -> None:
        variants = self.handler._query_variants('an API Layer')
        self.assertEqual(variants[0], 'API Layer')

    def test_nested_determiners_stripped(self) -> None:
        variants = self.handler._query_variants('the my App')
        self.assertEqual(variants[0], 'App')

    def test_no_noise_words_unchanged(self) -> None:
        variants = self.handler._query_variants('PM Module')
        self.assertEqual(variants[0], 'PM Module')
        # No duplicate stripped variant when base already clean.
        self.assertEqual(variants.count('PM Module'), 1)

    def test_mid_word_my_not_stripped(self) -> None:
        variants = self.handler._query_variants('myProject')
        self.assertEqual(variants[0], 'myProject')

    def test_only_noise_words_degenerate_case(self) -> None:
        variants = self.handler._query_variants('My')
        # After stripping "my" we get empty; fall back to base.
        self.assertIn('My', variants)


if __name__ == '__main__':
    unittest.main()
