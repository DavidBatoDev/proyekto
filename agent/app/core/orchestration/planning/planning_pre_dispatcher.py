from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, IntentType
from app.core.logging_utils import log_event
from app.core.orchestration.context.actor_context_provider import (
    is_actor_context_required_message,
)

_ACTOR_FETCH_EXECUTOR: ThreadPoolExecutor | None = None


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
    prompt just omits the overview section).
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
            rebuild()
        except Exception:  # pragma: no cover
            pass
    metrics = session_context.setdefault('_phase_metrics', {})
    if isinstance(metrics, dict):
        metrics['roadmap_overview_fetch_join_ms'] = join_ms
    return join_ms


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
    should_force_edit_preview = (
        pending_continuation_requested
        or staged_operation_continuation
        or recent_target_continuation
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
    if should_force_edit_preview:
        preview_intent: IntentType = 'roadmap_edit'
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
    # Mixed intents (edit + informational question in one turn) are handled
    # LLM-natively inside the edit planner via prompt + context tools — see
    # agent/app/core/prompts/templates/edit_mode/v1.md "Answering questions
    # alongside edits". The regex-based pre-split was removed.
    planning_user_message = user_message

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

        def _rebuild_roadmap_overview_on_context() -> None:
            # The background task writes to session.metadata — pull the fresh
            # value into session_context so the next prompt build picks it up.
            summary = session.metadata.roadmap_overview_summary
            if isinstance(summary, str) and summary.strip():
                session_context['roadmap_overview_summary'] = summary

        session_context['_roadmap_overview_fetch_rebuild'] = (
            _rebuild_roadmap_overview_on_context
        )
    if pending_context is not None and edit_continuation_trigger:
        session_context['pending_followup_kind'] = edit_continuation_trigger
    if should_force_edit_preview:
        session_context['force_edit_continuation'] = True
        session_context['force_edit_continuation_reason'] = (
            edit_continuation_trigger or 'pending_context'
        )
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
