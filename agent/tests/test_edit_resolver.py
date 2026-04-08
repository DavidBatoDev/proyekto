import unittest

from app.core.orchestration.edits.edit_resolver import (
    extract_create_intent,
    parse_selection_index,
    resolve_candidates,
)


class EditResolverTests(unittest.TestCase):
    def test_resolve_unique_candidate(self) -> None:
        result = resolve_candidates(
            [
                {
                    'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    'type': 'epic',
                    'title': 'Platform Foundation',
                    'score': 1.2,
                    'matched_fields': ['title', 'type_hint'],
                }
            ],
            label='Platform Foundation',
            node_type='epic',
        )
        self.assertEqual(result.status, 'unique')
        self.assertIsNotNone(result.selected)
        assert result.selected is not None
        self.assertEqual(result.selected.id, 'dad5697a-8962-4f80-8bc3-8a964edd8e56')
        self.assertEqual(result.selected.matched_fields, ['title', 'type_hint'])

    def test_resolve_ambiguous_candidates(self) -> None:
        result = resolve_candidates(
            [
                {'id': '1', 'type': 'epic', 'title': 'Platform Foundation', 'score': 1.0},
                {'id': '2', 'type': 'epic', 'title': 'Platform Foundation', 'score': 0.95},
            ],
            label='Platform Foundation',
            node_type='epic',
        )
        self.assertEqual(result.status, 'ambiguous')
        self.assertEqual(len(result.candidates), 2)

    def test_resolve_falls_back_when_backend_score_missing(self) -> None:
        result = resolve_candidates(
            [
                {'id': '1', 'type': 'epic', 'title': 'Platform Foundation'},
            ],
            label='Platform Foundation',
            node_type='epic',
        )
        self.assertEqual(result.status, 'unique')
        self.assertIsNotNone(result.selected)

    def test_resolve_single_low_confidence_candidate_returns_not_found(self) -> None:
        result = resolve_candidates(
            [
                {'id': '1', 'type': 'epic', 'title': 'Platform Foundation'},
            ],
            label='Autenthication System',
            node_type='epic',
        )
        self.assertEqual(result.status, 'not_found')
        self.assertIsNone(result.selected)
        self.assertEqual(len(result.candidates), 1)

    def test_resolve_typo_label_still_matches_expected_epic(self) -> None:
        result = resolve_candidates(
            [
                {'id': '1', 'type': 'epic', 'title': 'Authentication System'},
            ],
            label='Autenthication System',
            node_type='epic',
        )
        self.assertEqual(result.status, 'unique')
        self.assertIsNotNone(result.selected)
        assert result.selected is not None
        self.assertEqual(result.selected.title, 'Authentication System')

    def test_parse_selection_index(self) -> None:
        self.assertEqual(parse_selection_index('first'), 1)
        self.assertEqual(parse_selection_index('the first'), 1)
        self.assertEqual(parse_selection_index('option 2'), 2)
        self.assertEqual(parse_selection_index('2'), 2)
        self.assertIsNone(parse_selection_index('the first one'))
        self.assertIsNone(parse_selection_index('Foundation1'))
        self.assertIsNone(parse_selection_index('rename to v2'))
        self.assertIsNone(parse_selection_index('option 1 rename this'))
        self.assertIsNone(parse_selection_index('pick whichever is best'))

    def test_extract_create_epic_intent(self) -> None:
        intent = extract_create_intent('Create a new Epic called "AI Module"')
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.node_type, 'epic')
        self.assertEqual(intent.title, 'AI Module')
        self.assertFalse(intent.allow_duplicate)

    def test_extract_create_epic_intent_with_conversational_prefix(self) -> None:
        intent = extract_create_intent(
            'Can you create new epic for me called "AI Module"'
        )
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.node_type, 'epic')
        self.assertEqual(intent.title, 'AI Module')

    def test_extract_create_epic_intent_with_named_anchor(self) -> None:
        intent = extract_create_intent('Please add a new epic named "AI Module"')
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.node_type, 'epic')
        self.assertEqual(intent.title, 'AI Module')

    def test_extract_create_epic_intent_without_quotes(self) -> None:
        intent = extract_create_intent('Create epic called AI Module')
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.node_type, 'epic')
        self.assertEqual(intent.title, 'AI Module')

    def test_extract_create_epic_intent_with_here_suffix(self) -> None:
        intent = extract_create_intent('Create AI Module here')
        self.assertIsNone(intent)

    def test_extract_add_epic_intent_without_type_hint(self) -> None:
        intent = extract_create_intent('Add AI Module')
        self.assertIsNone(intent)

    def test_extract_create_epic_intent_rejects_empty_title(self) -> None:
        intent = extract_create_intent('Can you create new epic for me called ""')
        self.assertIsNone(intent)

    def test_extract_create_feature_intent_with_parent(self) -> None:
        intent = extract_create_intent(
            'Add feature User Auth under Platform Foundation epic'
        )
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.node_type, 'feature')
        self.assertEqual(intent.title, 'User Auth')
        self.assertEqual(intent.parent_label, 'Platform Foundation')
        self.assertEqual(intent.parent_node_type, 'epic')

    def test_extract_create_intent_does_not_overmatch_feature_batch(self) -> None:
        intent = extract_create_intent('add three features "Framework","LLM","Tools"')
        self.assertIsNone(intent)


if __name__ == '__main__':
    unittest.main()
