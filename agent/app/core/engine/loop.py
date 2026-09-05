"""The single agentic loop.

while not done:
  response = model(messages, tools)
  if no tool calls            -> plain-text chat terminal
  if terminal tool(s)         -> hand them together to the terminal handler
                                 (a LoopResult ends the turn; errors are fed back)
  else (reads / unknown)      -> run them, append results, continue;
                                 the model self-corrects from errors

No intent classifier, no separate repair lane, no doubled-budget retries.
Tool errors are ordinary tool messages fed back into the same loop. Reads run
in parallel. The engine is roadmap-agnostic: what a terminal call MEANS is
decided by the injected ``terminal_handler`` (``app.core.runtime.terminal``).

Budgets: ``AGENT_V2_MAX_TURNS`` / ``AGENT_V2_MAX_TOOL_CALLS`` (offsets let a
resumed phase continue its own counters), plus an optional wall-clock
``deadline_monotonic`` — the loop pauses ONLY at a turn boundary once the
deadline has passed (never mid-call), returning ``kind='paused'`` with the
echoed transcript so a later request can resume with the tool results it
already paid for. ``should_stop`` is polled between turns (cancel).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from time import monotonic
from typing import Any, Callable

from app.core.engine import progress
from app.core.engine.llm_client import LLMResponse, ToolCall
from app.core.engine.tool_results import tool_result_content
from app.core.runtime import tool_exec
from app.core.runtime.tools import is_dispatcher_tool, is_terminal_tool

logger = logging.getLogger(__name__)


@dataclass
class LoopResult:
    # batches | revert | plan_proposal | plan_revision | clarifier | chat |
    # budget | paused | cancelled
    kind: str
    assistant_message: str = ''
    # Flattened operations of `batches` (convenience for single-batch callers).
    operations: list[Any] = field(default_factory=list)
    # One RunBatch per distinct roadmap (stage_edits / revert terminals).
    batches: list[Any] = field(default_factory=list)
    revision_operations: list[dict[str, Any]] = field(default_factory=list)
    clarifier: dict[str, Any] | None = None
    plan_payload: dict[str, Any] | None = None
    terminal_tool: str | None = None
    used_read_tools: bool = False
    turns: int = 0
    tool_calls_used: int = 0
    termination_reason: str = ''
    tokens_input: int = 0
    tokens_output: int = 0
    tokens_total: int = 0
    tokens_cached: int = 0
    # kind='paused' / 'cancelled': the echoed items after the user turn
    # (function_call / function_call_output / nudges) to replay on resume.
    transcript: list[dict[str, Any]] | None = None


TerminalHandler = Callable[[list[ToolCall]], "LoopResult | dict[str, dict[str, Any]]"]


def run_loop(
    *,
    client: Any,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    dispatcher: Any,
    session_context: dict[str, Any],
    handle_map: dict[str, dict[str, str]] | None,
    settings: Any,
    trace_id: str | None,
    pending_plan_titles: frozenset[str] | None = None,
    actor_id: str | None = None,
    reasoning_effort: str | None = None,
    delta_emitter: Any = None,
    thought_emitter: Any = None,
    terminal_handler: TerminalHandler | None = None,
    deadline_monotonic: float | None = None,
    transcript: list[dict[str, Any]] | None = None,
    should_stop: Callable[[], bool] | None = None,
    turns_used: int = 0,
    tool_calls_used: int = 0,
) -> LoopResult:
    max_turns = max(1, int(settings.agent_v2_max_turns))
    # None → let the client use the configured effort. A resolved value
    # applies to every model call in this turn.
    complete_kwargs: dict[str, Any] = (
        {} if reasoning_effort is None else {'reasoning_effort': reasoning_effort}
    )
    # Stream assistant text as throttled assistant_delta progress events so the
    # web can render a live preview. Omitted when no emitter (keeps old fakes
    # and non-traced callers on the plain complete(messages, tools) shape).
    if delta_emitter is not None:
        complete_kwargs['on_text_delta'] = delta_emitter.on_delta
    # Reasoning-summary parts → assistant_thought progress events ("thought"
    # lines between tool steps). Same omit-when-absent contract as above.
    if thought_emitter is not None:
        complete_kwargs['on_reasoning_part'] = thought_emitter.on_part
    max_tool_calls = max(1, int(settings.agent_v2_max_tool_calls))
    tool_calls_used = max(0, int(tool_calls_used))
    turns_used = max(0, int(turns_used))
    used_read_tools = False
    nudged_ask_user = False
    nudged_act = False
    tok_in = tok_out = tok_total = tok_cached = 0
    # Everything after this index is the turn's transcript (a resumed
    # transcript the caller already appended is included, so a second pause
    # carries the whole history forward).
    transcript_start = max(0, len(messages) - len(transcript or []))

    if terminal_handler is None:
        terminal_handler = _default_terminal_handler(
            handle_map=handle_map,
            settings=settings,
            trace_id=trace_id,
            pending_plan_titles=pending_plan_titles,
            actor_id=actor_id,
            session_context=session_context,
        )

    def _transcript() -> list[dict[str, Any]]:
        return [dict(item) for item in messages[transcript_start:] if isinstance(item, dict)]

    if turns_used >= max_turns:
        return _finalize(
            LoopResult(kind='budget', termination_reason='max_turns'),
            turns_used,
            tool_calls_used,
            0,
            0,
            0,
            0,
        )

    turns_in_call = 0
    turn = turns_used
    while turn < max_turns:
        turn += 1
        turns_in_call += 1
        if turns_in_call > 1:
            # Never interrupt the first turn of a request: a continue whose
            # budget is already spent must still make progress.
            if should_stop is not None and _safe_should_stop(should_stop):
                return _finalize(
                    LoopResult(
                        kind='cancelled',
                        used_read_tools=used_read_tools,
                        termination_reason='cancelled',
                        transcript=_transcript(),
                    ),
                    turn - 1,
                    tool_calls_used,
                    tok_in,
                    tok_out,
                    tok_total,
                    tok_cached,
                )
            if deadline_monotonic is not None and monotonic() > deadline_monotonic:
                return _finalize(
                    LoopResult(
                        kind='paused',
                        used_read_tools=used_read_tools,
                        termination_reason='deadline',
                        transcript=_transcript(),
                    ),
                    turn - 1,
                    tool_calls_used,
                    tok_in,
                    tok_out,
                    tok_total,
                    tok_cached,
                )
        progress.provider_attempt(settings, trace_id, turn)
        if delta_emitter is not None:
            delta_emitter.set_turn(turn)
        if thought_emitter is not None:
            thought_emitter.set_turn(turn)
        response: LLMResponse = client.complete(messages, tools, **complete_kwargs)
        if delta_emitter is not None:
            delta_emitter.finish()
        tok_in += int(response.tokens_input or 0)
        tok_out += int(response.tokens_output or 0)
        tok_total += int(response.tokens_total or 0)
        tok_cached += int(response.tokens_cached or 0)
        progress.provider_success(
            settings,
            trace_id,
            turn,
            tool_names=[tc.name for tc in response.tool_calls],
            finish_reason=response.finish_reason,
            tokens_total=response.tokens_total,
            tokens_input=response.tokens_input,
            tokens_cached=response.tokens_cached,
        )
        messages.extend(_echo_items(response))

        if not response.tool_calls:
            text = (response.content or '').strip()
            # Contract enforcement the prompt alone can't guarantee: a plain-
            # text reply presenting choices ("Which epic? - A - B") strands the
            # user with nothing to click. Nudge once to re-emit via ask_user.
            if (
                not nudged_ask_user
                and turn < max_turns
                and _is_textual_option_question(text)
            ):
                nudged_ask_user = True
                messages.append(
                    {
                        'role': 'system',
                        'content': (
                            'Your last reply asked the user to choose between '
                            'options in plain text. Re-issue that question as an '
                            'ask_user call with those options so the user can '
                            'click an answer.'
                        ),
                    }
                )
                continue
            # Same class of contract failure: the model narrated its intent
            # ("I'll draft a roadmap structure…") and stopped without calling
            # any tool. Accepting that as a chat terminal strands the user
            # with a promise instead of a result — nudge once to act.
            if (
                not nudged_act
                and turn < max_turns
                and _is_announcement_without_action(text)
            ):
                nudged_act = True
                messages.append(
                    {
                        'role': 'system',
                        'content': (
                            'Your last reply announced work but made no tool '
                            'call. Do the work now: call propose for a '
                            'multi-item plan, or stage_edits for direct '
                            'changes. Do not reply with another announcement.'
                        ),
                    }
                )
                continue
            return _finalize(
                LoopResult(
                    kind='chat',
                    assistant_message=text,
                    used_read_tools=used_read_tools,
                    termination_reason='assistant_text',
                ),
                turn,
                tool_calls_used,
                tok_in,
                tok_out,
                tok_total,
                tok_cached,
            )

        results_by_id: dict[str, Any] = {}
        read_calls: list[ToolCall] = []
        terminal_calls: list[ToolCall] = []
        for tc in response.tool_calls:
            if is_terminal_tool(tc.name):
                terminal_calls.append(tc)
            elif is_dispatcher_tool(tc.name):
                read_calls.append(tc)
            else:
                results_by_id[tc.id] = {
                    'error': {
                        'code': 'UNKNOWN_TOOL',
                        'message': f'Tool {tc.name} is not available.',
                    }
                }

        if terminal_calls:
            for tc in terminal_calls:
                progress.tool_requested(settings, trace_id, tc.name, tc.arguments)
            outcome = terminal_handler(terminal_calls)
            if isinstance(outcome, LoopResult):
                outcome.used_read_tools = used_read_tools
                return _finalize(
                    outcome,
                    turn,
                    tool_calls_used + len(response.tool_calls),
                    tok_in,
                    tok_out,
                    tok_total,
                    tok_cached,
                )
            # Errors from the terminal(s) — feed them back to the model.
            for tc in terminal_calls:
                results_by_id[tc.id] = (outcome or {}).get(
                    tc.id,
                    {'error': {'code': 'NO_RESULT', 'message': 'No tool result.'}},
                )

        if read_calls:
            used_read_tools = True
            read_results = tool_exec.run_read_tools(
                dispatcher,
                [(tc.name, tc.arguments) for tc in read_calls],
                session_context,
            )
            for tc, result in zip(read_calls, read_results):
                results_by_id[tc.id] = result

        for tc in response.tool_calls:
            result = results_by_id.get(
                tc.id, {'error': {'code': 'NO_RESULT', 'message': 'No tool result.'}}
            )
            messages.append(
                {
                    'type': 'function_call_output',
                    'call_id': tc.id,
                    'output': tool_result_content(result, tc.name),
                }
            )

        tool_calls_used += len(response.tool_calls)
        if tool_calls_used >= max_tool_calls:
            return _finalize(
                LoopResult(
                    kind='budget',
                    used_read_tools=used_read_tools,
                    termination_reason='max_tool_calls',
                ),
                turn,
                tool_calls_used,
                tok_in,
                tok_out,
                tok_total,
                tok_cached,
            )

    return _finalize(
        LoopResult(
            kind='budget',
            used_read_tools=used_read_tools,
            termination_reason='max_turns',
        ),
        max_turns,
        tool_calls_used,
        tok_in,
        tok_out,
        tok_total,
        tok_cached,
    )


def _safe_should_stop(should_stop: Callable[[], bool]) -> bool:
    try:
        return bool(should_stop())
    except Exception:  # noqa: BLE001 — a store hiccup never aborts the loop
        return False


def _default_terminal_handler(
    *,
    handle_map: dict[str, dict[str, str]] | None,
    settings: Any,
    trace_id: str | None,
    pending_plan_titles: frozenset[str] | None,
    actor_id: str | None,
    session_context: dict[str, Any],
) -> TerminalHandler:
    """A session-less handler built from the legacy call shape (handle map +
    session_context keys). Imported lazily: ``runtime.terminal`` depends on
    ``LoopResult`` from this module."""
    from app.core.runtime.terminal import TerminalContext, make_terminal_handler

    focus = session_context.get('focus_roadmap_id') or session_context.get('roadmap_id')
    return make_terminal_handler(
        TerminalContext(
            settings=settings,
            trace_id=trace_id,
            handle_map=dict(handle_map or {}),
            actor_id=actor_id,
            pending_plan_titles=pending_plan_titles or frozenset(),
            has_pending_plan=bool(pending_plan_titles),
            change_history=session_context.get('change_history'),
            focus_roadmap_id=str(focus).strip() if isinstance(focus, str) and focus.strip() else None,
            recent_targets=list(session_context.get('recent_resolved_targets') or []),
            roadmap_titles=dict(session_context.get('roadmap_titles') or {}),
        )
    )


_ANNOUNCE_OPENER = re.compile(
    r"^(i['’]ll|i will|i['’]m going to|i am going to|let me)\b", re.IGNORECASE
)
_ANNOUNCE_ACTION_VERBS = re.compile(
    r'\b(draft|creat\w*|add\w*|build\w*|generat\w*|propos\w*|stag\w*|updat\w*'
    r'|renam\w*|delet\w*|mov\w*|plan\w*|outlin\w*|structur\w*|set up)\b',
    re.IGNORECASE,
)


def _is_announcement_without_action(text: str) -> bool:
    """A short reply that promises roadmap work ("I'll draft a roadmap…")
    without doing any — the model narrated its tool plan instead of calling a
    tool. Real answers are long or ask a question; announcements are one or
    two clipped sentences of pure intent."""
    if not text or '?' in text or len(text) > 240:
        return False
    return bool(
        _ANNOUNCE_OPENER.match(text) and _ANNOUNCE_ACTION_VERBS.search(text)
    )


def _is_textual_option_question(text: str) -> bool:
    """A question presenting 2+ list-style choices in plain text — the exact
    shape that should have been an ask_user call (clickable options)."""
    if '?' not in text:
        return False
    option_lines = sum(
        1
        for line in text.splitlines()
        if re.match(r'\s*([-*•]|\d+[.)])\s+\S', line)
    )
    return option_lines >= 2


def _echo_items(response: LLMResponse) -> list[dict[str, Any]]:
    """Items to append back into the Responses `input` for the next turn.

    Echo only the model's ``function_call`` items, sanitized to the fields the
    Responses API accepts as INPUT (type / call_id / name / arguments). Echoing
    raw output items verbatim is rejected — they carry output-only fields like
    ``status``. Reasoning and assistant-message items are dropped: they aren't
    needed for the stateless tool loop, and the model re-reasons each turn.
    Only continuation turns (reads) reuse these items; terminal turns return
    immediately, so dropping the assistant text is harmless.
    """
    return [
        {
            'type': 'function_call',
            'call_id': tc.id,
            'name': tc.name,
            'arguments': tc.raw_arguments,
        }
        for tc in response.tool_calls
    ]


def _finalize(
    result: LoopResult,
    turns: int,
    tool_calls_used: int,
    tok_in: int,
    tok_out: int,
    tok_total: int,
    tok_cached: int = 0,
) -> LoopResult:
    result.turns = turns
    result.tool_calls_used = tool_calls_used
    result.tokens_input = tok_in
    result.tokens_output = tok_out
    result.tokens_total = tok_total
    result.tokens_cached = tok_cached
    if not result.termination_reason:
        result.termination_reason = result.kind
    return result
