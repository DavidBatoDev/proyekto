import json
import unittest

from app.core.briefs.generator import BRIEF_JSON_SCHEMA, generate_brief
from app.core.contracts.briefs import GenerateBriefRequest

DESCRIPTION = (
    'I want to build a marketplace that connects event organizers with '
    'suppliers such as caterers, venues and photographers.'
)


class _StubResponse:
    def __init__(self, text: str) -> None:
        self.output_text = text


class _StubResponses:
    def __init__(self, text: str) -> None:
        self._text = text
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _StubResponse(self._text)


class _StubClient:
    def __init__(self, text: str) -> None:
        self.responses = _StubResponses(text)


def _payload(**over) -> GenerateBriefRequest:
    return GenerateBriefRequest(description=DESCRIPTION, **over)


def _draft(**over) -> str:
    body = {
        'title': 'Event supplier marketplace',
        'engagement_type': 'one_time',
        'summary': 'A marketplace connecting organizers with suppliers.',
        'sections': [
            {'key': 'Scope of work', 'value': '- Two user types'},
            {'key': 'Deliverables', 'value': '- A responsive web app'},
        ],
    }
    body.update(over)
    return json.dumps(body)


class BriefGeneratorTests(unittest.TestCase):
    def test_returns_sections_in_document_order(self):
        client = _StubClient(_draft())

        result = generate_brief(
            _payload(), client=client, model='m', max_output_tokens=100
        )

        self.assertEqual(result.title, 'Event supplier marketplace')
        self.assertEqual([s.key for s in result.sections],
                         ['Scope of work', 'Deliverables'])
        # Position is assigned here, not trusted from the model, so the editor
        # never has to cope with duplicates or gaps.
        self.assertEqual([s.position for s in result.sections], [0, 1])

    def test_drops_sections_with_an_empty_body(self):
        client = _StubClient(
            _draft(
                sections=[
                    {'key': 'Scope of work', 'value': '- Two user types'},
                    {'key': 'Budget', 'value': '   '},
                ]
            )
        )

        result = generate_brief(
            _payload(), client=client, model='m', max_output_tokens=100
        )

        self.assertEqual([s.key for s in result.sections], ['Scope of work'])
        self.assertEqual(result.sections[0].position, 0)

    def test_unknown_engagement_type_falls_back_to_one_time(self):
        client = _StubClient(_draft(engagement_type='whenever'))

        result = generate_brief(
            _payload(), client=client, model='m', max_output_tokens=100
        )

        self.assertEqual(result.engagement_type, 'one_time')

    def test_malformed_json_raises_value_error(self):
        client = _StubClient('not json at all')

        with self.assertRaises(ValueError):
            generate_brief(_payload(), client=client, model='m', max_output_tokens=100)

    def test_empty_output_raises_value_error(self):
        client = _StubClient('   ')

        with self.assertRaises(ValueError):
            generate_brief(_payload(), client=client, model='m', max_output_tokens=100)

    def test_pins_the_response_to_the_strict_schema(self):
        client = _StubClient(_draft())

        generate_brief(_payload(), client=client, model='m', max_output_tokens=100)

        kwargs = client.responses.calls[0]
        self.assertEqual(kwargs['text']['format']['type'], 'json_schema')
        self.assertTrue(kwargs['text']['format']['strict'])
        self.assertIs(kwargs['text']['format']['schema'], BRIEF_JSON_SCHEMA)
        # Never persist a client's project description on OpenAI's side.
        self.assertFalse(kwargs['store'])

    def test_category_hint_is_prepended_to_the_user_turn(self):
        client = _StubClient(_draft())

        generate_brief(
            _payload(category_hint='Programming & Tech'),
            client=client,
            model='m',
            max_output_tokens=100,
        )

        user_turn = client.responses.calls[0]['input'][1]['content']
        self.assertTrue(user_turn.startswith('Discipline: Programming & Tech'))
        self.assertIn(DESCRIPTION, user_turn)


if __name__ == '__main__':
    unittest.main()
