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
import re
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
    pending_plan_titles: frozenset[str] | None = None,
    actor_id: str | None = None,
) -> LoopResult:
    max_turns = max(1, int(settings.agent_v2_max_turns))
    max_tool_calls = max(1, int(settings.agent_v2_max_tool_calls))
    tool_calls_used = 0
    used_read_tools = False
    nudged_ask_user = False
    tok_in = tok_out = tok_total = 0
    live_epic_titles = _live_epic_titles(handle_map)

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
            )

        results_by_id: dict[str, Any] = {}
        read_calls: list[ToolCall] = []
        for tc in response.tool_calls:
            if tools_spec.is_terminal_tool(tc.name):
                outcome = _handle_terminal(
                    tc,
                    handle_map,
                    settings,
                    trace_id,
                    pending_plan_titles=pending_plan_titles or frozenset(),
                    live_epic_titles=live_epic_titles,
                    actor_id=actor_id,
                )
                if isinstance(outcome, LoopResult):
                    outcome.used_read_tools = used_read_tools
                    return _finalize(
                        outcome, turn, tool_calls_used + 1, tok_in, tok_out, tok_total
                    )
                # Error from the edit/stage tool — feed it back to the model.
                results_by_id[tc.id] = outcome
            elif tools_spec.is_dispatcher_tool(tc.name):
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
    *,
    pending_plan_titles: frozenset[str] = frozenset(),
    live_epic_titles: frozenset[str] = frozenset(),
    actor_id: str | None = None,
) -> LoopResult | dict[str, Any]:
    progress.tool_requested(settings, trace_id, tc.name, tc.arguments)

    if tc.name == PLANNING_TOOL_NAME:
        parsed = tools_exec.interpret_plan_tool(tc.arguments, handle_map, actor_id)
        if isinstance(parsed, tools_exec.PlanToolError):
            return {'error': {'code': 'INVALID_OPERATIONS', 'message': parsed.message}}
        if parsed.operations:
            # Drop add_epic ops that re-create an epic already on the live
            # roadmap (the model sometimes echoes an outline node back into a
            # fresh add). Only childless duplicates are dropped, so creation
            # chains (parent_ref -> temp_id) are never broken.
            kept, dropped = _drop_duplicate_epics(parsed.operations, live_epic_titles)
            if kept:
                return LoopResult(
                    kind='edit',
                    assistant_message=parsed.assistant_message,
                    operations=kept,
                    terminal_tool=tc.name,
                    termination_reason='edit',
                )
            if dropped:
                return LoopResult(
                    kind='chat',
                    assistant_message=(
                        parsed.assistant_message
                        or f'"{dropped[0]}" already exists on the roadmap, so there was '
                        'nothing new to add.'
                    ),
                    terminal_tool=tc.name,
                    termination_reason='duplicate_noop',
                )
        if parsed.revision_operations:
            # revision_operations only legitimately targets a titles-only
            # pending plan. If the targeted title isn't in that plan (or no
            # plan is pending), the model misrouted a LIVE edit — feed the
            # error back so it re-stages via `operations` instead of silently
            # editing a non-existent plan.
            if _revision_grounded_in_plan(parsed.revision_operations, pending_plan_titles):
                return LoopResult(
                    kind='plan_revision',
                    assistant_message=parsed.assistant_message,
                    revision_operations=parsed.revision_operations,
                    terminal_tool=tc.name,
                    termination_reason='plan_revision',
                )
            return {
                'error': {
                    'code': 'NOT_A_PLAN_REVISION',
                    'message': (
                        'revision_operations only applies to items in a pending plan '
                        'awaiting confirmation. This target is a live roadmap item — '
                        'stage the change in `operations` instead (e.g. update_node to '
                        'rename, delete_node to remove). Leave revision_operations empty.'
                    ),
                }
            }
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


def _live_epic_titles(handle_map: dict[str, dict[str, str]] | None) -> frozenset[str]:
    """Lower-cased titles of epics already on the live roadmap (from the
    handle-map outline), for duplicate detection."""
    if not handle_map:
        return frozenset()
    titles: set[str] = set()
    for entry in handle_map.values():
        if not isinstance(entry, dict) or entry.get('type') != 'epic':
            continue
        title = entry.get('title')
        if isinstance(title, str) and title.strip():
            titles.add(title.strip().lower())
    return frozenset(titles)


def _drop_duplicate_epics(
    operations: list[Any], live_epic_titles: frozenset[str]
) -> tuple[list[Any], list[str]]:
    """Return (kept_ops, dropped_titles). Drops an ``add_epic`` only when its
    title matches an existing live epic AND its ``temp_id`` is not referenced
    by any sibling op's ``parent_ref`` (so creation chains stay intact)."""
    if not live_epic_titles:
        return operations, []
    referenced_temp_ids = {
        op.parent_ref for op in operations if getattr(op, 'parent_ref', None)
    }
    kept: list[Any] = []
    dropped: list[str] = []
    for op in operations:
        op_name = getattr(op.op, 'value', None) or str(op.op)
        title = op.data.get('title') if isinstance(getattr(op, 'data', None), dict) else None
        is_referenced = bool(getattr(op, 'temp_id', None)) and op.temp_id in referenced_temp_ids
        if (
            op_name == 'add_epic'
            and isinstance(title, str)
            and title.strip().lower() in live_epic_titles
            and not is_referenced
        ):
            dropped.append(title.strip())
            continue
        kept.append(op)
    return kept, dropped


def _revision_grounded_in_plan(
    revision_operations: list[dict[str, Any]], pending_plan_titles: frozenset[str]
) -> bool:
    """True when at least one revision op targets a title present in the
    pending plan. ``new_title`` (the rename destination) is ignored — only the
    existing target identifies whether this is really a plan revision."""
    if not pending_plan_titles:
        return False
    for op in revision_operations:
        if not isinstance(op, dict):
            continue
        for key, value in op.items():
            if key == 'new_title' or not isinstance(value, str):
                continue
            if key == 'title' or key.endswith('_title'):
                if value.strip().lower() in pending_plan_titles:
                    return True
    return False


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
