from __future__ import annotations

from datetime import datetime
import logging
import re
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, PendingEditContext, PendingEditResolvedReferences
from app.core.llm.client import PlanningResult
from app.core.logging_utils import log_event, summarize_tool_result


# Cap the persisted snapshot so the session payload stays bounded. 10 is
# generous — a clarifier-emitting turn typically produces 1-3 observations.
_MAX_PRIOR_TOOL_OBSERVATIONS = 10
# Arg keys we strip from persisted observations. roadmap_id is redundant
# (pending context already knows it); auth keys should never appear in a
# planner tool call args dict, but gate defensively.
_PRIOR_TOOL_OBSERVATION_SENSITIVE_ARG_KEYS = frozenset({
    'auth_header',
    'authorization',
    'roadmap_id',
})


# Cap matched-node identifiers per observation. Enough for the replay
# prompt to unambiguously reference the target; beyond this we'd bloat
# the prompt with low-signal context.
_MAX_MATCHED_NODES_PER_OBSERVATION = 3


def _extract_matched_nodes(raw_result: Any) -> list[dict[str, Any]]:
    """Pull {id, title, type} identity triples from a raw resolver result.

    This is what the LLM actually needs to skip re-calling the tool —
    `summarize_tool_result` intentionally strips IDs for log compactness,
    so we extract them here for the persisted snapshot instead.
    """

    if not isinstance(raw_result, dict):
        return []
    matches = raw_result.get('matches')
    if not isinstance(matches, list):
        return []
    extracted: list[dict[str, Any]] = []
    for match in matches:
        if not isinstance(match, dict):
            continue
        node_id = match.get('id')
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        node_record: dict[str, Any] = {'id': node_id}
        title = match.get('title')
        if isinstance(title, str) and title.strip():
            node_record['title'] = title.strip()
        node_type = match.get('type') or match.get('node_type')
        if isinstance(node_type, str) and node_type.strip():
            node_record['type'] = node_type.strip()
        extracted.append(node_record)
        if len(extracted) >= _MAX_MATCHED_NODES_PER_OBSERVATION:
            break
    return extracted


def _trim_prior_tool_observation(raw: Any) -> dict[str, Any] | None:
    """Project a raw tool_observations entry onto the compact shape we
    persist on `PendingEditContext.prior_tool_observations`. Reuses
    `summarize_tool_result` for the text summary, but additionally
    carries `matched_nodes` (id + title + type) when the tool is a
    resolver — the LLM needs the concrete id to stage operations and
    would otherwise re-call the tool just to retrieve it.
    """

    if not isinstance(raw, dict):
        return None
    tool_name = raw.get('tool_name') or raw.get('name')
    if not isinstance(tool_name, str) or not tool_name.strip():
        return None
    raw_args = raw.get('tool_args') or raw.get('args') or {}
    if isinstance(raw_args, dict):
        args = {
            key: value
            for key, value in raw_args.items()
            if key not in _PRIOR_TOOL_OBSERVATION_SENSITIVE_ARG_KEYS
        }
    else:
        args = {}
    result_summary: dict[str, Any] | None = None
    matched_nodes: list[dict[str, Any]] = []
    raw_result = raw.get('result') or raw.get('tool_result')
    if isinstance(raw_result, dict):
        result_summary = summarize_tool_result(raw_result)
        matched_nodes = _extract_matched_nodes(raw_result)
    elif isinstance(raw.get('result_summary'), dict):
        result_summary = raw['result_summary']
    # Back-compat: if the raw entry already carried `matched_nodes`
    # (e.g. rehydrated session from a future version or a test fixture),
    # prefer the explicit field.
    if isinstance(raw.get('matched_nodes'), list) and not matched_nodes:
        matched_nodes = [
            node for node in raw['matched_nodes']
            if isinstance(node, dict) and isinstance(node.get('id'), str)
        ][:_MAX_MATCHED_NODES_PER_OBSERVATION]
    snapshot: dict[str, Any] = {
        'tool_name': tool_name,
        'args': args,
        'result_summary': result_summary or {},
    }
    if matched_nodes:
        snapshot['matched_nodes'] = matched_nodes
    return snapshot


def build_prior_tool_observations_snapshot(
    planning: PlanningResult,
) -> list[dict[str, Any]]:
    """Build the compact snapshot to stamp onto `PendingEditContext`.

    Pulled upstream of the card builder so the snapshot is part of the
    pending context's initial state — the existing post-execution save
    picks it up automatically, no extra Redis write needed.
    """

    raw = getattr(planning, 'tool_observations', None) or []
    trimmed: list[dict[str, Any]] = []
    for entry in raw:
        compact = _trim_prior_tool_observation(entry)
        if compact is None:
            continue
        trimmed.append(compact)
        if len(trimmed) >= _MAX_PRIOR_TOOL_OBSERVATIONS:
            break
    return trimmed


def infer_last_staged_create_title(
    *,
    staged_operations: list[RoadmapOperation],
) -> str | None:
    for operation in reversed(staged_operations):
        op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
        if op_name not in {'add_epic', 'add_feature', 'add_task'}:
            continue
        if isinstance(operation.data, dict):
            title = operation.data.get('title')
            if isinstance(title, str) and title.strip():
                return title.strip()
    return None


def set_pending_edit_context(
    *,
    session: AgentSession,
    context: PendingEditContext | None,
    event: str,
    trace_id: str | None,
    logger: logging.Logger,
    settings: Any,
    normalize_intent_family: Callable[[str | None], str],
    reason: str | None = None,
) -> None:
    if context is not None:
        context.intent_family = normalize_intent_family(context.intent_family)
    session.metadata.pending_edit_context = context
    prior_tool_observations_count: int | None = None
    if context is not None:
        raw_observations = getattr(context, 'prior_tool_observations', None)
        if isinstance(raw_observations, list):
            prior_tool_observations_count = len(raw_observations)
    log_event(
        logger,
        'pending_edit_context_event',
        settings=settings,
        trace_id=trace_id,
        roadmap_id=session.roadmap_id,
        pending_edit_context_event=event,
        pending_edit_context_reason=reason,
        pending_edit_context_present=context is not None,
        intent_family=(context.intent_family if context is not None else None),
        confirmation_mode=(context.confirmation_mode if context is not None else None),
        prior_tool_observations_count=prior_tool_observations_count,
    )


def invalidate_retry_hints(hints: dict[str, Any] | None) -> dict[str, Any]:
    next_hints = dict(hints or {})
    next_hints.pop('candidate_ids', None)
    next_hints.pop('candidate_count', None)
    next_hints.pop('last_label', None)
    next_hints.pop('normalized_label', None)
    next_hints.pop('rename_from_label', None)
    next_hints.pop('rename_to_title', None)
    next_hints.pop('expected_node_type', None)
    next_hints['retry_autostage_eligible'] = False
    next_hints['hint_intent_version'] = None
    next_hints['hint_staged_operations_version'] = None
    return next_hints


def build_resolver_hints(
    *,
    existing_hints: dict[str, Any] | None,
    user_message: str,
    planning: PlanningResult,
    edit_continuation_trigger: str | None,
    intent_family: str,
    staged_operations_version: int,
    rename_intent: tuple[str, str] | None,
    invalidate_retry_hints: Callable[[dict[str, Any] | None], dict[str, Any]],
) -> dict[str, Any] | None:
    hints: dict[str, Any] = dict(existing_hints or {})
    hints['intent_family'] = intent_family
    normalized_user_message = user_message.strip()
    if normalized_user_message:
        hints['last_user_message'] = normalized_user_message[:240]
    if edit_continuation_trigger:
        hints['last_trigger'] = edit_continuation_trigger
    prior_version = hints.get('intent_version')
    current_version = int(prior_version) if isinstance(prior_version, int) else 0
    invalidate_retry = edit_continuation_trigger in {'correction', 'cancel'}
    if invalidate_retry:
        current_version += 1
        hints = invalidate_retry_hints(hints)
    if rename_intent is not None:
        from_label, to_title = rename_intent
        hints['rename_from_label'] = from_label
        hints['rename_to_title'] = to_title
        if not invalidate_retry:
            hints['retry_autostage_eligible'] = True
    elif intent_family != 'rename_node':
        hints['retry_autostage_eligible'] = False
    if planning.clarifier_reason:
        hints['last_clarifier_reason'] = planning.clarifier_reason
    if planning.clarifier_options:
        hints['last_clarifier_options'] = list(planning.clarifier_options[:3])
    if planning.assistant_message:
        matched_ids = re.findall(
            r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
            planning.assistant_message,
        )
        if matched_ids:
            hints['candidate_ids'] = matched_ids[:5]
    hints['intent_version'] = current_version
    hints['hint_intent_version'] = current_version
    hints['hint_staged_operations_version'] = staged_operations_version
    return hints or None


def summarize_tool_plan(
    *,
    tool_plan: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not isinstance(tool_plan, list):
        return []
    summary: list[dict[str, Any]] = []
    for item in tool_plan[:5]:
        if not isinstance(item, dict):
            continue
        tool_name = item.get('tool_name')
        args = item.get('args')
        arg_keys = sorted(args.keys())[:6] if isinstance(args, dict) else []
        summary.append(
            {
                'tool_name': str(tool_name or ''),
                'arg_keys': arg_keys,
            }
        )
    return summary


def looks_like_edit_confirmation_prompt(assistant_message: str) -> bool:
    normalized = ' '.join(str(assistant_message or '').strip().lower().split())
    if not normalized:
        return False
    if not re.search(r'\b(?:do you want me to|would you like me to|should i)\b', normalized):
        return False
    return bool(
        re.search(
            r'\b(?:mark|set|rename|move|delete|remove|add|create|update|assign|unassign|reassign|apply|change|shift|retitle)\b',
            normalized,
        )
    )


def sync_pending_edit_context(
    *,
    session: AgentSession,
    planning: PlanningResult,
    user_message: str,
    edit_continuation_trigger: str | None,
    staged_operations_version: int,
    trace_id: str | None,
    edit_guard_intervened: bool,
    logger: logging.Logger,
    settings: Any,
    utcnow: Callable[[], datetime],
    normalize_intent_family: Callable[[str | None], str],
    extract_create_intent: Callable[[str], Any],
    infer_last_staged_create_title: Callable[[AgentSession], str | None],
    extract_rename_intent: Callable[[str], tuple[str, str] | None],
    invalidate_retry_hints: Callable[[dict[str, Any] | None], dict[str, Any]],
) -> None:
    existing_context = session.metadata.pending_edit_context
    if edit_continuation_trigger == 'correction' and existing_context is not None:
        invalidated_hints = invalidate_retry_hints(
            existing_context.resolver_hints
        )
        existing_context.resolver_hints = invalidated_hints
        existing_context.last_followup_kind = 'correction'
        existing_context.updated_at = utcnow()
        set_pending_edit_context(
            session=session,
            context=existing_context,
            event='updated',
            trace_id=trace_id,
            logger=logger,
            settings=settings,
            normalize_intent_family=normalize_intent_family,
            reason='correction_trigger',
        )

    if edit_continuation_trigger == 'cancel':
        if session.metadata.pending_edit_context is not None:
            set_pending_edit_context(
                session=session,
                context=None,
                event='cleared',
                trace_id=trace_id,
                logger=logger,
                settings=settings,
                normalize_intent_family=normalize_intent_family,
                reason='cancel_trigger',
            )
        return

    if edit_guard_intervened and existing_context is not None:
        existing_context.draft_operations = []
        existing_context.confirmation_mode = 'awaiting_clarification'
        existing_context.resolver_hints = invalidate_retry_hints(
            existing_context.resolver_hints
        )
        existing_context.last_guard_reason = planning.provider_error_code
        existing_context.last_followup_kind = edit_continuation_trigger
        existing_context.updated_at = utcnow()
        set_pending_edit_context(
            session=session,
            context=existing_context,
            event='updated',
            trace_id=trace_id,
            logger=logger,
            settings=settings,
            normalize_intent_family=normalize_intent_family,
            reason='edit_guard_intervened',
        )
        return

    if (
        planning.response_mode == 'chat'
        and planning.clarifier_action is None
        and looks_like_edit_confirmation_prompt(planning.assistant_message)
    ):
        if existing_context is None:
            context = PendingEditContext(
                intent_family='roadmap_edit_clarifier',
                draft_operations=[],
                required_fields=[],
                resolved_references=PendingEditResolvedReferences(),
                confirmation_mode='awaiting_clarification',
                source_user_message=user_message,
                last_followup_kind=edit_continuation_trigger,
                prior_tool_observations=build_prior_tool_observations_snapshot(planning),
                created_at=utcnow(),
                updated_at=utcnow(),
            )
            set_pending_edit_context(
                session=session,
                context=context,
                event='set',
                trace_id=trace_id,
                logger=logger,
                settings=settings,
                normalize_intent_family=normalize_intent_family,
                reason='implicit_edit_confirmation_prompt',
            )
        else:
            existing_context.last_followup_kind = edit_continuation_trigger
            existing_context.updated_at = utcnow()
            set_pending_edit_context(
                session=session,
                context=existing_context,
                event='updated',
                trace_id=trace_id,
                logger=logger,
                settings=settings,
                normalize_intent_family=normalize_intent_family,
                reason='implicit_edit_confirmation_prompt',
            )
        return

    if planning.intent_type != 'roadmap_edit':
        if existing_context is not None and edit_continuation_trigger == 'side_query':
            existing_context.last_followup_kind = 'side_query'
            existing_context.updated_at = utcnow()
            set_pending_edit_context(
                session=session,
                context=existing_context,
                event='updated',
                trace_id=trace_id,
                logger=logger,
                settings=settings,
                normalize_intent_family=normalize_intent_family,
                reason='side_query_followup',
            )
        return
    if planning.response_mode == 'edit_plan' and planning.operations:
        if session.metadata.pending_edit_context is not None:
            set_pending_edit_context(
                session=session,
                context=None,
                event='cleared',
                trace_id=trace_id,
                logger=logger,
                settings=settings,
                normalize_intent_family=normalize_intent_family,
                reason='edit_plan_staged',
            )
        return

    if planning.response_mode != 'chat':
        return

    clarifier_action = planning.clarifier_action
    if clarifier_action not in {'ask_clarifier', 'propose_safe_default', 'cannot_proceed'}:
        return

    create_intent = extract_create_intent(user_message)
    existing = session.metadata.pending_edit_context
    resolved_refs = (
        existing.resolved_references
        if existing is not None
        else PendingEditResolvedReferences()
    )
    existing_hints = (
        dict(existing.resolver_hints)
        if existing is not None and isinstance(existing.resolver_hints, dict)
        else {}
    )
    default_title = (
        create_intent.title
        if create_intent is not None
        else (existing.default_title if existing is not None else None)
        or infer_last_staged_create_title(session)
    )
    draft_operations: list[RoadmapOperation] = []
    required_fields: list[str] = []
    confirmation_mode: str = 'awaiting_clarification'
    intent_family = (
        f'create_{create_intent.node_type}'
        if create_intent is not None
        else (existing.intent_family if existing is not None else 'roadmap_edit_clarifier')
    )
    intent_family = normalize_intent_family(intent_family)
    rename_intent = extract_rename_intent(user_message)
    if rename_intent is not None:
        intent_family = 'rename_node'
    elif intent_family == 'rename_node' and existing_hints.get('rename_from_label'):
        rename_from_label = str(existing_hints.get('rename_from_label') or '').strip()
        rename_to_title = str(existing_hints.get('rename_to_title') or '').strip()
        if rename_from_label and rename_to_title:
            rename_intent = (rename_from_label, rename_to_title)

    if clarifier_action == 'propose_safe_default':
        if create_intent is not None and create_intent.node_type == 'epic' and default_title:
            draft_operations = [
                RoadmapOperation(
                    op='add_epic',
                    data={'title': default_title},
                )
            ]
            confirmation_mode = 'draft_ready'
        else:
            confirmation_mode = 'awaiting_clarification'
    else:
        if create_intent is not None and create_intent.node_type in {'feature', 'task'}:
            required_fields.append('parent')
        if not default_title and create_intent is not None:
            required_fields.append('title')

    awaiting_field: str | None = existing.awaiting_field if existing is not None else None
    target_hint = (
        str(existing.target_hint).strip()
        if existing is not None and isinstance(existing.target_hint, str)
        else ''
    )
    if rename_intent is not None:
        target_hint = rename_intent[0].strip()
    if not target_hint and isinstance(existing_hints.get('rename_from_label'), str):
        target_hint = str(existing_hints.get('rename_from_label') or '').strip()
    if intent_family == 'rename_node':
        clarifier_reason = str(planning.clarifier_reason or '').strip().lower()
        if clarifier_reason in {
            'pending_rename_target_ambiguous',
            'retry_multiple_matches',
            'deictic_parent_ambiguous',
        }:
            awaiting_field = 'target_label'
        else:
            awaiting_field = 'rename_title'
    elif required_fields:
        if 'parent' in required_fields:
            awaiting_field = 'parent'
        elif 'title' in required_fields:
            awaiting_field = 'title'

    resolver_hints = build_resolver_hints(
        existing_hints=existing_hints,
        user_message=user_message,
        planning=planning,
        edit_continuation_trigger=edit_continuation_trigger,
        intent_family=intent_family,
        staged_operations_version=staged_operations_version,
        rename_intent=rename_intent,
        invalidate_retry_hints=invalidate_retry_hints,
    )
    if resolver_hints is not None and awaiting_field:
        resolver_hints['awaiting_field'] = awaiting_field
    if resolver_hints is not None and target_hint:
        resolver_hints['target_hint'] = target_hint
    context = PendingEditContext(
        intent_family=intent_family,
        draft_operations=draft_operations,
        required_fields=required_fields,
        resolved_references=resolved_refs,
        confirmation_mode=confirmation_mode,  # type: ignore[arg-type]
        source_user_message=user_message,
        default_title=default_title,
        awaiting_field=awaiting_field,  # type: ignore[arg-type]
        target_hint=target_hint or None,
        last_clarifier_reason=(
            planning.clarifier_reason
            or (existing.last_clarifier_reason if existing is not None else None)
        ),
        last_followup_kind=edit_continuation_trigger,
        resolver_hints=resolver_hints,
        last_planner_stop_reason=planning.stop_reason,
        last_planner_needs_more_info=planning.needs_more_info,
        last_planner_draft_action=planning.draft_action,
        last_tool_plan_summary=summarize_tool_plan(tool_plan=planning.tool_plan),
        last_guard_reason=(existing.last_guard_reason if existing is not None else None),
        last_retry_blocked_reason=(
            existing.last_retry_blocked_reason if existing is not None else None
        ),
        last_retry_blocked_intent_family=(
            existing.last_retry_blocked_intent_family if existing is not None else None
        ),
        prior_tool_observations=build_prior_tool_observations_snapshot(planning),
        created_at=(existing.created_at if existing is not None else utcnow()),
        updated_at=utcnow(),
    )
    set_pending_edit_context(
        session=session,
        context=context,
        event='updated' if existing is not None or edit_continuation_trigger else 'set',
        trace_id=trace_id,
        logger=logger,
        settings=settings,
        normalize_intent_family=normalize_intent_family,
        reason=planning.clarifier_reason or clarifier_action,
    )
