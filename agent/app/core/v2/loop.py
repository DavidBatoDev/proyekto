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
from uuid import uuid4

from app.core.contracts.sessions import ChangeGroup
from app.core.tools.registry import PLANNING_TOOL_NAME
from app.core.v2 import progress, revert, tools_exec, tools_spec
from app.core.v2.openai_client import LLMResponse, ToolCall
from app.core.v2.tools_spec import (
    ASK_USER_TOOL_NAME,
    PROPOSE_PLAN_TOOL_NAME,
    REVERT_CHANGES_TOOL_NAME,
)

logger = logging.getLogger('app.core.v2')

_MAX_TOOL_RESULT_CHARS = 8000
_MAX_PROJECT_BRIEF_TOOL_RESULT_CHARS = 64_000


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
    tokens_cached: int = 0


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
) -> LoopResult:
    max_turns = max(1, int(settings.agent_v2_max_turns))
    # None → let the client use the configured effort. A resolved value (from
    # brain._turn_reasoning_effort) applies to every model call in this turn.
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
    tool_calls_used = 0
    used_read_tools = False
    nudged_ask_user = False
    nudged_act = False
    tok_in = tok_out = tok_total = tok_cached = 0
    live_epic_titles = _live_epic_titles(handle_map)

    for turn in range(1, max_turns + 1):
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
                            'call. Do the work now: call propose_plan for a '
                            'multi-item plan, or the roadmap edit tool for '
                            'direct changes. Do not reply with another '
                            'announcement.'
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
                    change_history=session_context.get('change_history'),
                )
                if isinstance(outcome, LoopResult):
                    outcome.used_read_tools = used_read_tools
                    return _finalize(
                        outcome,
                        turn,
                        tool_calls_used + 1,
                        tok_in,
                        tok_out,
                        tok_total,
                        tok_cached,
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
                    'output': _tool_result_content(result, tc.name),
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


def _handle_terminal(
    tc: ToolCall,
    handle_map: dict[str, dict[str, str]] | None,
    settings: Any,
    trace_id: str | None,
    *,
    pending_plan_titles: frozenset[str] = frozenset(),
    live_epic_titles: frozenset[str] = frozenset(),
    actor_id: str | None = None,
    change_history: list[dict[str, Any]] | None = None,
) -> LoopResult | dict[str, Any]:
    progress.tool_requested(settings, trace_id, tc.name, tc.arguments)

    if tc.name == REVERT_CHANGES_TOOL_NAME:
        return _handle_revert(tc, change_history, handle_map, actor_id)

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
        questions = _normalize_ask_user_questions(tc.arguments)
        if not questions:
            return {
                'error': {
                    'code': 'MISSING_QUESTION',
                    'message': (
                        'ask_user requires `questions` with at least one entry, '
                        'each with a non-empty question.'
                    ),
                }
            }
        lane = tc.arguments.get('lane')
        if lane not in {'edit', 'query', 'plan'}:
            lane = 'edit'
        first = questions[0]
        return LoopResult(
            kind='clarifier',
            assistant_message='\n'.join(q['question'] for q in questions),
            clarifier={
                'lane': lane,
                'questions': questions,
                # Legacy mirror of questions[0] — old web bundles render these.
                'question': first['question'],
                'options': [o['label'] for o in first['options']],
                'allow_custom': first['allow_custom'],
            },
            terminal_tool=tc.name,
            termination_reason='clarifier',
        )

    return {'error': {'code': 'UNKNOWN_TERMINAL', 'message': f'Unknown terminal {tc.name}.'}}


_MAX_CLARIFIER_QUESTIONS = 4
_MAX_CLARIFIER_OPTIONS = 6


def _normalize_ask_user_questions(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    """Coerce ask_user arguments (new `questions` array or legacy flat
    question/options) into a canonical question list. Lenient by design:
    models mix shapes under prompt pressure, so trim/dedupe/cap instead of
    erroring wherever a usable question survives.
    """
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    raw_questions = arguments.get('questions')
    if isinstance(raw_questions, list):
        for entry in raw_questions:
            if not isinstance(entry, dict):
                continue
            question = str(entry.get('question') or '').strip()
            if not question:
                continue
            entry_id = entry.get('id')
            entry_id = entry_id.strip() if isinstance(entry_id, str) else ''
            if not entry_id or entry_id in seen_ids:
                entry_id = str(uuid4())
            seen_ids.add(entry_id)
            header = str(entry.get('header') or '').strip()[:32] or None
            options: list[dict[str, Any]] = []
            seen_labels: set[str] = set()
            for opt in entry.get('options') or []:
                if isinstance(opt, str):
                    label, description = opt.strip()[:120], None
                elif isinstance(opt, dict):
                    label = str(opt.get('label') or '').strip()[:120]
                    description = str(opt.get('description') or '').strip()[:200] or None
                else:
                    continue
                if not label or label in seen_labels:
                    continue
                seen_labels.add(label)
                options.append({'label': label, 'description': description})
                if len(options) >= _MAX_CLARIFIER_OPTIONS:
                    break
            allow_custom = entry.get('allow_custom')
            allow_custom = True if allow_custom is None else bool(allow_custom)
            if not options:
                allow_custom = True  # otherwise the question is unanswerable
            normalized.append(
                {
                    'id': entry_id,
                    'header': header,
                    'question': question,
                    'multi_select': bool(entry.get('multi_select', False)),
                    'allow_custom': allow_custom,
                    'options': options,
                }
            )
            if len(normalized) >= _MAX_CLARIFIER_QUESTIONS:
                break
    if normalized:
        return normalized

    # Legacy flat shorthand: single question + string options.
    question = str(arguments.get('question') or '').strip()
    if not question:
        return []
    options = [
        {'label': o.strip()[:120], 'description': None}
        for o in (arguments.get('options') or [])
        if isinstance(o, str) and o.strip()
    ][:_MAX_CLARIFIER_OPTIONS]
    allow_custom = arguments.get('allow_custom')
    allow_custom = True if allow_custom is None else bool(allow_custom)
    if not options:
        allow_custom = True
    return [
        {
            'id': str(uuid4()),
            'header': None,
            'question': question,
            'multi_select': False,
            'allow_custom': allow_custom,
            'options': options,
        }
    ]


def _handle_revert(
    tc: ToolCall,
    change_history: list[dict[str, Any]] | None,
    handle_map: dict[str, dict[str, str]] | None,
    actor_id: str | None,
) -> LoopResult | dict[str, Any]:
    """Deterministically undo a range of committed changes.

    Selects the range (latest, or back to a given change_id), builds the net
    inverse operations, and routes them through the same validation/commit path
    as a normal edit. Nothing-to-do cases return a chat reply.
    """
    groups = _parse_change_groups(change_history)
    if not groups:
        return LoopResult(
            kind='chat',
            assistant_message="There aren't any recent changes for me to revert.",
            terminal_tool=tc.name,
            termination_reason='revert_noop',
        )

    raw_change_id = tc.arguments.get('change_id')
    change_id = (
        raw_change_id.strip()
        if isinstance(raw_change_id, str) and raw_change_id.strip()
        else None
    )

    selected = revert.select_revert_range(groups, change_id)
    if not selected:
        return LoopResult(
            kind='chat',
            assistant_message=(
                "I couldn't find that change to revert back to — tell me which "
                'change you mean and I\'ll undo back to it.'
            ),
            terminal_tool=tc.name,
            termination_reason='revert_unknown_change',
        )

    operations = revert.build_inverse_operations(selected)
    if not operations:
        return LoopResult(
            kind='chat',
            assistant_message="Those changes cancel out — there's nothing to undo.",
            terminal_tool=tc.name,
            termination_reason='revert_empty',
        )

    parsed = tools_exec.interpret_plan_tool(
        {'operations': operations, 'assistant_message': _revert_message(selected)},
        handle_map,
        actor_id,
    )
    if isinstance(parsed, tools_exec.PlanToolError):
        return {'error': {'code': 'REVERT_BUILD_FAILED', 'message': parsed.message}}
    if not parsed.operations:
        return LoopResult(
            kind='chat',
            assistant_message="There's nothing to undo.",
            terminal_tool=tc.name,
            termination_reason='revert_empty',
        )
    return LoopResult(
        kind='edit',
        assistant_message=parsed.assistant_message,
        operations=parsed.operations,
        terminal_tool=tc.name,
        termination_reason='revert',
    )


def _parse_change_groups(raw: list[dict[str, Any]] | None) -> list[ChangeGroup]:
    if not isinstance(raw, list):
        return []
    groups: list[ChangeGroup] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            groups.append(ChangeGroup.model_validate(item))
        except Exception:  # noqa: BLE001 — a malformed entry shouldn't kill revert
            continue
    return groups


def _revert_message(selected: list[ChangeGroup]) -> str:
    """One-line confirmation. ``selected`` is most-recent-first; the oldest in
    the range is the point we're rewinding to."""
    if len(selected) == 1:
        summary = (selected[0].summary or '').strip()
        return f'Reverted: {summary}.' if summary else 'Reverted the last change.'
    target = (selected[-1].summary or '').strip()
    if target:
        return f'Reverted the last {len(selected)} changes, back to before "{target}".'
    return f'Reverted the last {len(selected)} changes.'


def _looks_like_question(text: str) -> bool:
    return isinstance(text, str) and '?' in text


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


def _serialized_tool_result(result: Any) -> str:
    return json.dumps(result, default=str, ensure_ascii=False)


def _fits_default_tool_result_cap(result: Any) -> bool:
    return len(_serialized_tool_result(result)) <= _MAX_TOOL_RESULT_CHARS


def _structured_project_resources_result(result: Any) -> str:
    source = result if isinstance(result, dict) else {}
    folders_raw = source.get('folders')
    links_raw = source.get('links')
    folders = (
        [item for item in folders_raw if isinstance(item, dict)]
        if isinstance(folders_raw, list)
        else []
    )
    links = (
        [item for item in links_raw if isinstance(item, dict)]
        if isinstance(links_raw, list)
        else []
    )
    truncated: dict[str, Any] = {
        'project_id': source.get('project_id'),
        'folders': [],
        'links': [],
        'total_folders': len(folders),
        'returned_folders': 0,
        'total_links': len(links),
        'returned_links': 0,
        'result_truncated': True,
    }

    for folder in folders:
        truncated['folders'].append(folder)
        truncated['returned_folders'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['folders'].pop()
            truncated['returned_folders'] -= 1
            break

    for link in links:
        truncated['links'].append(link)
        truncated['returned_links'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['links'].pop()
            truncated['returned_links'] -= 1
            break

    return _serialized_tool_result(truncated)


def _structured_project_meetings_result(result: Any) -> str:
    source = result if isinstance(result, dict) else {}
    meetings_raw = source.get('meetings')
    meetings = (
        [item for item in meetings_raw if isinstance(item, dict)]
        if isinstance(meetings_raw, list)
        else []
    )
    participants_by_meeting: list[list[dict[str, Any]]] = []
    total_participants = 0
    for meeting in meetings:
        participants_raw = meeting.get('participants')
        participants = (
            [item for item in participants_raw if isinstance(item, dict)]
            if isinstance(participants_raw, list)
            else []
        )
        participants_by_meeting.append(participants)
        total_participants += len(participants)

    truncated: dict[str, Any] = {
        'project_id': source.get('project_id'),
        'window': source.get('window'),
        'meetings': [],
        'total_meetings': len(meetings),
        'returned_meetings': 0,
        'total_participants': total_participants,
        'returned_participants': 0,
        'result_truncated': True,
    }
    returned_participant_sources: list[list[dict[str, Any]]] = []

    # Reserve room for as many ordered meetings as possible first. Participant
    # payloads are then filled as ordered prefixes without splitting an item.
    for meeting, participants in zip(meetings, participants_by_meeting):
        meeting_copy = {
            key: value for key, value in meeting.items() if key != 'participants'
        }
        meeting_copy['participants'] = []
        meeting_copy['total_participants'] = len(participants)
        meeting_copy['returned_participants'] = 0
        truncated['meetings'].append(meeting_copy)
        truncated['returned_meetings'] += 1
        if not _fits_default_tool_result_cap(truncated):
            truncated['meetings'].pop()
            truncated['returned_meetings'] -= 1
            break
        returned_participant_sources.append(participants)

    for meeting_copy, participants in zip(
        truncated['meetings'], returned_participant_sources
    ):
        for participant in participants:
            meeting_copy['participants'].append(participant)
            meeting_copy['returned_participants'] += 1
            truncated['returned_participants'] += 1
            if not _fits_default_tool_result_cap(truncated):
                meeting_copy['participants'].pop()
                meeting_copy['returned_participants'] -= 1
                truncated['returned_participants'] -= 1
                break

    return _serialized_tool_result(truncated)


def _tool_result_content(result: Any, tool_name: str) -> str:
    try:
        text = json.dumps(result, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(result)
    max_chars = (
        _MAX_PROJECT_BRIEF_TOOL_RESULT_CHARS
        if tool_name == 'get_project_brief'
        else _MAX_TOOL_RESULT_CHARS
    )
    if len(text) > max_chars:
        if tool_name == 'list_project_resources':
            return _structured_project_resources_result(result)
        if tool_name == 'list_project_meetings':
            return _structured_project_meetings_result(result)
        text = text[:max_chars] + '…(truncated)'
    return text


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
