from __future__ import annotations

from typing import Any


def record_planning_loop_metrics(
    *,
    phase_timings: dict[str, Any],
    planning_loop_metrics: dict[str, Any],
) -> None:
    phase_timings['provider_planning_ms'] = int(
        planning_loop_metrics.get('elapsed_ms') or 0
    )
    phase_timings['react_loop_turns'] = int(
        planning_loop_metrics.get('loop_turns') or 0
    )
    phase_timings['react_loop_budget'] = int(
        planning_loop_metrics.get('loop_budget') or 0
    )
    phase_timings['react_loop_termination_reason'] = planning_loop_metrics.get(
        'termination_reason'
    )
    phase_timings['llm_calls_budget'] = int(
        planning_loop_metrics.get('llm_calls_budget') or 0
    )
    phase_timings['llm_calls_used'] = int(
        planning_loop_metrics.get('llm_calls_used') or 0
    )
    phase_timings['llm_calls_remaining'] = int(
        planning_loop_metrics.get('llm_calls_remaining') or 0
    )


def record_context_tool_phase_metrics(
    *,
    phase_timings: dict[str, Any],
    session_context: dict[str, Any],
) -> None:
    internal_metrics = session_context.get('_phase_metrics', {})
    if isinstance(internal_metrics, dict):
        context_tools_total_ms = float(internal_metrics.get('context_tools_ms') or 0.0)
        context_tools_http_ms = float(
            internal_metrics.get('context_tools_http_call_ms') or 0.0
        )
        phase_timings['context_tools_ms'] = int(context_tools_total_ms)
        phase_timings['context_tools_http_call_ms'] = int(context_tools_http_ms)
        phase_timings['context_tools_executor_overhead_ms'] = int(
            max(context_tools_total_ms - context_tools_http_ms, 0.0)
        )
        phase_timings['context_tools_by_name_ms'] = (
            internal_metrics.get('context_tools_by_name')
            if isinstance(internal_metrics.get('context_tools_by_name'), dict)
            else {}
        )
        phase_timings['resolve_cache_hits'] = int(
            internal_metrics.get('resolve_cache_hits') or 0
        )
        phase_timings['resolve_cache_misses'] = int(
            internal_metrics.get('resolve_cache_misses') or 0
        )
        phase_timings['resolve_dedup_hits'] = int(
            internal_metrics.get('resolve_dedup_hits') or 0
        )


def read_resolve_cache_metrics(
    *,
    phase_timings: dict[str, Any],
) -> tuple[int, int, int]:
    resolve_cache_hits = int(phase_timings.get('resolve_cache_hits') or 0)
    resolve_cache_misses = int(phase_timings.get('resolve_cache_misses') or 0)
    resolve_dedup_hits = int(phase_timings.get('resolve_dedup_hits') or 0)
    return resolve_cache_hits, resolve_cache_misses, resolve_dedup_hits


def read_react_loop_metrics(
    *,
    phase_timings: dict[str, Any],
) -> tuple[int | None, int | None, str | None]:
    react_loop_turns = (
        int(phase_timings.get('react_loop_turns'))
        if phase_timings.get('react_loop_turns') is not None
        else None
    )
    react_loop_budget = (
        int(phase_timings.get('react_loop_budget'))
        if phase_timings.get('react_loop_budget') is not None
        else None
    )
    react_loop_termination_reason = (
        str(phase_timings.get('react_loop_termination_reason'))
        if phase_timings.get('react_loop_termination_reason') is not None
        else None
    )
    return react_loop_turns, react_loop_budget, react_loop_termination_reason
