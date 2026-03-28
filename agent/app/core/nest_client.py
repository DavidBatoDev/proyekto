from typing import Any
from urllib.parse import quote_plus

import httpx
from fastapi import HTTPException

from app.core.config import get_settings


class NestRoadmapClient:
    def __init__(self) -> None:
        self._settings = get_settings()

    async def preview(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/preview",
            payload,
            auth_header,
        )

    async def get_preview(
        self,
        roadmap_id: str,
        preview_id: str,
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/previews/{preview_id}",
            auth_header,
        )

    async def commit(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/commit",
            payload,
            auth_header,
        )

    async def discard_preview(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/discard",
            payload,
            auth_header,
        )

    async def rollback(
        self,
        roadmap_id: str,
        payload: dict[str, Any],
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._post(
            f"/roadmaps/{roadmap_id}/ai/rollback",
            payload,
            auth_header,
        )

    async def context_summary(
        self,
        roadmap_id: str,
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/summary",
            auth_header,
        )

    async def context_actor(
        self,
        roadmap_id: str,
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/actor",
            auth_header,
        )

    async def context_search(
        self,
        roadmap_id: str,
        query: str,
        limit: int | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        query_string = f"?query={quote_plus(query)}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/search{query_string}",
            auth_header,
        )

    async def context_children_from_resolution(
        self,
        roadmap_id: str,
        resolution_id: str,
        choice: int,
        limit: int | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        query_string = f"?choice={choice}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/resolutions/{resolution_id}/children{query_string}",
            auth_header,
        )

    async def context_features(
        self,
        roadmap_id: str,
        epic_id: str,
        limit: int | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        query_string = f"?epic_id={quote_plus(epic_id)}"
        if limit is not None:
            query_string += f"&limit={limit}"
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/features{query_string}",
            auth_header,
        )

    async def context_tasks_assigned_to_me(
        self,
        roadmap_id: str,
        status: str | None,
        limit: int | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        query_parts: list[str] = []
        if status:
            query_parts.append(f"status={quote_plus(status)}")
        if limit is not None:
            query_parts.append(f"limit={limit}")
        query_string = f"?{'&'.join(query_parts)}" if query_parts else ''
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/tasks-assigned-to-me{query_string}",
            auth_header,
        )

    async def context_node_details(
        self,
        roadmap_id: str,
        node_id: str,
        auth_header: str | None,
    ) -> dict[str, Any]:
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/nodes/{node_id}",
            auth_header,
        )

    async def context_children(
        self,
        roadmap_id: str,
        node_id: str,
        limit: int | None,
        auth_header: str | None,
    ) -> dict[str, Any]:
        query_string = ''
        if limit is not None:
            query_string = f'?limit={limit}'
        return await self._get(
            f"/roadmaps/{roadmap_id}/ai/context/nodes/{node_id}/children{query_string}",
            auth_header,
        )

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        auth_header: str | None,
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        if auth_header:
            headers['Authorization'] = auth_header

        url = f"{self._settings.nest_api_base_url}{path}"
        timeout = self._settings.nest_timeout_seconds

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)

        if response.is_success:
            return self._extract_success_payload(response)

        detail: Any
        try:
            detail = response.json()
        except Exception:
            detail = response.text or 'Unknown NestJS error'

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
    ) -> dict[str, Any]:
        headers = {'Content-Type': 'application/json'}
        if auth_header:
            headers['Authorization'] = auth_header

        url = f"{self._settings.nest_api_base_url}{path}"
        timeout = self._settings.nest_timeout_seconds

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers)

        if response.is_success:
            return self._extract_success_payload(response)

        detail: Any
        try:
            detail = response.json()
        except Exception:
            detail = response.text or 'Unknown NestJS error'

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
