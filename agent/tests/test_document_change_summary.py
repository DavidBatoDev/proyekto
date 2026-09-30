import json
import unittest

from app.core.contracts.documents import ChangeRow, SummarizeChangesRequest
from app.core.documents.change_summary import SUMMARY_SCHEMA, summarize_changes


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


def _payload(rows=None) -> SummarizeChangesRequest:
    return SummarizeChangesRequest(
        seat='hirer',
        seat_label='Client',
        from_version=1,
        to_version=2,
        effective_from='2026-09-01',
        rows=rows
        if rows is not None
        else [
            ChangeRow(
                id='field:client_hourly_rate',
                kind='field',
                label='Hourly rate',
                before=80,
                after=95,
            )
        ],
    )


class ChangeSummaryTests(unittest.TestCase):
    def test_keeps_only_bullets_that_cite_real_rows(self):
        client = _StubClient(
            json.dumps(
                {
                    'headline': 'Changes in v2',
                    'bullets': [
                        {'text': 'Rate rises 80 to 95.', 'row_ids': ['field:client_hourly_rate']},
                        {'text': 'Invented change.', 'row_ids': ['field:notice_days']},
                        {'text': 'No citation.', 'row_ids': []},
                    ],
                    'for_you': 'You pay more per hour.',
                }
            )
        )

        result = summarize_changes(
            _payload(), client=client, model='m', max_output_tokens=100
        )

        self.assertEqual([b.text for b in result.bullets], ['Rate rises 80 to 95.'])
        self.assertEqual(result.for_you, 'You pay more per hour.')
        self.assertEqual(result.model, 'm')

    def test_sends_rows_not_documents_under_a_strict_schema(self):
        client = _StubClient(json.dumps({'headline': 'h', 'bullets': [], 'for_you': None}))

        summarize_changes(_payload(), client=client, model='m', max_output_tokens=100)

        call = client.responses.calls[0]
        self.assertEqual(call['text']['format']['schema'], SUMMARY_SCHEMA)
        self.assertTrue(call['text']['format']['strict'])
        self.assertFalse(call['store'])
        user = call['input'][1]['content'][0]['text']
        self.assertIn('field:client_hourly_rate', user)

    def test_no_rows_means_no_model_call(self):
        client = _StubClient('{}')

        result = summarize_changes(
            _payload(rows=[]), client=client, model='m', max_output_tokens=100
        )

        self.assertEqual(client.responses.calls, [])
        self.assertEqual(result.bullets, [])

    def test_malformed_reply_raises_value_error(self):
        client = _StubClient('not json')
        with self.assertRaises(ValueError):
            summarize_changes(_payload(), client=client, model='m', max_output_tokens=100)


if __name__ == '__main__':
    unittest.main()
