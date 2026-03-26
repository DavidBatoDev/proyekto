from typing import Any

import httpx
from fastapi import HTTPException, status

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
            return response.json()

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