"""Terminal-tool interpretation for the loop engine.

The engine collects every terminal tool call of one model response and hands
them together to a ``terminal_handler``; this module builds those handlers
per phase. A handler returns either a ``LoopResult`` (the turn is over) or a
``{call_id: error_result}`` dict the engine feeds back so the model can
self-correct.

Terminals: ``stage_edits`` (one call per roadmap, all in the same response ->
one ``RunBatch`` per distinct roadmap), ``propose``, ``revise_proposal`` (only
while a proposal is pending), ``ask_user`` and ``revert_changes``. Mixed kinds
in one response are rejected with ``MULTIPLE_TERMINALS``.

``build_clarifier_card`` is the web-facing ClarifierCard builder (verbatim
from the single-loop agent).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import uuid4

from app.core.contracts.runs import RunBatch
from app.core.contracts.sessions import ChangeGroup
from app.core.engine import progress
from app.core.engine.loop import LoopResult
from app.core.runtime import revert, tool_exec
from app.core.runtime.handles import live_epic_titles as _live_epic_titles, validate_batch_roadmap
from app.core.uuid_utils import is_uuid_like
from app.core.runtime.tools import (
    ASK_USER_TOOL_NAME,
    PROPOSE_TOOL_NAME,
    REVERT_CHANGES_TOOL_NAME,
    REVISE_PROPOSAL_TOOL_NAME,
    is_stage_tool,
)

logger = logging.getLogger(__name__)

# Terminal kinds (one per tool family). A handler's `allowed` set restricts
# which kinds a phase accepts (materialize/repair: stage only; verify: propose).
KIND_STAGE = 'stage'
KIND_PROPOSE = 'propose'
KIND_REVISE = 'revise'
KIND_ASK = 'ask'
KIND_REVERT = 'revert'
ALL_TERMINAL_KINDS = frozenset({KIND_STAGE, KIND_PROPOSE, KIND_REVISE, KIND_ASK, KIND_REVERT})

BUDGET_MESSAGE = (
    "I couldn't finish that within the available steps. "
    'Could you rephrase or narrow the request?'
)
PROVIDER_FAILURE_MESSAGE = (
    "I hit an issue reaching the model and couldn't process that "
    'just now. Please try again in a moment.'
)

_PROPOSE_ALIASES = frozenset({PROPOSE_TOOL_NAME, 'propose_plan'})


def terminal_kind(tool_name: str) -> str | None:
    if is_stage_tool(tool_name):
        return KIND_STAGE
    if tool_name in _PROPOSE_ALIASES:
        return KIND_PROPOSE
    if tool_name == REVISE_PROPOSAL_TOOL_NAME:
        return KIND_REVISE
    if tool_name == ASK_USER_TOOL_NAME:
        return KIND_ASK
    if tool_name == REVERT_CHANGES_TOOL_NAME:
        return KIND_REVERT
    return None


@dataclass
class TerminalContext:
    """Everything a handler needs to interpret terminals for one loop run."""

    settings: Any = None
    trace_id: str | None = None
    # Merged (already prefixed) handle map of every loaded roadmap.
    handle_map: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Per-roadmap maps (duplicate-epic detection uses the batch roadmap's own).
    handle_maps_by_roadmap: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    actor_id: str | None = None
    pending_plan_titles: frozenset[str] = frozenset()
    has_pending_plan: bool = False
    change_history: list[Any] | None = None
    focus_roadmap_id: str | None = None
    # Pinned roadmap (materialize / repair loops): every stage call must
    # target it and `roadmap_id` defaults to it.
    expected_roadmap_id: str | None = None
    recent_targets: list[Any] = field(default_factory=list)
    roadmap_titles: dict[str, str | None] = field(default_factory=dict)
    roadmap_prefixes: dict[str, str | None] = field(default_factory=dict)
    allowed: frozenset[str] = ALL_TERMINAL_KINDS

    def title_of(self, roadmap_id: str | None) -> str | None:
        if not roadmap_id:
            return None
        return self.roadmap_titles.get(roadmap_id)

    def live_epics_for(self, roadmap_id: str | None) -> frozenset[str]:
        if roadmap_id and roadmap_id in self.handle_maps_by_roadmap:
            return _live_epic_titles(self.handle_maps_by_roadmap[roadmap_id])
        # Merged-map fallback: entries stamped with another roadmap are skipped;
        # unstamped entries (single-roadmap fixtures) count for any roadmap.
        scoped = {
            handle: entry
            for handle, entry in (self.handle_map or {}).items()
            if isinstance(entry, dict)
            and (not entry.get('roadmap_id') or not roadmap_id or entry.get('roadmap_id') == roadmap_id)
        }
        return _live_epic_titles(scoped)


TerminalHandler = Callable[[list[Any]], LoopResult | dict[str, dict[str, Any]]]


def make_terminal_handler(ctx: TerminalContext) -> TerminalHandler:
    def _handler(calls: list[Any]) -> LoopResult | dict[str, dict[str, Any]]:
        return interpret_terminals(calls, ctx)

    return _handler


# ---------------------------------------------------------------------------
# Per-phase handler factories
# ---------------------------------------------------------------------------


def _context_from_session(
    session: Any,
    run: Any,
    *,
    settings: Any,
    trace_id: str | None,
    actor_id: str | None,
    session_context: dict[str, Any] | None,
    allowed: frozenset[str],
    expected_roadmap_id: str | None = None,
) -> TerminalContext:
    session_context = session_context or {}
    roadmaps = getattr(session.metadata, 'roadmaps', None) or {}
    merged: dict[str, dict[str, Any]] = {}
    per_roadmap: dict[str, dict[str, dict[str, Any]]] = {}
    for roadmap_id, context in roadmaps.items():
        own = dict(getattr(context, 'handle_map', None) or {})
        per_roadmap[roadmap_id] = own
        for handle, entry in own.items():
            if isinstance(entry, dict):
                stamped = dict(entry)
                stamped.setdefault('roadmap_id', roadmap_id)
                merged[handle] = stamped
    handle_map = session_context.get('roadmap_handle_map')
    if not isinstance(handle_map, dict) or not handle_map:
        handle_map = merged
    pending = session.metadata.pending_plan
    has_pending = pending is not None and getattr(pending, 'status', None) in {
        'proposed',
        'awaiting_answers',
    }
    return TerminalContext(
        settings=settings,
        trace_id=trace_id,
        handle_map=handle_map,
        handle_maps_by_roadmap=per_roadmap,
        actor_id=actor_id,
        pending_plan_titles=pending_plan_titles(pending) if has_pending else frozenset(),
        has_pending_plan=has_pending,
        change_history=session_context.get('change_history')
        or [group.model_dump(mode='json', exclude_none=True) for group in session.metadata.change_history],
        focus_roadmap_id=session.scope.focus_roadmap_id,
        expected_roadmap_id=expected_roadmap_id,
        recent_targets=list(session.metadata.recent_resolved_targets),
        roadmap_titles={rid: getattr(c, 'title', None) for rid, c in roadmaps.items()},
        roadmap_prefixes={rid: getattr(c, 'handle_prefix', None) for rid, c in roadmaps.items()},
        allowed=allowed,
    )


def for_investigate(
    session: Any,
    run: Any = None,
    *,
    settings: Any = None,
    trace_id: str | None = None,
    actor_id: str | None = None,
    session_context: dict[str, Any] | None = None,
) -> TerminalHandler:
    return make_terminal_handler(
        _context_from_session(
            session,
            run,
            settings=settings,
            trace_id=trace_id,
            actor_id=actor_id,
            session_context=session_context,
            allowed=ALL_TERMINAL_KINDS,
        )
    )


def for_materialize(
    session: Any,
    run: Any,
    roadmap_id: str,
    *,
    settings: Any = None,
    trace_id: str | None = None,
    actor_id: str | None = None,
    session_context: dict[str, Any] | None = None,
) -> TerminalHandler:
    """Execute-phase materialize / repair loops: only ``stage_edits`` pinned
    to one roadmap."""
    return make_terminal_handler(
        _context_from_session(
            session,
            run,
            settings=settings,
            trace_id=trace_id,
            actor_id=actor_id,
            session_context=session_context,
            allowed=frozenset({KIND_STAGE}),
            expected_roadmap_id=roadmap_id,
        )
    )


for_repair = for_materialize


def for_verify(
    session: Any,
    run: Any = None,
    *,
    settings: Any = None,
    trace_id: str | None = None,
    session_context: dict[str, Any] | None = None,
) -> TerminalHandler:
    """Verify phase: only ``propose`` (a follow-up proposal)."""
    return make_terminal_handler(
        _context_from_session(
            session,
            run,
            settings=settings,
            trace_id=trace_id,
            actor_id=None,
            session_context=session_context,
            allowed=frozenset({KIND_PROPOSE}),
        )
    )


# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------


def _error(code: str, message: str) -> dict[str, Any]:
    return {'error': {'code': code, 'message': message}}


def interpret_terminals(
    calls: list[Any], ctx: TerminalContext
) -> LoopResult | dict[str, dict[str, Any]]:
    """Interpret every terminal call of one response together."""
    if not calls:
        return {}
    kinds: dict[str, str | None] = {tc.id: terminal_kind(tc.name) for tc in calls}
    distinct = {kind for kind in kinds.values() if kind is not None}
    if any(kind is None for kind in kinds.values()):
        return {
            tc.id: _error('UNKNOWN_TERMINAL', f'Unknown terminal {tc.name}.')
            for tc in calls
        }
    if len(distinct) > 1:
        names = ', '.join(sorted({tc.name for tc in calls}))
        return {
            tc.id: _error(
                'MULTIPLE_TERMINALS',
                f'You called several action tools in one response ({names}). Finish the '
                'turn with exactly ONE action (stage_edits may be called once per roadmap, '
                'but never together with another action tool). Re-issue only the one you mean.',
            )
            for tc in calls
        }
    kind = next(iter(distinct))
    if kind not in ctx.allowed:
        allowed = ', '.join(sorted(ctx.allowed))
        return {
            tc.id: _error(
                'TERMINAL_NOT_ALLOWED',
                f'{tc.name} is not available in this phase; allowed action kinds: {allowed}.',
            )
            for tc in calls
        }
    if kind == KIND_STAGE:
        return _interpret_stage_calls(calls, ctx)
    if len(calls) > 1:
        return {
            tc.id: _error(
                'MULTIPLE_TERMINALS',
                f'{tc.name} must be called once per response. Re-issue a single call.',
            )
            for tc in calls
        }
    tc = calls[0]
    if kind == KIND_PROPOSE:
        return _interpret_propose(tc)
    if kind == KIND_REVISE:
        return _interpret_revise(tc, ctx)
    if kind == KIND_ASK:
        return _interpret_ask_user(tc)
    return _handle_revert(tc, ctx)


# -- stage_edits -----------------------------------------------------------


def _interpret_stage_calls(
    calls: list[Any], ctx: TerminalContext
) -> LoopResult | dict[str, dict[str, Any]]:
    errors: dict[str, dict[str, Any]] = {}
    batches: dict[str, RunBatch] = {}
    singles: list[LoopResult] = []
    for tc in calls:
        outcome = _interpret_stage_call(tc, ctx)
        if isinstance(outcome, RunBatch):
            existing = batches.get(outcome.roadmap_id)
            if existing is None:
                batches[outcome.roadmap_id] = outcome
            else:
                existing.operations.extend(outcome.operations)
                existing.refresh_operations_hash()
                if outcome.assistant_message:
                    existing.assistant_message = (
                        f'{existing.assistant_message} {outcome.assistant_message}'.strip()
                    )
            continue
        if isinstance(outcome, LoopResult):
            singles.append(outcome)
            continue
        errors[tc.id] = outcome
    if errors:
        for tc in calls:
            if tc.id not in errors:
                errors[tc.id] = _error(
                    'BATCH_NOT_STAGED',
                    'Another stage_edits call in this response was invalid, so nothing was '
                    'staged. Fix that call and re-issue every stage_edits call together.',
                )
        return errors
    if batches:
        ordered = list(batches.values())
        operations = [op for batch in ordered for op in batch.operations]
        message = ' '.join(
            batch.assistant_message for batch in ordered if batch.assistant_message
        ).strip()
        return LoopResult(
            kind='batches',
            assistant_message=message,
            operations=operations,
            batches=ordered,
            terminal_tool=calls[0].name,
            termination_reason='edit',
        )
    if len(singles) == 1:
        return singles[0]
    if singles:
        # Several calls that all reduced to a no-op / question: keep the first
        # (a clarifier wins over a duplicate no-op).
        clarifier = next((item for item in singles if item.kind == 'clarifier'), None)
        return clarifier or singles[0]
    return {tc.id: _error('INVALID_OPERATIONS', 'Nothing to stage.') for tc in calls}


def _interpret_stage_call(
    tc: Any, ctx: TerminalContext
) -> RunBatch | LoopResult | dict[str, Any]:
    arguments = dict(tc.arguments or {})
    # Only a pinned loop (materialize / repair) forces the roadmap; in
    # investigate the focus roadmap is merely the default when the call names
    # none, so the batch validation below runs against that default.
    parsed = tool_exec.interpret_stage_edits(
        arguments,
        ctx.handle_map or None,
        ctx.actor_id,
        ctx.expected_roadmap_id,
        recent_targets=ctx.recent_targets,
        roadmap_titles=ctx.roadmap_titles,
        roadmap_prefixes=ctx.roadmap_prefixes,
    )
    if isinstance(parsed, tool_exec.PlanToolError):
        return _error(parsed.code, parsed.message)
    roadmap_id = parsed.roadmap_id or ctx.focus_roadmap_id
    if not roadmap_id:
        return _error(
            'MISSING_ROADMAP_ID',
            'stage_edits needs a roadmap_id in this session — load the roadmap with '
            'get_roadmap_overview (or find it with list_roadmaps) and pass its id.',
        )
    if parsed.roadmap_id is None and parsed.operations:
        mismatch = validate_batch_roadmap(
            parsed.operations,
            roadmap_id,
            ctx.handle_map or None,
            recent_targets=ctx.recent_targets,
            roadmap_titles=ctx.roadmap_titles,
            roadmap_prefixes=ctx.roadmap_prefixes,
        )
        if mismatch is not None:
            return _error('HANDLE_ROADMAP_MISMATCH', mismatch)
    if parsed.operations:
        # Drop add_epic ops that re-create an epic already on the live
        # roadmap (the model sometimes echoes an outline node back into a
        # fresh add). Only childless duplicates are dropped, so creation
        # chains (parent_ref -> temp_id) are never broken.
        kept, dropped = drop_duplicate_epics(parsed.operations, ctx.live_epics_for(roadmap_id))
        if kept:
            return RunBatch(
                roadmap_id=roadmap_id,
                roadmap_title=ctx.title_of(roadmap_id),
                operations=kept,
                assistant_message=parsed.assistant_message,
                source='stage_edits',
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
        # revision_operations only legitimately targets a titles-only pending
        # plan. If the targeted title isn't in that plan (or no plan is
        # pending), the model misrouted a LIVE edit — feed the error back so
        # it re-stages via `operations` instead of silently editing a
        # non-existent plan.
        if revision_grounded_in_plan(parsed.revision_operations, ctx.pending_plan_titles):
            return LoopResult(
                kind='plan_revision',
                assistant_message=parsed.assistant_message,
                revision_operations=parsed.revision_operations,
                terminal_tool=tc.name,
                termination_reason='plan_revision',
            )
        return _error(
            'NOT_A_PLAN_REVISION',
            'revision_operations only applies to items in a pending plan '
            'awaiting confirmation. This target is a live roadmap item — '
            'stage the change in `operations` instead (e.g. update_node to '
            'rename, delete_node to remove). Leave revision_operations empty.',
        )
    if parsed.clarifier_options or looks_like_question(parsed.assistant_message):
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
    progress.tool_rejected(
        ctx.settings,
        ctx.trace_id,
        tc.name,
        reason='empty_action_payload',
        operations_count=len(parsed.operations),
        revision_operations_count=len(parsed.revision_operations),
        clarifier_options_count=len(parsed.clarifier_options),
        assistant_message_present=bool(parsed.assistant_message),
    )
    return _error(
        'INVALID_OPERATIONS',
        'The roadmap action was empty. Include at least one concrete '
        'operation, or use ask_user when a decision is required.',
    )


# -- propose / revise_proposal -----------------------------------------------


def _interpret_propose(tc: Any) -> LoopResult:
    summary = str(tc.arguments.get('summary') or '').strip()
    return LoopResult(
        kind='plan_proposal',
        assistant_message=summary or 'Here is a proposed plan for your review.',
        plan_payload=dict(tc.arguments),
        terminal_tool=tc.name,
        termination_reason='plan_proposal',
    )


def _interpret_revise(tc: Any, ctx: TerminalContext) -> LoopResult | dict[str, dict[str, Any]]:
    if not ctx.has_pending_plan:
        return {
            tc.id: _error(
                'NO_PENDING_PROPOSAL',
                'There is no proposal awaiting confirmation to revise. Use stage_edits for '
                'live roadmap changes or propose for a new plan.',
            )
        }
    raw_ops = tc.arguments.get('revision_operations')
    revision_operations = [op for op in raw_ops if isinstance(op, dict)] if isinstance(raw_ops, list) else []
    if not revision_operations:
        return {
            tc.id: _error(
                'INVALID_REVISION',
                'revise_proposal requires at least one revision operation targeting a '
                'title listed under "# Pending proposal".',
            )
        }
    if not revision_grounded_in_plan(revision_operations, ctx.pending_plan_titles):
        return {
            tc.id: _error(
                'NOT_A_PLAN_REVISION',
                'revise_proposal only applies to items in the pending proposal awaiting '
                'confirmation. This target is a live roadmap item — stage the change '
                'with stage_edits instead.',
            )
        }
    message = str(tc.arguments.get('assistant_message') or '').strip()
    return LoopResult(
        kind='plan_revision',
        assistant_message=message,
        revision_operations=revision_operations,
        terminal_tool=tc.name,
        termination_reason='plan_revision',
    )


# -- ask_user ------------------------------------------------------------------


def _interpret_ask_user(tc: Any) -> LoopResult | dict[str, dict[str, Any]]:
    questions = normalize_ask_user_questions(tc.arguments)
    if not questions:
        return {
            tc.id: _error(
                'MISSING_QUESTION',
                'ask_user requires `questions` with at least one entry, '
                'each with a non-empty question.',
            )
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


_MAX_CLARIFIER_QUESTIONS = 4
_MAX_CLARIFIER_OPTIONS = 6


def normalize_ask_user_questions(arguments: dict[str, Any]) -> list[dict[str, Any]]:
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


# -- revert_changes ------------------------------------------------------------


def _resolve_revert_roadmap(value: str | None, ctx: TerminalContext) -> str | None:
    """The roadmap a ``revert_changes`` call names: a uuid as-is, a loaded
    roadmap's title (case-insensitive) as that roadmap's id, else ``None``."""
    if not value:
        return None
    if is_uuid_like(value):
        return value
    wanted = value.casefold()
    for candidate_id, title in ctx.roadmap_titles.items():
        if isinstance(title, str) and title.strip().casefold() == wanted:
            return candidate_id
    return None


def _handle_revert(tc: Any, ctx: TerminalContext) -> LoopResult | dict[str, dict[str, Any]]:
    """Deterministically undo a range of committed changes on one roadmap.

    Selects the range (latest, or back to a given change_id) on the roadmap
    the call names (default: the focus roadmap), builds the net inverse
    operations, and routes them through the same validation path as a normal
    edit. Nothing-to-do cases return a chat reply.
    """
    groups = _parse_change_groups(ctx.change_history)
    if not groups:
        return LoopResult(
            kind='chat',
            assistant_message="There aren't any recent changes for me to revert.",
            terminal_tool=tc.name,
            termination_reason='revert_noop',
        )

    raw_roadmap_id = tc.arguments.get('roadmap_id')
    requested_roadmap = (
        raw_roadmap_id.strip()
        if isinstance(raw_roadmap_id, str) and raw_roadmap_id.strip()
        else None
    )
    # The model sometimes passes the roadmap's TITLE here ("Supply Chain
    # Resilience Program"). A title that names a loaded roadmap resolves to
    # its id; anything else that is not uuid-shaped is ignored in favour of
    # the focus roadmap — never used as a filter that silently matches no
    # change and turns "undo that" into "I couldn't find that change".
    roadmap_id = _resolve_revert_roadmap(requested_roadmap, ctx) or (
        ctx.expected_roadmap_id or ctx.focus_roadmap_id
    )
    if not roadmap_id:
        candidates = revert.roadmap_ids_with_history(groups)
        if len(candidates) > 1:
            listed = ', '.join(
                f'"{ctx.title_of(rid) or rid}" (roadmap_id {rid})' for rid in candidates
            )
            return {
                tc.id: _error(
                    'REVERT_NEEDS_ROADMAP',
                    'Several roadmaps have recent changes; pass roadmap_id to say which one '
                    f'to revert: {listed}.',
                )
            }
        if len(candidates) == 1:
            roadmap_id = candidates[0]
    if not roadmap_id:
        return {
            tc.id: _error(
                'REVERT_NEEDS_ROADMAP',
                'Pass roadmap_id — the recent changes do not say which roadmap they belong to.',
            )
        }

    raw_change_id = tc.arguments.get('change_id')
    change_id = (
        raw_change_id.strip()
        if isinstance(raw_change_id, str) and raw_change_id.strip()
        else None
    )

    selected = revert.select_revert_range(groups, change_id, roadmap_id=roadmap_id)
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

    parsed = tool_exec.interpret_stage_edits(
        {'operations': operations, 'assistant_message': _revert_message(selected)},
        ctx.handle_map or None,
        ctx.actor_id,
        roadmap_id,
        recent_targets=ctx.recent_targets,
        roadmap_titles=ctx.roadmap_titles,
        roadmap_prefixes=ctx.roadmap_prefixes,
    )
    if isinstance(parsed, tool_exec.PlanToolError):
        return {tc.id: _error('REVERT_BUILD_FAILED', parsed.message)}
    if not parsed.operations:
        return LoopResult(
            kind='chat',
            assistant_message="There's nothing to undo.",
            terminal_tool=tc.name,
            termination_reason='revert_empty',
        )
    batch = RunBatch(
        roadmap_id=roadmap_id,
        roadmap_title=ctx.title_of(roadmap_id),
        operations=parsed.operations,
        assistant_message=parsed.assistant_message,
        source='revert',
    )
    return LoopResult(
        kind='revert',
        assistant_message=parsed.assistant_message,
        operations=list(parsed.operations),
        batches=[batch],
        terminal_tool=tc.name,
        termination_reason='revert',
    )


def _parse_change_groups(raw: list[Any] | None) -> list[ChangeGroup]:
    if not isinstance(raw, list):
        return []
    groups: list[ChangeGroup] = []
    for item in raw:
        if isinstance(item, ChangeGroup):
            groups.append(item)
            continue
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


# ---------------------------------------------------------------------------
# Shared guards
# ---------------------------------------------------------------------------


def looks_like_question(text: str) -> bool:
    return isinstance(text, str) and '?' in text


def drop_duplicate_epics(
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


def revision_grounded_in_plan(
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


def pending_plan_titles(pending_plan: Any) -> frozenset[str]:
    """Lower-cased titles across a pending plan's epic/feature/task hierarchy
    (every target's). Used by the revision guard to tell a genuine plan
    revision from a misrouted live edit. Empty when no plan is pending."""
    if pending_plan is None:
        return frozenset()
    titles: set[str] = set()
    hierarchies = [getattr(pending_plan, 'proposed_hierarchy', None) or []]
    for target in getattr(pending_plan, 'targets', None) or []:
        hierarchies.append(getattr(target, 'proposed_hierarchy', None) or [])
    for hierarchy in hierarchies:
        for epic in hierarchy:
            _add_title(titles, getattr(epic, 'title', None))
            for feature in getattr(epic, 'features', None) or []:
                _add_title(titles, getattr(feature, 'title', None))
                for task in getattr(feature, 'tasks', None) or []:
                    _add_title(titles, getattr(task, 'title', None))
    return frozenset(titles)


def _add_title(acc: set[str], title: Any) -> None:
    if isinstance(title, str) and title.strip():
        acc.add(title.strip().lower())


# ---------------------------------------------------------------------------
# Clarifier cards (web-facing)
# ---------------------------------------------------------------------------


def build_clarifier_card(clarifier: dict[str, Any] | None) -> dict[str, Any] | None:
    if not clarifier:
        return None
    # New multi-question shape (pre-normalized by the ask_user branch).
    # Defensively drop entries without question text; fall back to the legacy
    # flat keys (implicit edit-tool and budget clarifiers) when none survive.
    questions = [
        q
        for q in (clarifier.get('questions') or [])
        if isinstance(q, dict) and str(q.get('question') or '').strip()
    ]
    if not questions:
        options = [
            o for o in (clarifier.get('options') or []) if isinstance(o, str) and o.strip()
        ]
        question = str(clarifier.get('question') or '').strip()
        allow_custom = bool(clarifier.get('allow_custom', True))
        if not question and not options:
            return None
        if not options:
            allow_custom = True
        questions = [
            {
                'id': str(uuid4()),
                'header': None,
                'question': question,
                'multi_select': False,
                'allow_custom': allow_custom,
                'options': [{'label': o, 'description': None} for o in options],
            }
        ]
    lane = clarifier.get('lane')
    if lane not in {'edit', 'query', 'plan'}:
        lane = 'edit'
    first = questions[0]
    return {
        'lane': lane,
        'question_id': str(uuid4()),
        # Legacy mirror of questions[0] for web bundles that predate `questions`.
        'question': first['question'],
        'options': [o['label'] for o in first['options']],
        'allow_custom': first['allow_custom'],
        'questions': questions,
        'reason': 'agent_clarifier',
    }


def budget_clarifier_card() -> dict[str, Any]:
    """The canned card a budget-exhausted turn answers with (verbatim)."""
    card = build_clarifier_card(
        {
            'lane': 'edit',
            'question': BUDGET_MESSAGE,
            'options': [],
            'allow_custom': True,
        }
    )
    assert card is not None
    card['reason'] = 'budget_exhausted'
    return card
