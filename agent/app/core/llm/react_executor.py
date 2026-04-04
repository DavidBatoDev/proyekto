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
) -> BoundedToolLoopOutcome:
    usage_totals: UsageTotals = {'tokens_input': 0, 'tokens_output': 0, 'tokens_total': 0}
    messages = list(initial_messages)

    for turn in range(max(1, int(max_tool_turns))):
        ai_message = invoke(messages)
        _add_usage(usage_totals, extract_usage(ai_message))
        messages.append(ai_message)

        tool_calls = getattr(ai_message, 'tool_calls', []) or []
        if not tool_calls:
            return on_no_tool_calls(ai_message, usage_totals)

        for index, tool_call in enumerate(tool_calls):
            if not isinstance(tool_call, dict):
                raise ProviderAdapterError(
                    provider=provider,
                    code='invalid_tool_call',
                    message='Tool call payload must be a JSON object.',
                    tokens_input=usage_totals['tokens_input'],
                    tokens_output=usage_totals['tokens_output'],
                    tokens_total=usage_totals['tokens_total'],
                )

            name = str(tool_call.get('name', '')).strip()
            args = normalize_tool_args(tool_call.get('args'))
            terminal_outcome = on_tool_call(name, args, tool_call, turn, index, usage_totals)
            if terminal_outcome is not None:
                return terminal_outcome

            tool_result = tool_executor(name, args)
            tool_call_id = str(tool_call.get('id') or f'{name}-{turn}-{index}')
            messages.append(
                build_tool_message(
                    json.dumps(tool_result, ensure_ascii=True),
                    tool_call_id,
                )
            )

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
