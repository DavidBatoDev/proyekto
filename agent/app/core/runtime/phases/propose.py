"""Propose phase — deterministic: records the proposal the investigate loop
produced (a ``propose`` / ``revise_proposal`` call, or ``stage_edits`` batches
the checkpoint policy sent for confirmation) as the session's pending plan.

No model call happens here. The titles-to-operations work for ``kind='plan'``
proposals happens in execute ("materialize"), exactly where today's confirm
turn does it; ``kind='edits'`` proposals carry concrete operations already.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.contracts.runs import RunBatch
from app.core.contracts.sessions import AgentSession
from app.core.logging_utils import log_event
from app.core.memory.pending_plan_manager import record_pending_plan_from_planner_output
from app.core.runtime import context_cache
from app.core.runtime.handles import handle_map_for_roadmap
from app.core.runtime.operation_contracts import read_operation_title
from app.core.runtime.results import PhaseOutcome

logger = logging.getLogger(__name__)

DEFAULT_PROPOSAL_MESSAGE = 'Here is a proposed plan for your review.'
DEFAULT_REVISION_MESSAGE = 'Updated the proposed plan.'
DEFAULT_EDITS_MESSAGE = 'Here are the edits I would make; confirm to apply them.'
NO_PLAN_TO_REVISE_MESSAGE = 'I could not find a plan to revise.'


def run(ctx: Any, session: AgentSession, run_state: Any, outcome: PhaseOutcome) -> PhaseOutcome:
    """Record the proposal carried by ``outcome`` (an investigate outcome of
    kind ``proposal`` or ``batches``)."""
    if outcome.kind == 'batches':
        return record_edits_proposal(ctx, session, run_state, outcome.batches, outcome.assistant_message)
    if outcome.intent_type == 'plan_revision':
        return record_revision(ctx, session, run_state, outcome)
    return record_plan_proposal(ctx, session, run_state, outcome.proposal_payload or {}, outcome.assistant_message)


# ---------------------------------------------------------------------------
# propose (kind='plan')
# ---------------------------------------------------------------------------


def _error(code: str, message: str) -> PhaseOutcome:
    return PhaseOutcome(kind='error', error={'code': code, 'message': message})


def normalize_targets(
    ctx: Any, session: AgentSession, run_state: Any, payload: dict[str, Any]
) -> list[dict[str, Any]] | PhaseOutcome:
    """``targets[]`` with every roadmap loadable; absent targets default to
    the focus roadmap with the top-level ``proposed_hierarchy``."""
    raw_targets = payload.get('targets')
    targets: list[dict[str, Any]] = []
    if isinstance(raw_targets, list):
        for entry in raw_targets:
            if not isinstance(entry, dict):
                continue
            roadmap_id = str(entry.get('roadmap_id') or '').strip()
            if not roadmap_id:
                continue
            hierarchy = entry.get('proposed_hierarchy')
            targets.append(
                {
                    'roadmap_id': roadmap_id,
                    'roadmap_title': entry.get('roadmap_title'),
                    'proposed_hierarchy': hierarchy if isinstance(hierarchy, list) else [],
                }
            )
    focus = session.scope.focus_roadmap_id
    if not targets:
        if not focus:
            return _error(
                'PROPOSAL_TARGET_REQUIRED',
                'There is no focus roadmap in this session: pass `targets` with the '
                'roadmap_id of every existing roadmap the plan applies to (use '
                'list_roadmaps or get_roadmap_overview to find ids).',
            )
        hierarchy = payload.get('proposed_hierarchy')
        targets = [
            {
                'roadmap_id': focus,
                'roadmap_title': None,
                'proposed_hierarchy': hierarchy if isinstance(hierarchy, list) else [],
            }
        ]
    deps = ctx.cache_deps()
    for target in targets:
        roadmap_id = target['roadmap_id']
        context = context_cache.load_roadmap(
            session=session,
            roadmap_id=roadmap_id,
            as_focus=(roadmap_id == focus),
            run=run_state,
            reason='proposal_target',
            **deps,
        )
        if context is None:
            context = session.metadata.roadmaps.get(roadmap_id)
        if context is None:
            return _error(
                'PROPOSAL_TARGET_INACCESSIBLE',
                f'Roadmap {roadmap_id} could not be loaded (it may not exist or you may '
                'not have access). Every target must be an existing roadmap the user can '
                'access; drop it or pick another with list_roadmaps.',
            )
        if roadmap_id not in run_state.focus_roadmap_ids:
            run_state.focus_roadmap_ids.append(roadmap_id)
        target['roadmap_title'] = target.get('roadmap_title') or context.title
        target['project_id'] = context.project_id
    return targets


def record_plan_proposal(
    ctx: Any,
    session: AgentSession,
    run_state: Any,
    payload: dict[str, Any],
    assistant_message: str = '',
) -> PhaseOutcome:
    targets = normalize_targets(ctx, session, run_state, dict(payload))
    if isinstance(targets, PhaseOutcome):
        return targets
    body = dict(payload)
    body.pop('targets', None)
    body['status'] = 'plan_ready'
    body['kind'] = 'plan'
    body['targets'] = targets
    body['proposed_hierarchy'] = targets[0]['proposed_hierarchy']
    body['run_id'] = run_state.run_id
    plan = record_pending_plan_from_planner_output(
        session,
        payload=body,
        user_message=run_state.user_message,
        trace_id=ctx.trace_id,
        logger=ctx.logger,
        settings=ctx.settings,
        intent_type='roadmap_plan',
    )
    if plan is None:
        return _error(
            'PROPOSAL_INVALID',
            'The proposal could not be recorded: it needs a summary, a goal and at '
            'least one epic title per target roadmap.',
        )
    run_state.batches = []
    return _recorded(ctx, session, run_state, plan, assistant_message or DEFAULT_PROPOSAL_MESSAGE, 'roadmap_plan')


def record_revision(ctx: Any, session: AgentSession, run_state: Any, outcome: PhaseOutcome) -> PhaseOutcome:
    """Merge revision ops into the pending plan. Degrades to chat when there is
    no prior proposed plan to revise."""
    existing = session.metadata.pending_plan
    if existing is None or not outcome.revision_operations:
        return PhaseOutcome(kind='chat', assistant_message=NO_PLAN_TO_REVISE_MESSAGE)
    try:
        payload = existing.model_dump(mode='json', exclude_none=True)
        payload['status'] = 'plan_ready'
        payload['revision_operations'] = list(outcome.revision_operations)
        payload['run_id'] = run_state.run_id
        plan = record_pending_plan_from_planner_output(
            session,
            payload=payload,
            user_message=run_state.user_message,
            trace_id=ctx.trace_id,
            logger=ctx.logger,
            settings=ctx.settings,
            intent_type='plan_revision',
        )
    except Exception:  # pragma: no cover - revision is best-effort
        plan = None
    if plan is None:
        return PhaseOutcome(kind='chat', assistant_message=NO_PLAN_TO_REVISE_MESSAGE)
    return _recorded(ctx, session, run_state, plan, outcome.assistant_message or DEFAULT_REVISION_MESSAGE, 'plan_revision')


# ---------------------------------------------------------------------------
# stage_edits batches that need confirmation (kind='edits')
# ---------------------------------------------------------------------------


def record_edits_proposal(
    ctx: Any,
    session: AgentSession,
    run_state: Any,
    batches: list[RunBatch],
    assistant_message: str = '',
) -> PhaseOutcome:
    targets: list[dict[str, Any]] = []
    for batch in batches:
        if batch.roadmap_id not in run_state.focus_roadmap_ids:
            run_state.focus_roadmap_ids.append(batch.roadmap_id)
        context = session.metadata.roadmaps.get(batch.roadmap_id)
        handle_map = handle_map_for_roadmap(session, batch.roadmap_id)
        operations = [op.model_dump(mode='json', exclude_none=True) for op in batch.operations]
        targets.append(
            {
                'roadmap_id': batch.roadmap_id,
                'roadmap_title': batch.roadmap_title or (context.title if context is not None else None),
                'project_id': context.project_id if context is not None else None,
                'operations': operations,
                'summary_lines': describe_operations(batch.operations, handle_map),
                'operations_count': len(operations),
                'contains_delete': batch.contains_delete,
                'proposed_hierarchy': derive_hierarchy(batch.operations, handle_map),
            }
        )
    if not targets:
        return _error('PROPOSAL_INVALID', 'Nothing to propose.')
    summary = (assistant_message or '').strip() or _auto_summary(targets)
    body = {
        'status': 'plan_ready',
        'kind': 'edits',
        'targets': targets,
        'proposed_hierarchy': targets[0]['proposed_hierarchy'],
        'summary': summary,
        'goal': run_state.user_message or summary,
        'run_id': run_state.run_id,
    }
    plan = record_pending_plan_from_planner_output(
        session,
        payload=body,
        user_message=run_state.user_message,
        trace_id=ctx.trace_id,
        logger=ctx.logger,
        settings=ctx.settings,
        intent_type='roadmap_edit',
    )
    if plan is None:
        return _error('PROPOSAL_INVALID', 'The edits could not be recorded as a proposal.')
    # Re-created from pending_plan.targets on confirm, so a superseding
    # message never executes stale batches.
    run_state.batches = []
    return _recorded(ctx, session, run_state, plan, summary or DEFAULT_EDITS_MESSAGE, 'roadmap_edit')


def _recorded(ctx: Any, session: AgentSession, run_state: Any, plan: Any, message: str, intent_type: str) -> PhaseOutcome:
    run_state.plan_id = plan.plan_id
    log_event(
        logger,
        'run_checkpoint',
        settings=ctx.settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        phase='propose',
        checkpoint='proposal',
        plan_id=plan.plan_id,
    )
    return PhaseOutcome(
        kind='proposal',
        assistant_message=message,
        proposal_payload=plan.model_dump(mode='json', exclude_none=True),
        intent_type=intent_type,
    )


def _auto_summary(targets: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for target in targets:
        count = int(target.get('operations_count') or 0)
        title = target.get('roadmap_title') or target.get('roadmap_id')
        parts.append(f'{count} change{"s" if count != 1 else ""} to "{title}"')
    return 'Proposed ' + '; '.join(parts) + '.'


# ---------------------------------------------------------------------------
# Operation descriptions (the proposal card)
# ---------------------------------------------------------------------------


def _title_of(handle_map: dict[str, dict[str, Any]], node_id: str | None) -> str | None:
    if not node_id:
        return None
    for entry in handle_map.values():
        if isinstance(entry, dict) and entry.get('id') == node_id:
            title = entry.get('title')
            return title if isinstance(title, str) and title.strip() else None
    return None


def _node_type_of(operation: Any) -> str:
    node_type = getattr(operation, 'node_type', None)
    if node_type is None:
        return 'item'
    return str(getattr(node_type, 'value', node_type))


def describe_operations(operations: list[Any], handle_map: dict[str, dict[str, Any]] | None = None) -> list[str]:
    """Human lines for the proposal card, one per operation."""
    handle_map = handle_map or {}
    lines: list[str] = []
    for op in operations:
        name = str(getattr(op.op, 'value', op.op))
        title = read_operation_title(op)
        node_title = title or _title_of(handle_map, getattr(op, 'node_id', None))
        label = f'"{node_title}"' if node_title else 'an item'
        node_type = _node_type_of(op)
        if name in {'add_epic', 'add_feature', 'add_task', 'add_milestone'}:
            lines.append(f'Add {name[4:]} {label}')
        elif name == 'delete_node':
            targets = getattr(op, 'targets', None)
            extra = f' and {len(targets)} more' if isinstance(targets, list) and targets else ''
            lines.append(f'Delete {node_type} {label}{extra}')
        elif name == 'update_node':
            patch = getattr(op, 'patch', None)
            fields = ', '.join(sorted(patch.keys())) if isinstance(patch, dict) and patch else 'fields'
            new_title = patch.get('title') if isinstance(patch, dict) else None
            if isinstance(new_title, str) and new_title.strip():
                lines.append(f'Rename {node_type} {label} to "{new_title.strip()}"')
            else:
                lines.append(f'Update {node_type} {label} ({fields})')
        elif name == 'move_node':
            lines.append(f'Move {node_type} {label}')
        elif name == 'mark_status':
            status = getattr(op, 'status', None)
            lines.append(f'Mark {node_type} {label} as {status or "updated"}')
        elif name == 'shift_dates':
            delta = getattr(op, 'delta_days', None)
            lines.append(f'Shift dates of {node_type} {label} by {delta} day(s)')
        else:
            lines.append(f'{name.replace("_", " ").capitalize()} {label}')
    return lines


def derive_hierarchy(operations: list[Any], handle_map: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Epics/features/tasks the ``add_*`` ops create, so the legacy plan card
    renders creates (deletes/updates appear in ``summary_lines``)."""
    handle_map = handle_map or {}
    epics: list[dict[str, Any]] = []
    epic_by_temp: dict[str, dict[str, Any]] = {}
    epic_by_id: dict[str, dict[str, Any]] = {}
    feature_by_temp: dict[str, dict[str, Any]] = {}
    feature_by_id: dict[str, dict[str, Any]] = {}

    def _existing_epic(node_id: str | None) -> dict[str, Any]:
        entry = epic_by_id.get(node_id or '')
        if entry is None:
            title = _title_of(handle_map, node_id) or 'Existing epic'
            entry = {'title': title, 'features': []}
            epics.append(entry)
            if node_id:
                epic_by_id[node_id] = entry
        return entry

    def _existing_feature(node_id: str | None) -> dict[str, Any]:
        entry = feature_by_id.get(node_id or '')
        if entry is None:
            title = _title_of(handle_map, node_id) or 'Existing feature'
            entry = {'title': title, 'tasks': []}
            host = _existing_epic(None)
            host['features'].append(entry)
            if node_id:
                feature_by_id[node_id] = entry
        return entry

    for op in operations:
        name = str(getattr(op.op, 'value', op.op))
        title = read_operation_title(op)
        if not title:
            continue
        data = getattr(op, 'data', None) if isinstance(getattr(op, 'data', None), dict) else {}
        description = data.get('description') if isinstance(data.get('description'), str) else None
        temp_id = getattr(op, 'temp_id', None)
        if name == 'add_epic':
            entry = {'title': title, 'description': description, 'features': []}
            epics.append(entry)
            if temp_id:
                epic_by_temp[temp_id] = entry
        elif name == 'add_feature':
            parent_ref = getattr(op, 'parent_ref', None)
            parent = epic_by_temp.get(parent_ref) if parent_ref else None
            if parent is None:
                parent = _existing_epic(getattr(op, 'parent_id', None))
                entry = {'title': title, 'description': description, 'tasks': [], 'target_epic_title': parent['title']}
            else:
                entry = {'title': title, 'description': description, 'tasks': []}
            parent['features'].append(entry)
            if temp_id:
                feature_by_temp[temp_id] = entry
        elif name == 'add_task':
            parent_ref = getattr(op, 'parent_ref', None)
            parent = feature_by_temp.get(parent_ref) if parent_ref else None
            if parent is None:
                parent = _existing_feature(getattr(op, 'parent_id', None))
                entry = {'title': title, 'description': description, 'target_feature_title': parent['title']}
            else:
                entry = {'title': title, 'description': description}
            status = data.get('status')
            if isinstance(status, str):
                entry['status'] = status
            parent['tasks'].append(entry)
    return epics
