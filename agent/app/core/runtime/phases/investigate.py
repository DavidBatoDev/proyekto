"""Investigate phase: load context, run the tool-calling loop, interpret the
terminal into a ``PhaseOutcome``.

Context prep: the focus roadmap (roadmap scope) + the run's referenced
roadmaps, memory notes and the project pack for the focus roadmap only, the
workspace overview in workspace scope, @-refs hydrated once per run, and the
semantic-memory retrieval against the focus roadmap. Then ``run_loop`` with
``terminal.for_investigate``; a pause past the step budget saves the loop
transcript to a Redis side key and reports ``paused`` (the next request
resumes it with the tool results it already paid for).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.core.contracts.sessions import AgentSession
from app.core.engine.llm_client import LLMClient
from app.core.engine.loop import LoopResult, run_loop
from app.core.engine.progress import AssistantDeltaEmitter, ThoughtEmitter
from app.core.logging_utils import log_event
from app.core.runtime import context_cache, refs as refs_module, terminal
from app.core.runtime.handles import merged_handle_map
from app.core.runtime.prompt import build_messages
from app.core.runtime.results import PhaseOutcome
from app.core.runtime.tools import investigate_tools
from app.core.tools.dispatch import ToolDispatcher

logger = logging.getLogger(__name__)

# Reasoning effort escalates on "hard" turns. Ordered so we can take a max
# without downgrading a higher configured base.
_EFFORT_ORDER = {'minimal': 0, 'low': 1, 'medium': 2, 'high': 3}

# The user message drives relevant-memory retrieval; cap what we embed.
_SEMANTIC_MEMORY_QUERY_MAX_CHARS = 500
_SEMANTIC_MEMORY_TOP_K = 8

RESTARTED_NOTE = (
    '# Run\nPhase: investigate (restarted). Your previous investigation was '
    'interrupted and its tool results are gone; start again from the outlines '
    'and finish the turn with exactly one action.'
)


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------


def _apply_semantic_memory_retrieval(
    *,
    ctx: Any,
    session: AgentSession,
    session_context: dict[str, Any],
    user_message: str,
) -> None:
    """Above the note-count threshold, swap inject-all memory notes for a
    per-turn top-k fetch keyed on the incoming message. Any failure falls
    back silently to inject-all — memories are an enhancement, never a
    turn-blocker. Renders as a prompt-TAIL block (see compact_state) so the
    cached prefix stays byte-stable."""
    settings = ctx.settings
    notes = session_context.get('memory_notes')
    if not isinstance(notes, list):
        return
    threshold = settings.agent_memory_semantic_threshold
    if len(notes) <= threshold:
        return
    focus = session.scope.focus_roadmap_id
    if not ctx.auth_header or not focus:
        return
    query = (user_message or '').strip()[:_SEMANTIC_MEMORY_QUERY_MAX_CHARS]
    if not query:
        return
    try:
        payload = ctx.run_async_call(
            ctx.nest_client.ai_memories_relevant(
                roadmap_id=focus,
                query=query,
                limit=_SEMANTIC_MEMORY_TOP_K,
                auth_header=ctx.auth_header,
                trace_id=ctx.trace_id,
            )
        )
    except Exception:  # noqa: BLE001 — fall back to inject-all
        return
    memories = payload.get('memories') if isinstance(payload, dict) else None
    if not isinstance(memories, list) or not memories:
        return
    session_context['memory_notes_semantic'] = True
    session_context['relevant_memory_notes'] = [
        item for item in memories if isinstance(item, dict) and item.get('content')
    ]
    log_event(
        logger,
        'relevant_memories_loaded',
        settings=settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        roadmap_id=focus,
        note_count=len(notes),
        matched=len(session_context['relevant_memory_notes']),
    )


def _message_references_ambiguous_title(
    message: str, handle_map: dict[str, Any]
) -> bool:
    """True when the message names a node title that more than one node shares
    (e.g. two features both called "Login"). Such an edit is ambiguous, so the
    turn should reason harder and raise a clarifier instead of guessing — at
    low effort the model picks the first match roughly half the time. Escalating
    is safe even when the user did disambiguate ("the Login under alpha"): more
    reasoning never forces a wrong pick, it just avoids a blind one."""
    if not message or not handle_map:
        return False
    counts: dict[str, int] = {}
    for entry in handle_map.values():
        title = entry.get('title') if isinstance(entry, dict) else None
        if not isinstance(title, str):
            continue
        norm = title.strip().lower()
        if norm:
            counts[norm] = counts.get(norm, 0) + 1
    lowered = message.lower()
    for norm, count in counts.items():
        if count < 2:
            continue
        # Word-boundary match so a duplicated title doesn't fire on a substring
        # buried inside an unrelated word.
        if re.search(rf'(?<!\w){re.escape(norm)}(?!\w)', lowered):
            return True
    return False


# Imperative plan-drafting opener ("Draft…", "Plan…", "Outline…") or a
# plan-shaped verb+object anywhere ("create a roadmap for…", "build a plan…").
_PLAN_REQUEST_OPENER = re.compile(
    r'^\s*(draft|plan|design|outline|propose)\b', re.IGNORECASE
)
_PLAN_REQUEST_OBJECT = re.compile(
    r'\b(creat\w*|build\w*|generat\w*|draft\w*|design\w*|propos\w*|plan\w*)\b'
    r'.{0,60}?\b(roadmaps?|plans?|epics?|milestones?)\b',
    re.IGNORECASE | re.DOTALL,
)


def _message_requests_plan(message: str) -> bool:
    """True when the user is asking the agent to draft/design a plan or
    roadmap structure. At low effort the model tends to announce the work
    ("I'll draft…") instead of calling propose; running these turns at
    medium makes it act on the first try."""
    if not message:
        return False
    return bool(
        _PLAN_REQUEST_OPENER.match(message)
        or _PLAN_REQUEST_OBJECT.search(message)
    )


def _accessible_referenced_roadmaps(run: Any) -> set[str]:
    ids: set[str] = set()
    for ref in getattr(run, 'resolved_refs', None) or []:
        roadmap_id = refs_module.resolved_ref_roadmap_id(ref)
        if roadmap_id:
            ids.add(roadmap_id)
    return ids


def _hard_turn_trigger(
    session: AgentSession,
    *,
    user_message: str,
    handle_map: dict[str, Any],
    run: Any = None,
) -> str:
    """Which signal (if any) makes this a 'hard' turn warranting more reasoning:
    a plan awaiting confirmation, a message targeting a title shared by
    multiple nodes, a request to draft a new plan, a message referencing two
    or more roadmaps, or a workspace-scope session with no focus roadmap.
    Returns 'none' for ordinary direct edits/chat. First match wins (used as
    the reported reason)."""
    if session.metadata.pending_plan is not None:
        return 'pending_plan'
    if _message_references_ambiguous_title(user_message, handle_map):
        return 'ambiguous_title'
    if _message_requests_plan(user_message):
        return 'plan_request'
    if run is not None and len(_accessible_referenced_roadmaps(run)) >= 2:
        return 'multi_roadmap_refs'
    if session.scope.kind == 'workspace':
        return 'workspace_scope'
    return 'none'


def _turn_reasoning_effort(settings: Any, trigger: str) -> str | None:
    """Direct edits/chat run at the configured base (``low`` by default); a hard
    turn (trigger != 'none') escalates to at least ``medium``. Never downgrades a
    higher configured base, and respects ``None`` (reasoning disabled)."""
    base = settings.openai_v2_reasoning_effort
    if base is None:
        return None
    if trigger == 'none':
        return base
    if _EFFORT_ORDER.get(base, 1) >= _EFFORT_ORDER['medium']:
        return base
    return 'medium'


def escalated_effort(settings: Any, minimum: str = 'medium') -> str | None:
    """The materialize/repair effort: at least ``minimum``, never below the base."""
    base = settings.openai_v2_reasoning_effort
    if base is None:
        return None
    if _EFFORT_ORDER.get(base, 1) >= _EFFORT_ORDER.get(minimum, 2):
        return base
    return minimum


# ---------------------------------------------------------------------------
# Phase entry
# ---------------------------------------------------------------------------


def prepare_context(ctx: Any, session: AgentSession, run: Any) -> dict[str, Any]:
    """Load the caches the phase reads and build the turn context dict."""
    deps = ctx.cache_deps()
    context_cache.refresh_focus_for_run(session=session, run=run, **deps)
    if session.scope.kind == 'roadmap':
        context_cache.ensure_memory_notes(session=session, **deps)
        context_cache.ensure_project_context(session=session, **deps)
    else:
        context_cache.ensure_workspace_overview(session=session, **deps)
    if run.refs and not run.resolved_refs:
        refs_module.hydrate_refs(session=session, run=run, **deps)
    turn_context = ctx.service.build_turn_context(session, ctx.auth_header, ctx.trace_id, run=run)
    _apply_semantic_memory_retrieval(
        ctx=ctx, session=session, session_context=turn_context, user_message=run.user_message
    )
    turn_context['on_roadmap_loaded'] = context_cache.make_on_roadmap_loaded(
        session=session, run=run, settings=ctx.settings, logger=ctx.logger, trace_id=ctx.trace_id
    )
    return turn_context


def set_feedback_note(run_state: Any, note: str) -> None:
    """A one-shot ``# Run`` note rendered at the tail of the next investigate
    turn (e.g. why the previous proposal was rejected)."""
    try:
        run_state.feedback_note = note
    except Exception:  # noqa: BLE001
        pass


def _take_feedback_note(run_state: Any) -> str | None:
    note = getattr(run_state, 'feedback_note', None)
    if isinstance(note, str) and note.strip():
        try:
            run_state.feedback_note = None
        except Exception:  # noqa: BLE001
            pass
        return '# Run\n' + note.strip()
    return None


def _phase_usage(run: Any, phase: str) -> dict[str, int]:
    usage = run.phase_usage.get(phase)
    if not isinstance(usage, dict):
        usage = {'turns': 0, 'tool_calls': 0}
        run.phase_usage[phase] = usage
    return usage


def run(ctx: Any, session: AgentSession, run_state: Any) -> PhaseOutcome:
    settings = ctx.settings
    turn_context = prepare_context(ctx, session, run_state)
    handle_map = merged_handle_map(session, run_state)

    transcript_key = run_state.loop_transcript_key
    transcript: list[dict[str, Any]] | None = None
    restarted = False
    if transcript_key:
        transcript = ctx.get_transcript(transcript_key)
        if transcript is None:
            restarted = True
        run_state.loop_transcript_key = None
    resumed = bool(transcript)
    extra_tail = RESTARTED_NOTE if restarted else _take_feedback_note(run_state)

    messages = build_messages(
        session,
        run_state,
        turn_context,
        'investigate',
        resumed=resumed,
        transcript=transcript,
        extra_tail=extra_tail,
    )
    tools = investigate_tools(session, run_state, settings=settings)

    actor = session.metadata.actor_context
    actor_id = actor.actor_id if actor is not None else None

    effort_trigger = _hard_turn_trigger(
        session, user_message=run_state.user_message, handle_map=handle_map, run=run_state
    )
    resolved_effort = _turn_reasoning_effort(settings, effort_trigger)
    # Only override the client's configured effort when this turn escalates it;
    # otherwise pass None so the client uses its default and the common path
    # stays byte-identical to the pre-escalation call.
    reasoning_effort = (
        resolved_effort if resolved_effort != settings.openai_v2_reasoning_effort else None
    )
    if resolved_effort:
        run_state.reasoning_effort['investigate'] = resolved_effort
    log_event(
        logger,
        'reasoning_effort_selected',
        settings=settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        roadmap_id=session.scope.focus_roadmap_id,
        run_id=run_state.run_id,
        phase='investigate',
        effort=resolved_effort,
        escalated=reasoning_effort is not None,
        trigger=effort_trigger,
    )

    # Pin the prompt-cache to the scope: every session/turn on this scope
    # shares the same system-prompt + state prefix.
    client = LLMClient(settings, prompt_cache_key=session.scope.key)
    dispatcher = ToolDispatcher(settings=settings, logger=ctx.logger, nest_client=ctx.nest_client)
    trace_id = ctx.trace_id
    delta_emitter = (
        AssistantDeltaEmitter(settings, trace_id)
        if trace_id and getattr(settings, 'openai_v2_streaming_enabled', False)
        else None
    )
    thought_emitter = (
        ThoughtEmitter(settings, trace_id)
        if trace_id and getattr(settings, 'openai_v2_reasoning_summary_enabled', False)
        else None
    )
    handler = terminal.for_investigate(
        session,
        run_state,
        settings=settings,
        trace_id=trace_id,
        actor_id=actor_id,
        session_context=turn_context,
    )
    usage = _phase_usage(run_state, 'investigate')
    turns_before = int(usage.get('turns') or 0)
    tool_calls_before = int(usage.get('tool_calls') or 0)

    try:
        loop_result = run_loop(
            client=client,
            messages=messages,
            tools=tools,
            dispatcher=dispatcher,
            session_context=turn_context,
            handle_map=handle_map,
            settings=settings,
            trace_id=trace_id,
            actor_id=actor_id,
            reasoning_effort=reasoning_effort,
            delta_emitter=delta_emitter,
            thought_emitter=thought_emitter,
            terminal_handler=handler,
            deadline_monotonic=ctx.loop_deadline_monotonic(),
            transcript=transcript,
            should_stop=ctx.should_stop,
            turns_used=turns_before,
            tool_calls_used=tool_calls_before,
        )
    except Exception as exc:  # noqa: BLE001 — keep the endpoint resilient
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.ERROR,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.scope.focus_roadmap_id,
            run_id=run_state.run_id,
            phase='investigate',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        return PhaseOutcome(
            kind='error',
            assistant_message=terminal.PROVIDER_FAILURE_MESSAGE,
            error={'code': 'provider_error', 'message': str(exc)[:300]},
        )

    # A save_memory/forget_memory tool ran this turn — drop the cached notes
    # so the next turn refetches the authoritative list.
    if turn_context.get('memory_notes_dirty'):
        ctx.service.invalidate_memory_notes(session)
    # create_roadmap / attach_roadmap_to_project ran this turn: the workspace
    # overview (and an attached roadmap's project context) are stale.
    if turn_context.get('workspace_overview_dirty'):
        context_cache.invalidate_workspace_overview(session)
    dirty_roadmaps = turn_context.get('roadmap_overviews_dirty')
    if isinstance(dirty_roadmaps, list):
        for dirty_roadmap_id in dirty_roadmaps:
            if isinstance(dirty_roadmap_id, str) and dirty_roadmap_id:
                context_cache.invalidate_overview(session, dirty_roadmap_id)
                context_cache.invalidate_project_context(session, dirty_roadmap_id)

    usage['turns'] = int(loop_result.turns or 0)
    usage['tool_calls'] = int(loop_result.tool_calls_used or 0)
    ctx.add_loop_usage(loop_result, turns=max(0, int(loop_result.turns or 0) - turns_before))
    _add_run_tokens(run_state, loop_result)

    return loop_result_to_outcome(ctx, session, run_state, loop_result, transcript_key)


def _add_run_tokens(run_state: Any, loop_result: LoopResult) -> None:
    for key, attr in (
        ('input', 'tokens_input'),
        ('output', 'tokens_output'),
        ('total', 'tokens_total'),
        ('cached', 'tokens_cached'),
    ):
        run_state.tokens[key] = int(run_state.tokens.get(key, 0) or 0) + int(
            getattr(loop_result, attr, 0) or 0
        )


def loop_result_to_outcome(
    ctx: Any,
    session: AgentSession,
    run_state: Any,
    loop_result: LoopResult,
    transcript_key: str | None = None,
) -> PhaseOutcome:
    kind = loop_result.kind
    if kind in {'paused', 'cancelled'}:
        if kind == 'paused' and not ctx.sync_mode:
            key = ctx.transcript_key(session.session_id, run_state.run_id)
            if loop_result.transcript and ctx.put_transcript(key, loop_result.transcript):
                run_state.loop_transcript_key = key
        return PhaseOutcome(kind=kind, loop=loop_result, used_read_tools=loop_result.used_read_tools)
    if transcript_key:
        ctx.delete_transcript(transcript_key)
    if kind == 'batches':
        return PhaseOutcome(
            kind='batches',
            assistant_message=loop_result.assistant_message,
            batches=list(loop_result.batches),
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    if kind == 'revert':
        return PhaseOutcome(
            kind='revert',
            assistant_message=loop_result.assistant_message,
            batches=list(loop_result.batches),
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    if kind == 'plan_proposal':
        return PhaseOutcome(
            kind='proposal',
            assistant_message=loop_result.assistant_message,
            proposal_payload=dict(loop_result.plan_payload or {}),
            intent_type='roadmap_plan',
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    if kind == 'plan_revision':
        return PhaseOutcome(
            kind='proposal',
            assistant_message=loop_result.assistant_message,
            intent_type='plan_revision',
            revision_operations=list(loop_result.revision_operations),
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    if kind == 'clarifier':
        return PhaseOutcome(
            kind='clarifier',
            assistant_message=loop_result.assistant_message,
            clarifier=loop_result.clarifier,
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    if kind == 'budget':
        return PhaseOutcome(
            kind='budget',
            assistant_message=terminal.BUDGET_MESSAGE,
            loop=loop_result,
            used_read_tools=loop_result.used_read_tools,
        )
    return PhaseOutcome(
        kind='chat',
        assistant_message=loop_result.assistant_message,
        loop=loop_result,
        used_read_tools=loop_result.used_read_tools,
    )
