"""Pre-call output-token estimator for the edit-commit planner turn.

Replaces the previous "start narrow, retry wider on truncation" ladder.
Given what we know before the provider is invoked — prior ReAct tool
observations, bulk-intent classifiers, sub-intent class, roadmap size —
we estimate the plan-tool output in tokens and route to the profile whose
ceiling covers that estimate with slack.

The `planner_output_truncated → repair_retry` path in
`planner_operation_flow.py` stays in place as a safety net for estimator
misses, but is no longer the primary way we find the right ceiling.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable, Literal

from app.core.config import Settings
from app.core.contracts.intents import EditSubIntent
from app.core.llm.tokenization.tiktoken_helper import count_tokens


EstimateSignal = Literal[
    'tool_observations',
    'bulk_intent',
    'sub_intent_default',
    'fallback',
]

# Calibrated at import time against the real tiktoken encoder for the
# default model. The fallback constants kick in only if tiktoken is
# unavailable — they preserve the old string-length heuristic so the
# estimator degrades gracefully.
_FALLBACK_BASE_ENVELOPE_TOKENS = 300
_FALLBACK_PER_OP_ENVELOPE_TOKENS = 60
_FALLBACK_PER_TARGET_ID_TOKENS = 40

# Empirical gap between raw JSON token count and actual LLM output:
# production traces show the model generates ~50% more tokens than the
# pure structural envelope predicts — mostly from longer assistant
# messages and slight whitespace/indentation variance. Phase 2's
# feedback loop replaces this static fraction with a per-tenant
# calibration factor derived from (estimate, actual) samples.
_SAFETY_MARGIN_FRACTION = 0.5

# Canonical sample shapes used once at import to measure real per-op and
# per-target costs under the tokenizer. The envelope models the strict-
# mode reality: every operation field present (most null), since
# OpenAI's strict-schema binding requires all properties even when
# semantically unused. A minimal 3-key envelope would wildly under-count.
_CANONICAL_ASSISTANT_MESSAGE = (
    'I reviewed the roadmap and staged the requested updates against the '
    'current targets. This covers the requested scope in a single '
    'plan_roadmap_operations call so downstream commit can apply atomically.'
)
_CANONICAL_OP_ENVELOPE = {
    'op': 'update_node',
    'node_type': 'task',
    'node_id': None,
    'node_ref': None,
    'parent_id': None,
    'parent_ref': None,
    'new_parent_id': None,
    'new_parent_ref': None,
    'temp_id': None,
    'position': None,
    'patch': {'assignee_id': '00000000-0000-4000-8000-000000000000'},
    'status': None,
    'delta_days': None,
    'scope': None,
    'data': None,
    'targets': None,
}
_CANONICAL_UUID_SAMPLE = '00000000-0000-4000-8000-000000000000'


def _measure_per_target_cost() -> int:
    # Token delta between N and N+1 UUIDs inside a JSON array. Avoids
    # the constant overhead of the array brackets + first-entry framing.
    try:
        one = count_tokens(json.dumps([_CANONICAL_UUID_SAMPLE]))
        two = count_tokens(json.dumps([_CANONICAL_UUID_SAMPLE, _CANONICAL_UUID_SAMPLE]))
        delta = max(1, two - one)
        return delta
    except Exception:
        return _FALLBACK_PER_TARGET_ID_TOKENS


def _measure_op_envelope_cost() -> int:
    try:
        return max(
            _FALLBACK_PER_OP_ENVELOPE_TOKENS // 2,
            count_tokens(json.dumps(_CANONICAL_OP_ENVELOPE)),
        )
    except Exception:
        return _FALLBACK_PER_OP_ENVELOPE_TOKENS


def _measure_base_envelope_cost() -> int:
    try:
        scaffolding = json.dumps(
            {
                'assistant_message': _CANONICAL_ASSISTANT_MESSAGE,
                'operations': [],
            }
        )
        return max(
            _FALLBACK_BASE_ENVELOPE_TOKENS // 2,
            count_tokens(scaffolding),
        )
    except Exception:
        return _FALLBACK_BASE_ENVELOPE_TOKENS


_BASE_ENVELOPE_TOKENS = _measure_base_envelope_cost()
_PER_OP_ENVELOPE_TOKENS = _measure_op_envelope_cost()
_PER_TARGET_ID_TOKENS = _measure_per_target_cost()

# Typical per-call output floor when the planner emits one single-target
# op (update_node, delete_node, mark_status on one node, etc.).
_SINGLE_OP_DEFAULT_TOKENS = 400

# When a bulk intent is detected without a concrete count hint,
# size the estimate for the 95th-percentile roadmap we expect to see.
# Raised from 50 → 100 because the cost of one-time over-sizing
# (~300 extra tokens planned) is cheaper than truncating and retrying
# (a full LLM round-trip). The overview-summary extractor supplies a
# tighter count in the common path; this default is the fallback when
# the overview fetch fails.
_BULK_INTENT_DEFAULT_COUNT = 100

_EDIT_SUB_INTENT_DEFAULT_TOKENS: dict[EditSubIntent, int] = {
    EditSubIntent.RENAME_ONLY: 300,
    EditSubIntent.DELETE_ONLY: 350,
    EditSubIntent.STATUS_CHANGE_ONLY: 450,
    EditSubIntent.MOVE_ONLY: 400,
}
# Every enum member must have a default-token entry. If a new sub-intent
# is added to the enum without extending this table, the estimator would
# fall through to the generic fallback and under-size the turn.
assert set(_EDIT_SUB_INTENT_DEFAULT_TOKENS.keys()) == set(EditSubIntent), (
    'Every EditSubIntent member must have a default-token entry in '
    '_EDIT_SUB_INTENT_DEFAULT_TOKENS'
)


@dataclass(frozen=True)
class CommitEstimate:
    tokens: int
    op_count: int
    target_count: int
    signal: EstimateSignal


def estimate_commit_output_tokens(
    *,
    effective_tool_summary: list[dict[str, Any]] | None = None,
    edit_sub_intent: str | None = None,
    bulk_intent_detected: bool = False,
    roadmap_task_count: int | None = None,
    staged_operation_count: int = 0,
) -> CommitEstimate:
    """Forecast the plan-tool output size for the upcoming commit turn.

    Signal priority:
      1. Prior ReAct tool observations carrying concrete `operations_count`
         and targets/task_ids lists — the helper already told us what the
         planner will echo back.
      2. `staged_operation_count` — for continuation turns where ops from
         an earlier turn are already shaped.
      3. `bulk_intent_detected` — one of the bulk-scope classifiers fired
         on the user message; fall back to `roadmap_task_count` or a safe
         default to size a single bulk op with targets[N].
      4. `edit_sub_intent` default table — narrow single-dimension edits
         have a known small output.
      5. Fallback — single op envelope.
    """

    observed_ops, observed_targets = _sum_tool_observation_hints(
        effective_tool_summary
    )
    if observed_ops or observed_targets:
        raw = (
            _BASE_ENVELOPE_TOKENS
            + observed_ops * _PER_OP_ENVELOPE_TOKENS
            + observed_targets * _PER_TARGET_ID_TOKENS
        )
        return CommitEstimate(
            tokens=_with_safety_margin(raw),
            op_count=observed_ops or 1,
            target_count=observed_targets,
            signal='tool_observations',
        )

    if staged_operation_count > 0:
        raw = (
            _BASE_ENVELOPE_TOKENS
            + staged_operation_count * _PER_OP_ENVELOPE_TOKENS
        )
        return CommitEstimate(
            tokens=_with_safety_margin(raw),
            op_count=staged_operation_count,
            target_count=0,
            signal='tool_observations',
        )

    if bulk_intent_detected:
        projected_targets = (
            roadmap_task_count
            if isinstance(roadmap_task_count, int) and roadmap_task_count > 0
            else _BULK_INTENT_DEFAULT_COUNT
        )
        raw = (
            _BASE_ENVELOPE_TOKENS
            + _PER_OP_ENVELOPE_TOKENS
            + projected_targets * _PER_TARGET_ID_TOKENS
        )
        return CommitEstimate(
            tokens=_with_safety_margin(raw),
            op_count=1,
            target_count=projected_targets,
            signal='bulk_intent',
        )

    if edit_sub_intent in _EDIT_SUB_INTENT_DEFAULT_TOKENS:
        return CommitEstimate(
            tokens=_with_safety_margin(
                _EDIT_SUB_INTENT_DEFAULT_TOKENS[edit_sub_intent]
            ),
            op_count=1,
            target_count=0,
            signal='sub_intent_default',
        )

    return CommitEstimate(
        tokens=_with_safety_margin(_SINGLE_OP_DEFAULT_TOKENS),
        op_count=1,
        target_count=0,
        signal='fallback',
    )


def select_profile_for_estimate(
    estimate: CommitEstimate,
    *,
    edit_sub_intent: str | None,
    settings: Settings,
) -> str | None:
    """Pick the planner profile whose ceiling covers the estimate.

    `scoped_edit` (800-token ceiling) requires THREE conditions:
      - `edit_sub_intent` is present (that profile also narrows the tool
        envelope and prompt shape — it's not just a smaller budget),
      - The estimate came from `tool_observations` (i.e., concrete
        evidence, not an inferred default),
      - Observed op/target counts are both <= 1.

    Earlier versions picked `scoped_edit` whenever the sub-intent matched
    and the estimate fit. That leaked every mis-classified-as-narrow
    bulk edit into the 800 ceiling, which then truncated and paid a full
    repair-retry round-trip. Paying ~500 extra tokens of unused budget
    on a real single-op turn is strictly cheaper than one truncation +
    retry. The `sub_intent_default` and `fallback` signals are explicitly
    *not* strong enough on their own.

    Returns the profile name understood by `_planner_max_tokens_for_profile`
    in `openai_adapter.py`: `'scoped_edit'`, `None` (meaning `'default'`),
    or `'repair_retry'`.
    """
    narrow_cap = settings.openai_edit_narrow_max_tokens or 800
    default_cap = settings.openai_edit_default_max_tokens or 2000
    repair_cap = settings.openai_edit_repair_max_tokens or 3000
    # 90% utilization threshold: leaves ~10% last-mile slack on top of the
    # 20% safety margin already baked into the estimate. Combined ~30%
    # headroom is enough to cover normal estimator variance without
    # pushing every bulk-25 case into repair_retry.
    threshold_multiplier = 0.9

    tokens = max(0, estimate.tokens)
    has_single_op_evidence = (
        estimate.signal == 'tool_observations'
        and estimate.op_count <= 1
        and estimate.target_count <= 1
    )
    if (
        has_single_op_evidence
        and edit_sub_intent is not None
        and tokens <= narrow_cap * threshold_multiplier
    ):
        return 'scoped_edit'
    if tokens <= default_cap * threshold_multiplier:
        return None
    if tokens <= repair_cap * threshold_multiplier:
        return 'repair_retry'
    # Over the widest ceiling — still pick the widest profile so the
    # provider call gets the most room, and let the post-call truncation
    # safety net handle the overflow. Decomposition (Phase B) would
    # intervene here in a future change.
    return 'repair_retry'


_TASK_COUNT_PATTERN = re.compile(r'(\d+)\s+tasks?\b', re.IGNORECASE)


def extract_task_count_from_overview_summary(
    overview_summary: Any,
) -> int | None:
    """Pull the roadmap's task_count out of the formatted overview
    string produced by `roadmap_overview_summarizer.format_overview_summary`.

    The summarizer writes `"N epics · M features · K tasks"`. We regex
    out the `K tasks` count so the estimator can size bulk ops against
    the real task count instead of a generic default. Returns None when
    the string doesn't contain the pattern — estimator falls back to
    its built-in default in that case.
    """
    if not isinstance(overview_summary, str):
        return None
    match = _TASK_COUNT_PATTERN.search(overview_summary)
    if not match:
        return None
    try:
        value = int(match.group(1))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def profile_ceiling_tokens(
    profile: str | None, *, settings: Settings
) -> int:
    """Resolve the token ceiling for a profile, mirroring
    `_planner_max_tokens_for_profile` in openai_adapter so we can log
    the chosen ceiling alongside the estimator event."""
    normalized = str(profile or '').strip() or 'default'
    if normalized == 'repair_retry':
        return settings.openai_edit_repair_max_tokens or 3000
    if normalized == 'scoped_edit':
        return settings.openai_edit_narrow_max_tokens or 800
    return settings.openai_edit_default_max_tokens or 2000


def _sum_tool_observation_hints(
    summaries: Iterable[dict[str, Any]] | None,
) -> tuple[int, int]:
    """Sum operations_count across entries; take the MAX target-count
    signal per entry. The fields `targets`, `task_ids`, `matched_task_count`,
    `updated_task_count` all describe the same underlying id set —
    summing them would triple-count a single 24-task batch.

    A `resolve_node_reference` call that landed on exactly one match is
    also counted as one implied op + one implied target: without this, a
    batch of N single-match resolves looks like zero tool evidence and
    the estimator falls through to the sub-intent default, sizing the
    turn for one op when the planner is about to emit N. That's the
    exact miss that caused the "Delete all my epics" truncation — six
    resolves preceded the commit turn but contributed nothing.
    """
    if not summaries:
        return 0, 0
    ops_total = 0
    targets_total = 0
    for entry in summaries:
        if not isinstance(entry, dict):
            continue
        result_summary = (
            entry.get('result_summary')
            if isinstance(entry.get('result_summary'), dict)
            else entry
        )
        ops_total += _safe_int(result_summary.get('operations_count'))
        per_entry_targets = 0
        for key in ('targets', 'task_ids', 'matched_task_ids', 'match_ids'):
            value = result_summary.get(key)
            if isinstance(value, list):
                per_entry_targets = max(per_entry_targets, len(value))
        match_items = result_summary.get('match_items')
        if isinstance(match_items, list):
            per_entry_targets = max(per_entry_targets, len(match_items))
        per_entry_targets = max(
            per_entry_targets,
            _safe_int(result_summary.get('matched_task_count')),
            _safe_int(result_summary.get('updated_task_count')),
        )
        targets_total += per_entry_targets

        tool_name = str(
            entry.get('tool_name') or result_summary.get('tool_name') or ''
        ).strip()
        if tool_name == 'resolve_node_reference':
            # Both the react_helpers summary (`match_count`) and the raw
            # tool result (`matches_count`) appear in the wild; accept
            # either. Only a confirmed single-match implies an op — a
            # multi-match resolve is ambiguous and the planner will
            # typically clarify rather than emit.
            match_count = _safe_int(result_summary.get('match_count'))
            if match_count == 0:
                match_count = _safe_int(result_summary.get('matches_count'))
            if match_count == 1:
                ops_total += 1
    return ops_total, targets_total


def _safe_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int) and value > 0:
        return value
    return 0


def _with_safety_margin(raw_tokens: int) -> int:
    return int(round(raw_tokens * (1.0 + _SAFETY_MARGIN_FRACTION)))
