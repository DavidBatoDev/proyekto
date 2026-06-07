"""v2 tool catalog and classification.

Read tools and the edit/stage tool are reused VERBATIM from
``app.core.tools.registry`` so the operation schema stays in lockstep with
the Pydantic model, the canonical JSON schema, and the v1 path (schema parity
is automatic — see tests). Only the two extra terminals (``propose_plan``,
``ask_user``) are defined here.

Terminal classification drives the loop: a terminal tool ends the turn and is
mapped to a ``MessagePlanningOutcome`` by ``terminal.py``.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.statuses import TASK_STATUS_VALUES
from app.core.tools.registry import (
    CONTEXT_TOOL_NAMES,
    PLANNING_TOOL_NAME,
    get_context_tools,
    get_planning_tool,
)

PROPOSE_PLAN_TOOL_NAME = 'propose_plan'
ASK_USER_TOOL_NAME = 'ask_user'

# Read tools are non-terminal: the model uses them to gather facts, results
# are fed back, and the loop continues.
READ_TOOL_NAMES = frozenset(CONTEXT_TOOL_NAMES)

# Terminal tools end the turn.
TERMINAL_TOOL_NAMES = frozenset(
    {PLANNING_TOOL_NAME, PROPOSE_PLAN_TOOL_NAME, ASK_USER_TOOL_NAME}
)


def is_read_tool(name: str) -> bool:
    return name in READ_TOOL_NAMES


def is_terminal_tool(name: str) -> bool:
    return name in TERMINAL_TOOL_NAMES


def build_tools(*, has_pending_plan: bool = False) -> list[dict[str, Any]]:
    """The full tool list exposed to the model each turn.

    ``has_pending_plan`` gates the plan-revision affordance on the edit tool —
    see ``_planning_tool``.
    """
    return [
        *get_context_tools(),
        _planning_tool(has_pending_plan),
        propose_plan_tool(),
        ask_user_tool(),
    ]


def _planning_tool(has_pending_plan: bool) -> dict[str, Any]:
    """The registry edit tool, with the ``revision_operations`` affordance
    removed unless a plan is actually awaiting confirmation.

    The shared schema exposes both ``operations`` (live-roadmap edits) and
    ``revision_operations`` (edits to a titles-only *pending* plan). When no
    plan is pending the second lane is a foot-gun: the model can route a
    live-roadmap edit (e.g. "rename epic X") into ``revision_operations``,
    which then silently never touches the roadmap. Stripping the field — and
    the dual-target contract that references it — makes that misroute
    structurally impossible whenever there is nothing to revise. When a plan
    IS pending we keep the field (and a loop-level guard validates its target
    is actually in that plan).
    """
    tool = get_planning_tool()
    if has_pending_plan:
        return tool
    fn = dict(tool['function'])
    params = dict(fn.get('parameters') or {})
    props = dict(params.get('properties') or {})
    props.pop('revision_operations', None)
    params['properties'] = props
    fn['parameters'] = params
    fn['description'] = _strip_dual_target_contract(fn.get('description', ''))
    return {**tool, 'function': fn}


def _strip_dual_target_contract(description: str) -> str:
    """Remove the ``DUAL-TARGET CONTRACT`` sentence block (which introduces
    ``revision_operations``) while leaving the rest of the description intact.
    No-op if the markers aren't found.
    """
    start = description.find('DUAL-TARGET CONTRACT')
    if start == -1:
        return description
    end = description.find('CLARIFIER CONTRACT', start)
    if end == -1:
        return description[:start].rstrip() + ' '
    return description[:start] + description[end:]


def propose_plan_tool() -> dict[str, Any]:
    """Structured strategic-plan proposal. Mirrors the PendingPlan /
    ProposedEpic / ProposedFeature / ProposedTask shapes so the emitted args
    can be handed straight to ``record_pending_plan_from_planner_output``.
    """
    task_schema = {
        'type': 'object',
        'required': ['title'],
        'properties': {
            'title': {'type': 'string'},
            'description': {'type': 'string'},
            'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
            'assignee_label': {'type': 'string'},
        },
    }
    feature_schema = {
        'type': 'object',
        'required': ['title'],
        'properties': {
            'title': {'type': 'string'},
            'description': {'type': 'string'},
            'tasks': {'type': 'array', 'items': task_schema},
        },
    }
    epic_schema = {
        'type': 'object',
        'required': ['title'],
        'properties': {
            'title': {'type': 'string'},
            'description': {'type': 'string'},
            'features': {'type': 'array', 'items': feature_schema},
        },
    }
    return {
        'type': 'function',
        'function': {
            'name': PROPOSE_PLAN_TOOL_NAME,
            'description': (
                'Present a structured roadmap plan for the user to confirm '
                'WITHOUT changing the roadmap. Use when the user asks you to '
                'plan, brainstorm, or draft a multi-item structure and has not '
                'asked to apply it yet. The plan carries titles only — the user '
                'confirms, then a follow-up turn stages the concrete operations.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['summary', 'goal', 'proposed_hierarchy'],
                'properties': {
                    'summary': {
                        'type': 'string',
                        'description': 'One or two sentence overview of the plan.',
                    },
                    'goal': {
                        'type': 'string',
                        'description': 'The outcome this plan achieves.',
                    },
                    'rationale': {'type': 'string'},
                    'proposed_hierarchy': {
                        'type': 'array',
                        'description': 'Epics, each with optional features and tasks.',
                        'items': epic_schema,
                    },
                    'risks': {'type': 'array', 'items': {'type': 'string'}},
                    'next_steps': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        },
    }


def ask_user_tool() -> dict[str, Any]:
    """Structured clarifier — maps to a ClarifierCard the web renders."""
    return {
        'type': 'function',
        'function': {
            'name': ASK_USER_TOOL_NAME,
            'description': (
                'Ask the user ONE question when you genuinely cannot proceed '
                'without their decision (ambiguous target, a required choice you '
                'cannot infer). Provide concrete answer options the user can '
                'click. Do not use this for questions you can answer yourself '
                'from the roadmap or read tools.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['question'],
                'properties': {
                    'lane': {
                        'type': 'string',
                        'enum': ['edit', 'query', 'plan'],
                        'description': 'Which workflow the question belongs to.',
                    },
                    'question': {'type': 'string'},
                    'options': {
                        'type': 'array',
                        'description': (
                            'Concrete full-answer strings the user can select '
                            'as-is (candidate titles, valid values, etc.).'
                        ),
                        'items': {'type': 'string', 'minLength': 1, 'maxLength': 120},
                        'maxItems': 6,
                    },
                    'allow_custom': {
                        'type': 'boolean',
                        'description': 'Whether to also offer a free-form answer.',
                    },
                },
            },
        },
    }
