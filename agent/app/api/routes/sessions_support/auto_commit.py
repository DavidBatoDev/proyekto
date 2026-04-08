from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Awaitable, Callable

from fastapi.exceptions import HTTPException

from app.core.contracts.sessions import AgentSession, AppliedDraftCommit, RoadmapCommitArtifact
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore


@dataclass
class AutoCommitExecutionResult:
    auto_commit_ms: int
    staged_operations_version: int
    staged_operations_count: int
    active_draft_id: str | None
    active_draft_version: int | None
    artifact: RoadmapCommitArtifact | None
    inline_commit_size_bytes: int | None


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
    commit_result = await nest_client.commit(
        roadmap_id=session.roadmap_id,
        payload={
            'base_revision': session.base_revision,
            'revision_token': session.revision_token,
            'operations': [
                operation.model_dump(exclude_none=True)
                for operation in draft_operations
            ],
        },
        auth_header=auth_header,
        trace_id=trace_id,
    )
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

    artifact = build_commit_artifact(
        session,
        commit_result,
        change_id=change_id,
        status='applied',
    )
    inline_commit_size_bytes: int | None = None
    if artifact is not None:
        inline_payload = dict(commit_result)
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
            elapsed_ms=int((perf_counter() - started_at) * 1000),
        )
    except HTTPException as exc:
        log_event_fn(
            logger,
            'auto_commit_async_failed',
            settings=settings,
            trace_id=trace_id,
            session_id=session.session_id,
            roadmap_id=session.roadmap_id,
            auto_commit_error_code=extract_upstream_error_code(exc.detail),
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
