from __future__ import annotations

import re
from typing import Any, Callable

from app.core.contracts.sessions import AgentSession, RecentResolvedTarget
from app.core.llm.clarifier_contract import build_clarifier_contract
from app.core.llm.client import PlanningResult


def looks_like_deictic_parent_reference(
    user_message: str,
    *,
    deictic_parent_pattern: re.Pattern[str],
) -> bool:
    normalized = str(user_message or '').strip()
    if not normalized:
        return False
    return bool(deictic_parent_pattern.search(normalized))


def infer_required_parent_node_type(
    user_message: str,
    *,
    extract_create_intent: Callable[[str], Any],
) -> str | None:
    create_intent = extract_create_intent(user_message)
    if create_intent is not None:
        if create_intent.node_type == 'feature':
            return 'epic'
        if create_intent.node_type == 'task':
            return 'feature'

    lowered = user_message.strip().lower()
    if re.search(r'\bfeature(?:s)?\b', lowered):
        return 'epic'
    if re.search(r'\btask(?:s)?\b', lowered):
        return 'feature'
    return None


def resolve_deictic_parent_reference(
    *,
    session: AgentSession,
    user_message: str,
    looks_like_deictic_parent_reference: Callable[[str], bool],
    infer_required_parent_node_type: Callable[[str], str | None],
    get_recent_resolved_targets: Callable[[AgentSession], list[RecentResolvedTarget]],
    recent_target_rank: Callable[[RecentResolvedTarget], tuple[Any, float, int]],
) -> dict[str, Any] | None:
    if not looks_like_deictic_parent_reference(user_message):
        return None

    required_parent_type = infer_required_parent_node_type(user_message)
    recent_targets = get_recent_resolved_targets(session)
    if not recent_targets:
        return None

    ranked_targets = sorted(
        recent_targets,
        key=recent_target_rank,
        reverse=True,
    )

    candidates_by_id: dict[str, RecentResolvedTarget] = {}
    for target in ranked_targets:
        if required_parent_type is not None and target.node_type != required_parent_type:
            continue
        if target.node_id in candidates_by_id:
            continue
        candidates_by_id[target.node_id] = target

    if not candidates_by_id:
        return None

    candidates = list(candidates_by_id.values())
    if len(candidates) == 1:
        target = candidates[0]
        return {
            'status': 'resolved',
            'node_id': target.node_id,
            'node_type': target.node_type,
            'title': target.title,
            'label': target.label,
        }

    return {
        'status': 'ambiguous',
        'required_parent_type': required_parent_type,
        'candidates': [
            {
                'node_id': target.node_id,
                'node_type': target.node_type,
                'title': target.title,
                'label': target.label,
            }
            for target in candidates[:5]
        ],
    }


def build_deictic_ambiguity_planning(
    *,
    deictic_resolution: dict[str, Any],
    normalize_recent_target_node_type: Callable[[Any], str | None],
    is_uuid: Callable[[str | None], bool],
) -> PlanningResult:
    candidates_raw = deictic_resolution.get('candidates')
    required_parent_type = normalize_recent_target_node_type(
        deictic_resolution.get('required_parent_type')
    )
    option_candidates: list[str] = []
    if isinstance(candidates_raw, list):
        for candidate in candidates_raw[:3]:
            if not isinstance(candidate, dict):
                continue
            node_type = normalize_recent_target_node_type(candidate.get('node_type'))
            node_id = str(candidate.get('node_id') or '').strip()
            if not is_uuid(node_id):
                continue
            title = str(candidate.get('title') or candidate.get('label') or '').strip()
            display_type = node_type.title() if node_type else 'Node'
            if title:
                option_candidates.append(f'{display_type}: {title} ({node_id})')
            else:
                option_candidates.append(f'{display_type}: {node_id}')

    options = option_candidates + ['Provide node ID', 'Cancel']
    if required_parent_type is not None:
        question = (
            'I found multiple recent targets for "that". '
            f'Which {required_parent_type} should I use as the parent?'
        )
    else:
        question = 'I found multiple recent targets for "that". Which target should I use as the parent?'

    message, normalized_options = build_clarifier_contract(
        reason='deictic_target_ambiguous',
        question=question,
        options=options,
    )
    return PlanningResult(
        assistant_message=message,
        operations=[],
        parse_mode='deterministic_deictic_target_ambiguous',
        intent_type='roadmap_edit',
        response_mode='chat',
        preview_recommended=False,
        provider_used='rule_based',
        fallback_used=False,
        provider_error_code='deictic_target_ambiguous',
        clarifier_action='ask_clarifier',
        clarifier_reason='deictic_target_ambiguous',
        clarifier_options=normalized_options,
        draft_action='continue',
        tool_plan=[],
        needs_more_info=True,
        stop_reason='awaiting_user_input',
    )
