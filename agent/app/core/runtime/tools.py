"""The model-facing tool catalog, per phase and per scope.

Read tools and the stage tool are DERIVED from ``app.core.tools.registry`` so
the operation schema stays in lockstep with the Pydantic model and the
canonical JSON schema (the backend gate greps the registry's ``required=``
literals, so this module never edits the registry — it deep-copies each spec
and adjusts the copy). Per-scope rules:

- roadmap reads take an explicit ``roadmap_id`` that is optional in a roadmap
  session (the dispatcher defaults it to the focus roadmap) and required in a
  workspace session — the ``required`` strip happens HERE;
- ``stage_edits`` (the registry planning tool renamed) gains ``roadmap_id``,
  always drops ``revision_operations`` and the dual-target/clarifier contract
  text, and forces ``operations.minItems=1``;
- ``propose`` (was ``propose_plan``) gains ``targets[]``;
- ``revise_proposal`` is exposed only while a proposal is pending.

Terminal classification drives the loop: a terminal tool ends the turn.
"""

from __future__ import annotations

import copy
from typing import Any

from app.core.contracts.statuses import TASK_STATUS_VALUES
from app.core.tools.handlers.workspace_query import (
    PROJECT_KEYED_TOOL_NAMES,
    WORKSPACE_TOOL_NAMES,
)
from app.core.tools.registry import (
    COMMENT_TOOL_NAMES as _REGISTRY_COMMENT_TOOL_NAMES,
    CONTEXT_TOOL_NAMES,
    MEMORY_TOOL_NAMES as _REGISTRY_MEMORY_TOOL_NAMES,
    PLANNING_TOOL_NAME,
    ROADMAP_ADMIN_TOOL_NAMES as _REGISTRY_ROADMAP_ADMIN_TOOL_NAMES,
    get_context_tools,
    get_planning_tool,
)

STAGE_EDITS_TOOL_NAME = 'stage_edits'
PROPOSE_TOOL_NAME = 'propose'
REVISE_PROPOSAL_TOOL_NAME = 'revise_proposal'
ASK_USER_TOOL_NAME = 'ask_user'
SAVE_MEMORY_TOOL_NAME = 'save_memory'
FORGET_MEMORY_TOOL_NAME = 'forget_memory'
ADD_TASK_COMMENTS_TOOL_NAME = 'add_task_comments'
REVERT_CHANGES_TOOL_NAME = 'revert_changes'
SEARCH_KNOWLEDGE_TOOL_NAME = 'search_knowledge'
# The engine loop matches the proposal terminal on this name.
PROPOSE_PLAN_TOOL_NAME = PROPOSE_TOOL_NAME

ROADMAP_ID_DESCRIPTION = (
    'Roadmap id. Optional in a roadmap session (defaults to the focus '
    'roadmap); required otherwise. Use list_roadmaps to find ids.'
)
PROJECT_ID_DESCRIPTION = (
    'Project id. Optional in a roadmap session (defaults to the focus '
    "roadmap's project); required otherwise. Use list_roadmaps or "
    'get_workspace_overview to find ids.'
)
_ROADMAP_OVERVIEW_LOAD_HINT = (
    ' Loads the roadmap into your context and assigns it handles (R2.E1…) '
    'you can use in stage_edits.'
)

# Read tools are non-terminal: the model uses them to gather facts, results
# are fed back, and the loop continues.
READ_TOOL_NAMES = frozenset(CONTEXT_TOOL_NAMES) | frozenset(WORKSPACE_TOOL_NAMES)

# Memory tools are also non-terminal (the model saves/forgets a durable note
# and then finishes its answer), but unlike reads they WRITE to the backend.
MEMORY_TOOL_NAMES = frozenset(_REGISTRY_MEMORY_TOOL_NAMES)

# Comment tools follow the same non-terminal write pattern: the model posts
# task comments, reads the per-task results, and continues its answer.
COMMENT_TOOL_NAMES = frozenset(_REGISTRY_COMMENT_TOOL_NAMES)

# Roadmap admin tools create a roadmap or attach a standalone one to a
# project — non-terminal writes through plain backend REST.
ROADMAP_ADMIN_TOOL_NAMES = frozenset(_REGISTRY_ROADMAP_ADMIN_TOOL_NAMES)
CREATE_ROADMAP_TOOL_NAME = 'create_roadmap'
ATTACH_ROADMAP_TOOL_NAME = 'attach_roadmap_to_project'

# Everything the mid-loop dispatcher executes (results fed back, loop
# continues).
DISPATCHER_TOOL_NAMES = (
    READ_TOOL_NAMES | MEMORY_TOOL_NAMES | COMMENT_TOOL_NAMES | ROADMAP_ADMIN_TOOL_NAMES
)

# Terminal tools end the turn. PLANNING_TOOL_NAME is the registry's schema-
# bound name for the stage tool (== stage_edits once the registry constant is
# repointed); listing both keeps the engine matching either.
TERMINAL_TOOL_NAMES = frozenset(
    {
        STAGE_EDITS_TOOL_NAME,
        PLANNING_TOOL_NAME,
        PROPOSE_TOOL_NAME,
        REVISE_PROPOSAL_TOOL_NAME,
        ASK_USER_TOOL_NAME,
        REVERT_CHANGES_TOOL_NAME,
    }
)

# Read tools whose schema is defined here (project-keyed variants + the
# knowledge search) instead of copied from the registry.
_REDEFINED_READ_TOOL_NAMES = frozenset(PROJECT_KEYED_TOOL_NAMES) | {SEARCH_KNOWLEDGE_TOOL_NAME}


def is_read_tool(name: str) -> bool:
    return name in READ_TOOL_NAMES


def is_dispatcher_tool(name: str) -> bool:
    return name in DISPATCHER_TOOL_NAMES


def is_terminal_tool(name: str) -> bool:
    return name in TERMINAL_TOOL_NAMES


def is_stage_tool(name: str) -> bool:
    return name in {STAGE_EDITS_TOOL_NAME, PLANNING_TOOL_NAME}


# ---------------------------------------------------------------------------
# Scope helpers
# ---------------------------------------------------------------------------


def _scope_kind(scope: Any) -> str:
    kind = getattr(scope, 'kind', None)
    if kind is None and isinstance(scope, dict):
        kind = scope.get('kind')
    return 'workspace' if kind == 'workspace' else 'roadmap'


def _roadmap_id_required(scope: Any, pinned_roadmap_id: str | None) -> bool:
    if pinned_roadmap_id:
        return False
    return _scope_kind(scope) == 'workspace'


def _roadmap_id_property(pinned_roadmap_id: str | None) -> dict[str, Any]:
    if pinned_roadmap_id:
        return {
            'type': 'string',
            'enum': [pinned_roadmap_id],
            'description': f'Must be {pinned_roadmap_id} (the roadmap this turn works on).',
        }
    return {'type': 'string', 'description': ROADMAP_ID_DESCRIPTION}


def _with_required(spec: dict[str, Any], name: str, required: bool) -> None:
    params = spec['function']['parameters']
    current = [entry for entry in params.get('required', []) if entry != name]
    if required:
        current.append(name)
    params['required'] = current


# ---------------------------------------------------------------------------
# Catalogs
# ---------------------------------------------------------------------------


def build_tools(
    *,
    has_pending_plan: bool = False,
    include_knowledge_search: bool = False,
    scope: Any = None,
) -> list[dict[str, Any]]:
    """The investigate-phase catalog: roadmap reads + cross-scope reads +
    memory/comment writes + the terminals. ``scope`` (None = roadmap scope)
    decides whether ``roadmap_id`` is required; ``has_pending_plan`` exposes
    ``revise_proposal``; ``include_knowledge_search`` exposes the RAG search
    only when the knowledge pipeline is enabled (dispatch wiring stays
    permanent; only the model-facing exposure is gated)."""
    tools: list[dict[str, Any]] = [*roadmap_read_tools(scope)]
    tools.extend(cross_scope_tools(scope, include_knowledge_search=include_knowledge_search))
    tools.extend(write_tools(scope))
    tools.append(stage_edits_tool(scope))
    tools.append(propose_tool(scope))
    if has_pending_plan:
        tools.append(revise_proposal_tool())
    tools.append(ask_user_tool())
    tools.append(revert_changes_tool(scope))
    return tools


def investigate_tools(
    session: Any,
    run: Any = None,
    *,
    settings: Any = None,
    has_pending_plan: bool | None = None,
    include_knowledge_search: bool | None = None,
) -> list[dict[str, Any]]:
    """``build_tools`` for a session: pending-plan and knowledge-search flags
    derived from the session/settings when not given."""
    _ = run
    if has_pending_plan is None:
        pending = getattr(session.metadata, 'pending_plan', None)
        has_pending_plan = pending is not None and getattr(pending, 'status', None) in {
            'proposed',
            'awaiting_answers',
        }
    if include_knowledge_search is None:
        include_knowledge_search = bool(
            getattr(settings, 'agent_knowledge_search_enabled', False)
        )
    return build_tools(
        has_pending_plan=has_pending_plan,
        include_knowledge_search=include_knowledge_search,
        scope=session.scope,
    )


def materialize_tools(session: Any, roadmap_id: str) -> list[dict[str, Any]]:
    """Execute-phase materialize loop: roadmap reads pinned to the target
    roadmap + ``stage_edits`` pinned to it."""
    tools = roadmap_read_tools(session.scope, pinned_roadmap_id=roadmap_id)
    tools.append(stage_edits_tool(session.scope, pinned_roadmap_id=roadmap_id))
    return tools


def repair_tools(roadmap_id: str, scope: Any = None) -> list[dict[str, Any]]:
    """Execute-phase repair iteration: only ``stage_edits`` pinned to the
    batch's roadmap."""
    return [stage_edits_tool(scope, pinned_roadmap_id=roadmap_id)]


def verify_tools(scope: Any = None) -> list[dict[str, Any]]:
    """Verify phase: ``propose`` only (a follow-up proposal), targets required."""
    return [propose_tool(scope, targets_required=True)]


# ---------------------------------------------------------------------------
# Roadmap reads (registry copies)
# ---------------------------------------------------------------------------


def roadmap_read_tools(scope: Any = None, *, pinned_roadmap_id: str | None = None) -> list[dict[str, Any]]:
    """Every registry context tool (minus the project-keyed variants and the
    knowledge search, which get their own specs) with ``roadmap_id``
    described per scope and dropped from ``required`` in a roadmap session.
    Copies only — the registry literals are never touched."""
    required = _roadmap_id_required(scope, pinned_roadmap_id)
    tools: list[dict[str, Any]] = []
    for spec in get_context_tools():
        name = spec['function']['name']
        if name in _REDEFINED_READ_TOOL_NAMES:
            continue
        copied = copy.deepcopy(spec)
        params = copied['function']['parameters']
        props = params.setdefault('properties', {})
        if 'roadmap_id' in props:
            props['roadmap_id'] = _roadmap_id_property(pinned_roadmap_id)
            _with_required(copied, 'roadmap_id', required)
        if name == 'get_roadmap_overview':
            copied['function']['description'] = (
                copied['function']['description'].rstrip() + _ROADMAP_OVERVIEW_LOAD_HINT
            )
        tools.append(copied)
    return tools


# ---------------------------------------------------------------------------
# Cross-scope reads
# ---------------------------------------------------------------------------


def _function_tool(name: str, description: str, required: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    return {
        'type': 'function',
        'function': {
            'name': name,
            'description': description,
            'parameters': {
                'type': 'object',
                'required': required,
                'properties': properties,
            },
        },
    }


def cross_scope_tools(scope: Any = None, *, include_knowledge_search: bool = False) -> list[dict[str, Any]]:
    tools = [
        get_workspace_overview_tool(),
        list_roadmaps_tool(),
        search_everything_tool(),
        list_my_tasks_tool(),
    ]
    if include_knowledge_search:
        tools.append(search_knowledge_tool())
    tools.extend(project_tools(scope))
    return tools


def get_workspace_overview_tool() -> dict[str, Any]:
    return _function_tool(
        'get_workspace_overview',
        'List the projects, roadmaps (with epic/feature/task counts) and teams '
        'the current user can reach, tagged by lane (current workspace, shared, '
        'other workspace). Use it to find ids before list_roadmaps / '
        'get_roadmap_overview, or to answer "what am I working on" questions. '
        'Projects and roadmaps are separate lists: a roadmap with project_id null '
        'is standalone (no project); a project with roadmap_id null has no roadmap '
        'yet. lane "shared" only means outside your workspaces — check owner_id '
        'before describing an item as shared with the user.',
        [],
        {
            'workspace_id': {
                'type': 'string',
                'description': (
                    'Optional workspace id; defaults to the session workspace '
                    "(or the focus roadmap's workspace)."
                ),
            }
        },
    )


def list_roadmaps_tool() -> dict[str, Any]:
    return _function_tool(
        'list_roadmaps',
        'List roadmaps the user can access, optionally narrowed to a workspace '
        'or project or filtered by name. Returns ids you can pass to '
        'get_roadmap_overview and stage_edits. A roadmap with project_id null is '
        'standalone — it is not a project and belongs to none.',
        [],
        {
            'workspace_id': {'type': 'string'},
            'project_id': {'type': 'string'},
            'query': {
                'type': 'string',
                'maxLength': 200,
                'description': 'Case-insensitive name filter.',
            },
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
        },
    )


def search_everything_tool() -> dict[str, Any]:
    return _function_tool(
        'search_everything',
        'Search across every roadmap and project the user can access: '
        'epics, features, tasks, roadmaps, projects. Use it when the item is '
        'not on a loaded outline or you do not know which roadmap it lives on. '
        'Results carry roadmap/project attribution. Teams and milestones are '
        'not searchable here: teams are on get_workspace_overview, milestones '
        'on the roadmap outline.',
        ['query'],
        {
            'query': {'type': 'string', 'minLength': 2, 'maxLength': 200},
            'kinds': {
                'type': 'array',
                'items': {
                    'type': 'string',
                    'enum': ['project', 'roadmap', 'epic', 'feature', 'task'],
                },
                'minItems': 1,
                'maxItems': 5,
            },
            'roadmap_ids': {
                'type': 'array',
                'items': {'type': 'string'},
                'maxItems': 20,
                'description': 'Narrow to these roadmaps (never widens access).',
            },
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 20},
        },
    )


def list_my_tasks_tool() -> dict[str, Any]:
    return _function_tool(
        'list_my_tasks',
        "Tasks assigned to the current user across every accessible roadmap, "
        "with feature/epic/roadmap attribution. Use for \"what's on my plate\", "
        '"what is overdue for me", or "what do I have this week".',
        [],
        {
            'status': {
                'type': 'string',
                'enum': ['open', 'all', *TASK_STATUS_VALUES],
                'description': "'open' (default) = not done; 'all' = every status.",
            },
            'due': {
                'type': 'string',
                'enum': ['overdue', 'today', 'week', 'all'],
                'description': 'Due-date window; default all.',
            },
            'roadmap_ids': {
                'type': 'array',
                'items': {'type': 'string'},
                'maxItems': 20,
            },
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
        },
    )


def search_knowledge_tool() -> dict[str, Any]:
    return _function_tool(
        SEARCH_KNOWLEDGE_TOOL_NAME,
        "Semantic + keyword search over project history: chat messages (only "
        'rooms the current user can see), task comments, the project brief, '
        'the activity log and uploaded file chunks. Use for "what did we '
        'discuss/decide about X", '
        '"did anyone mention Y", or context that is not on a roadmap outline. '
        'Defaults to the projects of the loaded roadmaps; pass project_ids to '
        'search other projects. Returns ranked excerpts with source metadata '
        '— cite the source type and author/date in your answer.',
        ['query'],
        {
            'query': {'type': 'string', 'minLength': 2, 'maxLength': 400},
            'project_ids': {
                'type': 'array',
                'items': {'type': 'string'},
                'maxItems': 10,
                'description': 'Projects to search; defaults to the loaded roadmaps\' projects.',
            },
            'sources': {
                'type': 'array',
                'items': {
                    'type': 'string',
                    'enum': ['chat_message', 'task_comment', 'activity_log', 'brief', 'file_chunk'],
                },
                'minItems': 1,
                'maxItems': 5,
            },
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 12},
        },
    )


def project_tools(scope: Any = None) -> list[dict[str, Any]]:
    """Project-keyed context reads. ``project_id`` is optional in a roadmap
    session (the dispatcher defaults it to the focus roadmap's project) and
    required otherwise."""
    required = ['project_id'] if _scope_kind(scope) == 'workspace' else []
    project_id = {'type': 'string', 'description': PROJECT_ID_DESCRIPTION}
    return [
        _function_tool(
            'get_project_brief',
            'Full narrative brief of a project (goals, scope, custom fields). '
            'Use when the compact "# Project context" block is not enough.',
            list(required),
            {'project_id': dict(project_id)},
        ),
        _function_tool(
            'list_project_resources',
            "A project's resource links (docs, designs, repos) with titles and URLs.",
            list(required),
            {'project_id': dict(project_id)},
        ),
        _function_tool(
            'list_project_meetings',
            "A project's meetings — upcoming, recent, or all — with times and participants.",
            list(required),
            {
                'project_id': dict(project_id),
                'window': {'type': 'string', 'enum': ['upcoming', 'recent', 'all']},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
            },
        ),
        _function_tool(
            'list_project_members',
            "The people on a project with their roles and ids (use an id for "
            'assignments or get_member_details).',
            list(required),
            {'project_id': dict(project_id)},
        ),
        _function_tool(
            'get_member_details',
            "One project member's profile and project capabilities.",
            [*required, 'member_id'],
            {'project_id': dict(project_id), 'member_id': {'type': 'string'}},
        ),
    ]


# ---------------------------------------------------------------------------
# Non-terminal writes
# ---------------------------------------------------------------------------


def write_tools(scope: Any = None) -> list[dict[str, Any]]:
    return [
        save_memory_tool(scope),
        forget_memory_tool(scope),
        add_task_comments_tool(scope),
        create_roadmap_tool(),
        attach_roadmap_to_project_tool(scope),
    ]


def save_memory_tool(scope: Any = None) -> dict[str, Any]:
    required = ['content', 'roadmap_id'] if _scope_kind(scope) == 'workspace' else ['content']
    return _function_tool(
        SAVE_MEMORY_TOOL_NAME,
        'Persist ONE durable preference or convention for a roadmap '
        '(shared with all collaborators), e.g. a naming scheme or a '
        'default workflow rule. Use for explicit "remember ..." '
        'requests (source=user_request) or a clearly durable '
        'preference you inferred (source=inferred). NEVER store '
        'roadmap content, statuses, or one-off facts. Continue your '
        'answer after saving.',
        required,
        {
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
                    "'project' = applies to every roadmap in the "
                    "project; default 'roadmap' = that roadmap only."
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
            'roadmap_id': {
                'type': 'string',
                'description': (
                    'Roadmap the note belongs to. Optional in a roadmap session '
                    '(defaults to the focus roadmap); required otherwise.'
                ),
            },
        },
    )


def forget_memory_tool(scope: Any = None) -> dict[str, Any]:
    required = ['memory_id', 'roadmap_id'] if _scope_kind(scope) == 'workspace' else ['memory_id']
    return _function_tool(
        FORGET_MEMORY_TOOL_NAME,
        'Deactivate one memory note by the memory_id shown in the '
        '"# Memory notes" section. Continue your answer after.',
        required,
        {
            'memory_id': {'type': 'string'},
            'roadmap_id': {
                'type': 'string',
                'description': (
                    'Roadmap the note belongs to. Optional in a roadmap session '
                    '(defaults to the focus roadmap); required otherwise.'
                ),
            },
        },
    )


def add_task_comments_tool(scope: Any = None) -> dict[str, Any]:
    required = (
        ['task_ids', 'content', 'roadmap_id']
        if _scope_kind(scope) == 'workspace'
        else ['task_ids', 'content']
    )
    return _function_tool(
        ADD_TASK_COMMENTS_TOOL_NAME,
        'Post the SAME comment to one or more tasks of one roadmap, authored as '
        'the current user and visible to collaborators immediately. Put '
        'every target task in ONE call via task_ids, using ids from '
        'read tools — never invent them. Plain text only; @mentions '
        'do not notify anyone. The result reports per-task success/'
        'failure — never re-post to a task that already succeeded. '
        'Continue your answer after posting.',
        required,
        {
            'task_ids': {
                'type': 'array',
                'items': {'type': 'string'},
                'minItems': 1,
                'maxItems': 25,
            },
            'content': {
                'type': 'string',
                'minLength': 1,
                'maxLength': 2000,
                'description': 'The comment text, plain text.',
            },
            'roadmap_id': {
                'type': 'string',
                'description': (
                    'Roadmap the tasks belong to. Optional in a roadmap session '
                    '(defaults to the focus roadmap); required otherwise.'
                ),
            },
        },
    )


def create_roadmap_tool() -> dict[str, Any]:
    return _function_tool(
        CREATE_ROADMAP_TOOL_NAME,
        'Create a NEW, empty roadmap owned by the current user. Standalone by '
        'default; pass project_id to attach it to a project that has no roadmap '
        'yet (a project holds at most one roadmap, and a roadmap belongs to at '
        'most one project — the backend refuses a second one). Only when the '
        'user asked for a new roadmap. Afterwards call get_roadmap_overview on '
        'the returned id before adding anything to it, then continue your '
        'answer (propose or stage_edits into it, or reply).',
        ['name'],
        {
            'name': {'type': 'string', 'minLength': 1, 'maxLength': 200},
            'description': {'type': 'string', 'maxLength': 2000},
            'category': {
                'type': 'string',
                'maxLength': 80,
                'description': 'Short label such as "SaaS", "Education" or "Personal".',
            },
            'project_id': {
                'type': 'string',
                'description': (
                    'Attach the new roadmap to this project (id from '
                    'get_workspace_overview). Omit for a standalone roadmap.'
                ),
            },
            'status': {
                'type': 'string',
                'enum': ['draft', 'active'],
                'description': 'Defaults to draft.',
            },
        },
    )


def attach_roadmap_to_project_tool(scope: Any = None) -> dict[str, Any]:
    required = ['project_id', 'roadmap_id'] if _scope_kind(scope) == 'workspace' else ['project_id']
    return _function_tool(
        ATTACH_ROADMAP_TOOL_NAME,
        'Attach an existing STANDALONE roadmap (no project yet) that the user '
        'owns to a project that has no roadmap yet. Projects and roadmaps are '
        'one-to-one: a project already holding a roadmap cannot take another, '
        'and a roadmap already linked to a project cannot be moved with this '
        'tool. Only when the user asked to attach/link it. Continue your answer '
        'after.',
        required,
        {
            'roadmap_id': {
                'type': 'string',
                'description': (
                    'The standalone roadmap to attach. Optional in a roadmap '
                    'session (defaults to the focus roadmap); required otherwise.'
                ),
            },
            'project_id': {
                'type': 'string',
                'description': 'The project to attach it to (id from get_workspace_overview).',
            },
        },
    )


# ---------------------------------------------------------------------------
# Terminals
# ---------------------------------------------------------------------------


def stage_edits_tool(scope: Any = None, *, pinned_roadmap_id: str | None = None) -> dict[str, Any]:
    """The registry planning tool renamed ``stage_edits``: ``revision_operations``
    (and the dual-target contract that introduces it) always stripped — plan
    revisions go through ``revise_proposal`` — ``operations.minItems=1``
    forced, the clarifier contract stripped (``ask_user`` exists), and a
    ``roadmap_id`` property (required in workspace scope; pinned to one
    roadmap in the execute-phase loops)."""
    tool = copy.deepcopy(get_planning_tool())
    fn = tool['function']
    fn['name'] = STAGE_EDITS_TOOL_NAME
    params = fn['parameters']
    props = params['properties']
    props.pop('revision_operations', None)
    operations = dict(props.get('operations') or {})
    operations['minItems'] = 1
    props['operations'] = operations
    props['roadmap_id'] = _roadmap_id_property(pinned_roadmap_id)
    _with_required(tool, 'roadmap_id', _roadmap_id_required(scope, pinned_roadmap_id))
    description = _strip_dual_target_contract(fn.get('description', ''))
    description = _strip_clarifier_contract(description)
    fn['description'] = (
        'Stage concrete edits for ONE roadmap. Call once per roadmap, all in '
        'the same response, when a request edits several roadmaps; pass '
        'roadmap_id whenever the batch is not for the focus roadmap. Small '
        'single-roadmap edits are applied immediately; larger, multi-roadmap '
        'or deleting edits are shown to the user for confirmation first. '
        + description.strip()
    )
    return tool


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


def _strip_clarifier_contract(description: str) -> str:
    """The loop has a dedicated ``ask_user`` tool for clarifications."""
    start = description.find('CLARIFIER CONTRACT')
    if start == -1:
        return description
    return description[:start].rstrip()


def revise_proposal_tool() -> dict[str, Any]:
    """Edit the pending titles-only proposal. The ``revision_operations``
    schema is the registry's (plan-level ops), exposed only while a proposal
    is awaiting confirmation."""
    registry_props = get_planning_tool()['function']['parameters']['properties']
    revision_schema = copy.deepcopy(registry_props.get('revision_operations') or {'type': 'array', 'items': {'type': 'object'}})
    revision_schema['minItems'] = 1
    revision_schema['description'] = (
        'Plan-level ops against the pending proposal (NOT a live roadmap). '
        'Supported op names: rename_epic, rename_feature, rename_task, '
        'remove_epic, remove_feature, remove_task, add_epic, add_feature, '
        'add_task, reorder_epics, update_metadata. Target items by their '
        'titles as listed under "# Pending proposal".'
    )
    return _function_tool(
        REVISE_PROPOSAL_TOOL_NAME,
        'Revise the proposal that is awaiting the user\'s confirmation — rename, '
        'add or remove proposed items. Only for titles listed under "# Pending '
        'proposal"; an edit to a real roadmap item goes through stage_edits.',
        ['assistant_message', 'revision_operations'],
        {
            'assistant_message': {'type': 'string', 'minLength': 1},
            'revision_operations': revision_schema,
        },
    )


def propose_plan_tool() -> dict[str, Any]:
    """The bare proposal schema (roadmap-scope shape); ``propose_tool`` adds
    the per-scope ``targets`` requirement."""
    return propose_tool(None)


def propose_tool(scope: Any = None, *, targets_required: bool | None = None) -> dict[str, Any]:
    """Structured proposal. Mirrors the PendingPlan / PlanTarget /
    ProposedEpic / ProposedFeature / ProposedTask shapes so the emitted args
    can be handed straight to ``record_pending_plan_from_planner_output``.
    ``targets`` is required in workspace scope (no focus roadmap to default to)."""
    if targets_required is None:
        targets_required = _scope_kind(scope) == 'workspace'
    task_schema = {
        'type': 'object',
        'required': ['title'],
        'properties': {
            'title': {'type': 'string'},
            'description': {'type': 'string'},
            'status': {'type': 'string', 'enum': TASK_STATUS_VALUES},
            'assignee_label': {'type': 'string'},
            'assignee_labels': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': (
                    'Every person to assign (member names, or "me"); a task can '
                    'have several assignees. Prefer this over assignee_label.'
                ),
            },
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
    target_schema = {
        'type': 'object',
        'required': ['roadmap_id', 'proposed_hierarchy'],
        'properties': {
            'roadmap_id': {
                'type': 'string',
                'description': 'An existing roadmap the user can access (load it first).',
            },
            'roadmap_title': {'type': 'string'},
            'proposed_hierarchy': {
                'type': 'array',
                'description': 'Epics for THIS roadmap, each with optional features and tasks.',
                'items': epic_schema,
            },
        },
    }
    required = ['summary', 'goal']
    if targets_required:
        required.append('targets')
    else:
        required.append('proposed_hierarchy')
    return _function_tool(
        PROPOSE_TOOL_NAME,
        'Present a structured roadmap plan for the user to confirm '
        'WITHOUT changing any roadmap. Use when the user asks you to '
        'plan, brainstorm, or draft a multi-item structure and has not '
        'asked to apply it yet. The plan carries titles only — the user '
        'confirms, then the system materializes the concrete operations per '
        'target roadmap. Every target must be an existing roadmap; if the '
        'work needs a new roadmap, create it first with create_roadmap (mid-loop, '
        'then get_roadmap_overview) and propose into it; a project can hold only '
        'one roadmap, so say so in next_steps when the target project already has one.',
        required,
        {
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
                'description': (
                    'Epics for the focus roadmap, each with optional features and '
                    'tasks. Use targets instead when the plan spans roadmaps or '
                    'there is no focus roadmap.'
                ),
                'items': epic_schema,
            },
            'targets': {
                'type': 'array',
                'minItems': 1,
                'maxItems': 6,
                'description': (
                    'One entry per roadmap the plan touches. Required when there is '
                    'no focus roadmap; otherwise optional (defaults to the focus '
                    'roadmap with proposed_hierarchy).'
                ),
                'items': target_schema,
            },
            'risks': {'type': 'array', 'items': {'type': 'string'}},
            'next_steps': {'type': 'array', 'items': {'type': 'string'}},
        },
    )


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


def revert_changes_tool(scope: Any = None) -> dict[str, Any]:
    _ = scope
    return _function_tool(
        REVERT_CHANGES_TOOL_NAME,
        'Undo committed roadmap changes, restoring the exact prior state '
        '(deleted items come back with their original structure and '
        'fields; created items are removed; edits are reverted). With no '
        'argument, undoes the most recent change. To undo back to an '
        'earlier point ("revert everything I did before X"), pass the '
        'change_id of that earlier change from the "# Recent changes" '
        'section — every change committed at or after it is undone. If '
        'you cannot tell which point the user means, ask first with '
        'ask_user instead of guessing.',
        [],
        {
            'change_id': {
                'type': 'string',
                'description': (
                    'Optional. The change_id from "# Recent changes" to '
                    'revert back to (that change and all newer ones are '
                    'undone). Omit to undo only the most recent change.'
                ),
            },
            'roadmap_id': {
                'type': 'string',
                'description': (
                    'Roadmap whose changes to revert, as its roadmap id (uuid) — '
                    'never its name. Omit it in a roadmap session (defaults to '
                    'the focus roadmap); required only when several roadmaps '
                    'have recent changes.'
                ),
            },
        },
    )
