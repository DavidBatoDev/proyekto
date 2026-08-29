"""One-shot brief generation.

Deliberately NOT the v2 tool-calling loop. That loop exists to read and mutate a
roadmap across many turns with a session, an undo log and a staged-operation
contract; this is a single stateless call that turns a paragraph into prose.
Routing it through the loop would buy nothing and would put a marketing-copy
prompt inside the thing that edits people's roadmaps.

The model is pinned to a JSON schema so a malformed draft fails here, in one
place, rather than halfway through rendering an editor.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.contracts.briefs import (
    GenerateBriefRequest,
    GenerateBriefResponse,
    GeneratedSection,
)

logger = logging.getLogger(__name__)

# The sections a good brief tends to have, in the order a reader wants them.
# The model may return a subset — a two-week logo job does not need a
# "Technical considerations" heading, and inventing one produces filler.
RECOMMENDED_SECTIONS = [
    'Scope of work',
    'Deliverables',
    'Ideal consultant',
    'Technical considerations',
    'Success criteria',
]

BRIEF_JSON_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['title', 'engagement_type', 'summary', 'sections'],
    'properties': {
        'title': {
            'type': 'string',
            'description': 'A short, specific project name. No marketing adjectives.',
        },
        'engagement_type': {
            'type': 'string',
            'enum': ['ongoing', 'one_time'],
            'description': (
                'one_time for a project with an end state; ongoing for '
                'continuous collaboration with no fixed finish.'
            ),
        },
        'summary': {
            'type': 'string',
            'description': (
                'One paragraph: what is being built, for whom, and why. '
                'Plain text, no markdown headings.'
            ),
        },
        'sections': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['key', 'value'],
                'properties': {
                    'key': {'type': 'string', 'description': 'The section heading.'},
                    'value': {
                        'type': 'string',
                        'description': (
                            'The section body. Use "- " bullets for lists; '
                            'no markdown headings inside a section.'
                        ),
                    },
                },
            },
        },
    },
}

SYSTEM_PROMPT = """You turn a client's rough description of a project into a \
structured project brief that independent consultants will read and respond to.

Rules:
- Use only what the client told you. Do not invent budgets, deadlines, company \
names, team sizes, or technologies they did not mention.
- Where the description is vague, write the section at the level of detail the \
client actually gave. A short brief is better than a padded one.
- Write for a consultant deciding whether to propose: concrete scope, real \
constraints, no sales language.
- Prefer these section headings where they apply, in this order: {sections}. \
Omit any that the description gives you nothing to say about, and add your own \
heading if the project genuinely needs one.
- Second person ("you will", "your users") is wrong here. Write about the work, \
not about the reader.
"""


def _build_prompt(payload: GenerateBriefRequest) -> list[dict[str, Any]]:
    system = SYSTEM_PROMPT.format(sections=', '.join(RECOMMENDED_SECTIONS))
    user = payload.description
    if payload.category_hint:
        user = f'Discipline: {payload.category_hint}\n\n{user}'
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user},
    ]


def _extract_output_text(response: Any) -> str:
    """Pull the text payload out of a Responses API result.

    `output_text` is the documented convenience accessor; the manual walk is the
    fallback for SDK versions and stubs that do not expose it.
    """
    text = getattr(response, 'output_text', None)
    if isinstance(text, str) and text.strip():
        return text

    chunks: list[str] = []
    for item in getattr(response, 'output', None) or []:
        for part in getattr(item, 'content', None) or []:
            part_text = getattr(part, 'text', None)
            if isinstance(part_text, str):
                chunks.append(part_text)
    return ''.join(chunks)


def generate_brief(
    payload: GenerateBriefRequest,
    *,
    client: Any,
    model: str,
    max_output_tokens: int,
) -> GenerateBriefResponse:
    """Draft a brief. Raises ValueError when the model returns something unusable."""
    response = client.responses.create(
        model=model,
        input=_build_prompt(payload),
        max_output_tokens=max_output_tokens,
        store=False,
        text={
            'format': {
                'type': 'json_schema',
                'name': 'project_brief',
                'strict': True,
                'schema': BRIEF_JSON_SCHEMA,
            },
        },
    )

    raw = _extract_output_text(response)
    if not raw.strip():
        raise ValueError('the model returned an empty brief')

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        # Strict json_schema makes this close to impossible; it is here because
        # "close to impossible" still shows up in production logs eventually.
        raise ValueError(f'the model returned malformed JSON: {exc}') from exc

    sections = [
        GeneratedSection(
            key=str(section.get('key', '')).strip() or 'Details',
            value=str(section.get('value', '')).strip(),
            position=index,
        )
        for index, section in enumerate(parsed.get('sections') or [])
        # An empty body renders as a heading with a hole under it, which reads
        # as a bug rather than as an invitation to fill it in.
        if str(section.get('value', '')).strip()
    ]

    return GenerateBriefResponse(
        title=str(parsed.get('title', '')).strip(),
        engagement_type=(
            'ongoing' if parsed.get('engagement_type') == 'ongoing' else 'one_time'
        ),
        summary=str(parsed.get('summary', '')).strip(),
        sections=sections,
    )
