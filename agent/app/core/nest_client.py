import asyncio
from typing import Any
from urllib.parse import quote, quote_plus
from time import perf_counter
import logging

import httpx
from fastapi import HTTPException

from app.core.config import get_settings
from app.core.logging_utils import log_event
from app.core.uuid_utils import normalize_uuid

_GUEST_PREFIX = 'Guest '

# Query keys each /ai/context list endpoint accepts (the backend's global
# ValidationPipe runs with forbidNonWhitelisted, so an unknown key is a 400).
_AI_CONTEXT_ROADMAPS_PARAMS = ('workspace_id', 'project_id', 'cursor', 'limit')
_AI_CONTEXT_SEARCH_PARAMS = (
    'q',
    'kinds',
    'workspace_id',
    'project_id',
    'roadmap_ids',
    'limit',
)
_AI_CONTEXT_TASKS_PARAMS = (
    'assigned_to_me',
    'status',
    'due_before',
    'due_after',
    'overdue',
    'workspace_id',
    'project_id',
    'roadmap_ids',
    'limit',
)


def _encode_query_value(value: Any) -> str | None:
    """None/empty -> omitted; bool -> 'true'/'false'; list/tuple -> CSV of
    the non-empty items (the backend DTOs @Transform CSV into arrays);
    everything else -> str."""
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (list, tuple, set, frozenset)):
        items = [str(item).strip() for item in value if item is not None and str(item).strip()]
        if not items:
            return None
        return ','.join(items)
    text = str(value).strip()
    return text or None


def _encode_query(pairs: list[tuple[str, Any]]) -> str:
    """Build `?a=b&c=d` from ordered pairs, skipping empties. Returns '' when
    nothing survives so callers can append it unconditionally."""
    parts: list[str] = []
    for key, value in pairs:
        encoded = _encode_query_value(value)
        if encoded is None:
            continue
        parts.append(f"{key}={quote_plus(encoded)}")
    return f"?{'&'.join(parts)}" if parts else ''


def _pick_params(params: dict[str, Any] | None, allowed: tuple[str, ...]) -> list[tuple[str, Any]]:
    if not params:
        return []
    return [(key, params.get(key)) for key in allowed if key in params]


def _apply_auth_header(headers: dict[str, str], auth_header: str | None) -> None:
    """Translate the composite forward-auth value (see
    sessions_support/auth.py resolve_forward_auth) into the right outbound header: 'Guest <id>'
    becomes X-Guest-User-Id, anything else (a real bearer) passes through
    as Authorization. No-op when auth_header is falsy."""
    if not auth_header:
        return
    if auth_header.startswith(_GUEST_PREFIX):
        headers['X-Guest-User-Id'] = auth_header[len(_GUEST_PREFIX):]
    else:
        headers['Authorization'] = auth_header


class NestRoadmapClient:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._logger = logging.getLogger(__name__)
        # Per-loop client cache. `httpx.AsyncClient`'s connection pool is
        # bound to the event loop that created it — sockets get registered
        # on that loop's selector. Sharing a client across loops (e.g. when
        # the agent's sync tool dispatcher spins up `asyncio.run(...)` per
        # call, creating a fresh loop each time) triggers cryptic
        # "Event loop is closed" errors on the NEXT call, because any
        # attempt to close the old client uses the new loop to touch
        # sockets registered on the dead one.
        #
        # Instead, key clients by `id(loop)`. The main FastAPI event loop
        # keeps its client for the process lifetime (huge TLS keep-alive
        # win for actor fetch, commit, preview). Short-lived worker-thread
        # loops each get a fresh client — no keep-alive across runs for
        # those, but also no crashes. We deliberately do not attempt to
        # close stale clients; when their loop is closed the OS will
        # reclaim the sockets on GC / process exit.
        self._clients_by_loop_id: dict[
            int, tuple[asyncio.AbstractEventLoop, httpx.AsyncClient]
        ] = {}

    async def _get_client(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        loop_id = id(loop)
        cached = self._clients_by_loop_id.get(loop_id)
        if cached is not None:
            cached_loop, cached_client = cached
            # Same id() doesn't guarantee same loop object: Python may reuse
            # the memory address of a garbage-collected loop for a new one
            # spun up by the next `asyncio.run(...)`. So we additionally
            # check identity + whether the cached loop already closed. If
            # either fails we drop the zombie entry without touching its
            # client (any aclose attempt would cross-loop and crash).
            if (
                cached_loop is loop
                and not cached_loop.is_closed()
                and not cached_client.is_closed
            ):
                return cached_client
            self._clients_by_loop_id.pop(loop_id, None)
        client = httpx.AsyncClient(
            timeout=self._settings.nest_timeout_seconds,
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=40,
                keepalive_expiry=30.0,
            ),
        )
        self._clients_by_loop_id[loop_id] = (loop, client)
        return client

    async def aclose(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        entry = self._clients_by_loop_id.pop(id(loop), None)
        if entry is None:
            return
        cached_loop, cached_client = entry
        if (
            cached_loop is loop
            and not cached_loop.is_closed()
            and not cached_client.is_closed
        ):
            await cached_client.aclose()

    def _transport_error(
        self,
        *,
        exc: httpx.RequestError,
        method: str,
        path: str,
        trace_id: str | None,
        started: float,
    ) -> HTTPException:
        is_timeout = isinstance(exc, httpx.TimeoutException)
        status_code = 504 if is_timeout else 503
        error_code = 'NEST_TIMEOUT' if is_timeout else 'NEST_UNAVAILABLE'
        error_label = 'Gateway Timeout' if is_timeout else 'Service Unavailable'
        message = (
            'The backend service timed out. Please retry.'
            if is_timeout
            else 'The backend service is temporarily unavailable. Please retry.'
        )
        elapsed_ms = int((perf_counter() - started) * 1000)
        log_event(
            self._logger,
            'nest_http_call',
            settings=self._settings,
            trace_id=trace_id,
            method=method,
            path=path,
            status_code=status_code,
            nest_http_call_ms=elapsed_ms,
            nest_http_network_ms=elapsed_ms,
            nest_http_parse_ms=0,
            nest_transport_error=type(exc).__name__,
        )
        return HTTPException(
            status_code=status_code,
            detail={
                'upstream': 'nestjs',
                'path': path,
                'detail': {
                    'statusCode': status_code,
                    'error': error_label,
                    'code': error_code,
                    'message': message,
                },
            },
        )

    async def preview(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/preview",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def get_preview(
        self,
        roadmap_id: str,
        preview_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/previews/{preview_id}",
            auth_header,
            trace_id=trace_id,
        )

    async def commit(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
        *,
        session_id: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        # Run-attributed commits carry the session/run ids so the backend can
        # stamp roadmap_change_history and answer GET /ai/context/changes.
        # Only added when given AND uuid-shaped: the commit DTO validates both
        # with @IsUUID and would reject the whole commit otherwise (an older
        # backend DTO would 400 on unknown keys too). The caller's dict is
        # never mutated.
        body = payload
        session_uuid = normalize_uuid(session_id)
        run_uuid = normalize_uuid(run_id)
        if session_uuid or run_uuid:
            body = dict(payload)
            if session_uuid:
                body['session_id'] = session_uuid
            if run_uuid:
                body['run_id'] = run_uuid
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/commit",
            body,
            auth_header,
            trace_id=trace_id,
        )

    async def discard_preview(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/discard",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def rollback(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/rollback",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def context_summary(
        self,
        roadmap_id: str,
        preview_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_parts: list[str] = []
        if preview_id:
            query_parts.append(f"preview_id={quote_plus(preview_id)}")
        query_string = f"?{'&'.join(query_parts)}" if query_parts else ''
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/summary{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_actor(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/actor",
            auth_header,
            trace_id=trace_id,
        )

    async def context_members(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/members",
            auth_header,
            trace_id=trace_id,
        )

    async def context_project(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/project",
            auth_header,
            trace_id=trace_id,
        )

    async def context_project_brief(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/project/brief",
            auth_header,
            trace_id=trace_id,
        )

    async def context_project_resources(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/project/resources",
            auth_header,
            trace_id=trace_id,
        )

    async def context_project_meetings(
        self,
        roadmap_id: str,
        window: str | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_parts: list[str] = []
        if window:
            query_parts.append(f"window={quote_plus(window)}")
        if limit is not None:
            query_parts.append(f"limit={limit}")
        query_string = f"?{'&'.join(query_parts)}" if query_parts else ''
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/project/meetings{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_project_member_details(
        self,
        roadmap_id: str,
        member_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        encoded_member_id = quote(member_id, safe='')
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/project/members/{encoded_member_id}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_search(
        self,
        roadmap_id: str,
        query: str,
        node_type: str | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = f"?query={quote_plus(query)}"
        if node_type:
            query_string += f"&node_type={quote_plus(node_type)}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/search{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_resolve(
        self,
        roadmap_id: str,
        query: str,
        node_type: str | None,
        limit: int | None,
        auth_header: str | None,
        include_parent: bool = True,
        include_children: bool = True,
        children_limit: int | None = None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = f"?query={quote_plus(query)}"
        if node_type:
            query_string += f"&node_type={quote_plus(node_type)}"
        if limit is not None:
            query_string += f"&limit={limit}"
        query_string += f"&include_parent={'true' if include_parent else 'false'}"
        query_string += f"&include_children={'true' if include_children else 'false'}"
        if children_limit is not None:
            query_string += f"&children_limit={children_limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/resolve{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_children_from_resolution(
        self,
        roadmap_id: str,
        resolution_id: str,
        choice: int,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = f"?choice={choice}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/resolutions/{resolution_id}/children{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_features(
        self,
        roadmap_id: str,
        epic_id: str,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = f"?epic_id={quote_plus(epic_id)}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/features{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_tasks_assigned_to_me(
        self,
        roadmap_id: str,
        status: str | None,
        limit: int | None,
        preview_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_parts: list[str] = []
        if preview_id:
            query_parts.append(f"preview_id={quote_plus(preview_id)}")
        if status:
            query_parts.append(f"status={quote_plus(status)}")
        if limit is not None:
            query_parts.append(f"limit={limit}")
        query_string = f"?{'&'.join(query_parts)}" if query_parts else ''
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/tasks-assigned-to-me{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_tasks_filtered(
        self,
        roadmap_id: str,
        status: str | None,
        parent_id: str | None,
        parent_type: str | None,
        assignee_id: str | None,
        keyword: str | None,
        include_completed: bool | None,
        limit: int | None,
        preview_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_parts: list[str] = []
        if preview_id:
            query_parts.append(f"preview_id={quote_plus(preview_id)}")
        if status:
            query_parts.append(f"status={quote_plus(status)}")
        if parent_id:
            query_parts.append(f"parent_id={quote_plus(parent_id)}")
        if parent_type:
            query_parts.append(f"parent_type={quote_plus(parent_type)}")
        if assignee_id:
            query_parts.append(f"assignee_id={quote_plus(assignee_id)}")
        if keyword:
            query_parts.append(f"keyword={quote_plus(keyword)}")
        if include_completed is not None:
            query_parts.append(
                f"include_completed={'true' if include_completed else 'false'}"
            )
        if limit is not None:
            query_parts.append(f"limit={limit}")
        query_string = f"?{'&'.join(query_parts)}" if query_parts else ''
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/tasks{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_node_details(
        self,
        roadmap_id: str,
        node_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/nodes/{node_id}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_children(
        self,
        roadmap_id: str,
        node_id: str,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = ''
        if limit is not None:
            query_string = f'?limit={limit}'
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/nodes/{node_id}/children{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, auth_header)
        if trace_id:
            headers['X-Trace-Id'] = trace_id

        url = f"{self._settings.nest_api_base_url}{path}"
        client = await self._get_client()
        started = perf_counter()
        network_started = perf_counter()
        try:
            response = await client.post(url, json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise self._transport_error(
                exc=exc,
                method='POST',
                path=path,
                trace_id=trace_id,
                started=started,
            ) from exc
        network_ms = int((perf_counter() - network_started) * 1000)

        if response.is_success:
            parse_started = perf_counter()
            payload_result = self._extract_success_payload(response)
            parse_ms = int((perf_counter() - parse_started) * 1000)
            elapsed_ms = int((perf_counter() - started) * 1000)
            log_event(
                self._logger,
                'nest_http_call',
                settings=self._settings,
                trace_id=trace_id,
                method='POST',
                path=path,
                status_code=response.status_code,
                nest_http_call_ms=elapsed_ms,
                nest_http_network_ms=network_ms,
                nest_http_parse_ms=parse_ms,
            )
            return payload_result

        parse_started = perf_counter()
        detail: Any
        try:
            detail = response.json()
        except Exception:
            detail = response.text or 'Unknown NestJS error'
        parse_ms = int((perf_counter() - parse_started) * 1000)
        elapsed_ms = int((perf_counter() - started) * 1000)
        log_event(
            self._logger,
            'nest_http_call',
            settings=self._settings,
            trace_id=trace_id,
            method='POST',
            path=path,
            status_code=response.status_code,
            nest_http_call_ms=elapsed_ms,
            nest_http_network_ms=network_ms,
            nest_http_parse_ms=parse_ms,
        )

        raise HTTPException(
            status_code=response.status_code,
            detail={
                'upstream': 'nestjs',
                'path': path,
                'detail': detail,
            },
        )

    async def _mutate(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, auth_header)
        if trace_id:
            headers['X-Trace-Id'] = trace_id

        url = f"{self._settings.nest_api_base_url}{path}"
        client = await self._get_client()
        started = perf_counter()
        try:
            response = await client.request(method, url, json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise self._transport_error(
                exc=exc,
                method=method,
                path=path,
                trace_id=trace_id,
                started=started,
            ) from exc
        elapsed_ms = int((perf_counter() - started) * 1000)

        log_event(
            self._logger,
            'nest_http_call',
            settings=self._settings,
            trace_id=trace_id,
            method=method,
            path=path,
            status_code=response.status_code,
            nest_http_call_ms=elapsed_ms,
            nest_http_network_ms=elapsed_ms,
            nest_http_parse_ms=0,
        )

        if response.is_success:
            # 204s carry no body; tolerate empty payloads.
            try:
                return self._extract_success_payload(response)
            except Exception:  # noqa: BLE001 — empty/non-JSON success body
                return {}

        try:
            detail: Any = response.json()
        except Exception:  # noqa: BLE001
            detail = response.text or 'Unknown NestJS error'
        raise HTTPException(
            status_code=response.status_code,
            detail={
                'upstream': 'nestjs',
                'path': path,
                'detail': detail,
            },
        )

    async def _put(
        self,
        path: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._mutate('PUT', path, payload, auth_header, trace_id)

    async def _delete(
        self,
        path: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._mutate('DELETE', path, None, auth_header, trace_id)

    async def put_session_agent_state(
        self,
        roadmap_id: str,
        session_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._put(
            f"/roadmaps/{roadmap_id}/ai-sessions/{session_id}/agent-state",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def ai_memories_list(
        self,
        roadmap_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/memories",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_memories_create(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/memories",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def ai_memories_delete(
        self,
        roadmap_id: str,
        memory_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._delete(
            f"/roadmaps/{roadmap_id}/ai/memories/{memory_id}",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_task_comments_add(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/task-comments",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def ai_memories_relevant(
        self,
        roadmap_id: str,
        query: str,
        limit: int,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_string = f"?query={quote_plus(query)}&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/memories/relevant{query_string}",
            auth_header,
            trace_id=trace_id,
        )

    async def context_knowledge_search(
        self,
        roadmap_id: str,
        query: str,
        sources: list[str] | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query_parts = [f"query={quote_plus(query)}"]
        if sources:
            query_parts.append(f"sources={quote_plus(','.join(sources))}")
        if limit is not None:
            query_parts.append(f"limit={limit}")
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/knowledge-search?{'&'.join(query_parts)}",
            auth_header,
            trace_id=trace_id,
        )

    # ------------------------------------------------------------------
    # User-scoped AI context family (`/api/ai/context/*`). Every route is
    # authorized per request as the forwarded user; every denial is a 404.
    # ------------------------------------------------------------------

    async def resolve_refs(
        self,
        refs: list[dict[str, Any]],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        """POST /ai/context/resolve-refs -> {refs: [ResolvedRef-shaped dicts]}.
        Fail-closed per ref on the backend; the caller treats a transport or
        4xx/5xx failure as every ref inaccessible (RESOLVE_FAILED)."""
        return await self._post(
            '/ai/context/resolve-refs',
            {'refs': list(refs)},
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_actor(
        self,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get('/ai/context/actor', auth_header, trace_id=trace_id)

    async def ai_context_overview(
        self,
        workspace_id: str | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/ai/context/overview{_encode_query([('workspace_id', workspace_id)])}",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_roadmaps(
        self,
        params: dict[str, Any] | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query = _encode_query(_pick_params(params, _AI_CONTEXT_ROADMAPS_PARAMS))
        return await self._get(
            f"/ai/context/roadmaps{query}",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_search(
        self,
        params: dict[str, Any] | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query = _encode_query(_pick_params(params, _AI_CONTEXT_SEARCH_PARAMS))
        return await self._get(
            f"/ai/context/search{query}",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_tasks(
        self,
        params: dict[str, Any] | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query = _encode_query(_pick_params(params, _AI_CONTEXT_TASKS_PARAMS))
        return await self._get(
            f"/ai/context/tasks{query}",
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_knowledge_search(
        self,
        q: str,
        project_ids: list[str] | None,
        sources: list[str] | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
        *,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        query = _encode_query(
            [
                ('q', q),
                ('project_ids', project_ids),
                ('workspace_id', workspace_id),
                ('sources', sources),
                ('limit', limit),
            ]
        )
        return await self._get(
            f"/ai/context/knowledge-search{query}",
            auth_header,
            trace_id=trace_id,
        )

    def _ai_context_project_path(self, project_id: str, suffix: str = '') -> str:
        encoded_project_id = quote(project_id, safe='')
        return f"/ai/context/projects/{encoded_project_id}{suffix}"

    async def ai_context_project_context(
        self,
        project_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            self._ai_context_project_path(project_id),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_project_brief(
        self,
        project_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            self._ai_context_project_path(project_id, '/brief'),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_project_resources(
        self,
        project_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            self._ai_context_project_path(project_id, '/resources'),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_project_meetings(
        self,
        project_id: str,
        window: str | None,
        limit: int | None,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        query = _encode_query([('window', window), ('limit', limit)])
        return await self._get(
            self._ai_context_project_path(project_id, f"/meetings{query}"),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_project_members(
        self,
        project_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._get(
            self._ai_context_project_path(project_id, '/members'),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_project_member_details(
        self,
        project_id: str,
        member_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        encoded_member_id = quote(member_id, safe='')
        return await self._get(
            self._ai_context_project_path(project_id, f"/members/{encoded_member_id}"),
            auth_header,
            trace_id=trace_id,
        )

    async def ai_context_changes(
        self,
        auth_header: str | None,
        trace_id: str | None = None,
        *,
        run_id: str | None = None,
        session_id: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """GET /ai/context/changes?run_id=|session_id=&limit= — the
        authoritative "which batches already landed" guard on resume."""
        if not run_id and not session_id:
            raise ValueError('ai_context_changes requires run_id or session_id')
        query = _encode_query(
            [('run_id', run_id), ('session_id', session_id), ('limit', limit)]
        )
        return await self._get(
            f"/ai/context/changes{query}",
            auth_header,
            trace_id=trace_id,
        )

    # ------------------------------------------------------------------
    # Workspace scope
    # ------------------------------------------------------------------

    async def workspace_get(
        self,
        workspace_id: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        """GET /workspaces/{id}: 404 (missing) or 403 (not a member); the
        session-create flow maps both to 404 SESSION_SCOPE_NOT_FOUND."""
        encoded_workspace_id = quote(workspace_id, safe='')
        return await self._get(
            f"/workspaces/{encoded_workspace_id}",
            auth_header,
            trace_id=trace_id,
        )

    async def put_workspace_session_agent_state(
        self,
        workspace_id: str,
        session_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        encoded_workspace_id = quote(workspace_id, safe='')
        encoded_session_id = quote(session_id, safe='')
        return await self._put(
            f"/workspaces/{encoded_workspace_id}/ai-sessions/{encoded_session_id}/agent-state",
            payload,
            auth_header,
            trace_id=trace_id,
        )

    async def _get(
        self,
        path: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, auth_header)
        if trace_id:
            headers['X-Trace-Id'] = trace_id

        url = f"{self._settings.nest_api_base_url}{path}"
        client = await self._get_client()
        started = perf_counter()
        network_started = perf_counter()
        try:
            response = await client.get(url, headers=headers)
        except httpx.RequestError as exc:
            raise self._transport_error(
                exc=exc,
                method='GET',
                path=path,
                trace_id=trace_id,
                started=started,
            ) from exc
        network_ms = int((perf_counter() - network_started) * 1000)

        if response.is_success:
            parse_started = perf_counter()
            payload_result = self._extract_success_payload(response)
            parse_ms = int((perf_counter() - parse_started) * 1000)
            elapsed_ms = int((perf_counter() - started) * 1000)
            log_event(
                self._logger,
                'nest_http_call',
                settings=self._settings,
                trace_id=trace_id,
                method='GET',
                path=path,
                status_code=response.status_code,
                nest_http_call_ms=elapsed_ms,
                nest_http_network_ms=network_ms,
                nest_http_parse_ms=parse_ms,
            )
            return payload_result

        parse_started = perf_counter()
        detail: Any
        try:
            detail = response.json()
        except Exception:
            detail = response.text or 'Unknown NestJS error'
        parse_ms = int((perf_counter() - parse_started) * 1000)
        elapsed_ms = int((perf_counter() - started) * 1000)
        log_event(
            self._logger,
            'nest_http_call',
            settings=self._settings,
            trace_id=trace_id,
            method='GET',
            path=path,
            status_code=response.status_code,
            nest_http_call_ms=elapsed_ms,
            nest_http_network_ms=network_ms,
            nest_http_parse_ms=parse_ms,
        )

        raise HTTPException(
            status_code=response.status_code,
            detail={
                'upstream': 'nestjs',
                'path': path,
                'detail': detail,
            },
        )

    def _extract_success_payload(self, response: httpx.Response) -> dict[str, Any]:
        body = response.json()
        if isinstance(body, dict) and 'data' in body:
            payload = body['data']
            if isinstance(payload, dict):
                return payload
            return {'value': payload}
        if isinstance(body, dict):
            return body
        return {'value': body}
