"""Document intake: classify and extract (docs/13-proposals/document-intake.md).

Both calls take the original file (a PDF via input_file, or a photo via
input_image) and return JSON pinned to a strict schema. The agent never
decides anything: every value it returns is a draft that a person confirms in
the review screen, and NestJS stores it.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.documents import (
    ClassifiedDocument,
    ClassifyPagesRequest,
    ClassifyPagesResponse,
    ExtractDocumentRequest,
    ExtractDocumentResponse,
    ExtractedField,
    ReadJsonRequest,
    ReadJsonResponse,
)
from app.core.documents.common import json_call

DOC_TYPES = ['contract', 'amendment', 'invoice', 'receipt', 'proof_of_payment', 'other']

# Below this a value is shown as Unsure and must be confirmed by a person.
CONFIDENCE_THRESHOLD = 0.85

# The fields each type is read for. Names are the keys the review screen and
# the replicate step use; keep them in step with backend document-intake.
FIELDS_BY_TYPE: dict[str, list[str]] = {
    'contract': [
        'title',
        'provider_name',
        'provider_email',
        'provider_address',
        'provider_tax_id',
        'client_name',
        'client_email',
        'client_address',
        'client_tax_id',
        'date_signed',
        'service_start',
        'service_end',
        'currency',
        'billing_mode',
        'rate_amount',
        'billing_timing',
        'payment_terms_days',
        'notice_days',
    ],
    'amendment': [
        'amends_reference',
        'provider_name',
        'client_name',
        'date_signed',
        'effective_date',
        'currency',
        'rate_amount',
        'billing_mode',
        'notice_days',
        'summary_of_changes',
    ],
    'invoice': [
        'number',
        'issuer',
        'recipient',
        'issue_date',
        'due_date',
        'currency',
        'subtotal',
        'tax',
        'total',
    ],
    'receipt': [
        'payer',
        'payee',
        'amount',
        'currency',
        'payment_date',
        'reference',
        'invoice_numbers',
    ],
    'proof_of_payment': [
        'payer',
        'payee',
        'amount',
        'currency',
        'payment_date',
        'reference',
        'invoice_numbers',
    ],
    'other': [],
}

CLASSIFY_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['documents'],
    'properties': {
        'documents': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['doc_type', 'page_start', 'page_end', 'language', 'confidence'],
                'properties': {
                    'doc_type': {'type': 'string', 'enum': DOC_TYPES},
                    'page_start': {'type': 'integer'},
                    'page_end': {'type': 'integer'},
                    'language': {'type': 'string'},
                    'confidence': {'type': 'number'},
                },
            },
        },
    },
}

EXTRACT_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['language', 'fields', 'clauses', 'line_items'],
    'properties': {
        'language': {'type': 'string'},
        'fields': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['name', 'value', 'confidence', 'page', 'box'],
                'properties': {
                    'name': {'type': 'string'},
                    'value': {'type': ['string', 'null']},
                    'confidence': {'type': 'number'},
                    'page': {'type': ['integer', 'null']},
                    'box': {
                        'type': ['array', 'null'],
                        'items': {'type': 'number'},
                    },
                },
            },
        },
        'clauses': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['number', 'title', 'body'],
                'properties': {
                    'number': {'type': 'string'},
                    'title': {'type': 'string'},
                    'body': {'type': 'string'},
                },
            },
        },
        'line_items': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['description', 'quantity', 'unit_rate', 'amount'],
                'properties': {
                    'description': {'type': 'string'},
                    'quantity': {'type': ['number', 'null']},
                    'unit_rate': {'type': ['number', 'null']},
                    'amount': {'type': ['number', 'null']},
                },
            },
        },
    },
}

CLASSIFY_PROMPT = """You split an uploaded file into the separate documents it \
contains and classify each one.

A single scan often holds several documents (a contract followed by three \
invoices). Use page headings, page numbering that restarts, letterheads and \
signature pages to find the breaks. Types: contract (a signed service or \
consulting agreement), amendment (changes an earlier agreement), invoice, \
receipt, proof_of_payment (a bank record or transfer confirmation), other.

Return one entry per document with its 1-based inclusive page range, the \
ISO 639-1 code of its main language, and your confidence 0..1. Every page \
belongs to exactly one document."""

EXTRACT_PROMPT = """You read one {doc_type} (pages {page_start}-{page_end} of \
the file) and return its fields.

Return exactly these field names: {fields}.
Rules:
- Copy values exactly as written. Never invent a value that is not on the page.
- Handwriting counts: read it, and lower your confidence when unsure.
- If a field's place is visible but unreadable, or the field is absent, return \
value null and confidence 0.
- Dates as YYYY-MM-DD. Amounts as plain numbers without separators or \
symbols. Currency as a 3-letter ISO code.
- billing_mode is one of fixed, retainer (a monthly fee), time_based (hourly), \
hybrid. billing_timing is advance or arrears.
- page is the 1-based page of the file the value is on; box is [x, y, width, \
height] as fractions 0..1 of that page when you can locate it, else null.
- clauses: for a contract or amendment, its clauses in order, split at each \
numbered heading, with the text copied. Empty otherwise.
- line_items: for an invoice, its lines. Empty otherwise.
- language: the ISO 639-1 code of the document's main language."""

REREAD_PROMPT = """The image is a region cropped from a document by a person \
who says it contains the field "{field}". Return that one field, named \
"{field}", read exactly as written (handwriting included), with page and box \
null. Dates as YYYY-MM-DD, amounts as plain numbers. If it is unreadable, \
return value null and confidence 0. clauses and line_items are empty."""


def _file_part(mime_type: str, file_name: str, data_url: str, detail: str) -> dict[str, Any]:
    if mime_type == 'application/pdf':
        return {'type': 'input_file', 'filename': file_name or 'document.pdf', 'file_data': data_url}
    return {'type': 'input_image', 'image_url': data_url, 'detail': detail}


def classify_pages(
    payload: ClassifyPagesRequest,
    *,
    client: Any,
    model: str,
    max_output_tokens: int,
) -> ClassifyPagesResponse:
    page_count = max(1, payload.page_count)
    content = [
        {'type': 'input_text', 'text': f'The file has {page_count} page(s). File name: {payload.file_name}.'},
        _file_part(payload.mime_type, payload.file_name, payload.file_data_url, 'low'),
    ]
    parsed = json_call(
        client,
        model=model,
        system=CLASSIFY_PROMPT,
        content=content,
        schema=CLASSIFY_SCHEMA,
        schema_name='intake_classification',
        max_output_tokens=max_output_tokens,
    )
    documents: list[ClassifiedDocument] = []
    for raw in parsed.get('documents') or []:
        start = min(max(1, int(raw.get('page_start') or 1)), page_count)
        end = min(max(start, int(raw.get('page_end') or start)), page_count)
        doc_type = raw.get('doc_type') if raw.get('doc_type') in DOC_TYPES else 'other'
        documents.append(
            ClassifiedDocument(
                doc_type=doc_type,
                page_start=start,
                page_end=end,
                language=str(raw.get('language') or 'en')[:8].lower(),
                confidence=max(0.0, min(1.0, float(raw.get('confidence') or 0))),
            )
        )
    documents.sort(key=lambda d: d.page_start)
    if not documents:
        documents = [
            ClassifiedDocument(
                doc_type='other', page_start=1, page_end=page_count, language='en', confidence=0.0
            )
        ]
    return ClassifyPagesResponse(documents=documents, model=model)


def _field_status(value: Any, confidence: float) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return 'missing'
    return 'read' if confidence >= CONFIDENCE_THRESHOLD else 'unsure'


def extract_document(
    payload: ExtractDocumentRequest,
    *,
    client: Any,
    model: str,
    max_output_tokens: int,
) -> ExtractDocumentResponse:
    if payload.field:
        wanted = [payload.field]
        system = REREAD_PROMPT.format(field=payload.field)
    else:
        wanted = FIELDS_BY_TYPE.get(payload.doc_type, [])
        system = EXTRACT_PROMPT.format(
            doc_type=payload.doc_type.replace('_', ' '),
            page_start=payload.page_start,
            page_end=payload.page_end,
            fields=', '.join(wanted) or '(none)',
        )
    content = [
        _file_part(payload.mime_type, payload.file_name, payload.file_data_url, 'high'),
    ]
    parsed = json_call(
        client,
        model=model,
        system=system,
        content=content,
        schema=EXTRACT_SCHEMA,
        schema_name='intake_extraction',
        max_output_tokens=max_output_tokens,
    )
    by_name = {
        str(raw.get('name')): raw for raw in parsed.get('fields') or [] if raw.get('name') in wanted
    }
    fields: dict[str, ExtractedField] = {}
    for name in wanted:
        raw = by_name.get(name) or {}
        value = raw.get('value')
        confidence = max(0.0, min(1.0, float(raw.get('confidence') or 0)))
        box = raw.get('box')
        if not (isinstance(box, list) and len(box) == 4):
            box = None
        fields[name] = ExtractedField(
            value=value,
            confidence=confidence if value is not None else 0.0,
            page=raw.get('page'),
            box=box,
            status=_field_status(value, confidence),
        )
    return ExtractDocumentResponse(
        doc_type=payload.doc_type,
        language=str(parsed.get('language') or 'en')[:8].lower(),
        fields=fields,
        clauses=[c for c in parsed.get('clauses') or [] if str(c.get('body', '')).strip()],
        line_items=list(parsed.get('line_items') or []),
        model=model,
    )


def read_json(
    payload: ReadJsonRequest,
    *,
    client: Any,
    model: str,
    max_output_tokens: int,
) -> ReadJsonResponse:
    """The invoice reader, moved off the backend's key: prompt from NestJS."""
    content: list[dict[str, Any]] = []
    if payload.text:
        content.append({'type': 'input_text', 'text': payload.text})
    if payload.image_data_url:
        content.append({'type': 'input_image', 'image_url': payload.image_data_url, 'detail': 'high'})
    if not content:
        raise ValueError('nothing to read')
    parsed = json_call(
        client,
        model=model,
        system=payload.system,
        content=content,
        schema=None,
        schema_name='document_read',
        max_output_tokens=max_output_tokens,
    )
    return ReadJsonResponse(data=parsed, model=model)
