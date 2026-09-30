import json
import unittest

from app.core.contracts.documents import (
    ClassifyPagesRequest,
    ExtractDocumentRequest,
    ReadJsonRequest,
)
from app.core.documents.intake import (
    CONFIDENCE_THRESHOLD,
    FIELDS_BY_TYPE,
    classify_pages,
    extract_document,
    read_json,
)

PDF = 'data:application/pdf;base64,JVBERi0xLjQK'
PNG = 'data:image/png;base64,iVBORw0KGgo='


class _Stub:
    def __init__(self, text: str) -> None:
        self.calls: list[dict] = []
        self._text = text
        self.responses = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type('R', (), {'output_text': self._text})()


class ClassifyTests(unittest.TestCase):
    def test_splits_a_scan_into_documents_clamped_to_the_file(self):
        stub = _Stub(
            json.dumps(
                {
                    'documents': [
                        {'doc_type': 'invoice', 'page_start': 5, 'page_end': 9, 'language': 'EN', 'confidence': 0.9},
                        {'doc_type': 'contract', 'page_start': 1, 'page_end': 4, 'language': 'en', 'confidence': 0.95},
                    ]
                }
            )
        )
        result = classify_pages(
            ClassifyPagesRequest(
                file_name='scan.pdf', mime_type='application/pdf', file_data_url=PDF, page_count=6
            ),
            client=stub,
            model='m',
            max_output_tokens=100,
        )
        self.assertEqual([d.doc_type for d in result.documents], ['contract', 'invoice'])
        self.assertEqual(result.documents[1].page_end, 6)
        self.assertEqual(result.documents[1].language, 'en')
        # A PDF goes to the model as a file, not as text we extracted.
        part = stub.calls[0]['input'][1]['content'][1]
        self.assertEqual(part['type'], 'input_file')

    def test_nothing_classified_becomes_one_other_document(self):
        result = classify_pages(
            ClassifyPagesRequest(mime_type='image/png', file_data_url=PNG),
            client=_Stub(json.dumps({'documents': []})),
            model='m',
            max_output_tokens=100,
        )
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(result.documents[0].doc_type, 'other')


class ExtractTests(unittest.TestCase):
    def test_every_field_is_read_unsure_or_missing(self):
        stub = _Stub(
            json.dumps(
                {
                    'language': 'en',
                    'fields': [
                        {'name': 'number', 'value': 'INV-7', 'confidence': 0.99, 'page': 1, 'box': [0.1, 0.1, 0.2, 0.05]},
                        {'name': 'total', 'value': '3840', 'confidence': CONFIDENCE_THRESHOLD - 0.2, 'page': 1, 'box': None},
                        {'name': 'invented', 'value': 'x', 'confidence': 1, 'page': 1, 'box': None},
                    ],
                    'clauses': [],
                    'line_items': [{'description': 'Build', 'quantity': 1, 'unit_rate': 3840, 'amount': 3840}],
                }
            )
        )
        result = extract_document(
            ExtractDocumentRequest(doc_type='invoice', mime_type='image/png', file_data_url=PNG),
            client=stub,
            model='m',
            max_output_tokens=100,
        )
        self.assertEqual(set(result.fields), set(FIELDS_BY_TYPE['invoice']))
        self.assertEqual(result.fields['number'].status, 'read')
        self.assertEqual(result.fields['total'].status, 'unsure')
        self.assertEqual(result.fields['due_date'].status, 'missing')
        self.assertNotIn('invented', result.fields)
        self.assertEqual(len(result.line_items), 1)

    def test_a_drawn_box_rereads_one_field(self):
        stub = _Stub(
            json.dumps(
                {
                    'language': 'en',
                    'fields': [{'name': 'service_start', 'value': '2026-03-02', 'confidence': 0.7, 'page': None, 'box': None}],
                    'clauses': [],
                    'line_items': [],
                }
            )
        )
        result = extract_document(
            ExtractDocumentRequest(
                doc_type='contract', mime_type='image/png', file_data_url=PNG, field='service_start'
            ),
            client=stub,
            model='m',
            max_output_tokens=100,
        )
        self.assertEqual(list(result.fields), ['service_start'])
        self.assertIn('service_start', stub.calls[0]['input'][0]['content'])


class ReadJsonTests(unittest.TestCase):
    def test_invoice_reader_runs_on_the_agent(self):
        stub = _Stub(json.dumps({'number': 'A1'}))
        result = read_json(
            ReadJsonRequest(system='Return JSON.', text='Invoice A1'),
            client=stub,
            model='m',
            max_output_tokens=100,
        )
        self.assertEqual(result.data, {'number': 'A1'})
        self.assertEqual(stub.calls[0]['text']['format'], {'type': 'json_object'})

    def test_needs_text_or_an_image(self):
        with self.assertRaises(ValueError):
            read_json(ReadJsonRequest(system='x'), client=_Stub('{}'), model='m', max_output_tokens=10)


if __name__ == '__main__':
    unittest.main()
