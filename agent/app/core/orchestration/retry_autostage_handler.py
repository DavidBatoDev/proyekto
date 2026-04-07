from __future__ import annotations

from datetime import datetime
import logging
from typing import Any, Callable

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, PendingEditContext
from app.core.llm.client import PlanningResult
from app.core.logging_utils import log_event


def is_high_confidence_match(
    *,
    candidate: dict[str, Any],
    normalized_label: str,
    normalize_label: Callable[[str], str],
) -> bool:
    title = str(candidate.get('title') or '').strip()
    if not title:
        return False
    candidate_norm = normalize_label(title)
    if candidate_norm == normalized_label:
        return True
    if normalized_label and normalized_label in candidate_norm:
        return True
    confidence = candidate.get('confidence')
    return isinstance(confidence, (int, float)) and float(confidence) >= 0.9


def passes_rename_autostage_gate(
    *,
    candidate: dict[str, Any],
    from_label: str,
    expected_node_type: str | None,
    normalize_label: Callable[[str], str],
) -> bool:
    if expected_node_type:
        candidate_type = str(candidate.get('type') or '').strip().lower()
        if candidate_type != expected_node_type.lower():
            return False
    normalized_label = normalize_label(from_label)
    title = str(candidate.get('title') or '').strip()
    candidate_norm = normalize_label(title)
    if candidate_norm == normalized_label:
        return True
    confidence = candidate.get('confidence')
    return isinstance(confidence, (int, float)) and float(confidence) >= 0.9


def resolve_retry_candidates(
    *,
    roadmap_id: str,
    label: str,
    expected_node_type: str | None,
    auth_header: str | None,
    trace_id: str | None,
    nest_client: Any,
    run_async_call: Callable[[Any], dict[str, Any]],
    normalize_label: Callable[[str], str],
    fallback_label: Callable[[str], str | None],
    is_high_confidence_match: Callable[..., bool],
) -> dict[str, Any]:
    auth_value = auth_header if isinstance(auth_header, str) and auth_header else None
    variants: list[str] = []
    primary = label.strip()
    if primary:
        variants.append(primary)
    normalized = normalize_label(primary)
    if normalized and normalized not in variants:
        variants.append(normalized)
    fallback = fallback_label(normalized or primary)
    if fallback and fallback not in variants:
        variants.append(fallback)
    variants = variants[:3]

    all_matches: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    tool_calls_used = 0
    for query in variants:
        tool_calls_used += 1
        result = run_async_call(
            nest_client.context_search(
                roadmap_id=roadmap_id,
                query=query,
                node_type=expected_node_type,
                limit=20,
                auth_header=auth_value,
                trace_id=trace_id,
            )
        )
        matches = result.get('matches', [])
        if not isinstance(matches, list):
            continue
        for raw in matches:
            if not isinstance(raw, dict):
                continue
            candidate_id = str(raw.get('id') or '').strip()
            if not candidate_id or candidate_id in seen_ids:
                continue
            seen_ids.add(candidate_id)
            all_matches.append(raw)

    normalized_label = normalize_label(label)
    high_confidence = [
        item
        for item in all_matches
        if is_high_confidence_match(
            candidate=item,
            normalized_label=normalized_label,
        )
    ]
    return {
        'matches': high_confidence or all_matches[:3],
        'tool_calls_used': tool_calls_used,
        'budget_exhausted': tool_calls_used >= 3 and len(all_matches) == 0,
    }


def attempt_retry_autostage(
    *,
    session: AgentSession,
    pending_context: PendingEditContext,
    trace_id: str | None,
    auth_header: str | None,
    logger: logging.Logger,
    settings: Any,
    utcnow: Callable[[], datetime],
    normalize_intent_family: Callable[[str | None], str],
    set_pending_edit_context: Callable[..., None],
    get_current_staged_operations_version: Callable[[AgentSession], int],
    resolve_retry_candidates: Callable[..., dict[str, Any]],
    normalize_label: Callable[[str], str],
    is_uuid: Callable[[str | None], bool],
    passes_rename_autostage_gate: Callable[..., bool],
) -> dict[str, Any]:
    hints = pending_context.resolver_hints or {}
    if pending_context.intent_family != 'rename_node':
        blocked_reason = 'retry_autostage_unsupported_intent_family'
        blocked_intent_family = normalize_intent_family(pending_context.intent_family)
        pending_context.last_retry_blocked_reason = blocked_reason
        pending_context.last_retry_blocked_intent_family = blocked_intent_family
        pending_context.updated_at = utcnow()
        set_pending_edit_context(
            session=session,
            context=pending_context,
            event='updated',
            trace_id=trace_id,
        )
        log_event(
            logger,
            'retry_autostage_unsupported_intent_family',
            settings=settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            blocked_reason=blocked_reason,
            blocked_intent_family=blocked_intent_family,
        )
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': blocked_reason,
            'blocked_intent_family': blocked_intent_family,
            'retry_autostage_applied': False,
        }
    if not isinstance(hints, dict):
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': 'retry_stale_hints_blocked',
            'retry_autostage_applied': False,
        }
    hint_version = hints.get('hint_intent_version')
    current_version = hints.get('intent_version')
    if (
        not isinstance(hint_version, int)
        or not isinstance(current_version, int)
        or hint_version != current_version
    ):
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': 'retry_stale_hints_blocked',
            'retry_autostage_applied': False,
        }
    if not bool(hints.get('retry_autostage_eligible')):
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': 'retry_stale_hints_blocked',
            'retry_autostage_applied': False,
        }
    hint_staged_version = hints.get('hint_staged_operations_version')
    current_staged_version = get_current_staged_operations_version(session)
    if (
        not isinstance(hint_staged_version, int)
        or hint_staged_version != current_staged_version
    ):
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': 'retry_stale_hints_blocked',
            'retry_autostage_applied': False,
        }

    from_label = str(hints.get('rename_from_label') or '').strip()
    to_title = str(hints.get('rename_to_title') or '').strip()
    if not from_label or not to_title:
        return {
            'planning': None,
            'tool_calls_used': 0,
            'blocked_reason': 'retry_stale_hints_blocked',
            'retry_autostage_applied': False,
        }

    retry_resolution = resolve_retry_candidates(
        roadmap_id=session.roadmap_id,
        label=from_label,
        expected_node_type=(
            str(hints.get('expected_node_type')).strip()
            if isinstance(hints.get('expected_node_type'), str)
            else None
        ),
        auth_header=auth_header,
        trace_id=trace_id,
    )
    candidates = retry_resolution['matches']
    tool_calls_used = retry_resolution['tool_calls_used']
    if retry_resolution['budget_exhausted']:
        return {
            'planning': PlanningResult(
                assistant_message=(
                    'I reached the retry lookup budget before resolving a safe single target. '
                    'Please choose one node by ID so I can continue.'
                ),
                operations=[],
                parse_mode='deterministic_retry_clarifier_budget',
                intent_type='roadmap_edit',
                response_mode='chat',
                preview_recommended=False,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code='retry_discovery_budget_exhausted',
                clarifier_action='ask_clarifier',
                clarifier_reason='retry_discovery_budget_exhausted',
                clarifier_options=[
                    'Provide exact node ID',
                    'Refine target label',
                    'Cancel',
                ],
            ),
            'tool_calls_used': tool_calls_used,
            'blocked_reason': None,
            'retry_autostage_applied': False,
        }
    pending_context.resolver_hints = {
        **hints,
        'last_label': from_label,
        'intent_family': pending_context.intent_family,
        'normalized_label': normalize_label(from_label),
        'candidate_ids': [item.get('id') for item in candidates if isinstance(item, dict)],
        'candidate_count': len(candidates),
        'hint_staged_operations_version': current_staged_version,
        'hint_intent_version': int(hints.get('intent_version') or 0),
    }
    pending_context.updated_at = utcnow()
    set_pending_edit_context(
        session=session,
        context=pending_context,
        event='updated',
        trace_id=trace_id,
    )

    if len(candidates) == 1:
        candidate = candidates[0]
        node_id = str(candidate.get('id') or '').strip() if isinstance(candidate, dict) else ''
        expected_node_type = (
            str(hints.get('expected_node_type')).strip()
            if isinstance(hints.get('expected_node_type'), str)
            else None
        )
        if is_uuid(node_id) and passes_rename_autostage_gate(
            candidate=candidate if isinstance(candidate, dict) else {},
            from_label=from_label,
            expected_node_type=expected_node_type,
        ):
            return {
                'planning': PlanningResult(
                    assistant_message=(
                        f'I found one strong match for "{from_label}" and staged the rename to "{to_title}".'
                    ),
                    operations=[
                        RoadmapOperation(
                            op='update_node',
                            node_id=node_id,
                            patch={'title': to_title},
                        )
                    ],
                    parse_mode='deterministic_retry_autostage',
                    intent_type='roadmap_edit',
                    response_mode='edit_plan',
                    preview_recommended=True,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code=None,
                    draft_action='continue',
                    tool_plan=[],
                    needs_more_info=False,
                    stop_reason='ready_to_stage',
                ),
                'tool_calls_used': tool_calls_used,
                'blocked_reason': None,
                'retry_autostage_applied': True,
            }

    if len(candidates) > 1:
        options: list[str] = []
        for index, item in enumerate(candidates[:3], start=1):
            if not isinstance(item, dict):
                continue
            title = str(item.get('title') or '').strip()
            node_type = str(item.get('type') or '').strip()
            node_id = str(item.get('id') or '').strip()
            if title and node_id:
                options.append(f'{index}. {node_type} "{title}" ({node_id})')
        if options:
            return {
                'planning': PlanningResult(
                    assistant_message=(
                        f'I found multiple matches for "{from_label}". '
                        'Reply with the option number to continue:\n' + '\n'.join(options)
                    ),
                    operations=[],
                    parse_mode='deterministic_retry_clarifier',
                    intent_type='roadmap_edit',
                    response_mode='chat',
                    preview_recommended=False,
                    provider_used='rule_based',
                    fallback_used=False,
                    provider_error_code='retry_multiple_matches',
                    clarifier_action='ask_clarifier',
                    clarifier_reason='retry_multiple_matches',
                    clarifier_options=options,
                ),
                'tool_calls_used': tool_calls_used,
                'blocked_reason': None,
                'retry_autostage_applied': False,
            }
    return {
        'planning': None,
        'tool_calls_used': tool_calls_used,
        'blocked_reason': None,
        'retry_autostage_applied': False,
    }
