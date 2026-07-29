from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app.api.routes.sessions_support.common import extract_upstream_error_details
from app.core.nest_client import NestRoadmapClient


class NestClientTransportErrorTests(unittest.IsolatedAsyncioTestCase):
    def _client_with_transport(self, transport: object) -> NestRoadmapClient:
        client = NestRoadmapClient.__new__(NestRoadmapClient)
        client._settings = SimpleNamespace(
            nest_api_base_url='http://backend.test/api',
        )
        client._logger = logging.getLogger('nest-client-transport-tests')
        client._clients_by_loop_id = {}
        client._get_client = AsyncMock(return_value=transport)
        return client

    async def test_post_maps_connect_error_to_structured_503(self) -> None:
        request = httpx.Request(
            'POST',
            'http://backend.test/api/roadmaps/roadmap-1/ai/commit',
        )
        transport = SimpleNamespace(
            post=AsyncMock(
                side_effect=httpx.ConnectError(
                    'All connection attempts failed',
                    request=request,
                )
            )
        )
        client = self._client_with_transport(transport)

        with patch('app.core.nest_client.log_event') as log_event_mock:
            with self.assertRaises(HTTPException) as ctx:
                await client._post(
                    '/roadmaps/roadmap-1/ai/commit',
                    {'operations': []},
                    'Bearer test',
                    trace_id='trace-connect-error',
                )

        self.assertEqual(ctx.exception.status_code, 503)
        details = extract_upstream_error_details(ctx.exception.detail)
        self.assertEqual(details.get('code'), 'NEST_UNAVAILABLE')
        self.assertEqual(details.get('status_code'), 503)
        self.assertEqual(
            details.get('message'),
            'The backend service is temporarily unavailable. Please retry.',
        )
        log_event_mock.assert_called_once()
        logged = log_event_mock.call_args.kwargs
        self.assertEqual(logged.get('method'), 'POST')
        self.assertEqual(logged.get('status_code'), 503)
        self.assertEqual(logged.get('nest_transport_error'), 'ConnectError')

    async def test_get_maps_timeout_to_structured_504(self) -> None:
        request = httpx.Request(
            'GET',
            'http://backend.test/api/roadmaps/roadmap-1/ai/context/summary',
        )
        transport = SimpleNamespace(
            get=AsyncMock(
                side_effect=httpx.ReadTimeout(
                    'Timed out reading from backend',
                    request=request,
                )
            )
        )
        client = self._client_with_transport(transport)

        with patch('app.core.nest_client.log_event'):
            with self.assertRaises(HTTPException) as ctx:
                await client._get(
                    '/roadmaps/roadmap-1/ai/context/summary',
                    'Bearer test',
                    trace_id='trace-timeout',
                )

        self.assertEqual(ctx.exception.status_code, 504)
        details = extract_upstream_error_details(ctx.exception.detail)
        self.assertEqual(details.get('code'), 'NEST_TIMEOUT')
        self.assertEqual(details.get('status_code'), 504)
        self.assertEqual(
            details.get('message'),
            'The backend service timed out. Please retry.',
        )

    async def test_mutation_maps_connect_error_to_structured_503(self) -> None:
        request = httpx.Request(
            'PUT',
            'http://backend.test/api/roadmaps/roadmap-1/agent-state',
        )
        transport = SimpleNamespace(
            request=AsyncMock(
                side_effect=httpx.ConnectError(
                    'Connection refused',
                    request=request,
                )
            )
        )
        client = self._client_with_transport(transport)

        with patch('app.core.nest_client.log_event'):
            with self.assertRaises(HTTPException) as ctx:
                await client._mutate(
                    'PUT',
                    '/roadmaps/roadmap-1/agent-state',
                    {'state': {}},
                    'Bearer test',
                    trace_id='trace-mutation-connect-error',
                )

        self.assertEqual(ctx.exception.status_code, 503)
        details = extract_upstream_error_details(ctx.exception.detail)
        self.assertEqual(details.get('code'), 'NEST_UNAVAILABLE')


if __name__ == '__main__':
    unittest.main()
