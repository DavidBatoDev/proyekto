from typing import Any
from urllib.parse import quote_plus
from time import perf_counter
import logging

import httpx
from fastapi import HTTPException

from app.core.config import get_settings
from app.core.logging_utils import log_event


class NestRoadmapClient:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._logger = logging.getLogger(__name__)

    async def aclose(self) -> None:
        # Client instances are short-lived per request call.
        return None

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
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/commit",
            payload,
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
        if auth_header:
            headers['Authorization'] = auth_header
        if trace_id:
            headers['X-Trace-Id'] = trace_id

        url = f"{self._settings.nest_api_base_url}{path}"
        started = perf_counter()
        network_started = perf_counter()
        async with httpx.AsyncClient(timeout=self._settings.nest_timeout_seconds) as client:
            response = await client.post(url, json=payload, headers=headers)
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

    async def _get(
        self,
        path: str,
        auth_header: str | None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        if auth_header:
            headers['Authorization'] = auth_header
        if trace_id:
            headers['X-Trace-Id'] = trace_id

        url = f"{self._settings.nest_api_base_url}{path}"
        started = perf_counter()
        network_started = perf_counter()
        async with httpx.AsyncClient(timeout=self._settings.nest_timeout_seconds) as client:
            response = await client.get(url, headers=headers)
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
