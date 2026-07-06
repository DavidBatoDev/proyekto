"""Thin synchronous OpenAI **Responses API** wrapper for the v2 loop.

The whole loop runs on ONE model (``settings.openai_model_v2``) with no
separate classifier. We use ``/v1/responses`` (not chat/completions) because
it's OpenAI's recommended interface for the GPT-5 reasoning family with
tools — it supports ``reasoning.effort`` together with function tools, which
chat/completions rejects for models like gpt-5.4-mini.

The SDK response is adapted into the provider-agnostic ``LLMResponse`` the loop
consumes (``content`` + ``tool_calls`` + ``raw_output``), so the loop is
unit-testable with a scripted fake exposing the same ``.complete()`` shape.
``raw_output`` is the verbatim list of Responses output items (reasoning +
function_call + message) that the loop echoes back into ``input`` next turn so
the API's reasoning-item ordering requirement is satisfied.

Synchronous on purpose: ``plan_message`` already runs in a worker thread with
no event loop, matching how v1's planner and the ToolDispatcher operate.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger('app.core.v2')

# Sentinel: distinguishes "caller passed no override" (fall back to the
# configured effort) from "caller explicitly passed None" (disable reasoning).
_USE_CONFIGURED_EFFORT: Any = object()


@dataclass
class ToolCall:
    id: str  # the Responses `call_id` — used to bind function_call_output
    name: str
    arguments: dict[str, Any]
    raw_arguments: str


@dataclass
class LLMResponse:
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    # Verbatim Responses output items (dicts) to echo back into `input`.
    raw_output: list[dict[str, Any]] = field(default_factory=list)
    finish_reason: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_total: int | None = None
    # Cached-prefix input tokens (charged at ~10%). Read from
    # usage.input_tokens_details.cached_tokens — the signal that OpenAI's
    # automatic prompt caching hit our stable system-prompt + state prefix.
    tokens_cached: int | None = None


class V2LLMClient:
    def __init__(
        self,
        settings: Any,
        model: str | None = None,
        prompt_cache_key: str | None = None,
    ) -> None:
        self._settings = settings
        # Optional override so auxiliary callers (e.g. the conversation
        # summarizer) can run on a cheaper model than the main loop.
        self._model = model or settings.openai_model_v2
        # Routes requests that share our stable system-prompt + roadmap-state
        # prefix to the same cache node, improving prompt-cache hit rate under
        # concurrency. OpenAI still auto-caches without it; this just pins it.
        self._prompt_cache_key = prompt_cache_key
        self._client: Any | None = None
        # Defensive: if a model rejects the `reasoning` param, drop it once and
        # remember for the rest of the process (no failed round-trip per turn).
        self._drop_reasoning = False
        # Same self-heal for streaming: if a stream fails to open or dies
        # mid-iteration, fall back to plain calls for the rest of the process.
        self._drop_streaming = False

    def _ensure_client(self) -> Any:
        if self._client is None:
            try:
                from openai import OpenAI
            except Exception as exc:  # pragma: no cover - import guard
                raise RuntimeError(f'openai sdk unavailable: {exc}') from exc
            self._client = OpenAI(api_key=self._settings.openai_api_key, timeout=90)
        return self._client

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        reasoning_effort: Any = _USE_CONFIGURED_EFFORT,
        on_text_delta: Callable[[str], None] | None = None,
    ) -> LLMResponse:
        client = self._ensure_client()
        return self._create(
            client,
            messages,
            tools,
            send_reasoning=not self._drop_reasoning,
            reasoning_effort=reasoning_effort,
            on_text_delta=on_text_delta,
        )

    def _create(
        self,
        client: Any,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        send_reasoning: bool,
        reasoning_effort: Any = _USE_CONFIGURED_EFFORT,
        on_text_delta: Callable[[str], None] | None = None,
    ) -> LLMResponse:
        # Per-call override wins; otherwise fall back to the configured effort.
        effort = (
            self._settings.openai_v2_reasoning_effort
            if reasoning_effort is _USE_CONFIGURED_EFFORT
            else reasoning_effort
        )
        kwargs: dict[str, Any] = {
            'model': self._model,
            'input': input_items,
            'tools': _to_responses_tools(tools),
            'tool_choice': 'auto',
            'store': False,
        }
        if self._settings.openai_v2_max_output_tokens is not None:
            kwargs['max_output_tokens'] = self._settings.openai_v2_max_output_tokens
        if self._prompt_cache_key:
            kwargs['prompt_cache_key'] = self._prompt_cache_key
        if send_reasoning and effort is not None:
            kwargs['reasoning'] = {'effort': effort}
        if self._settings.openai_v2_temperature is not None:
            kwargs['temperature'] = self._settings.openai_v2_temperature

        # Stream only when someone is listening for deltas: the summarizer and
        # other auxiliary callers pass no callback and keep plain calls.
        use_streaming = (
            on_text_delta is not None
            and bool(getattr(self._settings, 'openai_v2_streaming_enabled', False))
            and not self._drop_streaming
        )
        if use_streaming:
            try:
                return self._create_streaming(client, kwargs, on_text_delta)
            except Exception as exc:  # noqa: BLE001 — self-heal, then plain call
                if send_reasoning and _is_reasoning_unsupported(exc):
                    self._drop_reasoning = True
                    return self._create(
                        client,
                        input_items,
                        tools,
                        send_reasoning=False,
                        reasoning_effort=reasoning_effort,
                        on_text_delta=on_text_delta,
                    )
                # Any other streaming failure (open error, mid-stream drop, no
                # terminal event): remember and retry non-streaming below. The
                # retry re-sends the same request; worst case is a duplicated
                # partial preview, never a corrupted final response.
                self._drop_streaming = True
                logger.warning(
                    'v2 streaming failed (%s: %s) — falling back to non-streaming',
                    type(exc).__name__,
                    str(exc)[:200],
                )

        try:
            response = client.responses.create(**kwargs)
        except Exception as exc:  # noqa: BLE001 — narrow retry on a known 400
            if send_reasoning and _is_reasoning_unsupported(exc):
                self._drop_reasoning = True
                return self._create(
                    client,
                    input_items,
                    tools,
                    send_reasoning=False,
                    reasoning_effort=reasoning_effort,
                    on_text_delta=on_text_delta,
                )
            raise
        return adapt_response(response)

    def _create_streaming(
        self,
        client: Any,
        kwargs: dict[str, Any],
        on_text_delta: Callable[[str], None],
    ) -> LLMResponse:
        """Streamed variant of the same request. Feeds text deltas to the
        callback and adapts the terminal event's full Response object, so the
        returned LLMResponse (content, tool calls, usage, cached tokens) is
        byte-identical to the non-streaming path."""
        final: Any | None = None
        stream = client.responses.create(**kwargs, stream=True)
        for event in stream:
            event_type = getattr(event, 'type', None)
            if event_type == 'response.output_text.delta':
                delta = getattr(event, 'delta', None)
                if isinstance(delta, str) and delta:
                    try:
                        on_text_delta(delta)
                    except Exception:  # noqa: BLE001 — preview must never kill the call
                        logger.debug('on_text_delta callback failed', exc_info=True)
            elif event_type == 'response.completed':
                final = getattr(event, 'response', None)
            # Everything else (reasoning summaries, tool-arg deltas, created/
            # in_progress markers) is intentionally ignored.
        if final is None:
            raise RuntimeError('response stream ended without response.completed')
        return adapt_response(final)


def _to_responses_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten chat-completions function tools to the Responses shape.

    chat: {'type':'function','function':{'name','description','parameters'}}
    resp: {'type':'function','name','description','parameters','strict':false}
    Our op schema isn't strict-mode compliant (no additionalProperties:false
    throughout), so strict is False.
    """
    out: list[dict[str, Any]] = []
    for tool in tools:
        if tool.get('type') == 'function' and isinstance(tool.get('function'), dict):
            fn = tool['function']
            out.append(
                {
                    'type': 'function',
                    'name': fn.get('name'),
                    'description': fn.get('description', ''),
                    'parameters': fn.get('parameters', {}),
                    'strict': False,
                }
            )
        else:
            out.append(tool)
    return out


def _item_to_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, 'model_dump'):
        return item.model_dump(exclude_unset=False)
    return dict(item)


def adapt_response(response: Any) -> LLMResponse:
    """Convert an OpenAI Responses object into the loop's LLMResponse."""
    raw_output: list[dict[str, Any]] = []
    tool_calls: list[ToolCall] = []
    content_parts: list[str] = []

    for item in (getattr(response, 'output', None) or []):
        item_dict = _item_to_dict(item)
        raw_output.append(item_dict)
        item_type = item_dict.get('type')
        if item_type == 'function_call':
            raw_args = item_dict.get('arguments') or ''
            if not isinstance(raw_args, str):
                raw_args = json.dumps(raw_args)
            try:
                parsed = json.loads(raw_args) if raw_args.strip() else {}
            except json.JSONDecodeError:
                parsed = {}
            tool_calls.append(
                ToolCall(
                    id=str(item_dict.get('call_id') or item_dict.get('id') or ''),
                    name=str(item_dict.get('name') or ''),
                    arguments=parsed if isinstance(parsed, dict) else {},
                    raw_arguments=raw_args,
                )
            )
        elif item_type == 'message':
            for chunk in item_dict.get('content') or []:
                if isinstance(chunk, dict) and chunk.get('type') == 'output_text':
                    text = chunk.get('text')
                    if isinstance(text, str):
                        content_parts.append(text)

    content = '\n'.join(p for p in content_parts if p).strip() or None
    usage = getattr(response, 'usage', None)
    return LLMResponse(
        content=content,
        tool_calls=tool_calls,
        raw_output=raw_output,
        finish_reason=getattr(response, 'status', None),
        tokens_input=getattr(usage, 'input_tokens', None) if usage is not None else None,
        tokens_output=getattr(usage, 'output_tokens', None) if usage is not None else None,
        tokens_total=getattr(usage, 'total_tokens', None) if usage is not None else None,
        tokens_cached=_cached_tokens(usage),
    )


def _cached_tokens(usage: Any) -> int | None:
    """Pull cached_tokens out of usage.input_tokens_details (object or dict)."""
    if usage is None:
        return None
    details = getattr(usage, 'input_tokens_details', None)
    if details is None and isinstance(usage, dict):
        details = usage.get('input_tokens_details')
    if details is None:
        return None
    if isinstance(details, dict):
        value = details.get('cached_tokens')
    else:
        value = getattr(details, 'cached_tokens', None)
    return int(value) if isinstance(value, (int, float)) else None


def _is_reasoning_unsupported(exc: Exception) -> bool:
    text = str(exc).lower()
    return 'reasoning' in text and ('not supported' in text or 'unsupported' in text)
