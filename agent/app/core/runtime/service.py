"""The per-process runtime service — the DI root the session routes resolve —
and the per-request ``StepContext`` the orchestrator and the phases share.

``RuntimeService`` holds the session store, the NestJS client, settings and a
logger, and threads them into the memory helpers (recent targets), the
context caches and the sync->async bridge. ``StepContext`` adds what one HTTP
request needs: the forwarded auth, the trace id, the time budget (soft step
budget / hard deadline / batch reserve), the cancel probe and the per-step
accumulators ``finalize_step`` reads.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from time import monotonic
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, RecentResolvedTarget
from app.core.memory.recent_targets import (
    append_recent_resolved_target as append_recent_resolved_target_helper,
    get_recent_resolved_targets as get_recent_resolved_targets_helper,
    is_recent_target_fresh as is_recent_target_fresh_helper,
    normalize_recent_target_node_type as normalize_recent_target_node_type_helper,
    prune_recent_resolved_targets as prune_recent_resolved_targets_helper,
    record_recent_targets_from_operations as record_recent_targets_from_operations_helper,
    record_recent_targets_from_preview as record_recent_targets_from_preview_helper,
)
from app.core.nest_client import NestRoadmapClient
from app.core.runtime import context_cache
from app.core.runtime.async_bridge import run_async_call
from app.core.runtime.operation_contracts import read_operation_title
from app.core.runtime.prompt import build_turn_context
from app.core.session_store import SessionStore, SessionStoreUnavailableError
from app.core.uuid_utils import is_uuid_like


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def session_not_found(session_id: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            'code': 'SESSION_NOT_FOUND',
            'message': f'Session {session_id} was not found or has expired.',
        },
    )


# ---------------------------------------------------------------------------
# Ownership (owner_key = the actor id, or "Guest <id>")
# ---------------------------------------------------------------------------


def _jwt_subject(token: str) -> str | None:
    """The `sub` claim of a JWT, decoded WITHOUT verification. The backend
    verifies the token on every call the agent makes with it; here it only
    identifies the caller for the session-ownership check (a forged token
    cannot read anything through the backend)."""
    parts = token.split('.')
    if len(parts) < 2:
        return None
    segment = parts[1].strip()
    if not segment:
        return None
    try:
        padded = segment + '=' * (-len(segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode('ascii')).decode('utf-8'))
    except Exception:  # noqa: BLE001 — not a JWT
        return None
    subject = payload.get('sub') if isinstance(payload, dict) else None
    return subject.strip() if isinstance(subject, str) and subject.strip() else None


def owner_key_from_auth(auth_header: str | None, *, actor_id: str | None = None) -> str | None:
    """The owner key a forwarded auth value identifies: ``Guest <id>`` for a
    guest, the verified ``actor_id`` when the caller supplied one, else the
    bearer token's subject. None when the caller cannot be identified."""
    if not isinstance(auth_header, str) or not auth_header.strip():
        return None
    value = auth_header.strip()
    if value.lower().startswith('guest '):
        guest_id = value[6:].strip()
        return f'Guest {guest_id}' if guest_id else None
    if actor_id:
        return actor_id
    token = value[7:].strip() if value.lower().startswith('bearer ') else value
    return _jwt_subject(token)


def caller_matches_owner(auth_header: str | None, session: AgentSession) -> bool:
    """True when the forwarded auth identifies the session's owner. Sessions
    created before ownership was recorded adopt the first identified caller."""
    caller = owner_key_from_auth(auth_header)
    if not session.owner_key:
        if caller:
            session.owner_key = caller
        return True
    if caller is None:
        return False
    if caller == session.owner_key:
        return True
    actor = session.metadata.actor_context
    # A bearer whose subject is the recorded actor (owner_key came from the
    # verified actor fetch at create time).
    return actor is not None and actor.actor_id == caller and session.owner_key == actor.actor_id


class RuntimeService:
    _RECENT_TARGET_MAX_ITEMS = 20
    _RECENT_TARGET_MAX_AGE_HOURS = 24

    def __init__(
        self,
        store: Any,
        *,
        settings: Any = None,
        nest_client: Any = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.store = store
        self.nest_client = nest_client if nest_client is not None else NestRoadmapClient()
        self.logger = logger or logging.getLogger(__name__)
        self.actor_refresh_failures_key = 'actor_context_refresh_failures'

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------
    def get_session_or_404(self, session_id: str) -> AgentSession:
        session = self.store.get(session_id)
        if session is None:
            raise session_not_found(session_id)
        return session

    def run_async_call(self, coro: Any) -> Any:
        return run_async_call(coro, settings=self.settings, logger=self.logger)

    def new_step_context(
        self,
        *,
        auth_header: str | None,
        trace_id: str,
        sync_mode: bool = False,
    ) -> 'StepContext':
        return StepContext(service=self, auth_header=auth_header, trace_id=trace_id, sync_mode=sync_mode)

    # ------------------------------------------------------------------
    # Recent-target helpers (memory/recent_targets with this service's
    # policy: 24h freshness, 20 entries, uuid-only node ids)
    # ------------------------------------------------------------------
    def _is_recent_target_fresh(self, target: RecentResolvedTarget) -> bool:
        return is_recent_target_fresh_helper(
            target,
            utcnow=_utcnow,
            max_age_hours=self._RECENT_TARGET_MAX_AGE_HOURS,
        )

    def prune_recent_resolved_targets(
        self, targets: list[RecentResolvedTarget]
    ) -> list[RecentResolvedTarget]:
        return prune_recent_resolved_targets_helper(
            targets,
            is_recent_target_fresh=self._is_recent_target_fresh,
            max_items=self._RECENT_TARGET_MAX_ITEMS,
        )

    def get_recent_resolved_targets(self, session: AgentSession) -> list[RecentResolvedTarget]:
        return get_recent_resolved_targets_helper(
            session,
            prune_recent_resolved_targets=self.prune_recent_resolved_targets,
        )

    def append_recent_resolved_target(
        self,
        *,
        session: AgentSession,
        node_id: Any,
        node_type: Any,
        title: Any = None,
        label: Any = None,
        source: str = 'context_tool',
        confidence: float | None = None,
        roadmap_id: str | None = None,
    ) -> None:
        append_recent_resolved_target_helper(
            session=session,
            node_id=node_id,
            node_type=node_type,
            title=title,
            label=label,
            source=source,
            confidence=confidence,
            roadmap_id=roadmap_id,
            normalize_recent_target_node_type=normalize_recent_target_node_type_helper,
            is_uuid=is_uuid_like,
            get_recent_resolved_targets=self.get_recent_resolved_targets,
            prune_recent_resolved_targets=self.prune_recent_resolved_targets,
            utcnow=_utcnow,
        )

    def record_recent_targets_from_operations(
        self,
        *,
        session: AgentSession,
        operations: list[RoadmapOperation],
        source: str,
        roadmap_id: str | None = None,
    ) -> None:
        record_recent_targets_from_operations_helper(
            session=session,
            operations=operations,
            source=source,
            read_operation_title=read_operation_title,
            is_uuid=is_uuid_like,
            append_recent_resolved_target=self.append_recent_resolved_target,
            roadmap_id=roadmap_id,
        )

    def record_recent_targets_from_preview(
        self,
        *,
        session: AgentSession,
        preview_result: dict[str, Any],
        source: str = 'commit_semantic_diff',
        roadmap_id: str | None = None,
    ) -> None:
        record_recent_targets_from_preview_helper(
            session=session,
            preview_result=preview_result,
            source=source,
            append_recent_resolved_target=self.append_recent_resolved_target,
            roadmap_id=roadmap_id,
        )

    # ------------------------------------------------------------------
    # Context caches (bodies in runtime.context_cache)
    # ------------------------------------------------------------------
    def invalidate_memory_notes(self, session: AgentSession, roadmap_id: str | None = None) -> None:
        context_cache.invalidate_memory_notes(session, roadmap_id)

    def cache_deps(self, *, auth_header: str | None, trace_id: str | None) -> dict[str, Any]:
        """Keyword deps every ``context_cache`` loader takes."""
        return dict(
            auth_header=auth_header,
            trace_id=trace_id,
            settings=self.settings,
            nest_client=self.nest_client,
            logger=self.logger,
            run_async_call=self.run_async_call,
        )

    def build_turn_context(
        self,
        session: AgentSession,
        auth_header: str | None,
        trace_id: str | None,
        run: Any = None,
    ) -> dict[str, Any]:
        return build_turn_context(
            session=session,
            auth_header=auth_header,
            trace_id=trace_id,
            settings=self.settings,
            get_recent_resolved_targets=self.get_recent_resolved_targets,
            run=run,
        )


@dataclass
class StepContext:
    """One HTTP request's worth of orchestration state."""

    service: RuntimeService
    auth_header: str | None
    trace_id: str
    # Legacy client (no `continue` capability): one synchronous request.
    sync_mode: bool = False
    started_monotonic: float = field(default_factory=monotonic)
    # Per-step accumulators read by finalize_step.
    step_batch_ids: set[str] = field(default_factory=set)
    step_commit_batch_ids: set[str] = field(default_factory=set)
    tokens: dict[str, int] = field(default_factory=lambda: {'input': 0, 'output': 0, 'total': 0, 'cached': 0})
    loop_turns: int = 0
    loop_termination_reason: str | None = None
    provider_used: str = 'openai'
    fallback_used: bool = False
    provider_error_code: str | None = None
    route_lane: str | None = None
    cancel_key: str | None = None
    # Response fragments the transitions produce for finalize_step.
    proposal_payload: dict[str, Any] | None = None
    clarifier_card: dict[str, Any] | None = None
    intent_hint: str | None = None
    chat_used_read_tools: bool = False
    last_outcome_kind: str | None = None
    verify_reported: bool = False
    no_model_call: bool = False

    # -- deps ---------------------------------------------------------------
    @property
    def settings(self) -> Any:
        return self.service.settings

    @property
    def store(self) -> Any:
        return self.service.store

    @property
    def nest_client(self) -> Any:
        return self.service.nest_client

    @property
    def logger(self) -> logging.Logger:
        return self.service.logger

    def run_async_call(self, coro: Any) -> Any:
        return self.service.run_async_call(coro)

    def cache_deps(self) -> dict[str, Any]:
        return self.service.cache_deps(auth_header=self.auth_header, trace_id=self.trace_id)

    # -- time budget --------------------------------------------------------
    def elapsed(self) -> float:
        return monotonic() - self.started_monotonic

    @property
    def step_budget_seconds(self) -> float:
        return float(getattr(self.settings, 'agent_run_step_budget_seconds', 90.0))

    @property
    def hard_deadline_seconds(self) -> float:
        return float(getattr(self.settings, 'agent_run_hard_deadline_seconds', 165.0))

    @property
    def batch_reserve_seconds(self) -> float:
        reserve = getattr(self.settings, 'agent_run_batch_reserve_seconds', None)
        if reserve is None:
            reserve = float(getattr(self.settings, 'openai_model_timeout_seconds', 90.0)) + 3 * float(
                getattr(self.settings, 'nest_timeout_seconds', 20.0)
            )
        return float(reserve)

    def past_soft_budget(self) -> bool:
        return self.elapsed() >= self.step_budget_seconds

    def loop_deadline_monotonic(self) -> float:
        """When the investigate loop stops starting new turns. Sync mode
        stretches it to the last turn that can still finish inside the hard
        deadline (a legacy client cannot continue)."""
        budget = self.step_budget_seconds
        if self.sync_mode:
            model_timeout = float(getattr(self.settings, 'openai_model_timeout_seconds', 90.0))
            budget = max(budget, self.hard_deadline_seconds - model_timeout)
        return self.started_monotonic + budget

    @property
    def nest_reserve_seconds(self) -> float:
        """The uninterruptible Nest-only tail of a direct-edit batch: overview
        refresh + commit + one stale/transient retry."""
        return 3 * float(getattr(self.settings, 'nest_timeout_seconds', 20.0))

    def batch_reserve_seconds_for(self, batch: Any | None) -> float:
        """What must still fit before a batch may start. A batch that can call
        the model (materialize, or the preview repair turn of a proposal /
        revert batch) needs the full BATCH_RESERVE; a direct ``stage_edits``
        batch commits without a model turn, so only its Nest calls are
        reserved -- today's one-request in-roadmap edit stays one request
        even after a long investigate."""
        if batch is None:
            return self.batch_reserve_seconds
        needs_model = bool(getattr(batch, 'needs_materialize', False)) or getattr(
            batch, 'source', None
        ) in {'proposal', 'revert'}
        if needs_model:
            return self.batch_reserve_seconds
        return min(self.batch_reserve_seconds, self.nest_reserve_seconds)

    def materialize_deadline_monotonic(self) -> float:
        return self.started_monotonic + self.hard_deadline_seconds - self.batch_reserve_seconds

    def can_start_batch(self, batch: Any | None = None) -> bool:
        """Execute starts a batch only when elapsed + its reserve <= HARD_DEADLINE
        (the full BATCH_RESERVE when no batch is given)."""
        return self.elapsed() + self.batch_reserve_seconds_for(batch) <= self.hard_deadline_seconds

    # -- cancel ---------------------------------------------------------------
    def bind_cancel_key(self, session_id: str, run_id: str) -> None:
        run_key = getattr(self.store, 'run_key', None)
        self.cancel_key = run_key(session_id, run_id, 'cancel') if callable(run_key) else None

    def should_stop(self) -> bool:
        if not self.cancel_key:
            return False
        exists = getattr(self.store, 'exists', None)
        if not callable(exists):
            return False
        try:
            return bool(exists(self.cancel_key))
        except SessionStoreUnavailableError:
            return False
        except Exception:  # noqa: BLE001 — a store hiccup never aborts the loop
            return False

    # -- persistence ------------------------------------------------------------
    def persist(self, session: AgentSession) -> None:
        """Blind SET — the request path is the single writer under the run lock."""
        self.store.update(session)

    def transcript_key(self, session_id: str, run_id: str, suffix: str = 'transcript') -> str | None:
        run_key = getattr(self.store, 'run_key', None)
        if not callable(run_key):
            return None
        return run_key(session_id, run_id, suffix)

    def put_transcript(self, key: str | None, transcript: list[dict[str, Any]]) -> bool:
        put = getattr(self.store, 'put_side_key', None)
        if not key or not callable(put):
            return False
        ttl = int(getattr(self.settings, 'agent_run_transcript_ttl_seconds', 900))
        try:
            put(key, transcript, ttl)
        except Exception:  # noqa: BLE001 — a lost transcript restarts the read-only phase
            return False
        return True

    def get_transcript(self, key: str | None) -> list[dict[str, Any]] | None:
        get = getattr(self.store, 'get_side_key', None)
        if not key or not callable(get):
            return None
        try:
            payload = get(key)
        except Exception:  # noqa: BLE001
            return None
        if not isinstance(payload, list):
            return None
        return [item for item in payload if isinstance(item, dict)]

    def delete_transcript(self, key: str | None) -> None:
        delete = getattr(self.store, 'delete_side_key', None)
        if not key or not callable(delete):
            return
        try:
            delete(key)
        except Exception:  # noqa: BLE001
            pass

    # -- telemetry ------------------------------------------------------------------
    def add_loop_usage(self, loop_result: Any, *, turns: int | None = None) -> None:
        """Fold one loop run into the step's telemetry. ``turns`` overrides the
        loop's cumulative turn counter (a resumed phase reports the delta)."""
        if loop_result is None:
            return
        self.tokens['input'] += int(getattr(loop_result, 'tokens_input', 0) or 0)
        self.tokens['output'] += int(getattr(loop_result, 'tokens_output', 0) or 0)
        self.tokens['total'] += int(getattr(loop_result, 'tokens_total', 0) or 0)
        self.tokens['cached'] += int(getattr(loop_result, 'tokens_cached', 0) or 0)
        self.loop_turns += int(turns if turns is not None else (getattr(loop_result, 'turns', 0) or 0))
        self.loop_termination_reason = getattr(loop_result, 'termination_reason', None) or self.loop_termination_reason
