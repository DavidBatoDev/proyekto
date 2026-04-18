from __future__ import annotations

import json
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    AgentSession,
    IntentType,
    PendingPlan,
    PendingPlanAnswer,
)
from app.core.logging_utils import log_event
from app.core.orchestration.context.actor_context_provider import (
    is_actor_context_required_message,
)
from app.core.orchestration.context.pending_plan_manager import (
    append_plan_answer,
    clear_pending_plan,
    is_plan_stale,
)

_PLAN_ANSWER_SENTINEL = '__plan_answers__'
_CLARIFIER_ANSWER_SENTINEL = '__clarifier_answer__'


def _parse_plan_answer_sentinel(user_message: str) -> list[dict[str, Any]] | None:
    """Detect the `__plan_answers__\\n{json}` sentinel used by the web to
    submit answers to plan-mode clarifier questions. Returns a list of
    answer dicts on match, or `None` if the message isn't an answer payload.

    Accepted shapes (JSON body after the sentinel line):
      - `{"question_id": "...", "selected_option": "...", "custom_answer": null}`
      - `{"answers": [{...}, {...}]}`  — batched
      - `[{...}, {...}]`                — bare list
    """

    stripped = user_message.strip()
    if not stripped.startswith(_PLAN_ANSWER_SENTINEL):
        return None
    body = stripped[len(_PLAN_ANSWER_SENTINEL):].strip()
    if not body:
        return None
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return None
    if isinstance(parsed, dict) and 'answers' in parsed and isinstance(parsed['answers'], list):
        return [entry for entry in parsed['answers'] if isinstance(entry, dict)]
    if isinstance(parsed, list):
        return [entry for entry in parsed if isinstance(entry, dict)]
    if isinstance(parsed, dict):
        return [parsed]
    return None


def _parse_clarifier_answer_sentinel(user_message: str) -> dict[str, Any] | None:
    """Detect the generic `__clarifier_answer__\\n{json}` sentinel used by
    any lane's clarifier card. Returns the parsed answer dict — must
    contain `lane` (one of 'edit' | 'query' | 'plan') and `question_id`.
    Returns None for non-matching or malformed messages.
    """

    stripped = user_message.strip()
    if not stripped.startswith(_CLARIFIER_ANSWER_SENTINEL):
        return None
    body = stripped[len(_CLARIFIER_ANSWER_SENTINEL):].strip()
    if not body:
        return None
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    lane = parsed.get('lane')
    question_id = parsed.get('question_id')
    if not isinstance(lane, str) or lane not in {'edit', 'query', 'plan'}:
        return None
    if not isinstance(question_id, str) or not question_id.strip():
        return None
    return parsed

_ACTOR_FETCH_EXECUTOR: ThreadPoolExecutor | None = None
_overview_join_logger = logging.getLogger(__name__)


def _get_actor_fetch_executor() -> ThreadPoolExecutor:
    global _ACTOR_FETCH_EXECUTOR
    if _ACTOR_FETCH_EXECUTOR is None:
        _ACTOR_FETCH_EXECUTOR = ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix='actor-ctx-fetch',
        )
    return _ACTOR_FETCH_EXECUTOR


def resolve_deferred_actor_context(
    session_context: dict[str, Any],
) -> int | None:
    """Join a deferred actor-context fetch started by pre-dispatch.

    Idempotent: if no future is attached, returns None. When present, blocks
    until the background fetch resolves (the task itself updates
    session_context['actor_context']), and records join-wait under
    `phase_timings.actor_fetch_join_ms`. Overlap with planner setup absorbs
    most of the fetch latency; only the un-overlappable tail is measured.
    """
    future: Future[None] | None = session_context.pop(
        '_actor_fetch_future', None
    )
    rebuild = session_context.pop('_actor_fetch_rebuild', None)
    if future is None:
        return None
    join_started = perf_counter()
    try:
        future.result()
    except Exception:  # pragma: no cover - best-effort join
        pass
    join_ms = int((perf_counter() - join_started) * 1000)
    if callable(rebuild):
        try:
            rebuild()
        except Exception:  # pragma: no cover
            pass
    metrics = session_context.setdefault('_phase_metrics', {})
    if isinstance(metrics, dict):
        metrics['actor_fetch_join_ms'] = join_ms
    return join_ms


def resolve_deferred_roadmap_overview_summary(
    session_context: dict[str, Any],
) -> int | None:
    """Join a deferred roadmap-overview fetch started by pre-dispatch.

    Same contract as `resolve_deferred_actor_context`: idempotent, bounded
    by the fetch's own HTTP timeout, and failures degrade silently (the
    prompt just omits the overview section). `session_context` is passed
    to the rebuild so it writes into the caller's live dict — LangGraph
    shallow-copies state between nodes, so the pre-dispatcher's original
    dict is a different object.
    """
    future: Future[None] | None = session_context.pop(
        '_roadmap_overview_fetch_future', None
    )
    rebuild = session_context.pop('_roadmap_overview_fetch_rebuild', None)
    if future is None:
        return None
    join_started = perf_counter()
    try:
        future.result()
    except Exception:  # pragma: no cover - best-effort join
        pass
    join_ms = int((perf_counter() - join_started) * 1000)
    if callable(rebuild):
        try:
            rebuild(session_context)
        except Exception:  # pragma: no cover
            pass
    metrics = session_context.setdefault('_phase_metrics', {})
    if isinstance(metrics, dict):
        metrics['roadmap_overview_fetch_join_ms'] = join_ms
    summary = session_context.get('roadmap_overview_summary')
    _overview_join_logger.info(
        'roadmap_overview_summary_join_ms=%d present=%s chars=%d',
        join_ms,
        isinstance(summary, str) and bool(summary.strip()),
        len(summary) if isinstance(summary, str) else 0,
    )
    return join_ms


def _ingest_plan_answers(
    *,
    session: AgentSession,
    pending_plan: PendingPlan | None,
    parsed_answers: list[dict[str, Any]],
    logger: logging.Logger,
    settings: Any,
    trace_id: str | None,
) -> bool:
    """Validate and append each answer. Returns True when at least one
    answer landed on an `awaiting_answers` plan; False otherwise (e.g. no
    pending plan, or plan in the wrong status).
    """

    if pending_plan is None or pending_plan.status != 'awaiting_answers':
        log_event(
            logger,
            'plan_answers_dropped_no_pending_plan',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            pending_plan_status=(pending_plan.status if pending_plan else None),
        )
        return False

    appended = 0
    for raw in parsed_answers:
        question_id = str(raw.get('question_id') or '').strip()
        if not question_id:
            continue
        selected = raw.get('selected_option')
        custom = raw.get('custom_answer')
        if not isinstance(selected, str) and not isinstance(custom, str):
            continue
        question_text = raw.get('question_text')
        if not isinstance(question_text, str) and pending_plan.current_questions:
            # Snapshot the question text on the answer so the LLM can read it
            # back later without needing to cross-reference a removed question.
            # Match by question_id across the current batch.
            for q in pending_plan.current_questions:
                if q.id == question_id:
                    question_text = q.question
                    break
        answer = PendingPlanAnswer(
            question_id=question_id,
            question_text=question_text if isinstance(question_text, str) else None,
            selected_option=selected if isinstance(selected, str) and selected.strip() else None,
            custom_answer=custom if isinstance(custom, str) and custom.strip() else None,
        )
        if append_plan_answer(
            session,
            answer=answer,
            logger=logger,
            settings=settings,
            trace_id=trace_id,
        ):
            appended += 1
    return appended > 0


def _compose_plan_replay_prompt(pending_plan: PendingPlan) -> str:
    """Synthesize the user-side prompt for a plan-lane replay after the user
    submitted one or more answers. The plan lane sees the original request
    plus every accumulated Q/A pair, and decides whether to ask another
    question or finalize with `plan_ready`.
    """

    lines: list[str] = [
        'Continuing the plan clarifier. Use the answers below to either ask '
        'the next most-important question or emit the final `plan_ready` '
        'envelope with a concrete, non-empty proposed_hierarchy.',
        '',
        f'Original request: {pending_plan.source_user_message}',
    ]
    if pending_plan.answers:
        lines.append('')
        lines.append('Answers so far (most recent last):')
        for idx, answer in enumerate(pending_plan.answers, start=1):
            value = answer.custom_answer or answer.selected_option or '(no answer)'
            q = answer.question_text or answer.question_id
            lines.append(f'  {idx}. Q: {q}')
            lines.append(f'     A: {value}')
    return '\n'.join(lines)


def _ingest_edit_clarifier_answer(
    *,
    session: AgentSession,
    parsed_answer: dict[str, Any],
    logger: logging.Logger,
    settings: Any,
    trace_id: str | None,
) -> bool:
    """Route a `lane='edit'` clarifier answer into `PendingEditContext`.

    Validates `question_id` against the stamped id on the pending context,
    then writes the answer into the correct slot based on `awaiting_field`
    (rename_title/title → default_title; target_label/parent → target_hint).
    Returns True when the answer was applied; False when there's no matching
    pending state (caller should fall through to normal classification).
    """

    pending = session.metadata.pending_edit_context
    if pending is None:
        log_event(
            logger,
            'edit_clarifier_answer_dropped_no_pending_context',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
        )
        return False
    expected_id = pending.pending_clarifier_question_id
    incoming_id = parsed_answer.get('question_id')
    if expected_id is None or expected_id != incoming_id:
        log_event(
            logger,
            'edit_clarifier_answer_question_id_mismatch',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            expected_id=expected_id,
            incoming_id=incoming_id,
        )
        return False
    selected = parsed_answer.get('selected_option')
    custom = parsed_answer.get('custom_answer')
    value: str | None = None
    if isinstance(custom, str) and custom.strip():
        value = custom.strip()
    elif isinstance(selected, str) and selected.strip():
        value = selected.strip()
    if value is None:
        log_event(
            logger,
            'edit_clarifier_answer_empty',
            settings=settings,
            level=logging.WARNING,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
        )
        return False

    # Route the value to the right slot on the pending context.
    awaiting = pending.awaiting_field
    if awaiting in {'rename_title', 'title'}:
        pending.default_title = value
    else:
        # target_label / parent / None → write to target_hint so the
        # resolver picks up the disambiguation on the next turn.
        pending.target_hint = value
    pending.pending_clarifier_question_id = None
    pending.last_followup_kind = 'clarifier_answer'
    log_event(
        logger,
        'edit_clarifier_answer_ingested',
        settings=settings,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        question_id=incoming_id,
        awaiting_field=awaiting,
        value_source='custom' if isinstance(custom, str) and custom.strip() else 'option',
    )
    return True


_PRIOR_TOOL_OBSERVATION_MAX_ENTRIES = 3
_PRIOR_TOOL_OBSERVATION_BLOCK_CAP_CHARS = 500


def _format_matched_nodes_inline(matched_nodes: list[dict[str, Any]]) -> str:
    """Render matched nodes as `type id=<id> title="<title>"` segments.

    Keeps the id verbatim so the LLM can stage operations against it
    without re-resolving. Caller inlines this into the observation line.
    """

    if not matched_nodes:
        return ''
    parts: list[str] = []
    for node in matched_nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get('id')
        if not isinstance(node_id, str):
            continue
        title = node.get('title')
        node_type = node.get('type') or 'node'
        title_segment = f' title="{title}"' if isinstance(title, str) else ''
        parts.append(f'{node_type} id={node_id}{title_segment}')
    return '; '.join(parts)


def _format_prior_tool_observation_line(entry: Any) -> str | None:
    if not isinstance(entry, dict):
        return None
    tool_name = entry.get('tool_name')
    if not isinstance(tool_name, str) or not tool_name.strip():
        return None
    args = entry.get('args') or {}
    if isinstance(args, dict) and args:
        key_args_parts = []
        for key in sorted(args.keys()):
            value = args[key]
            if isinstance(value, str):
                value = value[:60]
            key_args_parts.append(f'{key}={value}')
        key_args_text = ', '.join(key_args_parts)
    else:
        key_args_text = ''
    # Prefer the concrete matched_nodes segment (includes ids the LLM
    # needs to stage operations); fall back to the textual summary.
    matched_nodes = entry.get('matched_nodes')
    if isinstance(matched_nodes, list) and matched_nodes:
        matched_segment = _format_matched_nodes_inline(matched_nodes)
        if matched_segment:
            return f'- {tool_name}({key_args_text}) → matched: {matched_segment}'
    result_summary = entry.get('result_summary') or {}
    if isinstance(result_summary, dict) and result_summary:
        summary_parts = []
        for key in sorted(result_summary.keys()):
            value = result_summary[key]
            if isinstance(value, list):
                value = value[:3]
            summary_parts.append(f'{key}={value}')
        summary_text = ', '.join(summary_parts)
    else:
        summary_text = '(no result)'
    return f'- {tool_name}({key_args_text}) → {summary_text}'


def _compose_prior_tool_observation_block(
    observations: list[dict[str, Any]] | None,
) -> str:
    """Format a compact 'already done' block listing prior tool calls.

    Returns '' when there's nothing meaningful to show. Caps at the 3 most
    recent entries and ~500 chars total so the injected block stays
    within budget.
    """

    if not observations:
        return ''
    # Most recent first (react-loop appends chronologically, so flip).
    recent = list(reversed(observations))[:_PRIOR_TOOL_OBSERVATION_MAX_ENTRIES]
    lines: list[str] = []
    for entry in recent:
        line = _format_prior_tool_observation_line(entry)
        if line:
            lines.append(line)
    if not lines:
        return ''
    header = (
        'Context from the prior turn (already done — do NOT repeat these '
        'tool calls; reuse the resolved targets below):'
    )
    block = '\n'.join([header, *lines])
    if len(block) > _PRIOR_TOOL_OBSERVATION_BLOCK_CAP_CHARS:
        block = block[: _PRIOR_TOOL_OBSERVATION_BLOCK_CAP_CHARS - 3] + '...'
    return block


def _compose_edit_clarifier_replay_prompt(
    *,
    pending: Any,
    user_answer_value: str,
) -> str:
    """Synthesize the user-side prompt after an edit-clarifier answer.
    The edit planner sees the answer in context and continues staging.
    """

    parts: list[str] = []
    prior_observations = getattr(pending, 'prior_tool_observations', None) or []
    prior_block = _compose_prior_tool_observation_block(prior_observations)
    if prior_block:
        parts.append(prior_block)
        parts.append('')
    parts.append(
        'Continuing the edit clarifier. The user picked their answer via '
        'the clarifier card — proceed with the edit, do not ask again.'
    )
    parts.append('')
    parts.append(f'Original request: {pending.source_user_message}')
    field = pending.awaiting_field or 'the field'
    parts.append(f'User answer for `{field}`: {user_answer_value}')
    return '\n'.join(parts)


def _compose_plan_confirmation_prompt(
    *,
    original_user_message: str,
    pending_plan: PendingPlan,
) -> str:
    """Synthesize an edit-lane prompt describing the plan the user just
    confirmed. The edit planner sees this as the user message and stages
    concrete operations, resolving existing nodes by title and creating the
    rest.
    """

    lines: list[str] = []
    lines.append(
        'The user confirmed the following plan — stage the concrete roadmap '
        'operations to implement it. Do not ask for further confirmation. '
        'Resolve existing nodes by title (use the `target_*_title` hints); '
        'create new epics/features/tasks otherwise.'
    )
    lines.append('')
    lines.append(f'Plan summary: {pending_plan.summary}')
    if pending_plan.goal:
        lines.append(f'Goal: {pending_plan.goal}')
    if pending_plan.proposed_hierarchy:
        lines.append('Proposed structure:')
        for epic in pending_plan.proposed_hierarchy:
            lines.append(f'- Epic "{epic.title}"')
            if epic.description:
                lines.append(f'    description: {epic.description}')
            for feature in epic.features:
                anchor = (
                    f' (under existing epic "{feature.target_epic_title}")'
                    if feature.target_epic_title else ''
                )
                lines.append(f'  - Feature "{feature.title}"{anchor}')
                if feature.description:
                    lines.append(f'      description: {feature.description}')
                for task in feature.tasks:
                    task_anchor = (
                        f' (under existing feature "{task.target_feature_title}")'
                        if task.target_feature_title else ''
                    )
                    lines.append(f'    - Task "{task.title}"{task_anchor}')
                    if task.description:
                        lines.append(f'        description: {task.description}')
                    if task.status:
                        lines.append(f'        status: {task.status}')
    if pending_plan.next_steps:
        lines.append('Next steps (advisory, not operations): ' + '; '.join(pending_plan.next_steps))
    lines.append('')
    lines.append(f'Original user confirmation: "{original_user_message}"')
    return '\n'.join(lines)


@dataclass
class PrePlanningDispatchResult:
    session_context: dict[str, Any]
    pending_edit_context_present: bool
    edit_continuation_trigger: str | None
    has_staged_operations: bool
    preview_intent: IntentType
    planning_user_message: str
    deictic_resolution: dict[str, Any] | None
    actor_fetch_attempted: bool
    actor_fetch_skipped_reason: str | None
    actor_fetch_ms: int | None


def dispatch_pre_planning_phase(
    *,
    service: Any,
    session: AgentSession,
    user_message: str,
    auth_header: str | None,
    trace_id: str | None,
    staged_operations: list[RoadmapOperation],
    phase_timings: dict[str, Any],
) -> PrePlanningDispatchResult:
    self = service

    pending_context = session.metadata.pending_edit_context
    pending_edit_context_present = pending_context is not None
    if pending_context is not None:
        edit_continuation_trigger = self._detect_pending_edit_followup_kind(
            user_message=user_message,
            pending_context=pending_context,
        )
    else:
        edit_continuation_trigger = self._detect_edit_continuation_trigger(user_message)
    has_staged_operations = bool(staged_operations)
    deictic_reference_present = self._looks_like_deictic_parent_reference(user_message)
    recent_targets_available = bool(self._get_recent_resolved_targets(session))
    force_continuation_triggers = {
        'confirm',
        'cancel',
        'correction',
        'retry',
        'delegate',
        'slot_value',
    }
    staged_continuation_triggers = {'confirm', 'cancel', 'correction', 'retry'}
    pending_continuation_requested = pending_edit_context_present and (
        edit_continuation_trigger in force_continuation_triggers
    )
    staged_operation_continuation = (
        edit_continuation_trigger in staged_continuation_triggers and has_staged_operations
    )
    recent_target_continuation = (
        edit_continuation_trigger in staged_continuation_triggers
        and deictic_reference_present
        and recent_targets_available
    )
    pending_plan = session.metadata.pending_plan
    plan_flag_enabled = bool(
        getattr(self._settings, 'agent_plan_proposal_enabled', False)
    )
    # Detect a clarifier answer payload BEFORE we classify. Two sentinels:
    #  - new `__clarifier_answer__` — lane-aware, any lane (preferred)
    #  - legacy `__plan_answers__`  — plan lane only, kept one release
    plan_answers_submitted = False
    edit_clarifier_answer_submitted = False
    if plan_flag_enabled:
        clarifier_answer = _parse_clarifier_answer_sentinel(user_message)
        if clarifier_answer is not None:
            lane = clarifier_answer.get('lane')
            if lane == 'plan':
                plan_answers_submitted = _ingest_plan_answers(
                    session=session,
                    pending_plan=pending_plan,
                    parsed_answers=[clarifier_answer],
                    logger=self._logger,
                    settings=self._settings,
                    trace_id=trace_id,
                )
                pending_plan = session.metadata.pending_plan
            elif lane == 'edit':
                edit_clarifier_answer_submitted = _ingest_edit_clarifier_answer(
                    session=session,
                    parsed_answer=clarifier_answer,
                    logger=self._logger,
                    settings=self._settings,
                    trace_id=trace_id,
                )
            else:
                # 'query' lane deferred to Phase 2 — just log and fall through.
                log_event(
                    self._logger,
                    'clarifier_answer_lane_not_implemented',
                    settings=self._settings,
                    trace_id=trace_id,
                    session_id=session.session_id,
                    roadmap_id=session.roadmap_id,
                    lane=lane,
                )
        else:
            # Legacy plan-mode sentinel still honoured for one release.
            parsed_answers = _parse_plan_answer_sentinel(user_message)
            if parsed_answers is not None:
                plan_answers_submitted = _ingest_plan_answers(
                    session=session,
                    pending_plan=pending_plan,
                    parsed_answers=parsed_answers,
                    logger=self._logger,
                    settings=self._settings,
                    trace_id=trace_id,
                )
                pending_plan = session.metadata.pending_plan
    pending_plan_present = (
        pending_plan is not None and pending_plan.status == 'proposed'
    )
    plan_confirmation_requested = False
    plan_stale_cleared = False
    # Plan-confirm bridge fires for explicit confirms AND for 'retry' when a
    # pending plan exists — that covers the "apply crashed mid-flow, user
    # hit retry" case where the pending_plan is still in session but the
    # edit-lane apply never committed.
    if (
        plan_flag_enabled
        and pending_plan_present
        and pending_plan is not None
        and edit_continuation_trigger in {'confirm', 'retry'}
        and not pending_continuation_requested
    ):
        if is_plan_stale(session, pending_plan):
            clear_pending_plan(
                session,
                reason='stale_base_revision',
                logger=self._logger,
                settings=self._settings,
                trace_id=trace_id,
            )
            plan_stale_cleared = True
        else:
            plan_confirmation_requested = True
    elif (
        plan_flag_enabled
        and pending_plan_present
        and edit_continuation_trigger == 'cancel'
    ):
        clear_pending_plan(
            session,
            reason='user_cancel',
            logger=self._logger,
            settings=self._settings,
            trace_id=trace_id,
        )

    should_force_edit_preview = (
        pending_continuation_requested
        or staged_operation_continuation
        or recent_target_continuation
        or plan_confirmation_requested
        or edit_clarifier_answer_submitted
    )
    if recent_target_continuation:
        phase_timings['deictic_recent_target_continuation'] = 1
    if pending_context is not None and edit_continuation_trigger:
        phase_timings['pending_followup_kind'] = edit_continuation_trigger
        log_event(
            self._logger,
            'pending_followup_classified',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            followup_kind=edit_continuation_trigger,
            pending_intent_family=pending_context.intent_family,
            pending_confirmation_mode=pending_context.confirmation_mode,
        )

    # Speculative actor-context prefetch: kick off the fetch BEFORE intent
    # classification when the cheap heuristics already make it likely we'll
    # need actor data. The same regex (`is_actor_context_required_message`)
    # gates both this prefetch and the formal `should_fetch_actor_context`
    # decision below, so this is never wasted work — it just shifts the
    # 1.5s round-trip to overlap with classification + LLM call #1 instead
    # of running serially before them.
    speculative_actor_future: Future[None] | None = None
    if (
        auth_header
        and session.metadata.actor_context is None
        and is_actor_context_required_message(user_message)
    ):
        def _run_speculative_actor_fetch() -> None:
            self._ensure_actor_context(
                session=session,
                auth_header=auth_header,
                trace_id=trace_id,
            )

        speculative_actor_future = _get_actor_fetch_executor().submit(
            _run_speculative_actor_fetch
        )

    # Speculative roadmap-overview prefetch: populate
    # `session.metadata.roadmap_overview_summary` in parallel so the planner's
    # system prompt can include a compact roadmap shape without spending a
    # discovery tool call. The fetch is idempotent (skips if already cached)
    # and joined later at the prompt-build site via
    # `resolve_deferred_roadmap_overview_summary`.
    roadmap_overview_fetch_future: Future[None] | None = None
    if (
        auth_header
        and session.metadata.roadmap_overview_summary is None
        and session.roadmap_id
    ):
        def _run_roadmap_overview_fetch() -> None:
            self._ensure_roadmap_overview_summary(
                session=session,
                auth_header=auth_header,
                trace_id=trace_id,
            )

        roadmap_overview_fetch_future = _get_actor_fetch_executor().submit(
            _run_roadmap_overview_fetch
        )

    session_context = self._build_session_context(session, auth_header, trace_id)
    cached_classifier_result: dict[str, Any] | None = None
    if plan_answers_submitted:
        # Skip classification — we know we're re-entering the plan lane with
        # new answers accumulated on the pending plan.
        preview_intent: IntentType = 'roadmap_plan'
        phase_timings['intent_classification_ms'] = 0
        phase_timings['plan_answers_replay'] = 1
    elif should_force_edit_preview:
        preview_intent = 'roadmap_edit'
        phase_timings['intent_classification_ms'] = 0
    else:
        classify_started = perf_counter()
        preview_intent, _ = self._planner.preview_intent_classification(
            user_message=user_message,
            session_context=session_context,
        )
        phase_timings['intent_classification_ms'] = int(
            (perf_counter() - classify_started) * 1000
        )
        cached_classifier_result = session_context.get('_classifier_result')

    simple_edit_detected = preview_intent == 'roadmap_edit'
    # Post-classification plan-confirm bridge: the pre-classification heuristic
    # `edit_continuation_trigger` uses strict regex fullmatch and misses
    # phrasing like "Yes, apply this plan." (trailing "plan" falls outside
    # the allowed tail group). The classifier handles these reliably — so
    # if it returned `confirm_action` (or `roadmap_query` for a retry-style
    # message when a plan is pending) and we have a fresh pending plan,
    # fire the plan-confirm bridge now.
    retry_with_pending_plan = (
        edit_continuation_trigger == 'retry'
        and pending_plan_present
        and pending_plan is not None
    )
    if (
        plan_flag_enabled
        and pending_plan_present
        and pending_plan is not None
        and not plan_confirmation_requested
        and not plan_stale_cleared
        and (preview_intent == 'confirm_action' or retry_with_pending_plan)
        and not pending_continuation_requested
    ):
        if is_plan_stale(session, pending_plan):
            clear_pending_plan(
                session,
                reason='stale_base_revision',
                logger=self._logger,
                settings=self._settings,
                trace_id=trace_id,
            )
            plan_stale_cleared = True
        else:
            plan_confirmation_requested = True
            should_force_edit_preview = True
            # Force preview_intent to edit so downstream compose_dynamic_system_prompt
            # sees `intent_type='roadmap_edit'` via the force_edit_continuation flag
            # on session_context (set below).
            preview_intent = 'roadmap_edit'
    # Vague-value handling is LLM-native: the edit planner's tool schema
    # requires `clarifier_options` when operations=[] + a question, and the
    # edit_mode prompt forbids inventing values. See the planner tool
    # schema in `agent/app/core/tools/registry.py` and `edit_mode/v1.md`.
    # The edit_planner_staged_op_with_unverified_value log in the
    # orchestrator is the observability layer that tells us if the LLM
    # ever slips.
    planning_user_message = user_message
    if plan_answers_submitted and pending_plan is not None:
        # Replay the original request plus the freshly-appended answer(s) so
        # the plan lane can finalize (or ask the next question).
        planning_user_message = _compose_plan_replay_prompt(pending_plan)
        log_event(
            self._logger,
            'pending_plan_answers_replay_triggered',
            settings=self._settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            plan_id=pending_plan.plan_id,
            answer_count=len(pending_plan.answers),
        )
    if plan_confirmation_requested and pending_plan is not None:
        planning_user_message = _compose_plan_confirmation_prompt(
            original_user_message=user_message,
            pending_plan=pending_plan,
        )
        log_event(
            self._logger,
            'pending_plan_confirmation_triggered',
            settings=self._settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            plan_id=pending_plan.plan_id,
        )
    if edit_clarifier_answer_submitted:
        pending_ctx = session.metadata.pending_edit_context
        if pending_ctx is not None:
            user_answer_value = (
                pending_ctx.default_title
                or pending_ctx.target_hint
                or ''
            )
            planning_user_message = _compose_edit_clarifier_replay_prompt(
                pending=pending_ctx,
                user_answer_value=user_answer_value,
            )
            log_event(
                self._logger,
                'edit_clarifier_answer_replay_triggered',
                settings=self._settings,
                trace_id=trace_id,
                session_id=session.session_id,
                roadmap_id=session.roadmap_id,
                awaiting_field=pending_ctx.awaiting_field,
            )
    _ = plan_stale_cleared  # observable via pending_plan_cleared event

    actor_fetch_attempted = False
    actor_fetch_skipped_reason: str | None = None
    actor_fetch_ms: int | None = None
    should_fetch_actor, actor_skip_reason = self._should_fetch_actor_context(
        preview_intent=preview_intent,
        user_message=user_message,
        auth_header=auth_header,
        simple_edit_detected=simple_edit_detected,
        actor_context_present=session.metadata.actor_context is not None,
    )
    actor_fetch_future: Future[None] | None = None
    if should_fetch_actor:
        actor_fetch_attempted = True
        if speculative_actor_future is not None:
            # Speculative prefetch already in flight (or finished) — reuse it
            # rather than launching a second fetch for the same data.
            actor_fetch_future = speculative_actor_future
            speculative_actor_future = None
        else:
            def _run_actor_fetch() -> None:
                self._ensure_actor_context(
                    session=session,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )

            # Submit on a shared thread pool so the fetch overlaps with all
            # downstream pre-dispatch work (deictic resolution, session_context
            # rebuild, the planner's prompt construction, and the first LLM
            # network call). The future is joined at every consumer site that
            # reads session_context['actor_context'] via
            # `resolve_deferred_actor_context`.
            actor_fetch_future = _get_actor_fetch_executor().submit(
                _run_actor_fetch
            )
    else:
        if speculative_actor_future is not None:
            # Formal decision says we don't need actor — best-effort cancel.
            # If already running, the result still populates
            # session.metadata.actor_context and benefits the next request;
            # not wasted, just unattributed.
            speculative_actor_future.cancel()
            speculative_actor_future = None
        actor_fetch_skipped_reason = actor_skip_reason
        if actor_skip_reason == 'missing_auth_header':
            self._clear_actor_context_for_missing_auth(
                session=session,
                trace_id=trace_id,
            )

    session_context = self._build_session_context(session, auth_header, trace_id)
    if cached_classifier_result is not None:
        # `_build_session_context` returns a fresh dict, so the classifier
        # result stashed before the actor-fetch branch would otherwise be
        # dropped — forcing the LangGraph `classify_intent` node to re-call
        # the LLM. Carry it across the rebuild so the cache hits.
        session_context['_classifier_result'] = cached_classifier_result
    if plan_answers_submitted:
        # Seed the classifier cache so the LangGraph classify_intent node
        # stays on the plan lane rather than running a fresh classification
        # on the synthesized replay prompt.
        session_context['_classifier_result'] = {
            'intent_type': 'roadmap_plan',
            'source': 'plan_answers_replay',
            'rationale': 'user answered plan clarifier; replaying plan lane',
        }
    if actor_fetch_future is not None:
        session_context['_actor_fetch_future'] = actor_fetch_future

        def _rebuild_actor_on_context() -> None:
            refreshed = self._build_session_context(
                session, auth_header, trace_id
            )
            actor = refreshed.get('actor_context')
            if isinstance(actor, dict):
                session_context['actor_context'] = actor

        session_context['_actor_fetch_rebuild'] = _rebuild_actor_on_context
    if roadmap_overview_fetch_future is not None:
        session_context['_roadmap_overview_fetch_future'] = roadmap_overview_fetch_future

        def _rebuild_roadmap_overview_on_context(
            target_context: dict[str, Any],
        ) -> None:
            # `target_context` is the session_context dict held by the
            # caller of `resolve_deferred_roadmap_overview_summary`. That can
            # differ from the pre-dispatcher's original dict when LangGraph
            # shallow-copies state between nodes, so write to the caller's
            # dict directly rather than the closed-over one.
            refreshed = self._build_session_context(
                session, auth_header, trace_id
            )
            summary = refreshed.get('roadmap_overview_summary')
            if isinstance(summary, str) and summary.strip():
                target_context['roadmap_overview_summary'] = summary

        session_context['_roadmap_overview_fetch_rebuild'] = (
            _rebuild_roadmap_overview_on_context
        )
    if pending_context is not None and edit_continuation_trigger:
        session_context['pending_followup_kind'] = edit_continuation_trigger
    if should_force_edit_preview:
        session_context['force_edit_continuation'] = True
        if plan_confirmation_requested:
            reason = 'pending_plan_confirm'
        elif edit_clarifier_answer_submitted:
            reason = 'edit_clarifier_answer'
        else:
            reason = edit_continuation_trigger or 'pending_context'
        session_context['force_edit_continuation_reason'] = reason
    deictic_resolution = self._resolve_deictic_parent_reference(
        session=session,
        user_message=user_message,
    )
    if deictic_resolution is not None:
        deictic_status = str(deictic_resolution.get('status') or '')
        session_context['deictic_resolution_status'] = deictic_status
        phase_timings['deictic_resolution_detected'] = 1
        if deictic_status == 'resolved':
            parent_hint = {
                'node_id': deictic_resolution.get('node_id'),
                'node_type': deictic_resolution.get('node_type'),
                'title': deictic_resolution.get('title'),
                'label': deictic_resolution.get('label'),
            }
            session_context['deictic_parent_hint'] = parent_hint
            phase_timings['deictic_resolution_candidates'] = 1
            self._append_recent_resolved_target(
                session=session,
                node_id=parent_hint.get('node_id'),
                node_type=parent_hint.get('node_type'),
                title=parent_hint.get('title'),
                label=parent_hint.get('label'),
                source='deictic_pre_resolver',
                confidence=1.0,
            )
        elif deictic_status == 'ambiguous':
            candidates = deictic_resolution.get('candidates')
            phase_timings['deictic_resolution_candidates'] = (
                len(candidates) if isinstance(candidates, list) else 0
            )

    return PrePlanningDispatchResult(
        session_context=session_context,
        pending_edit_context_present=pending_edit_context_present,
        edit_continuation_trigger=edit_continuation_trigger,
        has_staged_operations=has_staged_operations,
        preview_intent=preview_intent,
        planning_user_message=planning_user_message,
        deictic_resolution=deictic_resolution,
        actor_fetch_attempted=actor_fetch_attempted,
        actor_fetch_skipped_reason=actor_fetch_skipped_reason,
        actor_fetch_ms=actor_fetch_ms,
    )
