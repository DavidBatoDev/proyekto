from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Awaitable, Callable

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.common import extract_upstream_error_code
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, AppliedDraftCommit
from app.core.logging_utils import log_event
from app.core.orchestration.agent_service import AgentService
from app.core.orchestration.context.applied_changes_log import (
    record_applied_changes_from_commit,
)
from app.core.orchestration.context.pending_plan_manager import clear_pending_plan
from app.core.session_store import SessionStore
from app.core.uuid_utils import is_uuid_like

_commit_diagnostic_logger = logging.getLogger(__name__)


async def _refresh_revision_token_from_summary(
    *,
    nest_client: Any,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
) -> str | None:
    try:
        payload = await nest_client.context_summary(
            roadmap_id=session.roadmap_id,
            preview_id=None,
            auth_header=auth_header,
            trace_id=trace_id,
        )
    except Exception:  # noqa: BLE001 — refresh is best-effort
        return None
    if not isinstance(payload, dict):
        return None
    token = payload.get('revision_token')
    if isinstance(token, str) and token.strip():
        return token.strip()
    return None


def _log_stale_revision_retry(
    *,
    session: AgentSession,
    trace_id: str | None,
    stale_token: str | None,
    fresh_token: str | None,
    retry_outcome: str,
) -> None:
    log_event(
        _commit_diagnostic_logger,
        'auto_commit_stale_revision_retry',
        settings=None,
        trace_id=trace_id,
        session_id=session.session_id,
        roadmap_id=session.roadmap_id,
        stale_token=stale_token,
        fresh_token=fresh_token,
        retry_outcome=retry_outcome,
    )


@dataclass
class AutoCommitExecutionResult:
    auto_commit_ms: int
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None
    active_draft_version: int | None
    impacted_items: list[dict[str, Any]]
    impacted_item_count: int
    impacted_summary: dict[str, int]
    change_id: str | None
    semantic_diff_summary: dict[str, int]


def _sanitize_invalid_operation_snapshot(
    *,
    index: int,
    operation: RoadmapOperation,
    reason: str,
) -> dict[str, Any]:
    patch = operation.patch if isinstance(operation.patch, dict) else None
    payload = operation.model_dump(exclude_none=True)
    return {
        'index': index,
        'reason': reason,
        'op': operation.op.value,
        'node_type': operation.node_type.value if operation.node_type is not None else None,
        'node_id': operation.node_id,
        'node_ref': operation.node_ref,
        'patch_keys': sorted(patch.keys())[:20] if isinstance(patch, dict) else [],
        'operation': {
            key: payload.get(key)
            for key in (
                'op',
                'node_type',
                'node_id',
                'node_ref',
                'parent_id',
                'parent_ref',
                'new_parent_id',
                'new_parent_ref',
                'temp_id',
                'status',
                'delta_days',
            )
            if key in payload
        },
    }


def _first_invalid_operation_snapshot(draft_operations: list[Any]) -> dict[str, Any] | None:
    for index, operation in enumerate(draft_operations):
        if not isinstance(operation, RoadmapOperation):
            continue
        issues = operation.semantic_contract_issues(is_uuid=is_uuid_like)
        if not issues:
            continue
        return _sanitize_invalid_operation_snapshot(
            index=index,
            operation=operation,
            reason=issues[0],
        )
    return None


def _refresh_recent_resolved_target_titles(
    session: AgentSession,
    applied_operations: list[RoadmapOperation],
) -> None:
    """After a commit, update `recent_resolved_targets[*].title` for any node
    that was just renamed. Without this, a subsequent turn's system prompt
    still shows the pre-rename title and the LLM may resolve references by
    the obsolete name. Safe no-op when no renames were applied.
    """
    # Build { node_id → new_title } from this turn's applied operations.
    renames: dict[str, str] = {}
    for operation in applied_operations:
        op_value = getattr(operation.op, 'value', str(operation.op or ''))
        if op_value != 'update_node':
            continue
        node_id = operation.node_id
        patch = operation.patch
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if not isinstance(patch, dict):
            continue
        new_title = patch.get('title')
        if not isinstance(new_title, str) or not new_title.strip():
            continue
        renames[node_id] = new_title.strip()

    if not renames:
        return

    for target in session.metadata.recent_resolved_targets:
        new_title = renames.get(target.node_id)
        if new_title is None:
            continue
        target.title = new_title


def _log_commit_response_shape(
    *,
    commit_result: dict[str, Any],
    session_id: str,
    roadmap_id: str,
    trace_id: str | None,
) -> None:
    """Dump the structural fields of the backend commit response.

    Helps diagnose why `impacted_items` comes back empty — we need to see
    whether `semantic_diff.changes` is actually empty (backend diff bug) or
    whether the agent parser is mismatching the field shape.
    """
    semantic_diff = commit_result.get('semantic_diff')
    if isinstance(semantic_diff, dict):
        changes_raw = semantic_diff.get('changes')
        changes = changes_raw if isinstance(changes_raw, list) else []
        summary = semantic_diff.get('summary')
        # Log the first two changes in full so we can see the actual key names
        # the backend uses (node.id / node.type vs node_ref / etc).
        sample = changes[:2]
    else:
        changes = []
        summary = None
        sample = None
    _commit_diagnostic_logger.info(
        'commit_response_shape trace_id=%s session_id=%s roadmap_id=%s '
        'top_level_keys=%s semantic_diff_keys=%s '
        'semantic_diff_changes_count=%d semantic_diff_summary=%s '
        'semantic_diff_first_changes=%s',
        trace_id,
        session_id,
        roadmap_id,
        sorted(commit_result.keys()) if isinstance(commit_result, dict) else None,
        sorted(semantic_diff.keys()) if isinstance(semantic_diff, dict) else None,
        len(changes),
        summary,
        sample,
    )


def _extract_impacted_items_from_commit_result(commit_result: dict[str, Any]) -> list[dict[str, Any]]:
    semantic_diff = commit_result.get('semantic_diff')
    changes = semantic_diff.get('changes') if isinstance(semantic_diff, dict) else None
    if not isinstance(changes, list):
        return []

    impacted_items: list[dict[str, Any]] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        node = change.get('node')
        if not isinstance(node, dict):
            continue
        node_id = node.get('id')
        node_type_raw = node.get('type')
        if not isinstance(node_id, str) or not node_id.strip():
            continue
        if not isinstance(node_type_raw, str):
            continue
        node_type = node_type_raw.strip().lower()
        if node_type not in {'roadmap', 'epic', 'feature', 'task'}:
            continue

        change_type_raw = change.get('type')
        change_type = (
            change_type_raw.strip().upper()
            if isinstance(change_type_raw, str) and change_type_raw.strip()
            else None
        )
        if change_type == 'NODE_ADDED':
            impact = 'created'
        elif change_type == 'NODE_REMOVED':
            impact = 'deleted'
        else:
            impact = 'modified'

        title: str | None = None
        node_title = node.get('title')
        if isinstance(node_title, str) and node_title.strip():
            title = node_title.strip()
        else:
            for source in (change.get('to'), change.get('from')):
                if not isinstance(source, dict):
                    continue
                for key in ('title', 'name', 'node_title'):
                    raw_title = source.get(key)
                    if isinstance(raw_title, str) and raw_title.strip():
                        title = raw_title.strip()
                        break
                if title:
                    break

        impacted_items.append(
            {
                'node_id': node_id.strip(),
                'node_type': node_type,
                'title': title,
                'change_type': change_type,
                'impact': impact,
            }
        )

    return impacted_items


def _summarize_impacted_items(impacted_items: list[dict[str, Any]]) -> dict[str, int]:
    summary = {'created': 0, 'modified': 0, 'deleted': 0}
    for item in impacted_items:
        impact = item.get('impact')
        if impact in summary:
            summary[impact] += 1
    return summary


def schedule_auto_commit_task(
    *,
    task_set: set[asyncio.Task],
    coro: Awaitable[None],
) -> asyncio.Task:
    task = asyncio.create_task(coro)
    task_set.add(task)
    task.add_done_callback(task_set.discard)
    return task


async def execute_auto_commit(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
    nest_client: Any,
    resolve_draft_snapshot: Callable[[AgentSession, AgentService], tuple[str, int, list]],
    set_draft_status: Callable[..., bool],
    run_store_call: Callable[..., Awaitable[Any]],
) -> AutoCommitExecutionResult:
    draft_id, draft_version, draft_operations = resolve_draft_snapshot(
        session,
        agent_service,
    )

    commit_started = perf_counter()

    def _build_commit_payload() -> dict[str, Any]:
        return {
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'include_roadmap': False,
            'include_timeline': False,
            'operations': [
                operation.model_dump(exclude_none=True)
                for operation in draft_operations
            ],
        }

    def _is_stale_revision_409(exc: HTTPException) -> bool:
        if exc.status_code != 409:
            return False
        code = extract_upstream_error_code(exc.detail)
        if code == 'STALE_REVISION':
            return True
        if isinstance(exc.detail, dict):
            message = exc.detail.get('message')
            if (
                isinstance(message, str)
                and 'revision token' in message.lower()
            ):
                return True
        return False

    try:
        commit_result = await nest_client.commit(
            roadmap_id=session.roadmap_id,
            payload=_build_commit_payload(),
            auth_header=auth_header,
            trace_id=trace_id,
        )
        _log_commit_response_shape(
            commit_result=commit_result,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            trace_id=trace_id,
        )
    except HTTPException as exc:
        if exc.status_code == 400:
            invalid_snapshot = _first_invalid_operation_snapshot(draft_operations)
            if invalid_snapshot is not None:
                enriched_detail: dict[str, Any]
                if isinstance(exc.detail, dict):
                    enriched_detail = dict(exc.detail)
                else:
                    enriched_detail = {'detail': exc.detail}
                enriched_detail['_auto_commit_invalid_operation'] = invalid_snapshot
                raise HTTPException(
                    status_code=exc.status_code,
                    detail=enriched_detail,
                    headers=getattr(exc, 'headers', None),
                ) from exc
        if _is_stale_revision_409(exc):
            # Defense-in-depth against cross-request revision drift
            # (another client commit, a backend-side updated_at bump that
            # outran our session refresh). Re-fetch the authoritative
            # token via the same summary path the pre-dispatcher uses, and
            # retry the commit exactly once. With Prongs 1+2 in place this
            # should essentially never fire; if it does, the telemetry
            # exposes it.
            stale_token = session.revision_token
            fresh_token = await _refresh_revision_token_from_summary(
                nest_client=nest_client,
                session=session,
                auth_header=auth_header,
                trace_id=trace_id,
            )
            if fresh_token and fresh_token != stale_token:
                session.revision_token = fresh_token
                try:
                    commit_result = await nest_client.commit(
                        roadmap_id=session.roadmap_id,
                        payload=_build_commit_payload(),
                        auth_header=auth_header,
                        trace_id=trace_id,
                    )
                except HTTPException as retry_exc:
                    _log_stale_revision_retry(
                        session=session,
                        trace_id=trace_id,
                        stale_token=stale_token,
                        fresh_token=fresh_token,
                        retry_outcome='still_stale',
                    )
                    raise retry_exc from exc
                _log_stale_revision_retry(
                    session=session,
                    trace_id=trace_id,
                    stale_token=stale_token,
                    fresh_token=fresh_token,
                    retry_outcome='success',
                )
                _log_commit_response_shape(
                    commit_result=commit_result,
                    session_id=session.session_id,
                    roadmap_id=session.roadmap_id,
                    trace_id=trace_id,
                )
            else:
                _log_stale_revision_retry(
                    session=session,
                    trace_id=trace_id,
                    stale_token=stale_token,
                    fresh_token=fresh_token,
                    retry_outcome='no_fresh_token',
                )
                raise
        else:
            raise
    auto_commit_ms = int((perf_counter() - commit_started) * 1000)

    change_id_raw = commit_result.get('change_id')
    change_id = (
        str(change_id_raw).strip()
        if isinstance(change_id_raw, str) and str(change_id_raw).strip()
        else None
    )
    committed_revision_token = commit_result.get('revision_token')
    if isinstance(committed_revision_token, str):
        session.revision_token = committed_revision_token

    if change_id is not None:
        applied_change_ids_raw = session.metadata.applied_change_ids
        if isinstance(applied_change_ids_raw, list):
            applied_change_ids = [
                value
                for value in applied_change_ids_raw
                if isinstance(value, str) and value.strip()
            ]
        else:
            applied_change_ids = []
        if change_id not in applied_change_ids:
            applied_change_ids.append(change_id)
        session.metadata.applied_change_ids = applied_change_ids

    session.metadata.applied_draft_commits.append(
        AppliedDraftCommit(
            change_id=change_id,
            draft_id=draft_id,
            draft_version=draft_version,
            status='applied',
        )
    )

    record_recent_targets_from_preview = getattr(
        agent_service,
        'record_recent_targets_from_preview',
        None,
    )
    if callable(record_recent_targets_from_preview):
        record_recent_targets_from_preview(
            session=session,
            preview_result=commit_result,
            source='commit_semantic_diff',
        )

    set_draft_status(
        session=session,
        draft_id=draft_id,
        status='applied',
    )
    session.operations = []
    session.staged_operations_version += 1
    staged_operations_count = 0
    staged_operations_version = session.staged_operations_version
    active_draft_id: str | None = None
    active_draft_version: int | None = None

    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None
    # Snapshot titles before clearing the handle map: description/date-only
    # changes carry no title in the semantic diff, so the impacted-items
    # extraction below needs this to label the commit chip in the web.
    handle_titles_by_id: dict[str, str] = {}
    for entry in session.metadata.roadmap_handle_map.values():
        if isinstance(entry, dict):
            entry_id = entry.get('id')
            entry_title = entry.get('title')
            if isinstance(entry_id, str) and isinstance(entry_title, str) and entry_title:
                handle_titles_by_id[entry_id] = entry_title
    # The roadmap shape has changed — next turn's pre-dispatcher will refetch
    # the overview via the speculative path.
    session.metadata.roadmap_overview_summary = None
    session.metadata.roadmap_overview_summary_fetched_at = None
    session.metadata.roadmap_handle_map = {}
    # Keep recent_resolved_targets in sync with committed renames so the LLM
    # doesn't see a stale pre-rename title for an epic/feature/task it just
    # renamed in a previous turn.
    _refresh_recent_resolved_target_titles(session, draft_operations)
    # Record the committed changes onto the session so the planner's prompt
    # can reference them (enables deterministic undo/revert reasoning).
    record_applied_changes_from_commit(session, commit_result)
    # A successful commit implicitly resolves any pending plan the commit was
    # confirming — mark the plan confirmed via the cleared-event reason, then
    # drop it so the next turn doesn't replay the confirmation synthesizer.
    clear_pending_plan(
        session,
        reason='confirm_committed',
        logger=_commit_diagnostic_logger,
        settings=None,
        final_status='confirmed',
    )

    # No commit artifact is built: the web renders the "Committed changes"
    # confirmation from the lightweight commit_summary and refreshes the
    # canvas directly. We only surface the impacted items + semantic-diff
    # summary the confirmation needs.
    impacted_items = _extract_impacted_items_from_commit_result(commit_result)
    for item in impacted_items:
        if item.get('title') is None:
            item['title'] = handle_titles_by_id.get(item.get('node_id') or '')
    impacted_summary = _summarize_impacted_items(impacted_items)
    impacted_item_count = len(impacted_items)
    _semantic_diff = commit_result.get('semantic_diff')
    semantic_diff_summary = (
        _semantic_diff.get('summary')
        if isinstance(_semantic_diff, dict) and isinstance(_semantic_diff.get('summary'), dict)
        else {}
    )

    await run_store_call(store.update, session)
    return AutoCommitExecutionResult(
        auto_commit_ms=auto_commit_ms,
        staged_operations_version=staged_operations_version,
        staged_operations_count=staged_operations_count,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        impacted_items=impacted_items,
        impacted_item_count=impacted_item_count,
        impacted_summary=impacted_summary,
        change_id=change_id,
        semantic_diff_summary=semantic_diff_summary,
    )


async def run_auto_commit_in_background(
    *,
    store: SessionStore,
    agent_service: AgentService,
    session: AgentSession,
    auth_header: str,
    trace_id: str | None,
    execute_auto_commit_fn: Callable[..., Awaitable[AutoCommitExecutionResult]],
    extract_upstream_error_code: Callable[[object], str | None],
    extract_upstream_error_details: Callable[[object], dict[str, Any]] | None = None,
    logger: logging.Logger,
    settings: Any,
    log_event_fn: Callable[..., None],
) -> None:
    started_at = perf_counter()
    try:
        result = await execute_auto_commit_fn(
            store=store,
            agent_service=agent_service,
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
        )
        log_event_fn(
            logger,
            'auto_commit_async_completed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_ms=result.auto_commit_ms,
            staged_operations_count=result.staged_operations_count,
            staged_operations_version=result.staged_operations_version,
            active_draft_id=result.active_draft_id,
            active_draft_version=result.active_draft_version,
            impacted_items=result.impacted_items,
            impacted_item_count=result.impacted_item_count,
            impacted_summary=result.impacted_summary,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
    except HTTPException as exc:
        upstream_error_details = (
            extract_upstream_error_details(exc.detail)
            if callable(extract_upstream_error_details)
            else {}
        )
        upstream_error_code = extract_upstream_error_code(exc.detail)
        if not isinstance(upstream_error_code, str) or not upstream_error_code.strip():
            candidate_code = upstream_error_details.get('code')
            upstream_error_code = (
                candidate_code.strip()
                if isinstance(candidate_code, str) and candidate_code.strip()
                else None
            )
        log_event_fn(
            logger,
            'auto_commit_async_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_error_code=upstream_error_code,
            auto_commit_error_name=(
                upstream_error_details.get('error')
                if isinstance(upstream_error_details.get('error'), str)
                else None
            ),
            auto_commit_error_message=(
                upstream_error_details.get('message')
                if isinstance(upstream_error_details.get('message'), str)
                else None
            ),
            auto_commit_error_status_code=(
                upstream_error_details.get('status_code')
                if isinstance(upstream_error_details.get('status_code'), int)
                else None
            ),
            auto_commit_invalid_operation=(
                upstream_error_details.get('invalid_operation')
                if isinstance(upstream_error_details.get('invalid_operation'), dict)
                else None
            ),
            auto_commit_error_retryable=(
                exc.status_code >= 500 or exc.status_code in {408, 429}
            ),
            auto_commit_error_upstream_status=exc.status_code,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
    except Exception:
        logger.exception(
            'Async auto-commit failed. session_id=%s roadmap_id=%s',
            session.session_id,
            session.roadmap_id,
        )
        log_event_fn(
            logger,
            'auto_commit_async_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_error_code='INTERNAL_ERROR',
            auto_commit_error_retryable=True,
            auto_commit_error_upstream_status=None,
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
