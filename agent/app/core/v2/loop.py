"""The v2 single agentic loop.

while not done:
  response = model(messages, tools)
  if no tool calls            -> plain-text chat terminal
  if a terminal tool          -> map to a terminal result and stop
  else (reads / unknown / a   -> run them, append results, continue;
        plan-tool error)         the model self-corrects from errors

No intent classifier, no separate repair lane, no doubled-budget retries.
Tool errors are ordinary tool messages fed back into the same loop. Reads run
in parallel; the edit/stage tool is terminal on success and error-feedback on
a parse/validation failure.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.tools.registry import PLANNING_TOOL_NAME
from app.core.v2 import progress, tools_exec, tools_spec
from app.core.v2.openai_client import LLMResponse, ToolCall
from app.core.v2.tools_spec import ASK_USER_TOOL_NAME, PROPOSE_PLAN_TOOL_NAME

logger = logging.getLogger('app.core.v2')

_MAX_TOOL_RESULT_CHARS = 8000


@dataclass
class LoopResult:
    kind: str  # edit | plan_proposal | plan_revision | clarifier | chat | budget
    assistant_message: str = ''
    operations: list[Any] = field(default_factory=list)
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
) -> LoopResult:
    max_turns = max(1, int(settings.agent_v2_max_turns))
    max_tool_calls = max(1, int(settings.agent_v2_max_tool_calls))
    tool_calls_used = 0
    used_read_tools = False
    tok_in = tok_out = tok_total = 0

    for turn in range(1, max_turns + 1):
        progress.provider_attempt(settings, trace_id, turn)
        response: LLMResponse = client.complete(messages, tools)
        tok_in += int(response.tokens_input or 0)
        tok_out += int(response.tokens_output or 0)
        tok_total += int(response.tokens_total or 0)
        progress.provider_success(
            settings,
            trace_id,
            turn,
            tool_names=[tc.name for tc in response.tool_calls],
            finish_reason=response.finish_reason,
            tokens_total=response.tokens_total,
        )
        messages.extend(_echo_items(response))

        if not response.tool_calls:
            return _finalize(
                LoopResult(
                    kind='chat',
                    assistant_message=(response.content or '').strip(),
                    used_read_tools=used_read_tools,
                    termination_reason='assistant_text',
                ),
                turn,
                tool_calls_used,
                tok_in,
                tok_out,
                tok_total,
            )

        results_by_id: dict[str, Any] = {}
        read_calls: list[ToolCall] = []
        for tc in response.tool_calls:
            if tools_spec.is_terminal_tool(tc.name):
                outcome = _handle_terminal(tc, handle_map, settings, trace_id)
                if isinstance(outcome, LoopResult):
                    outcome.used_read_tools = used_read_tools
                    return _finalize(
                        outcome, turn, tool_calls_used + 1, tok_in, tok_out, tok_total
                    )
                # Error from the edit/stage tool — feed it back to the model.
                results_by_id[tc.id] = outcome
            elif tools_spec.is_read_tool(tc.name):
                read_calls.append(tc)
            else:
                results_by_id[tc.id] = {
                    'error': {
                        'code': 'UNKNOWN_TOOL',
                        'message': f'Tool {tc.name} is not available.',
                    }
                }

        if read_calls:
            used_read_tools = True
            read_results = tools_exec.run_read_tools(
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
                    'output': _tool_result_content(result),
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
    )


def _handle_terminal(
    tc: ToolCall,
    handle_map: dict[str, dict[str, str]] | None,
    settings: Any,
    trace_id: str | None,
) -> LoopResult | dict[str, Any]:
    progress.tool_requested(settings, trace_id, tc.name, tc.arguments)

    if tc.name == PLANNING_TOOL_NAME:
        parsed = tools_exec.interpret_plan_tool(tc.arguments, handle_map)
        if isinstance(parsed, tools_exec.PlanToolError):
            return {'error': {'code': 'INVALID_OPERATIONS', 'message': parsed.message}}
        if parsed.operations:
            return LoopResult(
                kind='edit',
                assistant_message=parsed.assistant_message,
                operations=parsed.operations,
                terminal_tool=tc.name,
                termination_reason='edit',
            )
        if parsed.revision_operations:
            return LoopResult(
                kind='plan_revision',
                assistant_message=parsed.assistant_message,
                revision_operations=parsed.revision_operations,
                terminal_tool=tc.name,
                termination_reason='plan_revision',
            )
        if parsed.clarifier_options or _looks_like_question(parsed.assistant_message):
            return LoopResult(
                kind='clarifier',
                assistant_message=parsed.assistant_message,
                clarifier={
                    'lane': 'edit',
                    'question': parsed.assistant_message,
                    'options': parsed.clarifier_options,
                    'allow_custom': True,
                },
                terminal_tool=tc.name,
                termination_reason='clarifier',
            )
        return LoopResult(
            kind='chat',
            assistant_message=parsed.assistant_message,
            terminal_tool=tc.name,
            termination_reason='edit_tool_chat',
        )

    if tc.name == PROPOSE_PLAN_TOOL_NAME:
        summary = str(tc.arguments.get('summary') or '').strip()
        return LoopResult(
            kind='plan_proposal',
            assistant_message=summary or 'Here is a proposed plan for your review.',
            plan_payload=dict(tc.arguments),
            terminal_tool=tc.name,
            termination_reason='plan_proposal',
        )

    if tc.name == ASK_USER_TOOL_NAME:
        question = str(tc.arguments.get('question') or '').strip()
        if not question:
            return {
                'error': {
                    'code': 'MISSING_QUESTION',
                    'message': 'ask_user requires a non-empty question.',
                }
            }
        lane = tc.arguments.get('lane')
        if lane not in {'edit', 'query', 'plan'}:
            lane = 'edit'
        options = [
            o for o in (tc.arguments.get('options') or []) if isinstance(o, str) and o.strip()
        ]
        allow_custom = tc.arguments.get('allow_custom')
        allow_custom = True if allow_custom is None else bool(allow_custom)
        return LoopResult(
            kind='clarifier',
            assistant_message=question,
            clarifier={
                'lane': lane,
                'question': question,
                'options': options,
                'allow_custom': allow_custom,
            },
            terminal_tool=tc.name,
            termination_reason='clarifier',
        )

    return {'error': {'code': 'UNKNOWN_TERMINAL', 'message': f'Unknown terminal {tc.name}.'}}


def _looks_like_question(text: str) -> bool:
    return isinstance(text, str) and '?' in text


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


def _tool_result_content(result: Any) -> str:
    try:
        text = json.dumps(result, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(result)
    if len(text) > _MAX_TOOL_RESULT_CHARS:
        text = text[:_MAX_TOOL_RESULT_CHARS] + '…(truncated)'
    return text


def _finalize(
    result: LoopResult,
    turns: int,
    tool_calls_used: int,
    tok_in: int,
    tok_out: int,
    tok_total: int,
) -> LoopResult:
    result.turns = turns
    result.tool_calls_used = tool_calls_used
    result.tokens_input = tok_in
    result.tokens_output = tok_out
    result.tokens_total = tok_total
    if not result.termination_reason:
        result.termination_reason = result.kind
    return result
