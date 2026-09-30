"""Shared plumbing for the one-shot document calls.

Like the brief generator, these are single stateless Responses API calls pinned
to a JSON schema, not the v2 tool-calling loop.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


def output_text(response: Any) -> str:
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


def json_call(
    client: Any,
    *,
    model: str,
    system: str,
    content: list[dict[str, Any]] | str,
    schema: dict[str, Any] | None,
    schema_name: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    """One structured call. Raises ValueError on an empty or malformed reply."""
    user_content = (
        [{'type': 'input_text', 'text': content}] if isinstance(content, str) else content
    )
    text_format: dict[str, Any] = (
        {
            'type': 'json_schema',
            'name': schema_name,
            'strict': True,
            'schema': schema,
        }
        if schema
        else {'type': 'json_object'}
    )
    started = time.perf_counter()
    response = client.responses.create(
        model=model,
        input=[
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user_content},
        ],
        max_output_tokens=max_output_tokens,
        store=False,
        text={'format': text_format},
    )
    usage = getattr(response, 'usage', None)
    logger.info(
        'documents.json_call schema=%s model=%s input_tokens=%s output_tokens=%s ms=%d',
        schema_name,
        model,
        getattr(usage, 'input_tokens', None),
        getattr(usage, 'output_tokens', None),
        (time.perf_counter() - started) * 1000,
    )
    raw = output_text(response)
    if not raw.strip():
        raise ValueError('the model returned nothing')
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f'the model returned malformed JSON: {exc}') from exc
    if not isinstance(parsed, dict):
        raise ValueError('the model returned a non-object')
    return parsed
