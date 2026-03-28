import unittest

from app.core.orchestration.edit_resolver import (
    build_ambiguity_message,
    extract_rename_intent,
    parse_selection_index,
    resolve_candidates,
)


class EditResolverTests(unittest.TestCase):
    def test_extract_rename_intent_with_node_type(self) -> None:
        intent = extract_rename_intent(
            'Can you rename my Platform Foundation epic to Platform Foundation1?'
        )
        self.assertIsNotNone(intent)
        assert intent is not None
        self.assertEqual(intent.label, 'Platform Foundation')
        self.assertEqual(intent.new_title, 'Platform Foundation1')
        self.assertEqual(intent.node_type, 'epic')

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
        message = build_ambiguity_message('Platform Foundation', result.candidates)
        self.assertIn('Please choose one', message)

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


if __name__ == '__main__':
    unittest.main()
