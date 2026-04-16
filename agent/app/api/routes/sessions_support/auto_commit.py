from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Awaitable, Callable

from fastapi.exceptions import HTTPException

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, AppliedDraftCommit, RoadmapCommitArtifact
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore
from app.core.uuid_utils import is_uuid_like


@dataclass
class AutoCommitExecutionResult:
    auto_commit_ms: int
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None
    active_draft_version: int | None
    artifact: RoadmapCommitArtifact | None
    inline_commit_size_bytes: int | None
    impacted_items: list[dict[str, Any]]
    impacted_item_count: int
    impacted_summary: dict[str, int]


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


def _compact_inline_commit_payload(commit_result: dict[str, Any]) -> dict[str, Any]:
    compact_payload: dict[str, Any] = {}
    for key in (
        'change_id',
        'committed_at',
        'revision_token',
        'semantic_diff',
        'candidate_snapshot',
        'operation_results',
    ):
        value = commit_result.get(key)
        if value is None:
            continue
        compact_payload[key] = value
    return compact_payload


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
    draft_graph_enabled: bool,
    resolve_draft_snapshot: Callable[[AgentSession, AgentService], tuple[str, int, list]],
    reuse_selected_draft_as_post_commit_head: Callable[..., int],
    set_draft_status: Callable[..., bool],
    build_commit_artifact: Callable[..., RoadmapCommitArtifact | None],
    serialized_payload_bytes: Callable[[dict[str, Any]], int],
    run_store_call: Callable[..., Awaitable[Any]],
) -> AutoCommitExecutionResult:
    draft_id, draft_version, draft_operations = resolve_draft_snapshot(
        session,
        agent_service,
    )

    commit_started = perf_counter()
    commit_payload = {
        'base_revision': session.base_revision,
        'revision_token': session.revision_token,
        'include_roadmap': False,
        'include_timeline': False,
        'operations': [
            operation.model_dump(exclude_none=True)
            for operation in draft_operations
        ],
    }
    try:
        commit_result = await nest_client.commit(
            roadmap_id=session.roadmap_id,
            payload=commit_payload,
            auth_header=auth_header,
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

    staged_operations_count: int
    staged_operations_version: int
    active_draft_id: str | None
    active_draft_version: int | None
    if draft_graph_enabled:
        agent_service.ensure_draft_graph_initialized(session)
        next_draft_version = reuse_selected_draft_as_post_commit_head(
            session,
            selected_draft_id=draft_id,
        )
        staged_operations_count = 0
        staged_operations_version = next_draft_version
        active_draft_id = draft_id
        active_draft_version = next_draft_version
    else:
        set_draft_status(
            session=session,
            draft_id=draft_id,
            status='applied',
        )
        session.operations = []
        session.staged_operations_version += 1
        staged_operations_count = 0
        staged_operations_version = session.staged_operations_version
        active_draft_id = None
        active_draft_version = None

    session.metadata.pending_context_resolution = None
    session.metadata.pending_edit_context = None
    # The roadmap shape has changed — next turn's pre-dispatcher will refetch
    # the overview via the speculative path.
    session.metadata.roadmap_overview_summary = None
    session.metadata.roadmap_overview_summary_fetched_at = None

    artifact = build_commit_artifact(
        session,
        commit_result,
        change_id=change_id,
        status='applied',
    )
    if artifact is not None and artifact.impacted_items:
        impacted_items = [item.model_dump(exclude_none=True) for item in artifact.impacted_items]
    else:
        impacted_items = _extract_impacted_items_from_commit_result(commit_result)
    impacted_summary = _summarize_impacted_items(impacted_items)
    impacted_item_count = len(impacted_items)
    inline_commit_size_bytes: int | None = None
    if artifact is not None:
        inline_payload = _compact_inline_commit_payload(commit_result)
        inline_commit_size_bytes = serialized_payload_bytes(inline_payload)
        inline_artifact = artifact.model_copy(update={'inline_commit': inline_payload})
        session.artifacts.append(inline_artifact)
        artifact = inline_artifact

    await run_store_call(store.update, session)
    return AutoCommitExecutionResult(
        auto_commit_ms=auto_commit_ms,
        staged_operations_version=staged_operations_version,
        staged_operations_count=staged_operations_count,
        active_draft_id=active_draft_id,
        active_draft_version=active_draft_version,
        artifact=artifact,
        inline_commit_size_bytes=inline_commit_size_bytes,
        impacted_items=impacted_items,
        impacted_item_count=impacted_item_count,
        impacted_summary=impacted_summary,
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
            inline_commit_size_bytes=result.inline_commit_size_bytes,
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
