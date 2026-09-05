"""Result envelopes of the run machine.

``PhaseOutcome`` is what one phase hands back to ``orchestrator.advance``;
``StepResult`` is what one HTTP request (``POST /messages`` or
``POST /runs/{id}/continue``) hands back to the route, which maps it onto the
wire ``MessageResponse``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch, RunCommitView, RunState
from app.core.contracts.sessions import AgentSession, CommitSummary

PhaseOutcomeKind = Literal[
    'paused',
    'cancelled',
    'chat',
    'clarifier',
    'proposal',
    'batches',
    'revert',
    'budget',
    'executed',
    'verified',
    'error',
]


@dataclass
class PhaseOutcome:
    kind: str
    assistant_message: str = ''
    clarifier: dict[str, Any] | None = None
    batches: list[RunBatch] = field(default_factory=list)
    proposal_payload: dict[str, Any] | None = None
    # 'roadmap_plan' (propose) | 'plan_revision' (revise_proposal).
    intent_type: str | None = None
    revision_operations: list[dict[str, Any]] = field(default_factory=list)
    used_read_tools: bool = False
    # The loop result that produced this outcome (turn/token telemetry).
    loop: Any = None
    error: dict[str, Any] | None = None
    # Set by execute when a cancel landed mid-phase (remaining batches skipped).
    cancelled: bool = False


@dataclass
class StepResult:
    session: AgentSession
    run: RunState
    assistant_message: str
    parse_mode: str
    intent_type: str
    response_mode: str
    # Legacy: operations committed to the FOCUS roadmap in this step.
    operations: list[RoadmapOperation]
    staged_operations_version: int
    staged_operations_count: int
    plan_proposal_payload: dict[str, Any] | None = None
    clarifier_card: dict[str, Any] | None = None
    # Legacy: the focus roadmap's commit in this step.
    commit_summary: CommitSummary | None = None
    # Cumulative for the run; `operations` only on this step's commits.
    commits: list[RunCommitView] = field(default_factory=list)
    provider_used: str = 'openai'
    fallback_used: bool = False
    provider_error_code: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_total: int | None = None
    # Cached-prefix input tokens (billed at ~10%). The prompt is deliberately
    # ordered so the static prefix stays byte-stable (runtime/prompt.py) and
    # this is the only signal that the ordering is paying off.
    tokens_cached: int | None = None
    route_lane: str | None = None
    react_loop_turns: int | None = None
    react_loop_budget: int | None = None
    react_loop_termination_reason: str | None = None
    # True when this step ended a segment (checkpoint / terminal): the flow
    # pushes the durable snapshot only then.
    segment_ended: bool = False
