"""Thin synchronous OpenAI **Responses API** wrapper for the loop engine.

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

Synchronous on purpose: ``orchestrator.step`` already runs in a worker thread
with no event loop, matching how the ToolDispatcher operates.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)

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
    # Tokens written INTO the prompt cache on this call (billed at 1.25x on
    # GPT-5.6). usage.input_tokens_details.cache_write_tokens; a write on
    # every step of a loop means the prefix is churning.
    tokens_cache_write: int | None = None
    # Hidden reasoning tokens (usage.output_tokens_details.reasoning_tokens):
    # billed as output, invisible in the text, and the cost lever behind the
    # effort knob.
    tokens_reasoning: int | None = None


_DEFAULT_MODEL_TIMEOUT_SECONDS = 90
# GPT-5.6 explicit prompt caching: the only documented TTL, also the default.
_PROMPT_CACHE_TTL = '30m'
_ENCRYPTED_REASONING_INCLUDE = 'reasoning.encrypted_content'
# Every GPT-5 generation accepts 'low'; a rejected effort value lands here.
_EFFORT_FALLBACK = 'low'


def _model_timeout_seconds(settings: Any) -> int:
    """Per-request model timeout (``OPENAI_MODEL_TIMEOUT_SECONDS``), falling
    back to the historical 90s when the setting is absent or invalid."""
    value = getattr(settings, 'openai_model_timeout_seconds', None)
    if value is None:
        return _DEFAULT_MODEL_TIMEOUT_SECONDS
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return _DEFAULT_MODEL_TIMEOUT_SECONDS
    return seconds if seconds > 0 else _DEFAULT_MODEL_TIMEOUT_SECONDS


class LLMClient:
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
        # And for reasoning summaries: unverified orgs get a 400 for
        # reasoning.summary — drop just the summary request (keep effort) and
        # remember for the rest of the process.
        self._drop_reasoning_summary = False
        # text.verbosity is a GPT-5.x-family param; a model that rejects it
        # loses just that knob.
        self._drop_verbosity = False
        # A rejected effort VALUE (e.g. 'minimal' on GPT-5.6) retries at 'low'
        # instead of disabling reasoning altogether; only that value is
        # remapped, so a per-turn escalation to 'medium' still goes through.
        self._rejected_effort: str | None = None

    def _ensure_client(self) -> Any:
        if self._client is None:
            try:
                from openai import OpenAI
            except Exception as exc:  # pragma: no cover - import guard
                raise RuntimeError(f'openai sdk unavailable: {exc}') from exc
            self._client = OpenAI(
                api_key=self._settings.openai_api_key,
                timeout=_model_timeout_seconds(self._settings),
            )
        return self._client

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        reasoning_effort: Any = _USE_CONFIGURED_EFFORT,
        on_text_delta: Callable[[str], None] | None = None,
        on_reasoning_part: Callable[[str], None] | None = None,
    ) -> LLMResponse:
        client = self._ensure_client()
        return self._create(
            client,
            messages,
            tools,
            send_reasoning=not self._drop_reasoning,
            reasoning_effort=reasoning_effort,
            on_text_delta=on_text_delta,
            on_reasoning_part=on_reasoning_part,
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
        on_reasoning_part: Callable[[str], None] | None = None,
    ) -> LLMResponse:
        # Per-call override wins; otherwise fall back to the configured effort.
        effort = (
            self._settings.openai_v2_reasoning_effort
            if reasoning_effort is _USE_CONFIGURED_EFFORT
            else reasoning_effort
        )
        if effort is not None and effort == self._rejected_effort:
            effort = _EFFORT_FALLBACK
        cache_mode = str(getattr(self._settings, 'openai_v2_prompt_cache_mode', 'implicit') or 'implicit')
        kwargs: dict[str, Any] = {
            'model': self._model,
            'input': _with_cache_breakpoint(input_items) if cache_mode == 'explicit' else input_items,
            'tools': _to_responses_tools(tools),
            'tool_choice': 'auto',
            'store': False,
        }
        if self._settings.openai_v2_max_output_tokens is not None:
            kwargs['max_output_tokens'] = self._settings.openai_v2_max_output_tokens
        if self._prompt_cache_key and cache_mode != 'off':
            kwargs['prompt_cache_key'] = self._prompt_cache_key
        if cache_mode == 'explicit':
            # Not in SDK 1.109's typed signature yet; extra_body merges into
            # the JSON body. Explicit mode caches only through the declared
            # breakpoint (the static prefix) and bills nothing for the tail.
            kwargs['extra_body'] = {
                'prompt_cache_options': {'mode': 'explicit', 'ttl': _PROMPT_CACHE_TTL},
            }
        if send_reasoning and effort is not None:
            kwargs['reasoning'] = {'effort': effort}
            # With store=False the model's reasoning only survives a tool step
            # as an encrypted blob on the reasoning item; the loop echoes it
            # back with the function outputs (engine/loop.py _echo_items).
            # GPT-5.6 returns it by default; the include is the documented
            # opt-in for older models and harmless on newer ones.
            kwargs['include'] = [_ENCRYPTED_REASONING_INCLUDE]
            # Sanitized reasoning summaries → assistant_thought timeline rows.
            # Only requested when a consumer is listening (auxiliary callers
            # like the summarizer pass no callback and shouldn't pay for it).
            if (
                on_reasoning_part is not None
                and bool(getattr(self._settings, 'openai_v2_reasoning_summary_enabled', False))
                and not self._drop_reasoning_summary
            ):
                kwargs['reasoning']['summary'] = 'auto'
        verbosity = getattr(self._settings, 'openai_v2_verbosity', None)
        if isinstance(verbosity, str) and verbosity and not self._drop_verbosity:
            kwargs['text'] = {'verbosity': verbosity}
        if self._settings.openai_v2_temperature is not None:
            kwargs['temperature'] = self._settings.openai_v2_temperature

        def _retry(*, send_reasoning_next: bool) -> LLMResponse:
            return self._create(
                client,
                input_items,
                tools,
                send_reasoning=send_reasoning_next,
                reasoning_effort=reasoning_effort,
                on_text_delta=on_text_delta,
                on_reasoning_part=on_reasoning_part,
            )

        # Stream only when someone is listening for deltas: the summarizer and
        # other auxiliary callers pass no callback and keep plain calls.
        use_streaming = (
            on_text_delta is not None
            and bool(getattr(self._settings, 'openai_v2_streaming_enabled', False))
            and not self._drop_streaming
        )
        if use_streaming:
            try:
                return self._create_streaming(client, kwargs, on_text_delta, on_reasoning_part)
            except Exception as exc:  # noqa: BLE001 — self-heal, then plain call
                healed = self._heal_request(exc, kwargs, send_reasoning)
                if healed is not None:
                    return _retry(send_reasoning_next=healed)
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
            healed = self._heal_request(exc, kwargs, send_reasoning)
            if healed is not None:
                return _retry(send_reasoning_next=healed)
            raise
        # Non-streaming path: reasoning summaries arrive as parts on the
        # response's reasoning items rather than as stream events. Emit them
        # here (not in adapt_response — the streaming terminal Response also
        # carries the same items and would double-emit).
        if on_reasoning_part is not None and 'summary' in kwargs.get('reasoning', {}):
            _emit_reasoning_summary_parts(response, on_reasoning_part)
        return adapt_response(response)

    def _heal_request(
        self,
        exc: Exception,
        kwargs: dict[str, Any],
        send_reasoning: bool,
    ) -> bool | None:
        """Classify a rejected request. Returns the ``send_reasoning`` value
        for a retry after latching the matching drop flag, or ``None`` when
        the error is not one of the known parameter 400s.

        Order matters: the org-verification 400 mentions "reasoning
        summaries" and must not disable reasoning; an effort VALUE rejection
        ("'minimal' is not supported…") names reasoning too and must fall
        back to 'low' rather than dropping reasoning.
        """
        reasoning = kwargs.get('reasoning') or {}
        if 'summary' in reasoning and _is_reasoning_summary_unsupported(exc):
            self._drop_reasoning_summary = True
            return send_reasoning
        if 'text' in kwargs and _is_verbosity_unsupported(exc):
            self._drop_verbosity = True
            return send_reasoning
        if send_reasoning and reasoning:
            effort = reasoning.get('effort')
            if (
                _is_effort_value_unsupported(exc)
                and isinstance(effort, str)
                and effort != _EFFORT_FALLBACK
                and self._rejected_effort is None
            ):
                self._rejected_effort = effort
                logger.warning(
                    'reasoning effort %r rejected by %s — using %r for it from now on',
                    effort,
                    self._model,
                    _EFFORT_FALLBACK,
                )
                return True
            if _is_reasoning_unsupported(exc):
                self._drop_reasoning = True
                return False
        return None

    def _create_streaming(
        self,
        client: Any,
        kwargs: dict[str, Any],
        on_text_delta: Callable[[str], None],
        on_reasoning_part: Callable[[str], None] | None = None,
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
            elif event_type == 'response.reasoning_summary_part.done':
                # One completed sanitized-reasoning paragraph → one thought.
                text = getattr(getattr(event, 'part', None), 'text', None)
                if on_reasoning_part is not None and isinstance(text, str) and text:
                    try:
                        on_reasoning_part(text)
                    except Exception:  # noqa: BLE001 — narration must never kill the call
                        logger.debug('on_reasoning_part callback failed', exc_info=True)
            elif event_type == 'response.completed':
                final = getattr(event, 'response', None)
            # Everything else (summary text deltas, tool-arg deltas, created/
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
        tokens_cache_write=_usage_detail(usage, 'input_tokens_details', 'cache_write_tokens'),
        tokens_reasoning=_usage_detail(usage, 'output_tokens_details', 'reasoning_tokens'),
    )


def _usage_detail(usage: Any, details_key: str, value_key: str) -> int | None:
    """Pull one counter out of a usage details block (object or dict)."""
    if usage is None:
        return None
    details = getattr(usage, details_key, None)
    if details is None and isinstance(usage, dict):
        details = usage.get(details_key)
    if details is None:
        return None
    if isinstance(details, dict):
        value = details.get(value_key)
    else:
        value = getattr(details, value_key, None)
    return int(value) if isinstance(value, (int, float)) else None


def _cached_tokens(usage: Any) -> int | None:
    """Pull cached_tokens out of usage.input_tokens_details (object or dict)."""
    return _usage_detail(usage, 'input_tokens_details', 'cached_tokens')


def _with_cache_breakpoint(input_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Explicit prompt caching: split the leading system message at the
    ``# Actor`` boundary and mark the stable prefix as the cache breakpoint.

    Returns a NEW list (the loop keeps appending to the caller's). Untouched
    when the first item is not a plain-string system message or carries no
    ``# Actor`` block (the summarizer's short prompt).
    """
    if not input_items:
        return input_items
    first = input_items[0]
    if not isinstance(first, dict) or first.get('role') != 'system':
        return input_items
    content = first.get('content')
    if not isinstance(content, str):
        return input_items
    from app.core.runtime.prompt import split_cache_prefix

    parts = split_cache_prefix(content)
    if parts is None:
        return input_items
    prefix, tail = parts
    blocks: list[dict[str, Any]] = [
        {'type': 'input_text', 'text': prefix, 'prompt_cache_breakpoint': {'mode': 'explicit'}},
    ]
    if tail:
        blocks.append({'type': 'input_text', 'text': tail})
    return [{**first, 'content': blocks}, *input_items[1:]]


def _is_reasoning_unsupported(exc: Exception) -> bool:
    text = str(exc).lower()
    if 'effort' in text:
        # A rejected effort VALUE is handled by _is_effort_value_unsupported.
        return False
    return 'reasoning' in text and ('not supported' in text or 'unsupported' in text)


def _is_effort_value_unsupported(exc: Exception) -> bool:
    """The reasoning.effort VALUE was rejected (e.g. 'minimal' on GPT-5.6,
    'none' on an older model) — reasoning itself still works."""
    text = str(exc).lower()
    return 'effort' in text and (
        'not supported' in text
        or 'unsupported' in text
        or 'invalid' in text
        or 'must be one of' in text
    )


def _is_verbosity_unsupported(exc: Exception) -> bool:
    text = str(exc).lower()
    return 'verbosity' in text and (
        'not supported' in text
        or 'unsupported' in text
        or 'unknown' in text
        or 'unrecognized' in text
        or 'invalid' in text
    )


def _is_reasoning_summary_unsupported(exc: Exception) -> bool:
    """The reasoning.summary param specifically was rejected — most commonly
    OpenAI's org-verification 400 ("must be verified to generate reasoning
    summaries"); effort itself is fine and must stay enabled."""
    text = str(exc).lower()
    return 'summar' in text and (
        'not supported' in text or 'unsupported' in text or 'verif' in text
    )


def _emit_reasoning_summary_parts(response: Any, on_reasoning_part: Callable[[str], None]) -> None:
    """Fire the thought callback for each summary part on a non-streamed
    Response's reasoning items ({'type':'summary_text','text':...})."""
    for item in (getattr(response, 'output', None) or []):
        item_dict = _item_to_dict(item)
        if item_dict.get('type') != 'reasoning':
            continue
        for part in item_dict.get('summary') or []:
            text = part.get('text') if isinstance(part, dict) else getattr(part, 'text', None)
            if isinstance(text, str) and text:
                try:
                    on_reasoning_part(text)
                except Exception:  # noqa: BLE001 — narration must never kill the call
                    logger.debug('on_reasoning_part callback failed', exc_info=True)


# Kept for one release; new code imports ``LLMClient``.
V2LLMClient = LLMClient
