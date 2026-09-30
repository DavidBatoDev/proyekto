"""The AI change summary between two contract versions.

The input is the diff NestJS computed, never the documents. The model EXPLAINS
changes; it does not find them. Every bullet must cite the ids of the rows it
describes, and this module drops any bullet that cites nothing real before the
answer leaves the agent (NestJS checks again on its side).
"""

from __future__ import annotations

import json
from typing import Any

from app.core.contracts.documents import (
    SummarizeChangesRequest,
    SummarizeChangesResponse,
    SummaryBullet,
)
from app.core.documents.common import json_call

SUMMARY_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['headline', 'bullets', 'for_you'],
    'properties': {
        'headline': {'type': 'string'},
        'bullets': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['text', 'row_ids'],
                'properties': {
                    'text': {'type': 'string'},
                    'row_ids': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        },
        'for_you': {'type': ['string', 'null']},
    },
}

SYSTEM_PROMPT = """You explain, in plain language, what changed between two \
versions of a services contract, for one of its parties.

You receive the complete list of changes as rows, each with an id. Rules:
- Explain only the rows you are given. Never mention a change that is not a row.
- Every bullet must list, in row_ids, the ids of the rows it explains.
- Quote figures exactly as they appear (currency, amounts, days, dates). When a \
number rises or falls, you may give the percentage.
- One bullet per meaningful change; group rows only when they describe one \
change (a rate and its currency, a clause and its title).
- headline: one short line, e.g. "Changes in v2 (effective 1 Sep)".
- for_you: two or three sentences on what the changes mean for the reader, \
whose side is given as the seat. Practical, not legal advice. Null if nothing \
changes for them.
- No markdown, no legal advice, no recommendations to sign or not sign.
"""


def _render_rows(payload: SummarizeChangesRequest) -> str:
    rows = [row.model_dump() for row in payload.rows]
    header = {
        'document': payload.document_title,
        'from_version': payload.from_version,
        'to_version': payload.to_version,
        'effective_from': payload.effective_from,
        'reader_seat': payload.seat,
        'reader_is': payload.seat_label,
    }
    return json.dumps({'context': header, 'rows': rows}, default=str)


def summarize_changes(
    payload: SummarizeChangesRequest,
    *,
    client: Any,
    model: str,
    max_output_tokens: int,
) -> SummarizeChangesResponse:
    if not payload.rows:
        return SummarizeChangesResponse(
            headline='These versions have the same terms.',
            bullets=[],
            for_you=None,
            model=model,
        )
    parsed = json_call(
        client,
        model=model,
        system=SYSTEM_PROMPT,
        content=_render_rows(payload),
        schema=SUMMARY_SCHEMA,
        schema_name='contract_change_summary',
        max_output_tokens=max_output_tokens,
    )
    known = {row.id for row in payload.rows}
    bullets: list[SummaryBullet] = []
    for raw in parsed.get('bullets') or []:
        text = str(raw.get('text', '')).strip()
        cited = [rid for rid in raw.get('row_ids') or [] if rid in known]
        if text and cited:
            bullets.append(SummaryBullet(text=text, row_ids=list(dict.fromkeys(cited))))
    for_you = parsed.get('for_you')
    return SummarizeChangesResponse(
        headline=str(parsed.get('headline', '')).strip(),
        bullets=bullets,
        for_you=str(for_you).strip() if isinstance(for_you, str) and for_you.strip() else None,
        model=model,
    )
