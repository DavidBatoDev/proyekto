from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from app.core.llm.providers.base import ProviderAdapterError

UsageTotals = dict[str, int]
NoToolCallsHandler = Callable[[Any, UsageTotals], 'BoundedToolLoopOutcome']
TerminalToolCallHandler = Callable[
    [str, dict[str, Any], dict[str, Any], int, int, UsageTotals],
    'BoundedToolLoopOutcome | None',
]
ParallelToolExecutor = Callable[
    [list[tuple[str, dict[str, Any]]]],
    list[dict[str, Any]],
]


@dataclass
class BoundedToolLoopOutcome:
    value: Any
    usage_totals: UsageTotals


def run_bounded_tool_loop(
    *,
    provider: str,
    initial_messages: list[Any],
    invoke: Callable[[list[Any]], Any],
    tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]],
    normalize_tool_args: Callable[[Any], dict[str, Any]],
    extract_usage: Callable[[Any], dict[str, int] | None],
    build_tool_message: Callable[[str, str], Any],
    on_no_tool_calls: NoToolCallsHandler,
    on_tool_call: TerminalToolCallHandler,
    max_tool_turns: int,
    max_turns_error_code: str,
    max_turns_error_message: str,
    parallel_tool_executor: ParallelToolExecutor | None = None,
    parallel_safe_tools: frozenset[str] | set[str] | None = None,
) -> BoundedToolLoopOutcome:
    usage_totals: UsageTotals = {'tokens_input': 0, 'tokens_output': 0, 'tokens_total': 0}
    messages = list(initial_messages)
    safe_set = frozenset(parallel_safe_tools or ())

    usage_totals.setdefault('tokens_cached', 0)
    for turn in range(max(1, int(max_tool_turns))):
        ai_message = invoke(messages)
        _add_usage(usage_totals, extract_usage(ai_message))
        messages.append(ai_message)

        tool_calls = getattr(ai_message, 'tool_calls', []) or []
        if not tool_calls:
            return on_no_tool_calls(ai_message, usage_totals)

        # Validate shape up-front so we can reason about parallel groups.
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                raise ProviderAdapterError(
                    provider=provider,
                    code='invalid_tool_call',
                    message='Tool call payload must be a JSON object.',
                    tokens_input=usage_totals['tokens_input'],
                    tokens_output=usage_totals['tokens_output'],
                    tokens_total=usage_totals['tokens_total'],
                )

        index = 0
        while index < len(tool_calls):
            tool_call = tool_calls[index]
            name = str(tool_call.get('name', '')).strip()
            args = normalize_tool_args(tool_call.get('args'))
            terminal_outcome = on_tool_call(name, args, tool_call, turn, index, usage_totals)
            if terminal_outcome is not None:
                return terminal_outcome

            # Collect an adjacent run of parallel-safe tool calls so we can
            # dispatch them concurrently. The LLM returning multiple
            # read-only lookups in one turn is the common case for
            # roadmap-edit resolves.
            if (
                parallel_tool_executor is not None
                and name in safe_set
                and index + 1 < len(tool_calls)
            ):
                group: list[tuple[str, dict[str, Any]]] = [(name, args)]
                group_calls: list[dict[str, Any]] = [tool_call]
                lookahead = index + 1
                while lookahead < len(tool_calls):
                    peek = tool_calls[lookahead]
                    peek_name = str(peek.get('name', '')).strip()
                    if peek_name not in safe_set:
                        break
                    peek_args = normalize_tool_args(peek.get('args'))
                    peek_terminal = on_tool_call(
                        peek_name, peek_args, peek, turn, lookahead, usage_totals
                    )
                    if peek_terminal is not None:
                        return peek_terminal
                    group.append((peek_name, peek_args))
                    group_calls.append(peek)
                    lookahead += 1

                if len(group) > 1:
                    results = parallel_tool_executor(group)
                    for offset, (grp_name, _grp_args) in enumerate(group):
                        gcall = group_calls[offset]
                        gresult = results[offset] if offset < len(results) else {}
                        tool_call_id = str(
                            gcall.get('id') or f'{grp_name}-{turn}-{index + offset}'
                        )
                        messages.append(
                            build_tool_message(
                                json.dumps(gresult, ensure_ascii=True),
                                tool_call_id,
                            )
                        )
                    index = lookahead
                    continue

            tool_result = tool_executor(name, args)
            tool_call_id = str(tool_call.get('id') or f'{name}-{turn}-{index}')
            messages.append(
                build_tool_message(
                    json.dumps(tool_result, ensure_ascii=True),
                    tool_call_id,
                )
            )
            index += 1

    raise ProviderAdapterError(
        provider=provider,
        code=max_turns_error_code,
        message=max_turns_error_message,
        tokens_input=usage_totals['tokens_input'],
        tokens_output=usage_totals['tokens_output'],
        tokens_total=usage_totals['tokens_total'],
    )


def map_provider_error_to_stop_reason(
    provider_error_code: str | None,
    *,
    default: str = 'insufficient_context',
) -> str:
    normalized = str(provider_error_code or '').strip().lower()
    mapping = {
        'max_tool_turns_exceeded': 'tool_budget_exhausted',
        'discovery_budget_exhausted': 'tool_budget_exhausted',
        'discovery_repeat_limit_exhausted': 'tool_budget_exhausted',
        'missing_tool_call': 'insufficient_context',
        'invalid_operation_payload': 'insufficient_context',
        'invalid_tool_arguments': 'insufficient_context',
        'invalid_tool_call': 'insufficient_context',
        'invalid_planner_schema': 'insufficient_context',
        'invalid_clarifier_schema': 'insufficient_context',
    }
    return mapping.get(normalized, default)


def _add_usage(totals: UsageTotals, usage: dict[str, int] | None) -> None:
    if not usage:
        return
    totals['tokens_input'] += int(usage.get('tokens_input') or 0)
    totals['tokens_output'] += int(usage.get('tokens_output') or 0)
    totals['tokens_total'] += int(usage.get('tokens_total') or 0)
    cached = usage.get('tokens_cached')
    if cached is not None:
        totals['tokens_cached'] = int(totals.get('tokens_cached') or 0) + int(cached)
