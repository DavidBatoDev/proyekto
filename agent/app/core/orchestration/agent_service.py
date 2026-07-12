from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import (
    AgentSession,
    DraftNode,
    RecentResolvedTarget,
)
from app.core.logging_utils import log_event
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.shared.async_bridge import run_async_call
from app.core.orchestration.edits.draft_graph_manager import (
    ensure_draft_graph_initialized as ensure_draft_graph_initialized_helper,
    get_active_draft as get_active_draft_helper,
    get_active_draft_if_available as get_active_draft_if_available_helper,
    resolve_staged_state as resolve_staged_state_helper,
)
from app.core.orchestration.context.roadmap_overview_summarizer import (
    build_roadmap_overview_summary as build_roadmap_overview_summary_helper,
)
from app.core.orchestration.shared.operation_contracts import (
    operation_signature,
    read_operation_title,
    should_replace_staged_operations,
)
from app.core.orchestration.shared.outcomes import MessagePlanningOutcome
from app.core.orchestration.shared.planning_result import PlanningResult
from app.core.orchestration.context.recent_targets_manager import (
    append_recent_resolved_target as append_recent_resolved_target_helper,
    get_recent_resolved_targets as get_recent_resolved_targets_helper,
    is_recent_target_fresh as is_recent_target_fresh_helper,
    normalize_recent_target_node_type as normalize_recent_target_node_type_helper,
    prune_recent_resolved_targets as prune_recent_resolved_targets_helper,
    record_recent_targets_from_operations as record_recent_targets_from_operations_helper,
    record_recent_targets_from_preview as record_recent_targets_from_preview_helper,
)
from app.core.uuid_utils import is_uuid_like
from app.core.orchestration.context.session_context_builder import (
    build_session_context as build_session_context_helper,
)
from app.core.orchestration.context.session_runtime_access import (
    get_current_staged_operations as get_current_staged_operations_helper,
    get_current_staged_operations_version as get_current_staged_operations_version_helper,
    get_session_or_404 as get_session_or_404_helper,
    resolve_session_staged_state as resolve_session_staged_state_helper,
)
from app.core.session_store import SessionStore


def _utcnow() -> datetime:
    # Keep naive UTC timestamps while avoiding deprecated datetime.utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgentService:
    _ORDER_INSENSITIVE_SIGNATURE_FIELDS = {'tags'}
    _RECENT_TARGET_MAX_ITEMS = 20
    _RECENT_TARGET_MAX_AGE_HOURS = 24
    _RECENT_TARGET_SOURCE_PRIORITY = {
        'deictic_pre_resolver': 4,
        'staged_operations': 3,
        'commit_semantic_diff': 2,
        'context_tool': 1,
    }

    def __init__(self, store: SessionStore) -> None:
        self._settings = get_settings()
        self._store = store
        self._nest_client = NestRoadmapClient()
        self._logger = logging.getLogger(__name__)
        self._actor_refresh_failures_key = 'actor_context_refresh_failures'

    # ------------------------------------------------------------------
    # Public Entrypoints
    # ------------------------------------------------------------------
    def get_session_or_404(self, session_id: str) -> AgentSession:
        return get_session_or_404_helper(
            store=self._store,
            session_id=session_id,
        )

    def plan_message(
        self,
        session: AgentSession,
        user_message: str,
        replace: bool,
        auth_header: str | None = None,
        trace_id: str | None = None,
    ) -> MessagePlanningOutcome:
        # The v2 single-loop brain is the only path. Same MessagePlanningOutcome
        # envelope so the message route and auto-commit path are unchanged.
        from app.core.v2.brain import run_v2_message

        return run_v2_message(
            service=self,
            session=session,
            user_message=user_message,
            replace=replace,
            auth_header=auth_header,
            trace_id=trace_id,
            utcnow=_utcnow,
        )

    # ------------------------------------------------------------------
    # Operation Contract Helpers
    # ------------------------------------------------------------------
    def _operation_signature(self, operation: RoadmapOperation) -> str:
        return operation_signature(
            operation,
            order_insensitive_signature_fields=self._ORDER_INSENSITIVE_SIGNATURE_FIELDS,
        )

    def _should_replace_staged_operations(
        self,
        *,
        planning: PlanningResult,
    ) -> bool:
        return should_replace_staged_operations(planning=planning)

    def _read_operation_title(self, operation: RoadmapOperation) -> str | None:
        return read_operation_title(operation)

    def _is_uuid(self, value: str | None) -> bool:
        return is_uuid_like(value)

    # ------------------------------------------------------------------
    # Recent Target Helpers
    # ------------------------------------------------------------------
    def _normalize_recent_target_node_type(self, value: Any) -> str | None:
        return normalize_recent_target_node_type_helper(value)

    def _is_recent_target_fresh(self, target: RecentResolvedTarget) -> bool:
        return is_recent_target_fresh_helper(
            target,
            utcnow=_utcnow,
            max_age_hours=self._RECENT_TARGET_MAX_AGE_HOURS,
        )

    def _prune_recent_resolved_targets(
        self,
        targets: list[RecentResolvedTarget],
    ) -> list[RecentResolvedTarget]:
        return prune_recent_resolved_targets_helper(
            targets,
            is_recent_target_fresh=self._is_recent_target_fresh,
            max_items=self._RECENT_TARGET_MAX_ITEMS,
        )

    def _get_recent_resolved_targets(self, session: AgentSession) -> list[RecentResolvedTarget]:
        return get_recent_resolved_targets_helper(
            session,
            prune_recent_resolved_targets=self._prune_recent_resolved_targets,
        )

    def _append_recent_resolved_target(
        self,
        *,
        session: AgentSession,
        node_id: Any,
        node_type: Any,
        title: Any = None,
        label: Any = None,
        source: str = 'context_tool',
        confidence: float | None = None,
    ) -> None:
        append_recent_resolved_target_helper(
            session=session,
            node_id=node_id,
            node_type=node_type,
            title=title,
            label=label,
            source=source,
            confidence=confidence,
            normalize_recent_target_node_type=self._normalize_recent_target_node_type,
            is_uuid=self._is_uuid,
            get_recent_resolved_targets=self._get_recent_resolved_targets,
            prune_recent_resolved_targets=self._prune_recent_resolved_targets,
            utcnow=_utcnow,
        )

    def _record_recent_targets_from_operations(
        self,
        *,
        session: AgentSession,
        operations: list[RoadmapOperation],
        source: str,
    ) -> None:
        record_recent_targets_from_operations_helper(
            session=session,
            operations=operations,
            source=source,
            read_operation_title=self._read_operation_title,
            is_uuid=self._is_uuid,
            append_recent_resolved_target=self._append_recent_resolved_target,
        )

    def record_recent_targets_from_preview(
        self,
        *,
        session: AgentSession,
        preview_result: dict[str, Any],
        source: str = 'commit_semantic_diff',
    ) -> None:
        record_recent_targets_from_preview_helper(
            session=session,
            preview_result=preview_result,
            source=source,
            append_recent_resolved_target=self._append_recent_resolved_target,
        )

    # ------------------------------------------------------------------
    # Roadmap Overview And Async Bridge Helpers
    # ------------------------------------------------------------------
    def _ensure_roadmap_overview_summary(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        # Cached on session.metadata. Skip the backend call if we already have
        # it; it's invalidated on auto-commit success so the next turn refetches.
        if session.metadata.roadmap_overview_summary is not None:
            return
        if not auth_header or not session.roadmap_id:
            return
        summary, fresh_revision_token, handle_map = self._run_async_call(
            build_roadmap_overview_summary_helper(
                nest_client=self._nest_client,
                roadmap_id=session.roadmap_id,
                auth_header=auth_header,
                trace_id=trace_id,
            )
        )
        if summary:
            session.metadata.roadmap_overview_summary = summary
            session.metadata.roadmap_overview_summary_fetched_at = _utcnow()
            session.metadata.roadmap_handle_map = handle_map
            log_event(
                self._logger,
                'roadmap_overview_summary_loaded',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                session_id=session.session_id,
                summary_chars=len(summary),
                summary_lines=summary.count('\n') + 1,
                handle_map_size=len(handle_map),
                # Emit full summary so we can confirm post-commit freshness
                # end-to-end without guessing from a 240-char preview.
                summary_full=summary,
            )
        else:
            log_event(
                self._logger,
                'roadmap_overview_summary_fetch_empty',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                session_id=session.session_id,
                reason='backend_returned_no_summary',
            )
        # Refresh the preflight revision_token every time we fetch the
        # summary — the backend derives it from the latest `updated_at` on
        # the roadmap, so it captures any out-of-band writes (timeline
        # append, cache invalidation, another client, etc.) that would
        # otherwise trigger 409 STALE_REVISION on the next commit.
        if fresh_revision_token and session.revision_token != fresh_revision_token:
            previous_token = session.revision_token
            session.revision_token = fresh_revision_token
            log_event(
                self._logger,
                'roadmap_revision_token_refreshed',
                settings=self._settings,
                trace_id=trace_id,
                roadmap_id=session.roadmap_id,
                session_id=session.session_id,
                source='context_summary',
                previous_token=previous_token,
                current_token=fresh_revision_token,
            )

    def _ensure_memory_notes(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        """Fetch the roadmap's long-term memory notes (shared, durable
        preferences) and cache them on the session. Refetched on a short TTL
        so a collaborator's new note propagates within minutes."""
        if not auth_header or not session.roadmap_id:
            return
        fetched_at = session.metadata.memory_notes_fetched_at
        if session.metadata.memory_notes is not None and fetched_at is not None:
            age_seconds = (_utcnow() - fetched_at).total_seconds()
            if age_seconds < self._settings.agent_cache_ttl_seconds:
                return
        try:
            payload = self._run_async_call(
                self._nest_client.ai_memories_list(
                    roadmap_id=session.roadmap_id,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )
            )
        except Exception:  # noqa: BLE001 — notes are an enhancement
            return
        memories = payload.get('memories') if isinstance(payload, dict) else None
        if not isinstance(memories, list):
            return
        session.metadata.memory_notes = [
            {
                'id': str(item.get('id') or ''),
                'content': str(item.get('content') or ''),
                'source': str(item.get('source') or 'user_request'),
                'scope': str(item.get('scope') or 'roadmap'),
                'category': str(item.get('category') or 'preference'),
            }
            for item in memories
            if isinstance(item, dict) and item.get('content')
        ]
        session.metadata.memory_notes_fetched_at = _utcnow()
        log_event(
            self._logger,
            'memory_notes_loaded',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            session_id=session.session_id,
            note_count=len(session.metadata.memory_notes),
        )

    def invalidate_memory_notes(self, session: AgentSession) -> None:
        session.metadata.memory_notes = None
        session.metadata.memory_notes_fetched_at = None

    def _ensure_project_context(
        self,
        *,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> None:
        """Load the compact linked-project context into the Redis session.

        A fresh timestamp is sufficient to satisfy the cache, even when the
        value is ``None``. That negative-caches denied/projectless lookups and
        avoids retrying the same optional read on every turn.
        """
        if not self._settings.agent_project_context_enabled:
            # This must be a real kill switch for sessions created before the
            # flag changed, whose Redis payload may already contain a cache.
            session.metadata.project_context = None
            session.metadata.project_context_fetched_at = None
            return
        if not auth_header or not session.roadmap_id:
            return
        fetched_at = session.metadata.project_context_fetched_at
        if fetched_at is not None:
            age_seconds = (_utcnow() - fetched_at).total_seconds()
            if age_seconds < self._settings.agent_cache_ttl_seconds:
                return
        try:
            payload = self._run_async_call(
                self._nest_client.context_project(
                    roadmap_id=session.roadmap_id,
                    auth_header=auth_header,
                    trace_id=trace_id,
                )
            )
        except HTTPException as exc:
            if exc.status_code in {403, 404}:
                session.metadata.project_context = None
                session.metadata.project_context_fetched_at = _utcnow()
            return
        except Exception:  # noqa: BLE001 - project context is an enhancement
            return
        if not isinstance(payload, dict):
            return
        project = payload.get('project')
        if project is not None and not isinstance(project, dict):
            return
        # Keep {project: None}: it is the backend's projectless-roadmap
        # sentinel and lets the normal TTL guard negative-cache the result.
        session.metadata.project_context = payload
        session.metadata.project_context_fetched_at = _utcnow()
        log_event(
            self._logger,
            'project_context_loaded',
            settings=self._settings,
            trace_id=trace_id,
            roadmap_id=session.roadmap_id,
            session_id=session.session_id,
            project_linked=isinstance(project, dict),
        )

    def _run_async_call(self, coro: Any) -> dict[str, Any]:
        return run_async_call(
            coro,
            settings=self._settings,
            logger=self._logger,
        )

    # ------------------------------------------------------------------
    # Public Draft Graph Accessors
    # ------------------------------------------------------------------
    def ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return self._ensure_draft_graph_initialized(session)

    def get_active_draft(self, session: AgentSession) -> DraftNode:
        return self._get_active_draft(session)

    # ------------------------------------------------------------------
    # Draft Graph And Session Runtime Helpers
    # ------------------------------------------------------------------
    def _ensure_draft_graph_initialized(self, session: AgentSession) -> bool:
        return ensure_draft_graph_initialized_helper(session)

    def _get_active_draft(self, session: AgentSession) -> DraftNode:
        return get_active_draft_helper(session)

    def _get_active_draft_if_available(self, session: AgentSession) -> DraftNode | None:
        return get_active_draft_if_available_helper(session)

    def _resolve_staged_state(
        self,
        session: AgentSession,
        *,
        draft_graph_enabled: bool | None = None,
        active_draft: DraftNode | None = None,
    ) -> tuple[list[RoadmapOperation], int]:
        return resolve_session_staged_state_helper(
            session=session,
            draft_graph_enabled=draft_graph_enabled,
            active_draft=active_draft,
            settings_agent_draft_graph_enabled=False,
            resolve_staged_state=resolve_staged_state_helper,
        )

    def _get_current_staged_operations(self, session: AgentSession) -> list[RoadmapOperation]:
        return get_current_staged_operations_helper(
            session=session,
            resolve_staged_state=self._resolve_staged_state,
        )

    def _get_current_staged_operations_version(self, session: AgentSession) -> int:
        return get_current_staged_operations_version_helper(
            session=session,
            resolve_staged_state=self._resolve_staged_state,
        )

    def _build_session_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
    ) -> dict:
        return build_session_context_helper(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            settings=self._settings,
            get_active_draft_if_available=self._get_active_draft_if_available,
            get_recent_resolved_targets=self._get_recent_resolved_targets,
        )
