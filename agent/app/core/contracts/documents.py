"""Wire contracts for the document AI routes (app/api/routes/documents.py).

These routes are reached only from the NestJS backend, which authorizes the
human and computes everything that touches data. The agent receives already
authorized, already filtered input and returns JSON; it never reads or writes
the database.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

Seat = Literal['hirer', 'provider', 'viewer']


class ChangeRow(BaseModel):
    """One row of the deterministic diff NestJS computed. `id` is what a bullet cites."""

    id: str = Field(min_length=1, max_length=200)
    kind: Literal['field', 'clause', 'service']
    label: str = Field(max_length=300)
    change: Literal['added', 'removed', 'changed'] | None = None
    before: Any = None
    after: Any = None


class SummarizeChangesRequest(BaseModel):
    seat: Seat
    seat_label: str = Field(max_length=40)
    document_title: str = Field(default='Agreement', max_length=200)
    from_version: int = Field(ge=1)
    to_version: int = Field(ge=1)
    effective_from: str | None = None
    rows: list[ChangeRow] = Field(max_length=400)


class SummaryBullet(BaseModel):
    text: str
    row_ids: list[str]


class SummarizeChangesResponse(BaseModel):
    headline: str
    bullets: list[SummaryBullet]
    for_you: str | None
    model: str


class DocumentPage(BaseModel):
    """One page, as an image (data URL) and/or its text layer."""

    page: int = Field(ge=1)
    image_data_url: str | None = Field(default=None, max_length=12_000_000)
    text: str | None = Field(default=None, max_length=60_000)


class ClassifyPagesRequest(BaseModel):
    file_name: str = Field(default='', max_length=300)
    pages: list[DocumentPage] = Field(min_length=1, max_length=60)


class ClassifiedDocument(BaseModel):
    doc_type: Literal[
        'contract', 'amendment', 'invoice', 'receipt', 'proof_of_payment', 'other'
    ]
    page_start: int
    page_end: int
    language: str
    confidence: float


class ClassifyPagesResponse(BaseModel):
    documents: list[ClassifiedDocument]
    model: str


class ExtractDocumentRequest(BaseModel):
    doc_type: Literal[
        'contract', 'amendment', 'invoice', 'receipt', 'proof_of_payment', 'other'
    ]
    pages: list[DocumentPage] = Field(min_length=1, max_length=40)
    # A single region re-read ("assign a field by drawing a box"): the crop is
    # sent as the only page and `field` names what it should contain.
    field: str | None = Field(default=None, max_length=80)


class ExtractedField(BaseModel):
    value: Any = None
    confidence: float = 0.0
    page: int | None = None
    # [x, y, width, height] as fractions of the page, when the model can say.
    box: list[float] | None = None
    status: Literal['read', 'unsure', 'missing'] = 'missing'


class ExtractDocumentResponse(BaseModel):
    doc_type: str
    language: str
    fields: dict[str, ExtractedField]
    clauses: list[dict[str, Any]] = Field(default_factory=list)
    line_items: list[dict[str, Any]] = Field(default_factory=list)
    model: str


class ReadJsonRequest(BaseModel):
    """The invoice reader's call: a system prompt plus text or one image."""

    system: str = Field(min_length=1, max_length=8000)
    text: str | None = Field(default=None, max_length=60_000)
    image_data_url: str | None = Field(default=None, max_length=12_000_000)


class ReadJsonResponse(BaseModel):
    data: dict[str, Any]
    model: str
