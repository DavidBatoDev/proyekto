"""Token counting backed by tiktoken.

Replaces string-length heuristics anywhere the agent needs to know how many
tokens a prompt, tool schema, or output payload actually costs. Used by the
commit-output estimator and the input-token guard.

Cold-start cost: tiktoken.encoding_for_model loads a BPE file (~30 ms on
first call per process). The LRU cache hangs on to that for the life of
the worker so subsequent calls are free. Warm the cache at startup if
serverless cold starts matter for latency.
"""

from __future__ import annotations

import functools
import logging
from typing import Any, Iterable

try:
    import tiktoken
except Exception:  # pragma: no cover
    tiktoken = None  # type: ignore[assignment]


_FALLBACK_ENCODING = 'cl100k_base'
_PER_MESSAGE_OVERHEAD_TOKENS = 3
_PER_NAME_OVERHEAD_TOKENS = 1
_REPLY_PRIMING_TOKENS = 3

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=16)
def get_encoder(model: str | None = None):
    """Return a cached tiktoken encoder. Falls back to cl100k_base on any
    failure (unknown model, missing tiktoken install, etc.) so callers
    don't need to guard against every edge case."""
    if tiktoken is None:
        raise RuntimeError('tiktoken is not installed')
    resolved = (model or '').strip() or _FALLBACK_ENCODING
    try:
        return tiktoken.encoding_for_model(resolved)
    except Exception:
        return tiktoken.get_encoding(_FALLBACK_ENCODING)


def count_tokens(text: str, *, model: str | None = None) -> int:
    """Token count for a raw string under the given model's tokenizer.
    Returns 0 for empty/None; never raises."""
    if not text:
        return 0
    if tiktoken is None:
        # Conservative fallback: 1 token per 4 chars is the widely used
        # ASCII approximation. Only used when tiktoken is unavailable.
        return max(1, len(text) // 4)
    try:
        return len(get_encoder(model).encode(text))
    except Exception:
        logger.warning('tiktoken encode failed, falling back to char heuristic')
        return max(1, len(text) // 4)


def count_message_tokens(
    messages: Iterable[dict[str, Any]], *, model: str | None = None
) -> int:
    """Token count for an OpenAI chat-messages list using the convention
    documented at https://platform.openai.com/docs/guides/prompt-caching:
    3 tokens per message structural overhead, +1 when `name` is set,
    +3 tokens to prime the assistant reply.
    """
    if not messages:
        return 0
    total = _REPLY_PRIMING_TOKENS
    for message in messages:
        if not isinstance(message, dict):
            continue
        total += _PER_MESSAGE_OVERHEAD_TOKENS
        for key in ('role', 'content', 'name'):
            value = message.get(key)
            if isinstance(value, str):
                total += count_tokens(value, model=model)
            elif isinstance(value, list):
                # Content can be a list of multimodal parts; count only
                # the text parts — everything else we don't budget for.
                for part in value:
                    if isinstance(part, dict) and isinstance(part.get('text'), str):
                        total += count_tokens(part['text'], model=model)
        if isinstance(message.get('name'), str) and message['name']:
            total += _PER_NAME_OVERHEAD_TOKENS
    return total


def warm_encoder_cache(models: Iterable[str | None] = ('gpt-4o-mini',)) -> None:
    """Call at process startup to pay the BPE-load cost off the hot path."""
    if tiktoken is None:
        return
    for model in models:
        try:
            get_encoder(model)
        except Exception:
            logger.warning('failed to warm tiktoken encoder for %s', model)
