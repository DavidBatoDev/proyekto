"""Streaming progress events for the v2 loop.

Progress is captured as a side effect of ``log_event`` whenever the event
name is in ``logging_utils._PROGRESS_EVENT_ALLOWLIST`` and a ``trace_id`` is
bound. The ``GET .../traces/{trace_id}/events`` endpoint serves them. Read
tools already emit ``tool_call_requested`` / ``tool_call_result`` from the
ToolDispatcher, so these helpers only cover the loop's own lifecycle.
"""

from __future__ import annotations

import logging
from time import monotonic
from typing import Any

from app.core.logging_utils import log_event

logger = logging.getLogger('app.core.v2')

# Throttle for assistant_delta events: flush when the buffer reaches this many
# chars or this much time has passed since the last flush. ~2-3 events/sec and
# ≤ ~300 chars/event keeps each event under logging_utils' 500-char detail
# truncation and the per-trace 250-event cap far out of reach.
_DELTA_FLUSH_CHARS = 280
_DELTA_FLUSH_SECONDS = 0.4


class AssistantDeltaEmitter:
    """Buffers streamed model text and emits throttled ``assistant_delta``
    progress events (chunk text, not cumulative — the web accumulates them in
    seq order). One instance per message turn; the loop calls ``set_turn``
    before each model call and ``finish`` after it."""

    def __init__(self, settings: Any, trace_id: str) -> None:
        self._settings = settings
        self._trace_id = trace_id
        self._buffer = ''
        self._last_flush = monotonic()
        self._turn = 0
        self._delta_seq = 0

    def set_turn(self, turn: int) -> None:
        # A new model call supersedes any unflushed remainder from the last
        # one (finish() should have flushed it already; this is a guard).
        self._buffer = ''
        self._turn = turn
        self._last_flush = monotonic()

    def on_delta(self, text: str) -> None:
        self._buffer += text
        if (
            len(self._buffer) >= _DELTA_FLUSH_CHARS
            or monotonic() - self._last_flush >= _DELTA_FLUSH_SECONDS
        ):
            self.flush()

    def flush(self) -> None:
        if not self._buffer:
            return
        chunk = self._buffer
        self._buffer = ''
        self._last_flush = monotonic()
        self._delta_seq += 1
        log_event(
            logger,
            'assistant_delta',
            settings=self._settings,
            trace_id=self._trace_id,
            brain='v2',
            text=chunk,
            turn=self._turn,
            delta_seq=self._delta_seq,
        )

    def finish(self) -> None:
        """Flush any remainder at the end of a model call."""
        self.flush()


def provider_attempt(settings: Any, trace_id: str | None, turn: int) -> None:
    log_event(
        logger,
        'provider_attempt',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        turn=turn,
    )


def provider_success(
    settings: Any,
    trace_id: str | None,
    turn: int,
    *,
    tool_names: list[str],
    finish_reason: str | None,
    tokens_total: int | None,
    tokens_input: int | None = None,
    tokens_cached: int | None = None,
) -> None:
    log_event(
        logger,
        'provider_success',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        turn=turn,
        tool_names=tool_names,
        finish_reason=finish_reason,
        tokens_total=tokens_total,
        tokens_input=tokens_input,
        # Cached-prefix input tokens on this call — grep logs.txt for
        # `tokens_cached` to confirm prompt caching is hitting the prefix.
        tokens_cached=tokens_cached,
    )


def tool_requested(settings: Any, trace_id: str | None, tool_name: str, tool_args: Any) -> None:
    log_event(
        logger,
        'tool_call_requested',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        tool_name=tool_name,
        tool_args=tool_args,
    )


def route_selected(
    settings: Any,
    trace_id: str | None,
    *,
    route_lane: str,
    response_mode: str,
    turns: int,
    tool_calls_used: int,
    termination_reason: str,
) -> None:
    log_event(
        logger,
        'route_selected',
        settings=settings,
        trace_id=trace_id,
        brain='v2',
        route_lane=route_lane,
        response_mode=response_mode,
        react_loop_turns=turns,
        tool_calls_used=tool_calls_used,
        react_loop_termination_reason=termination_reason,
    )
