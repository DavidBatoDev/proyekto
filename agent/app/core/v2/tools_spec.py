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
    MEMORY_TOOL_NAMES as _REGISTRY_MEMORY_TOOL_NAMES,
    PLANNING_TOOL_NAME,
    get_context_tools,
    get_planning_tool,
)

PROPOSE_PLAN_TOOL_NAME = 'propose_plan'
ASK_USER_TOOL_NAME = 'ask_user'
SAVE_MEMORY_TOOL_NAME = 'save_memory'
FORGET_MEMORY_TOOL_NAME = 'forget_memory'
REVERT_CHANGES_TOOL_NAME = 'revert_changes'

# Read tools are non-terminal: the model uses them to gather facts, results
# are fed back, and the loop continues.
READ_TOOL_NAMES = frozenset(CONTEXT_TOOL_NAMES)

# Memory tools are also non-terminal (the model saves/forgets a durable note
# and then finishes its answer), but unlike reads they WRITE to the backend.
MEMORY_TOOL_NAMES = frozenset(_REGISTRY_MEMORY_TOOL_NAMES)

# Everything the mid-loop dispatcher executes (results fed back, loop
# continues).
DISPATCHER_TOOL_NAMES = READ_TOOL_NAMES | MEMORY_TOOL_NAMES

# Terminal tools end the turn.
TERMINAL_TOOL_NAMES = frozenset(
    {
        PLANNING_TOOL_NAME,
        PROPOSE_PLAN_TOOL_NAME,
        ASK_USER_TOOL_NAME,
        REVERT_CHANGES_TOOL_NAME,
    }
)


def is_read_tool(name: str) -> bool:
    return name in READ_TOOL_NAMES


def is_dispatcher_tool(name: str) -> bool:
    return name in DISPATCHER_TOOL_NAMES


def is_terminal_tool(name: str) -> bool:
    return name in TERMINAL_TOOL_NAMES


def build_tools(
    *,
    has_pending_plan: bool = False,
    include_knowledge_search: bool = False,
) -> list[dict[str, Any]]:
    """The full tool list exposed to the model each turn.

    ``has_pending_plan`` gates the plan-revision affordance on the edit tool —
    see ``_planning_tool``. ``include_knowledge_search`` exposes the RAG
    search tool only when the knowledge pipeline is enabled (dispatch wiring
    stays permanent via CONTEXT_TOOL_NAMES; only the model-facing exposure is
    gated).
    """
    tools: list[dict[str, Any]] = [*get_context_tools()]
    if include_knowledge_search:
        tools.append(search_knowledge_tool())
    tools.extend(
        [
            _planning_tool(has_pending_plan),
            propose_plan_tool(),
            ask_user_tool(),
            save_memory_tool(),
            forget_memory_tool(),
            revert_changes_tool(),
        ]
    )
    return tools


def search_knowledge_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': 'search_knowledge',
            'description': (
                "Semantic + keyword search over this project's history: chat "
                'messages (only rooms the current user can see), task '
                'comments, the project brief, and the activity log. Use for '
                '"what did we discuss/decide about X", "did anyone mention '
                'Y", or context that is not on the roadmap outline. Returns '
                'ranked excerpts with source metadata — cite the source type '
                'and author/date in your answer.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['query'],
                'properties': {
                    'query': {
                        'type': 'string',
                        'minLength': 2,
                        'maxLength': 400,
                    },
                    'sources': {
                        'type': 'array',
                        'items': {
                            'type': 'string',
                            'enum': [
                                'chat_message',
                                'task_comment',
                                'activity_log',
                                'brief',
                            ],
                        },
                        'minItems': 1,
                        'maxItems': 4,
                    },
                    'limit': {'type': 'integer', 'minimum': 1, 'maximum': 12},
                },
            },
        },
    }


def save_memory_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': SAVE_MEMORY_TOOL_NAME,
            'description': (
                'Persist ONE durable preference or convention for this roadmap '
                '(shared with all collaborators), e.g. a naming scheme or a '
                'default workflow rule. Use for explicit "remember ..." '
                'requests (source=user_request) or a clearly durable '
                'preference you inferred (source=inferred). NEVER store '
                'roadmap content, statuses, or one-off facts. Continue your '
                'answer after saving.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['content'],
                'properties': {
                    'content': {
                        'type': 'string',
                        'minLength': 3,
                        'maxLength': 300,
                        'description': 'The preference, phrased as a standing rule.',
                    },
                    'source': {
                        'type': 'string',
                        'enum': ['user_request', 'inferred'],
                    },
                    'scope': {
                        'type': 'string',
                        'enum': ['roadmap', 'project'],
                        'description': (
                            "'project' = applies to every roadmap in this "
                            "project; default 'roadmap' = this roadmap only."
                        ),
                    },
                    'category': {
                        'type': 'string',
                        'enum': ['preference', 'fact', 'decision'],
                        'description': (
                            'preference = how to work; fact = durable truth '
                            'about the project; decision = an agreed choice.'
                        ),
                    },
                },
            },
        },
    }


def forget_memory_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': FORGET_MEMORY_TOOL_NAME,
            'description': (
                'Deactivate one memory note by the memory_id shown in the '
                '"# Memory notes" section. Continue your answer after.'
            ),
            'parameters': {
                'type': 'object',
                'required': ['memory_id'],
                'properties': {
                    'memory_id': {'type': 'string'},
                },
            },
        },
    }


def revert_changes_tool() -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': REVERT_CHANGES_TOOL_NAME,
            'description': (
                'Undo committed roadmap changes, restoring the exact prior state '
                '(deleted items come back with their original structure and '
                'fields; created items are removed; edits are reverted). With no '
                'argument, undoes the most recent change. To undo back to an '
                'earlier point ("revert everything I did before X"), pass the '
                'change_id of that earlier change from the "# Recent changes" '
                'section — every change committed at or after it is undone. If '
                'you cannot tell which point the user means, ask first with '
                'ask_user instead of guessing.'
            ),
            'parameters': {
                'type': 'object',
                'required': [],
                'properties': {
                    'change_id': {
                        'type': 'string',
                        'description': (
                            'Optional. The change_id from "# Recent changes" to '
                            'revert back to (that change and all newer ones are '
                            'undone). Omit to undo only the most recent change.'
                        ),
                    },
                },
            },
        },
    }


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
                'Ask the user 1-4 structured questions when you genuinely '
                'cannot proceed without their decision (ambiguous target, a '
                'required choice you cannot infer). Batch every question '
                'blocking the same decision into ONE call via `questions` — '
                'never ask them across separate turns. Provide concrete '
                'answer options the user can click. Do not use this for '
                'questions you can answer yourself from the roadmap or read '
                'tools.'
            ),
            'parameters': {
                'type': 'object',
                'required': [],
                'properties': {
                    'lane': {
                        'type': 'string',
                        'enum': ['edit', 'query', 'plan'],
                        'description': 'Which workflow the question belongs to.',
                    },
                    'questions': {
                        'type': 'array',
                        'minItems': 1,
                        'maxItems': 4,
                        'description': (
                            'PREFERRED. All questions blocking this decision, '
                            'asked together (max 4). Each renders as its own '
                            'group on one card.'
                        ),
                        'items': {
                            'type': 'object',
                            'required': ['question', 'options'],
                            'properties': {
                                'header': {
                                    'type': 'string',
                                    'maxLength': 32,
                                    'description': (
                                        'Very short topic chip, 1-3 words, '
                                        'e.g. "Target epic".'
                                    ),
                                },
                                'question': {'type': 'string'},
                                'multi_select': {
                                    'type': 'boolean',
                                    'description': (
                                        'true = checkboxes, the user may pick '
                                        'several options. Default false = '
                                        'radio, pick exactly one.'
                                    ),
                                },
                                'allow_custom': {
                                    'type': 'boolean',
                                    'description': (
                                        'Also offer a free-form "Other" '
                                        'answer. Default true.'
                                    ),
                                },
                                'options': {
                                    'type': 'array',
                                    'minItems': 2,
                                    'maxItems': 6,
                                    'items': {
                                        'type': 'object',
                                        'required': ['label'],
                                        'properties': {
                                            'label': {
                                                'type': 'string',
                                                'minLength': 1,
                                                'maxLength': 120,
                                                'description': (
                                                    'A full answer the user '
                                                    'can select as-is.'
                                                ),
                                            },
                                            'description': {
                                                'type': 'string',
                                                'maxLength': 200,
                                                'description': (
                                                    'Optional one-line '
                                                    'context/consequence for '
                                                    'this option.'
                                                ),
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    'question': {
                        'type': 'string',
                        'description': (
                            'Legacy single-question shorthand. Prefer `questions`.'
                        ),
                    },
                    'options': {
                        'type': 'array',
                        'description': 'Options for the legacy shorthand.',
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
